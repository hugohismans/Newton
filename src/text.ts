import { Device } from './input';
import { HintKey } from './room';

type PerDevice = Record<Device, string>;

const HINTS: Record<HintKey, PerDevice> = {
  move: {
    touch: 'Glisse le pouce à gauche de l’écran pour bouger',
    keyboard: '← →  ou  Q D  pour bouger',
    gamepad: 'Stick ou croix pour bouger',
  },
  jump: {
    touch: 'Touche la droite de l’écran pour sauter',
    keyboard: 'Espace ou C pour sauter',
    gamepad: 'A pour sauter',
  },
  hold: {
    touch: 'Garde le doigt appuyé pour sauter plus haut',
    keyboard: 'Maintiens le saut pour monter plus haut',
    gamepad: 'Maintiens A pour monter plus haut',
  },
  walljump: {
    touch: 'Contre une paroi, saute pour rebondir dessus',
    keyboard: 'Contre une paroi, saute pour rebondir dessus',
    gamepad: 'Contre une paroi, saute pour rebondir dessus',
  },
  dash: {
    touch: 'Bouton ⚡ + direction : dash dans 8 directions',
    keyboard: 'X ou Maj + direction : dash dans 8 directions',
    gamepad: 'X ou B + direction : dash dans 8 directions',
  },
  refill: {
    touch: 'Le dash se recharge au sol… ou sur les cristaux verts',
    keyboard: 'Le dash se recharge au sol… ou sur les cristaux verts',
    gamepad: 'Le dash se recharge au sol… ou sur les cristaux verts',
  },
  dive: {
    touch: 'Debout sur une forme lumineuse : bouton ⤓ pour plonger dedans',
    keyboard: 'Debout sur une forme lumineuse : ↓ ou S pour plonger dedans',
    gamepad: 'Debout sur une forme lumineuse : ↓ pour plonger dedans',
  },
  fragment: {
    touch: 'La sortie est scellée. Le fragment est à l’intérieur…',
    keyboard: 'La sortie est scellée. Le fragment est à l’intérieur…',
    gamepad: 'La sortie est scellée. Le fragment est à l’intérieur…',
  },
  rise: {
    touch: 'Ce cercle te ramène à la surface',
    keyboard: 'Ce cercle te ramène à la surface',
    gamepad: 'Ce cercle te ramène à la surface',
  },
  super: {
    touch: 'Astuce : saute pendant un dash au sol pour un super-saut',
    keyboard: 'Astuce : saute pendant un dash au sol pour un super-saut',
    gamepad: 'Astuce : saute pendant un dash au sol pour un super-saut',
  },
};

export const hintText = (k: HintKey, d: Device) => HINTS[k][d];

export const ABILITY_CARDS = {
  wallJump: {
    title: 'Saut mural',
    body: {
      touch: 'Saute contre une paroi pour rebondir. Pousse vers elle pour glisser plus lentement.',
      keyboard: 'Saute contre une paroi pour rebondir. Pousse vers elle pour glisser plus lentement.',
      gamepad: 'Saute contre une paroi pour rebondir. Pousse vers elle pour glisser plus lentement.',
    } as PerDevice,
  },
  dash: {
    title: 'Dash',
    body: {
      touch: 'Bouton ⚡ + une direction. Un seul dash en l’air, rechargé en touchant le sol.',
      keyboard: 'X (ou Maj) + une direction. Un seul dash en l’air, rechargé en touchant le sol.',
      gamepad: 'X (ou B) + une direction. Un seul dash en l’air, rechargé en touchant le sol.',
    } as PerDevice,
  },
};
