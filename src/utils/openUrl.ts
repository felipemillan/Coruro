// openUrl.ts — the single, validated entry point for opening external URLs.
//
// SECURITY: repo `homepage` and fork `parent.url` come straight from the
// GitHub API (or a hand-edited repo remote), so they are untrusted input.
// Only http(s) URLs are ever passed to the OS handler — schemes like
// file:, javascript:, or vscode: are rejected. Routed through the opener
// plugin (the capability granted in capabilities/default.json).

import { openUrl as openerOpenUrl } from '@tauri-apps/plugin-opener';

/**
 * Open `url` in the user's browser, but ONLY when it is an http(s) URL.
 * Anything that fails to parse, or uses any other scheme, is ignored.
 * Never throws.
 */
export async function safeOpenUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return; // not a valid absolute URL
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return; // reject file:, javascript:, vscode:, etc.
  }
  try {
    await openerOpenUrl(parsed.toString());
  } catch {
    // open failure (handler missing / denied) — swallow, non-fatal.
  }
}
