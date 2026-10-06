/** Tiny WebAudio synth: every sound is generated, no assets. */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private padGain: GainNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  muted = false;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.startPad();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  /** Slow evolving drone; `depth` darkens and lowers it. */
  private startPad() {
    const ctx = this.ctx!;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.0;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 700;
    this.padFilter.Q.value = 2;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.master!);
    const notes = [55, 82.4, 110, 164.8, 220 * 1.122];
    for (const f of notes) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = 0.035;
        o.connect(g);
        g.connect(this.padFilter);
        o.start();
      }
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 350;
    lfo.connect(lg);
    lg.connect(this.padFilter.frequency);
    lfo.start();
    this.padGain.gain.setTargetAtTime(0.22, ctx.currentTime, 2);
  }

  setDepth(depth: number) {
    if (!this.ctx || !this.padFilter) return;
    this.padFilter.frequency.setTargetAtTime(700 / (1 + depth * 0.6), this.ctx.currentTime, 0.4);
  }

  private tone(
    freq: number,
    dur: number,
    opts: { type?: OscillatorType; to?: number; vol?: number; delay?: number; attack?: number } = {},
  ) {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    const g = ctx.createGain();
    const vol = opts.vol ?? 0.15;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, opts: { freq?: number; to?: number; vol?: number; q?: number } = {}) {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = opts.q ?? 1;
    const t0 = ctx.currentTime;
    f.frequency.setValueAtTime(opts.freq ?? 1000, t0);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.vol ?? 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
  }

  jump() {
    this.tone(330, 0.12, { to: 620, vol: 0.07, type: 'triangle' });
  }
  wallJump() {
    this.tone(300, 0.1, { to: 700, vol: 0.07, type: 'triangle' });
    this.noise(0.06, { freq: 3000, vol: 0.08 });
  }
  land() {
    this.noise(0.08, { freq: 300, to: 120, vol: 0.18 });
  }
  dash() {
    this.noise(0.22, { freq: 600, to: 4000, vol: 0.25, q: 2 });
    this.tone(180, 0.18, { to: 90, vol: 0.06, type: 'sawtooth' });
  }
  refill() {
    this.tone(880, 0.08, { vol: 0.05, type: 'sine' });
    this.tone(1320, 0.12, { vol: 0.05, type: 'sine', delay: 0.05 });
  }
  death() {
    this.noise(0.4, { freq: 1500, to: 100, vol: 0.3 });
    this.tone(440, 0.35, { to: 60, vol: 0.12, type: 'sawtooth' });
  }
  pickup() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, { vol: 0.07, type: 'triangle', delay: i * 0.07 }));
  }
  ability() {
    [392, 523, 659, 784, 1047, 1319].forEach((f, i) =>
      this.tone(f, 0.5, { vol: 0.07, type: 'triangle', delay: i * 0.09 }),
    );
  }
  dive() {
    this.tone(880, 1.1, { to: 110, vol: 0.09, type: 'sine', attack: 0.2 });
    this.noise(1.1, { freq: 4000, to: 200, vol: 0.12, q: 4 });
  }
  rise() {
    this.tone(110, 1.0, { to: 880, vol: 0.09, type: 'sine', attack: 0.2 });
    this.noise(1.0, { freq: 200, to: 4000, vol: 0.12, q: 4 });
  }
  exit() {
    [659, 784, 988, 1319].forEach((f, i) => this.tone(f, 0.3, { vol: 0.06, type: 'sine', delay: i * 0.06 }));
  }
  click() {
    this.tone(660, 0.05, { vol: 0.05, type: 'sine' });
  }
}
