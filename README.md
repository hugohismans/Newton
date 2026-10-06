# Newton

Prototype de platformer 2D fractal, avec des contrôles inspirés de Celeste.
Le terrain est fait de flocons de Koch et de tapis de Sierpinski. Les formes
lumineuses sont des portails : on plonge dedans pour explorer une version plus
petite du monde. En fond, des fractales de Newton (z³ − 1) et de Mandelbrot
calculées en shader suivent la profondeur.

## Jouer

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/index.html, un seul fichier autonome
```

| Action  | Tactile                      | Clavier                 | Manette        |
|---------|------------------------------|-------------------------|----------------|
| Bouger  | glisser à gauche de l'écran  | flèches, ZQSD ou WASD   | stick / croix  |
| Sauter  | toucher à droite (maintenir) | Espace, C               | A              |
| Dash    | bouton ⚡ + direction         | X, Maj                  | X, B, RT       |
| Plonger | bouton ⤓ sur une forme       | ↓ / S sur une forme     | ↓ ou Y         |
| Pause   | bouton en haut à gauche      | Échap, P                | Start          |

Les capacités se débloquent au fil des salles : saut, puis saut mural, puis dash.

## Structure

- `src/player.ts` : contrôleur à la Celeste (coyote time, saut bufferisé, saut variable, saut mural, dash 8 directions, super-saut)
- `src/collide.ts` : collisions cercle contre segments, avec grille d'accélération
- `src/fractals.ts` : génération du flocon et de la courbe de Koch, et du tapis de Sierpinski
- `src/room.ts`, `src/levels.ts` : constructeurs de salles et contenu des niveaux
- `src/game.ts` : états du jeu, caméra, transitions de plongée, interface et menus
- `src/background.ts` : shaders Newton et Mandelbrot en WebGL2
- `src/assets/hero.png` : sprite du héros, pack CC0 de JIK-A-4 (https://jik-a-4.itch.io/free-pixel-art-platformer-characters)
- `src/audio.ts` : sons synthétisés avec WebAudio, sans fichiers audio

Outils de dev : `?room=<id>` ouvre directement une salle, `&all` donne toutes les
capacités, `&overview` affiche la salle entière avec une grille, `&at=x,y` choisit
le point d'apparition.
