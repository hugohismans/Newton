import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build: the whole game ships as one self-contained index.html.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2020' },
});
