import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import terser from '@rollup/plugin-terser';
import { readFileSync } from 'fs';

export default {
  input: 'main.js',
  output: {
    file: 'dist/bundle.js',
    format: 'cjs',
    banner: '#!/usr/bin/env node',
    sourcemap: false
  },
  plugins: [
    resolve({
      preferBuiltins: true,
      exportConditions: ['node']
    }),
    commonjs(),
    json(),
    terser({
      compress: {
        drop_console: false,
        drop_debugger: true,
        pure_funcs: ['console.debug']
      },
      mangle: {
        keep_classnames: true,
        keep_fnames: true
      },
      format: {
        comments: false
      }
    }),
    {
      name: 'copy-files',
      generateBundle() {
        // Copy .env file to dist folder during build
        try {
          const envContent = readFileSync('.env', 'utf-8');
          this.emitFile({
            type: 'asset',
            fileName: '.env',
            source: envContent
          });
        } catch (error) {
          console.warn('Warning: .env file not found, skipping copy');
        }
        // Copy package.json to dist folder during build
        try {
          const packageContent = readFileSync('package.json', 'utf-8');
          this.emitFile({
            type: 'asset',
            fileName: 'package.json',
            source: packageContent
          });
        } catch (error) {
          console.warn('Warning: package.json file not found, skipping copy');
        }
      }
    }
  ],
  external: [
    'crypto',
    'dotenv',
    'ws',
    'node-telegram-bot-api',
    'socket.io-client',
    'crypto-js',
    'http',
    'https',
    'url',
    'fs',
    'path',
    'events',
    'stream',
    'util',
    'querystring',
    'buffer',
    'os'
  ]
};
