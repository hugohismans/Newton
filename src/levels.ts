import { v } from './math';
import {
  RoomDef,
  kochPath,
  block,
  carpet,
  carpetBlocks,
  flakeAt,
  flakeRoom,
  kochStrip,
  kochWall,
  portalize,
  room,
  spikes,
  squareFrame,
} from './room';

const rooms: RoomDef[] = [];
const add = (r: RoomDef) => (rooms.push(r), r);

// ───────────── Chapitre I · Flocon (Koch) ─────────────

add(
  room({
    id: 'premiers-pas',
    name: 'Premiers pas',
    chapter: 1,
    w: 774,
    walls: { left: true, right: true, top: false, bottom: false },
    h: 240,
    spawn: v(40, 170),
    exit: v(715, 138),
    solids: [
      kochPath(0, 180, [[18, 1, 12], [60, 2, 1], [18, 1, 7]], 320),
      kochPath(450, 180, [[18, 1, 6]], 320),
      kochPath(558, 158, [[18, 1, 12]], 320),
    ],
    hints: [
      { x: 110, y: 120, key: 'move' },
      { x: 250, y: 118, key: 'jump' },
      { x: 505, y: 112, key: 'hold' },
    ],
  }),
);

add(
  room({
    id: 'cristaux',
    name: 'Cristaux',
    chapter: 1,
    w: 820,
    h: 270,
    spawn: v(40, 190),
    exit: v(780, 164),
    solids: [
      kochStrip(0, 120, 200, 18, 1, 340),
      block(120, 252, 480, 90),
      flakeAt(150, 190, 60),
      flakeAt(240, 176, 54),
      flakeAt(330, 163, 48),
      flakeAt(420, 163, 84),
      flakeAt(540, 172, 42),
      kochStrip(600, 820, 182, 18, 1, 340),
    ],
    spikes: spikes(120, 600, 252),
  }),
);

add(
  room({
    id: 'paroi',
    name: 'Paroi',
    chapter: 1,
    w: 320,
    h: 480,
    spawn: v(160, 430),
    exit: v(272, 72),
    solids: [
      kochStrip(110, 210, 440, 20, 1, 560),
      kochWall(110, 90, 446, 40, 2, -1, 110),
      kochWall(210, 90, 446, 40, 2, 1, 110),
    ],
    items: [{ kind: 'wallJump', x: 160, y: 412, id: 'ab-walljump' }],
    hints: [{ x: 160, y: 340, key: 'walljump' }],
  }),
);

add(
  room({
    id: 'plongee',
    name: 'Plongée',
    chapter: 1,
    w: 620,
    h: 280,
    spawn: v(40, 210),
    exit: v(585, 202),
    requires: ['frag-flocon'],
    solids: [
      kochStrip(0, 620, 220, 18, 1, 340),
      flakeAt(140, 196, 36),
      flakeAt(195, 176, 36),
      flakeAt(250, 156, 96, 2, { portal: 'flocon-interieur' }),
    ],
    hints: [
      { x: 298, y: 104, key: 'dive' },
      { x: 520, y: 150, key: 'fragment' },
    ],
  }),
);

add(
  flakeRoom(
    {
      id: 'flocon-interieur',
      name: 'Intérieur du flocon',
      chapter: 1,
      parent: 'plongee',
      spawn: v(115, 355),
      exit: v(256, 434),
      solids: [
        flakeAt(160, 340, 36),
        flakeAt(230, 318, 36),
        flakeAt(160, 296, 36),
        flakeAt(230, 274, 36),
        flakeAt(160, 252, 36),
        flakeAt(230, 230, 36),
        flakeAt(160, 208, 36),
        flakeAt(230, 186, 36),
        flakeAt(160, 164, 36),
        flakeAt(230, 142, 36),
        flakeAt(160, 120, 36),
        flakeAt(230, 98, 36),
      ],
      items: [{ kind: 'fragment', x: 210, y: 50, id: 'frag-flocon' }],
    },
    420,
    2,
  ),
);

// ───────────── Chapitre II · Tapis (Sierpinski) ─────────────

add(
  room({
    id: 'elan',
    name: 'Élan',
    chapter: 2,
    w: 720,
    h: 280,
    walls: { left: true, right: true, top: false, bottom: false },
    spawn: v(30, 190),
    exit: v(657, 140),
    solids: [
      carpet(0, 200, 81, 2),
      carpet(81, 200, 81, 2),
      carpet(232, 200, 81, 2),
      carpet(440, 200, 81, 2),
      carpet(521, 200, 81, 2),
      carpet(602, 200, 81, 2),
      carpet(630, 154, 54, 2),
    ],
    items: [
      { kind: 'dash', x: 110, y: 182, id: 'ab-dash' },
      { kind: 'refill', x: 376, y: 180, id: 'elan-r1' },
    ],
    hints: [
      { x: 197, y: 130, key: 'dash' },
      { x: 376, y: 128, key: 'refill' },
      { x: 560, y: 140, key: 'super' },
    ],
  }),
);

// Three carpets side by side over a floor of crystal spikes.
const tapisSolids = [0, 1, 2].flatMap((i) =>
  carpetBlocks(i * 270, 0, 270, 3, (q) => (i === 1 && q.s === 90) || (i === 2 && q.s === 30 && q.y > 150)),
);
add(
  room({
    id: 'tapis',
    name: 'Tapis',
    chapter: 2,
    w: 810,
    h: 270,
    walls: { left: true, right: true, top: true, bottom: false },
    spawn: v(18, 248),
    exit: v(790, 30),
    solids: [block(0, 262, 30, 40), ...tapisSolids],
    spikes: spikes(30, 810, 270, -1, 7),
    items: [
      { kind: 'refill', x: 405, y: 135, id: 'tapis-r1' },
      { kind: 'refill', x: 600, y: 165, id: 'tapis-r2' },
    ],
  }),
);

const recursionRoom = (id: string, name: string, portalTo: string | null, extra: Partial<RoomDef> = {}) => {
  const S = 270;
  const blocks = carpetBlocks(0, 0, S, 3);
  // The deepest level is the true carpet: its central square is empty.
  const solids = portalTo ? [portalize(blocks[0], portalTo), ...blocks.slice(1)] : blocks.slice(1);
  return room({
    id,
    name,
    chapter: 2,
    w: S,
    h: S,
    walls: { left: true, right: true, top: true, bottom: true },
    frame: squareFrame(S),
    spawn: v(20, 262),
    exit: v(250, 262),
    solids,
    ...extra,
  });
};

add(
  recursionRoom('recursion', 'Récursion', 'recursion-1', {
    requires: ['frag-tapis'],
    hints: [
      { x: 135, y: 70, key: 'dive' },
      { x: 135, y: 230, key: 'fragment' },
    ],
  }),
);
add(
  recursionRoom('recursion-1', 'Récursion ×3', 'recursion-2', {
    spawn: v(250, 262),
    exit: v(20, 262),
    spikes: [...spikes(30, 240, 270, -1, 7)],
    items: [{ kind: 'refill', x: 135, y: 200, id: 'rec1-r1' }],
  }),
);
add(
  recursionRoom('recursion-2', 'Récursion ×9', null, {
    spawn: v(20, 262),
    exit: v(250, 262),
    items: [{ kind: 'fragment', x: 135, y: 135, id: 'frag-tapis' }],
  }),
);

export const ROOMS: Record<string, RoomDef> = Object.fromEntries(rooms.map((r) => [r.id, r]));
export const ORDER = ['premiers-pas', 'cristaux', 'paroi', 'plongee', 'elan', 'tapis', 'recursion'];
