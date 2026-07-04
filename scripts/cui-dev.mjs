#!/usr/bin/env node
/**
 * scripts/cui-dev.mjs  —  Start the CUI (console) development servers.
 *
 * Usage
 * ─────
 *   pnpm run cui:dev       runs concurrently (vite dev server + backend)
 *
 * Prerequisites
 *   • nodeenv virtual environment activated
 *     (.nodeenv\Scripts\Activate.ps1)
 *   • pnpm install has been run
 *
 * The backend starts with network HTTP only (no IPC).
 * The frontend connects via HTTP through Vite's proxy.
 */

import { run } from './runtime.mjs';

run(
  'concurrently --kill-others-on-fail' +
  ' "vite --config vite.demo.config.ts"' +
  ' "node backend/index.js"',
);
