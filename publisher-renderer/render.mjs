#!/usr/bin/env node
/* global process, URL, window, document */
// render.mjs — LOCAL headless asset renderer for the Coruro Publisher.
//
// The 4th process surface of Coruro (Chromium-bearing). Spawned over stdio by
// src-tauri/src/publisher.rs. Reads ONE JSON line from stdin, launches a headless
// Chromium via Playwright, loads the offscreen React build over file:// (or a
// localhost preview), injects the payload, waits for the nb-* styled component to
// settle, and screenshots each carousel page to a PNG. Prints ONE JSON line of
// absolute asset paths to stdout.
//
// HARD CONSTRAINTS honored here:
//   - LOCAL ONLY. Only file:// or 127.0.0.1/localhost origins are loaded. No
//     external network. We assert this before navigating.
//   - This is NOT the FoundationModels sidecar and performs no AI work.
//   - Absolute asset paths stay runtime-only; they are returned to the Rust
//     caller and never persisted.
//
// Protocol
//   stdin  (one line):  {"repo": "...", "target": "...", "data": {"cards":[...]},
//                        "outDir": "/abs/dir", "buildPath"?: "/abs/dist/offscreen.html",
//                        "previewUrl"?: "http://127.0.0.1:PORT/offscreen.html"}
//   stdout (one line):  {"assets": ["/abs/dir/card-1.png", ...]}
//   on error:           clear message to stderr + nonzero exit.

import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const READY_SELECTOR = 'body[data-coruro-render-ready="true"]';
const PAGE_SELECTOR = '.coruro-card-page';
const SETTLE_MS = 350;
const NAV_TIMEOUT_MS = 30_000;

/** Read one JSON line from stdin (fd 0), synchronously. */
function readStdinJson() {
  let raw;
  try {
    raw = readFileSync(0, 'utf8');
  } catch (e) {
    fail(`could not read stdin: ${e?.message ?? e}`);
  }
  const line = raw.split('\n').find((l) => l.trim().length > 0);
  if (!line) fail('empty stdin — expected one JSON line {repo,target,data,outDir}');
  try {
    return JSON.parse(line);
  } catch (e) {
    fail(`stdin is not valid JSON: ${e?.message ?? e}`);
  }
}

/** Print error to stderr and exit nonzero. */
function fail(msg) {
  process.stderr.write(`[publisher-renderer] ERROR: ${msg}\n`);
  process.exit(1);
}

/** Enforce the LOCAL-ONLY invariant on whatever URL we are about to load. */
function assertLocalUrl(url) {
  if (url.startsWith('file://')) return;
  try {
    const u = new URL(url);
    const host = u.hostname;
    const local =
      host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
    if (!local) fail(`refusing non-local origin (LOCAL ONLY): ${url}`);
  } catch {
    fail(`malformed render URL: ${url}`);
  }
}

async function main() {
  const input = readStdinJson();

  const outDir = input.outDir;
  if (!outDir || typeof outDir !== 'string')
    fail('missing "outDir" (absolute path) in stdin payload');
  const absOutDir = isAbsolute(outDir) ? outDir : resolve(process.cwd(), outDir);
  if (!existsSync(absOutDir)) mkdirSync(absOutDir, { recursive: true });

  // Resolve the render URL: explicit previewUrl (localhost) wins, else the
  // file:// build. Default build path is ../dist/offscreen.html relative to this
  // package (i.e. the app's vite build output).
  let url;
  if (input.previewUrl) {
    url = String(input.previewUrl);
  } else {
    const defaultBuild = resolve(import.meta.dirname, '..', 'dist', 'offscreen.html');
    const buildPath = input.buildPath ? String(input.buildPath) : defaultBuild;
    const absBuild = isAbsolute(buildPath) ? buildPath : resolve(process.cwd(), buildPath);
    if (!existsSync(absBuild)) {
      fail(
        `offscreen build not found at ${absBuild}. Run the app's \`vite build\` first ` +
          `(it must emit dist/offscreen.html — see vite.config.ts rollupOptions.input).`,
      );
    }
    url = pathToFileURL(absBuild).href;
  }
  assertLocalUrl(url);

  // Lazy-import Playwright so a missing install yields a clear, actionable error
  // rather than a module-load stack trace.
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    fail(
      'Playwright is not installed. Activate this package with:\n' +
        '  cd publisher-renderer && npm install && npx playwright install chromium\n' +
        `(import error: ${e?.message ?? e})`,
    );
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    fail(
      'could not launch headless Chromium. Install the browser binary with:\n' +
        '  cd publisher-renderer && npx playwright install chromium\n' +
        `(launch error: ${e?.message ?? e})`,
    );
  }

  const assets = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1080, height: 1080 },
      deviceScaleFactor: 2,
      offline: true, // belt-and-suspenders: no network from the renderer
    });

    // Inject the payload BEFORE any page script runs. offscreen.tsx reads
    // window.__CORURO_OFFSCREEN__ first, query param second.
    const payload = { repo: input.repo, target: input.target, data: input.data };
    await context.addInitScript((p) => {
      window.__CORURO_OFFSCREEN__ = p;
    }, payload);

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });

    // Wait for the React tree to commit (host sets data-coruro-render-ready),
    // then fonts, then a short settle for nb-* shadows/layout to stabilize.
    await page.waitForSelector(READY_SELECTOR, { timeout: NAV_TIMEOUT_MS });
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(SETTLE_MS);

    const pages = await page.$$(PAGE_SELECTOR);
    if (pages.length === 0) fail(`no "${PAGE_SELECTOR}" elements found — nothing to screenshot`);

    for (let i = 0; i < pages.length; i++) {
      const file = join(absOutDir, `card-${i + 1}.png`);
      await pages[i].screenshot({ path: file });
      assets.push(file);
    }
  } catch (e) {
    fail(`render failed: ${e?.message ?? e}`);
  } finally {
    await browser.close().catch(() => {});
  }

  process.stdout.write(JSON.stringify({ assets }) + '\n');
}

main().catch((e) => fail(e?.message ?? String(e)));
