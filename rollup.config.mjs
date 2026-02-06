import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';
import { readFileSync } from 'fs';

export default {
  input: 'main.js',
  output: {
    file: 'dist/bundle.js',
    format: 'cjs',
    sourcemap: false
  },
  plugins: [
    commonjs(),
    json(),
    terser(),
    {
      name: 'copy-env',
      generateBundle() {
        try {
          this.emitFile({
            type: 'asset',
            fileName: '.env',
            source: readFileSync('.env', 'utf-8')
          });
        } catch (e) {
          console.warn('.env not found, skipping');
        }
      }
    }
  ],
  external: (id) => id !== 'main.js' && !id.startsWith('.') && !id.startsWith('/')
};
