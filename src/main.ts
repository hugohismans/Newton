import { Game } from './game';

const bg = document.getElementById('bg') as HTMLCanvasElement;
const fg = document.getElementById('fg') as HTMLCanvasElement;
const safe = document.getElementById('safe') as HTMLElement;

const game = new Game(bg, fg, safe);

// On phones, go fullscreen and lock to landscape on the first touch (needs a user gesture).
let triedFullscreen = false;
fg.addEventListener('pointerup', (e) => {
  if (triedFullscreen || e.pointerType !== 'touch') return;
  triedFullscreen = true;
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => {});
  }
});

let last = performance.now();
const loop = (now: number) => {
  const dt = (now - last) / 1000;
  last = now;
  game.frame(dt);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
