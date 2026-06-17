/**
 * claudeEnrich.ts — Secret-free enrichment item builder for the Claude Command Center.
 *
 * SECRET-FREE GUARANTEE
 * ---------------------
 * This module never reads, stores, or forwards:
 *   • The raw `command` field of ClaudeMcpServer (may contain API keys or tokens
 *     embedded as CLI arguments or env-var assignments).
 *   • Any env-var value (ClaudeSettings.envKeys captures names only by design).
 *   • Any other credential or secret captured elsewhere in ClaudeInventory.
 *
 * For MCP servers the context string contains only: server name, transport kind,
 * and — for sse/http transports — the *hostname* of the URL (never the full URL,
 * which may include path-borne tokens).  hostname extraction is wrapped in a
 * try/catch so a malformed URL silently degrades to name+transport only.
 *
 * For sessions the context string is a humanized short name derived from the
 * project slug (a path-encoded directory name such as "-Users-admin-Github-Coruro")
 * by taking only the last non-empty dash-separated segment.  The raw slug is
 * never forwarded to any external service.
 *
 * Cap: at most 40 items (MCP first, then sessions) to bound downstream latency.
 */

import type { ClaudeInventory, ClaudeEnrichItem } from '../types';

/**
 * Maximum total items returned, to bound model-call latency. Kept equal to the
 * sidecar's per-batch cap (main.swift line 333 `prefix(40)`). PAIRED CONSTANT —
 * must be kept in sync; changes require updates to both this value and main.swift.
 */
const MAX_ITEMS = 40;

/**
 * Derives a human-readable project name from a Claude project slug.
 *
 * Claude stores transcripts under ~/.claude/projects/<slug> where <slug> is the
 * absolute project path with every "/" replaced by "-", e.g.:
 *   "-Users-admin-Github-Coruro"  →  "Coruro"
 *   "-Users-admin-my-project"     →  "project"
 *   "some-flat-slug"              →  "slug"
 *
 * Algorithm: split on "-", drop empty segments, return the last non-empty one.
 * Falls back to the full slug when no segment survives (should never happen in
 * practice, but guards against empty/all-dash slugs).
 *
 * @param slug - Raw project slug from ClaudeSessionStat.projectSlug.
 * @returns Short human-readable project name.
 */
export function humanizeSlug(slug: string): string {
  const segments = slug.split('-').filter((s) => s.length > 0);
  const last = segments[segments.length - 1];
  return last ?? slug;
}

/**
 * Extracts the hostname from a URL string without exposing path or query
 * parameters that might contain embedded tokens.
 *
 * @param url - Raw URL string (from ClaudeMcpServer.url).
 * @returns Hostname string, or null if parsing fails or url is falsy.
 */
function safeHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/**
 * Builds the secret-free list of enrichment items from a ClaudeInventory.
 *
 * Returns at most {@link MAX_ITEMS} items: MCP servers first, then sessions.
 * Each item carries only the information needed for the on-device model to
 * generate a short descriptive blurb — no secrets, no raw commands.
 *
 * @param inv - The full inventory produced by the Claude Command Center scanner.
 * @returns Ordered array of ClaudeEnrichItem, capped at 60 entries.
 */
export function buildEnrichmentItems(inv: ClaudeInventory): ClaudeEnrichItem[] {
  const items: ClaudeEnrichItem[] = [];

  // ── MCP servers ────────────────────────────────────────────────────────────
  for (const server of inv.mcpServers) {
    if (items.length >= MAX_ITEMS) break;

    // Base context: name · transport.  NEVER append the raw command (may carry
    // tokens) — only the scanner's pre-sanitized packageHint, which is the best
    // signal for what the server actually is (e.g. "@scope/server-github").
    let context = `${server.name} · ${server.transport}`;
    if (server.packageHint) {
      context += ` · package ${server.packageHint}`;
    }

    // For network transports, append the URL hostname only (not the full URL).
    const host = safeHost(server.url);
    if (host) {
      context += ` · ${host}`;
    }

    items.push({
      id: `mcp:${server.name}`,
      kind: 'mcp',
      context,
    });
  }

  // ── Sessions ───────────────────────────────────────────────────────────────
  for (const session of inv.sessions) {
    if (items.length >= MAX_ITEMS) break;

    items.push({
      id: `session:${session.projectSlug}`,
      kind: 'session',
      context: humanizeSlug(session.projectSlug),
    });
  }

  return items;
}
