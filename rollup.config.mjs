import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));

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
      name: 'copy-deploy-files',
      generateBundle() {
        // Copy .env
        try {
          this.emitFile({
            type: 'asset',
            fileName: '.env',
            source: readFileSync('.env', 'utf-8')
          });
        } catch (e) {
          console.warn('.env not found, skipping');
        }

        // Copy app.yaml
        try {
          this.emitFile({
            type: 'asset',
            fileName: 'app.yaml',
            source: readFileSync('app.yaml', 'utf-8')
          });
        } catch (e) {
          console.warn('app.yaml not found, skipping');
        }

        // Generate minimal package.json for deploy
        this.emitFile({
          type: 'asset',
          fileName: 'package.json',
          source: JSON.stringify({
            name: pkg.name,
            version: pkg.version,
            main: 'bundle.js',
            scripts: { start: 'node bundle.js', 'gcp-build': '' },
            engines: pkg.engines,
            dependencies: pkg.dependencies
          }, null, 2)
        });
      }
    }
  ],
  external: (id) => id !== 'main.js' && !id.startsWith('.') && !id.startsWith('/')
};
