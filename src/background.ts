/** Full-screen fractal backdrop (Newton z³−1 and Mandelbrot), rendered at reduced resolution. */

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uCenter;
uniform float uZoom;
uniform float uMix;    // 0 = Newton, 1 = Mandelbrot
uniform float uHue;    // palette shift with depth
uniform float uBright;
out vec4 outColor;

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
vec2 cdiv(vec2 a, vec2 b) { float d = dot(b, b); return vec2(a.x*b.x + a.y*b.y, a.y*b.x - a.x*b.y) / d; }

vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d) { return a + b * cos(6.28318 * (c * t + d)); }

vec3 newton(vec2 z) {
  vec2 a = vec2(1.0 + 0.18 * sin(uTime * 0.11), 0.16 * cos(uTime * 0.083));
  const vec2 r1 = vec2(1.0, 0.0);
  const vec2 r2 = vec2(-0.5, 0.8660254);
  const vec2 r3 = vec2(-0.5, -0.8660254);
  float it = 0.0;
  int root = -1;
  for (int i = 0; i < 28; i++) {
    vec2 z2 = cmul(z, z);
    vec2 z3 = cmul(z2, z);
    z -= cmul(a, cdiv(z3 - vec2(1.0, 0.0), 3.0 * z2));
    if (distance(z, r1) < 0.02) { root = 0; break; }
    if (distance(z, r2) < 0.02) { root = 1; break; }
    if (distance(z, r3) < 0.02) { root = 2; break; }
    it += 1.0;
  }
  vec3 c0 = pal(uHue + 0.00, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.55, 0.65, 0.75));
  vec3 c1 = pal(uHue + 0.33, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.55, 0.65, 0.75));
  vec3 c2 = pal(uHue + 0.66, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.55, 0.65, 0.75));
  vec3 col = root == 0 ? c0 : root == 1 ? c1 : root == 2 ? c2 : vec3(0.0);
  float shade = pow(1.0 - it / 28.0, 2.2);
  float edge = smoothstep(4.0, 14.0, it) * (1.0 - shade);
  return col * (0.18 + 0.82 * shade) * 0.55 + vec3(0.25, 0.55, 1.0) * edge * 0.35;
}

vec3 mandel(vec2 c) {
  vec2 z = vec2(0.0);
  float n = 0.0;
  const float MAXI = 160.0;
  for (int i = 0; i < 160; i++) {
    z = cmul(z, z) + c;
    if (dot(z, z) > 256.0) break;
    n += 1.0;
  }
  if (n >= MAXI) return vec3(0.0);
  float sn = n - log2(log2(dot(z, z))) + 4.0;
  float t = sn / 48.0 + uHue;
  vec3 col = pal(t, vec3(0.5), vec3(0.5), vec3(1.0, 1.0, 1.0), vec3(0.0, 0.10, 0.20));
  return col * (0.35 + 0.65 * smoothstep(0.0, 30.0, sn)) * 0.75;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec2 p = uCenter + uv * uZoom;
  vec3 col = vec3(0.0);
  if (uMix < 0.999) col += newton(p) * (1.0 - uMix);
  if (uMix > 0.001) col += mandel(p) * uMix;
  float vig = 1.0 - 0.65 * dot(uv, uv);
  col *= vig * uBright;
  col += vec3(0.010, 0.012, 0.035);
  outColor = vec4(col, 1.0);
}`;

export interface BgParams {
  centerX: number;
  centerY: number;
  zoom: number;
  mix: number;
  hue: number;
  bright: number;
}

export class Background {
  private gl: WebGL2RenderingContext | null;
  private prog: WebGLProgram | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private scale = 0.5;

  constructor(private canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!this.gl) return;
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      this.gl = null;
      return;
    }
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uRes', 'uTime', 'uCenter', 'uZoom', 'uMix', 'uHue', 'uBright'])
      this.u[n] = gl.getUniformLocation(prog, n);
  }

  get ok() {
    return !!this.gl;
  }

  resize(cssW: number, cssH: number) {
    // Keep the shader cheap on phones: cap the backdrop to ~520 px tall.
    this.scale = Math.min(1, 520 / cssH, 900 / cssW) * Math.min(1.5, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(cssW * this.scale));
    this.canvas.height = Math.max(1, Math.round(cssH * this.scale));
  }

  /** Adapt resolution if frames are slow. */
  degrade() {
    this.scale *= 0.8;
    this.canvas.width = Math.max(1, Math.round(this.canvas.width * 0.8));
    this.canvas.height = Math.max(1, Math.round(this.canvas.height * 0.8));
  }

  draw(t: number, p: BgParams) {
    const gl = this.gl;
    if (!gl || !this.prog) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.uTime, t);
    gl.uniform2f(this.u.uCenter, p.centerX, p.centerY);
    gl.uniform1f(this.u.uZoom, p.zoom);
    gl.uniform1f(this.u.uMix, p.mix);
    gl.uniform1f(this.u.uHue, p.hue);
    gl.uniform1f(this.u.uBright, p.bright);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
