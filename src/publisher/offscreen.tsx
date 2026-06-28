// offscreen.tsx — headless render target for the Coruro Publisher.
//
// This is NOT mounted by the running Tauri app. It is a standalone Vite entry
// built once (`vite build`) into `dist/offscreen.html` and loaded over file://
// by the LOCAL Playwright renderer (`publisher-renderer/render.mjs`), which is
// spawned by `src-tauri/src/publisher.rs`. The renderer screenshots the
// stark-outline Neo-Brutalist cards mounted here into PNG carousel pages.
//
// It is a THIN host: it introduces no new design language and no new card
// components. It reuses the EXISTING presentational components —
// `DailyNoteBento` (pure, all data via props) and `RepoCard` — and the existing
// nb-* primitives in src/index.css. Each card is wrapped in a fixed 1080x1080
// `.coruro-card-page` so the renderer can screenshot one element per carousel
// page.
//
// LOCAL ONLY. This module performs zero network I/O. The only AI/network policy
// surface is the PTY claude path elsewhere; nothing here touches it.
//
// ── Data injection contract ──────────────────────────────────────────────────
// The renderer injects a payload BEFORE navigation via Playwright
// `context.addInitScript`, setting:
//     window.__CORURO_OFFSCREEN__ = { repo, target, data }
// Fallback for manual/file:// testing: a `?payload=<encodeURIComponent(JSON)>`
// query param. `data.cards` is the ordered list of carousel pages to render.
//
// ── VITE INTEGRATION (Integration agent owns vite.config.ts — do NOT edit it
//    here) ───────────────────────────────────────────────────────────────────
// Add a multi-page build input so `vite build` emits `dist/offscreen.html`
// alongside the app's `dist/index.html`:
//
//     import { resolve } from 'node:path';
//     // ...
//     build: {
//       rollupOptions: {
//         input: {
//           main: resolve(__dirname, 'index.html'),
//           offscreen: resolve(__dirname, 'offscreen.html'),
//         },
//       },
//     },
//
// THE EXACT INPUT ENTRY TO ADD:
//     offscreen: resolve(__dirname, 'offscreen.html')
//
// This also requires a root-level host `offscreen.html` (created alongside this
// file) whose only job is `<script type="module" src="/src/publisher/offscreen.tsx">`.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { DailyNoteBento } from '../components/DailyNoteBento';
import { RepoCard } from '../components/RepoCard';
import type { DailyNoteData } from '../utils/parseDailyNote';
import type { Repo } from '../types';

/** One carousel page. Discriminated on `kind`. */
type CardSpec =
  | {
      kind: 'daily-note';
      data: DailyNoteData;
      trigger?: string;
      generatedAt?: string | number;
    }
  | {
      kind: 'repo-card';
      repo: Repo;
    };

interface OffscreenPayload {
  repo?: string;
  target?: string;
  data?: { cards?: CardSpec[] } | null;
}

/** Marker the renderer polls before screenshotting. */
const READY_ATTR = 'data-coruro-render-ready';
/** Class the renderer queries to find each carousel page element. */
const PAGE_CLASS = 'coruro-card-page';

/** Read the injected payload from the window global, then the query param. */
function readPayload(): OffscreenPayload {
  const w = window as unknown as { __CORURO_OFFSCREEN__?: OffscreenPayload };
  if (w.__CORURO_OFFSCREEN__) return w.__CORURO_OFFSCREEN__;
  try {
    const raw = new URLSearchParams(window.location.search).get('payload');
    if (raw) return JSON.parse(decodeURIComponent(raw)) as OffscreenPayload;
  } catch {
    // fall through to empty payload — host renders a visible empty state
  }
  return {};
}

/**
 * Fixed 1080x1080 social-card frame. The cream nb surface + thick navy outline
 * come straight from the existing primitives; we add no new chrome here.
 */
function CardPage({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <div
      className={`${PAGE_CLASS} nb-card bg-cream flex items-center justify-center overflow-hidden`}
      data-page-index={index}
      style={{ width: 1080, height: 1080, padding: 64, boxSizing: 'border-box' }}
    >
      <div style={{ width: '100%' }}>{children}</div>
    </div>
  );
}

function renderCard(card: CardSpec, index: number) {
  if (card.kind === 'repo-card') {
    return (
      <CardPage key={index} index={index}>
        <RepoCard repo={card.repo} />
      </CardPage>
    );
  }
  // daily-note
  return (
    <CardPage key={index} index={index}>
      <DailyNoteBento
        data={card.data}
        trigger={card.trigger ?? 'Publisher'}
        generatedAt={card.generatedAt ?? Date.now()}
      />
    </CardPage>
  );
}

function OffscreenHost() {
  const payload = readPayload();
  const cards = payload.data?.cards ?? [];

  if (cards.length === 0) {
    return (
      <div
        className={`${PAGE_CLASS} nb-card bg-cream flex items-center justify-center`}
        data-page-index={0}
        style={{ width: 1080, height: 1080 }}
      >
        <p className="text-navy font-bold text-xl">No card payload provided.</p>
      </div>
    );
  }

  return <div className="flex flex-col gap-8 p-8 bg-warm-gray">{cards.map(renderCard)}</div>;
}

const rootEl = document.getElementById('offscreen-root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <OffscreenHost />
    </StrictMode>,
  );
  // Signal the renderer that the React tree has committed. The renderer also
  // waits for fonts + a settle delay; this flag is the primary gate.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.setAttribute(READY_ATTR, 'true');
    });
  });
}
