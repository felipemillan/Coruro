# Ask Calm Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Coruro Ask tab calm and approachable for non-technical "vibe-coder" users, without changing the billing model — restyle the terminal, add a guided start screen built on the existing tool mega-menu, and have Claude confirm intent in plain language before acting.

**Architecture:** Four independent, separately-shippable phases over the existing single PTY/xterm session. No second `claude -p` stream (that bills a separate capped credit — see decision log). Phase 1 = visual polish via existing M3 Tailwind tokens + xterm theme. Phase 2 = a `StartPanel` empty-state component reusing the inventory data the mega-menu already loads, plus a hardcoded common-task template list; clicks fill the prompt box. Phase 3 = an intent-confirmation preamble injected at session start through the existing ready-marker injection mechanism, gated by a settings toggle. Phase 4 = onboarding/copy polish.

**Tech Stack:** React 18, TypeScript, Tauri v2, xterm.js (`@xterm/xterm`), Tailwind v4 (M3 token theme), Zustand store, Vitest.

---

## Decision Log (locked before writing)

- **No visual tool cards / no second headless stream.** Verified `claude -p --output-format=stream-json` runs on plan login but meters cost at API rates against a separate, capped, opt-in monthly credit ($20 Pro / $100 Max5x / $200 Max20x) — confirmed by the live experiment (`total_cost_usd` + `service_tier: standard` in the result event) and the billing note. Running a card stream alongside the PTY = uncapped-feeling drain on a capped pool, silent-failure UX for non-techs. Killed.
- **Keep the terminal recognizable.** Restyle for calm, do not disguise xterm as a chat-bubble UI (raw PTY can't be losslessly re-rendered as bubbles without the killed stream or fragile scraping).
- **Use existing M3 tokens** (`cream`/`warm-gray`/`navy`/`sage`), not the mockup's terracotta accent — house-style consistency.
- **Intent-confirmation = prompt preamble**, injected through the existing `fireCavemanSequence` ready-marker path. Default ON, toggle in settings.
- **Common-task templates = 8 hardcoded vibe-coder tasks** (drafted in Task 2.1). Not user-editable in v1 (YAGNI).

---

## File Structure

**New files:**
- `src/components/ask/startTemplates.ts` — common-task template data + types (Phase 2)
- `src/components/ask/StartPanel.tsx` — guided empty-state panel: Your tools / Common tasks / Recent (Phase 2)
- `src/components/ask/intentPreamble.ts` — builds the intent-confirmation preamble string (Phase 3)
- `src/__tests__/startTemplates.test.ts` — template list invariants (Phase 2)
- `src/__tests__/intentPreamble.test.ts` — preamble builder (Phase 3)

**Modified files:**
- `src/components/ask/useAskTerminal.ts` — xterm theme/font (Phase 1); intent preamble injection in the ready-marker sequence (Phase 3)
- `src/components/ask/AskTerminalPanel.tsx` — replace bare empty state (`:138-150`) with `<StartPanel>` (Phase 2); softened copy + calm chrome (Phase 1/4)
- `src/index.css` — terminal-panel chrome tokens / spacing polish (Phase 1)
- `src/store/useViewStore.ts` — `calmIntentConfirm: boolean` setting + toggle action (Phase 3)
- `src/components/AskTab.tsx` — pass recent sessions + fill/start callbacks down to `StartPanel` (Phase 2)

---

## PHASE 1 — Calm visual polish (ship alone)

Pure styling. Uses existing M3 tokens. No logic change.

### Task 1.1: Warm the xterm theme + font

**Files:**
- Modify: `src/components/ask/useAskTerminal.ts:26-32` (TERM_THEME), `:94-100` (Terminal options)

- [ ] **Step 1: Update TERM_THEME to the calmer warm-dark palette**

Replace the `TERM_THEME` constant (lines 26–32) with:

```typescript
// Warm dark — calmer than pure terminal, aligned to M3 navy surface
const TERM_THEME = {
  background: '#262320',          // warm dark (was #1A1C16)
  foreground: '#EDE7DC',          // soft off-white (was #F9FAEF)
  cursor: '#C2643B',              // accent cursor, easy to spot
  cursorAccent: '#262320',
  selectionBackground: '#4C662B55',
  black: '#262320',
  brightBlack: '#5a534a',
};
```

- [ ] **Step 2: Increase font size + line spacing for readability**

In the `new Terminal({...})` options (lines 94–100), change:

```typescript
const term = new Terminal({
  fontSize: 13.5,                 // was 12.5 — easier to read
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, 'Courier New', monospace",
  lineHeight: 1.4,                // add — breathing room
  cursorBlink: true,
  theme: TERM_THEME,
  scrollback: 5000,
});
```

- [ ] **Step 3: Verify visually**

Run the app: `npm run tauri dev`. Open Ask, start a session. Expected: warm-dark terminal, larger readable text, terracotta cursor. No functional change.

- [ ] **Step 4: Commit**

```bash
git add src/components/ask/useAskTerminal.ts
git commit -m "style(ask): warm terminal theme + readable font"
```

### Task 1.2: Calm chrome around the terminal panel

**Files:**
- Modify: `src/components/ask/AskTerminalPanel.tsx` (container + controls wrapper)
- Modify: `src/index.css` (add `.ask-panel` polish tokens if needed)

- [ ] **Step 1: Soften the panel container**

In `AskTerminalPanel.tsx`, wrap the terminal DOM container with generous padding and rounded corners using existing tokens. Find the terminal container div and ensure its parent uses:

```tsx
// terminal panel wrapper
<div className="flex h-full flex-col bg-cream">
  {/* controls row stays */}
  <div className="flex-1 overflow-hidden rounded-xl border border-warm-gray bg-[#262320] p-3">
    {/* xterm mount container */}
    <div ref={containerRef} className="h-full" />
  </div>
</div>
```

(Match the existing class names actually present — read the file first; this is the target shape, not a blind replace.)

- [ ] **Step 2: Verify visually**

`npm run tauri dev` → Ask. Expected: terminal sits in a soft rounded card on cream background, not edge-to-edge black.

- [ ] **Step 3: Commit**

```bash
git add src/components/ask/AskTerminalPanel.tsx src/index.css
git commit -m "style(ask): calm rounded chrome around terminal"
```

---

## PHASE 2 — Guided start screen (ship alone)

Replaces the bare empty state with the discoverability panel: Your tools / Common tasks / Recent.

### Task 2.1: Common-task template data

**Files:**
- Create: `src/components/ask/startTemplates.ts`
- Test: `src/__tests__/startTemplates.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/startTemplates.test.ts
import { describe, it, expect } from 'vitest';
import { START_TEMPLATES } from '../components/ask/startTemplates';

describe('START_TEMPLATES', () => {
  it('has 6-10 vibe-coder tasks', () => {
    expect(START_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    expect(START_TEMPLATES.length).toBeLessThanOrEqual(10);
  });

  it('every template has a plain-language label, a one-line hint, and a prompt with no trailing newline', () => {
    for (const t of START_TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.hint.length).toBeGreaterThan(0);
      expect(t.prompt.length).toBeGreaterThan(0);
      expect(t.prompt.endsWith('\n')).toBe(false); // inserted without submit
    }
  });

  it('uses no developer jargon in labels (no slashes, no "subagent", no "repo")', () => {
    for (const t of START_TEMPLATES) {
      expect(t.label.toLowerCase()).not.toMatch(/\/|subagent|repo\b|stdout|exit code/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/startTemplates.test.ts`
Expected: FAIL — cannot resolve `startTemplates`.

- [ ] **Step 3: Write the template data**

```typescript
// src/components/ask/startTemplates.ts

export interface StartTemplate {
  id: string;
  label: string;   // plain-language, no jargon
  hint: string;    // one-line description
  prompt: string;  // inserted into the prompt WITHOUT a trailing newline
}

export const START_TEMPLATES: StartTemplate[] = [
  {
    id: 'fix-homepage-text',
    label: 'Fix my homepage text',
    hint: 'Improve the wording on a page',
    prompt: 'Help me improve the wording on my homepage. First show me the current text, then suggest clearer versions before changing anything.',
  },
  {
    id: 'explain-project',
    label: 'Explain this project',
    hint: 'Plain-language overview of what you have',
    prompt: 'Give me a plain-language overview of this project — what it does, the main parts, and where things live. No jargon.',
  },
  {
    id: 'review-change',
    label: 'Review my latest change',
    hint: 'Catch problems before you ship',
    prompt: 'Review my most recent change for mistakes or things that could break. Explain anything you find in plain language.',
  },
  {
    id: 'add-contact-form',
    label: 'Add a contact form',
    hint: 'Build a small feature',
    prompt: 'I want to add a simple contact form to my site. Ask me what fields I need, then plan it out before building.',
  },
  {
    id: 'change-colors',
    label: 'Change my colors or fonts',
    hint: 'Adjust the look and feel',
    prompt: 'I want to change the look of my site. Show me where the colors and fonts are set, then help me adjust them.',
  },
  {
    id: 'fix-broken',
    label: 'Something looks broken',
    hint: 'Find and fix a visible problem',
    prompt: "Something on my site doesn't look right. Help me describe it, find the cause, and fix it.",
  },
  {
    id: 'write-copy',
    label: 'Write copy for me',
    hint: 'Draft text for a page or section',
    prompt: 'Help me write the text for a page. Ask me what the page is for and who reads it, then draft a few options.',
  },
  {
    id: 'make-responsive',
    label: 'Make it work on phones',
    hint: 'Check and fix mobile layout',
    prompt: 'Check whether my site looks good on a phone screen, and fix anything that breaks on small screens.',
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/startTemplates.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ask/startTemplates.ts src/__tests__/startTemplates.test.ts
git commit -m "feat(ask): common-task starter templates for non-tech users"
```

### Task 2.2: StartPanel component

**Files:**
- Create: `src/components/ask/StartPanel.tsx`
- Reads: `useClaudeStore.inventory` (skills/agents/commands/mcpServers), `START_TEMPLATES`

**Props contract:**

```typescript
interface StartPanelProps {
  repoName: string;                          // '' if no repo selected
  recent: { id: string; repoName: string; startedAt: number }[];
  onInsert: (text: string) => void;          // fill the prompt box (no submit)
  onPickRecent: (sessionId: string) => void; // switch to a past session
}
```

- [ ] **Step 1: Build the component**

```tsx
// src/components/ask/StartPanel.tsx
import { useClaudeStore } from '../../store/useClaudeStore';
import { START_TEMPLATES } from './startTemplates';
import { fmtTime } from './askUtils';

interface StartPanelProps {
  repoName: string;
  recent: { id: string; repoName: string; startedAt: number }[];
  onInsert: (text: string) => void;
  onPickRecent: (sessionId: string) => void;
}

export function StartPanel({ repoName, recent, onInsert, onPickRecent }: StartPanelProps) {
  const inventory = useClaudeStore((s) => s.inventory);
  const agents = inventory?.agents ?? [];
  const skills = inventory?.skills ?? [];

  return (
    <div className="mx-auto max-w-4xl px-8 py-9">
      <h1 className="text-[22px] font-bold tracking-tight text-navy">What do you want to do?</h1>
      <p className="mt-1 mb-7 max-w-[46ch] text-navy-light">
        Type below, or pick one of your tools — you don't have to remember what's there.
      </p>

      <div className="grid grid-cols-3 gap-5">
        {/* Your tools */}
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-navy-light">Your tools</h2>
          {agents.slice(0, 4).map((a) => (
            <button
              key={a.path}
              onClick={() => onInsert(`Use the ${a.name} subagent to `)}
              className="mb-2 flex w-full items-center gap-2.5 rounded-xl border border-warm-gray bg-cream/60 p-2.5 text-left hover:border-sage hover:bg-white"
            >
              <span className="text-base">🤖</span>
              <span>
                <span className="block text-[13px] font-semibold text-navy">{a.name}</span>
                <span className="block text-[11.5px] text-navy-light">{a.description}</span>
              </span>
            </button>
          ))}
          {skills.slice(0, 2).map((s) => (
            <button
              key={s.path}
              onClick={() => onInsert(`/${s.source ? `${s.source}:` : ''}${s.dirName} `)}
              className="mb-2 flex w-full items-center gap-2.5 rounded-xl border border-warm-gray bg-cream/60 p-2.5 text-left hover:border-sage hover:bg-white"
            >
              <span className="text-base">✦</span>
              <span>
                <span className="block text-[13px] font-semibold text-navy">{s.name}</span>
                <span className="block text-[11.5px] text-navy-light">{s.description}</span>
              </span>
            </button>
          ))}
        </section>

        {/* Common tasks */}
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-navy-light">Common tasks</h2>
          {START_TEMPLATES.slice(0, 6).map((t) => (
            <button
              key={t.id}
              onClick={() => onInsert(t.prompt)}
              className="mb-2 flex w-full items-center gap-2.5 rounded-xl border border-warm-gray bg-cream/60 p-2.5 text-left hover:border-sage hover:bg-white"
            >
              <span className="text-base">✏️</span>
              <span>
                <span className="block text-[13px] font-semibold text-navy">{t.label}</span>
                <span className="block text-[11.5px] text-navy-light">{t.hint}</span>
              </span>
            </button>
          ))}
        </section>

        {/* Recent */}
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-navy-light">Recent</h2>
          {recent.length === 0 && (
            <p className="text-[12px] text-navy-light">Your past chats show up here.</p>
          )}
          {recent.slice(0, 5).map((r) => (
            <button
              key={r.id}
              onClick={() => onPickRecent(r.id)}
              className="mb-2 flex w-full items-center gap-2.5 rounded-xl border border-warm-gray bg-cream/60 p-2.5 text-left hover:border-sage hover:bg-white"
            >
              <span className="text-base">↺</span>
              <span>
                <span className="block text-[13px] font-semibold text-navy">{r.repoName}</span>
                <span className="block text-[11.5px] text-navy-light">{fmtTime(r.startedAt)}</span>
              </span>
            </button>
          ))}
        </section>
      </div>

      <p className="mt-6 border-t border-dashed border-warm-gray pt-4 text-[12.5px] text-navy-light">
        💡 Clicking a tool drops a ready-to-edit starter prompt into the chat. Nothing runs until you press Enter.
      </p>
    </div>
  );
}
```

> Note: confirm `ClaudeSkill` exposes `source` and `dirName` and `ClaudeAgent` exposes `name`/`description`/`path` (per the inventory types in `types.ts`). Adjust field access to match.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors in `StartPanel.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ask/StartPanel.tsx
git commit -m "feat(ask): StartPanel guided empty state (tools/tasks/recent)"
```

### Task 2.3: Wire StartPanel into the empty state

**Files:**
- Modify: `src/components/ask/AskTerminalPanel.tsx:138-150` (replace bare empty state)
- Modify: `src/components/AskTab.tsx` (pass `recent`, fill, `onPickRecent` down)

- [ ] **Step 1: Pass data from AskTab**

In `AskTab.tsx`, derive `recent` from `chatSessions.sessions` (newest first) and pass a prompt-box fill handler + `switchToSession` through `AskTerminalPanel` to `StartPanel`:

```tsx
const recent = useMemo(
  () => [...sessions]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((s) => ({ id: s.id, repoName: s.repoName, startedAt: s.startedAt })),
  [sessions],
);
```

Thread `recent`, a `setQuestion`-based fill callback, and `switchToSession` into `AskTerminalPanel` props.

- [ ] **Step 2: Render StartPanel in the empty branch**

In `AskTerminalPanel.tsx`, replace the `activeSessionId === null` block (lines 138–150) with:

```tsx
{activeSessionId === null && (
  <StartPanel
    repoName={repoPath !== '' ? getRepoName(repoPath) : ''}
    recent={recent}
    onInsert={onFillPrompt}
    onPickRecent={switchToSession}
  />
)}
```

Add the import: `import { StartPanel } from './StartPanel';`

> Caveat — no PTY exists in the empty state, so `onInsert` MUST fill the prompt *input box* (set `question` state in `AskTab`), NOT call `pty_write`. The clicked prompt is then ready; pressing Enter spawns the session with that text. The live-session insert path (TopActionBar `pty_write`, no `\r`) is unchanged and unrelated.

- [ ] **Step 3: Verify**

`npm run tauri dev` → Ask with no active session. Expected: three-column StartPanel renders; clicking a chip fills the prompt box; pressing Enter starts the session with that text.

- [ ] **Step 4: Commit**

```bash
git add src/components/ask/AskTerminalPanel.tsx src/components/AskTab.tsx
git commit -m "feat(ask): render StartPanel as the calm empty state"
```

---

## PHASE 3 — Intent confirmation (ship alone)

Claude restates the ask + plan in plain language before acting. Injected via the existing ready-marker mechanism. Toggleable.

### Task 3.1: Settings flag

**Files:**
- Modify: `src/store/useViewStore.ts` (add `calmIntentConfirm` + toggle)

- [ ] **Step 1: Add the flag + action**

In `useViewStore.ts`, add to state (default `true`) and actions:

```typescript
// state
calmIntentConfirm: boolean;
// actions
setCalmIntentConfirm: (on: boolean) => void;
```

Implementation (in the store creator):

```typescript
calmIntentConfirm: true,
setCalmIntentConfirm: (on) => set({ calmIntentConfirm: on }),
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/store/useViewStore.ts
git commit -m "feat(ask): calmIntentConfirm setting (default on)"
```

### Task 3.2: Preamble builder

**Files:**
- Create: `src/components/ask/intentPreamble.ts`
- Test: `src/__tests__/intentPreamble.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/intentPreamble.test.ts
import { describe, it, expect } from 'vitest';
import { buildIntentPreamble } from '../components/ask/intentPreamble';

describe('buildIntentPreamble', () => {
  it('returns a single-line instruction (no embedded newlines that would submit early)', () => {
    const p = buildIntentPreamble();
    expect(p.length).toBeGreaterThan(0);
    expect(p.includes('\n')).toBe(false);
  });

  it('asks Claude to restate the request and plan before acting', () => {
    const p = buildIntentPreamble().toLowerCase();
    expect(p).toMatch(/restate|plain language|before/);
    expect(p).toMatch(/plan|what you.?ll do|confirm/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/intentPreamble.test.ts`
Expected: FAIL — cannot resolve `intentPreamble`.

- [ ] **Step 3: Implement**

```typescript
// src/components/ask/intentPreamble.ts

/**
 * One-line operator instruction injected at session start (no trailing newline;
 * the caller appends the submit). Asks Claude to confirm intent before acting —
 * the highest-leverage safety net for non-technical users who can't pre-scope.
 */
export function buildIntentPreamble(): string {
  return (
    'For the rest of this session: before you make any change or run anything, ' +
    'first restate what I asked for in plain language, list in 1-3 short bullets what you plan to do, ' +
    'and wait for me to confirm. Skip the confirmation only for read-only actions like looking at files. ' +
    'Keep all explanations jargon-free.'
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/intentPreamble.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ask/intentPreamble.ts src/__tests__/intentPreamble.test.ts
git commit -m "feat(ask): intent-confirmation preamble builder"
```

### Task 3.3: Inject the preamble at session start

**Files:**
- Modify: `src/components/ask/useAskTerminal.ts:196-222` (the existing ready-marker injection sequence, `fireCavemanSequence`)

- [ ] **Step 1: Inject after the caveman sequence, before the user prompt**

In the ready-marker handler that currently injects `/caveman:caveman ultra`, append the intent preamble when the setting is on. Read `calmIntentConfirm` from `useViewStore.getState()` at injection time. Sequence ordering: caveman directive → intent preamble (each submitted with `\r`) → then the user's queued prompt.

```typescript
import { buildIntentPreamble } from './intentPreamble';
import { useViewStore } from '../../store/useViewStore';

// inside the ready-marker injection, after the caveman line is written:
if (useViewStore.getState().calmIntentConfirm) {
  void invoke('pty_write', { id, data: buildIntentPreamble() + '\r' });
}
```

> Sequence-safety: these are submitted instructions in order. Confirm the existing code waits for the Claude ready marker before the first inject (it does — `fireCavemanSequence`), and that each injected line is allowed to settle. If the existing code injects on a single timer, chain the intent preamble on the same settle path so ordering is deterministic (caveman first, intent second). Do not interleave with the user prompt write. The injection timer is already cancelled on PTY exit via `quickActionTimersRef` — reuse that cleanup path for any new timer.

- [ ] **Step 2: Verify**

`npm run tauri dev` → Ask, start a session, type "make my headline punchier". Expected: Claude responds by restating the request + a short plan and asks to confirm before editing. Toggle the setting off (temporarily via store) → Claude acts directly.

- [ ] **Step 3: Commit**

```bash
git add src/components/ask/useAskTerminal.ts
git commit -m "feat(ask): inject intent-confirmation preamble at session start"
```

### Task 3.4: Expose the toggle in the UI

**Files:**
- Modify: the Ask controls row in `src/components/ask/AskTerminalPanel.tsx` (or the app settings/gear menu)

- [ ] **Step 1: Add a small toggle**

Add a checkbox/switch bound to `calmIntentConfirm` / `setCalmIntentConfirm`, labeled "Confirm before changes" with a one-line helper "Claude checks with you in plain language first."

```tsx
const calmIntentConfirm = useViewStore((s) => s.calmIntentConfirm);
const setCalmIntentConfirm = useViewStore((s) => s.setCalmIntentConfirm);
// ...
<label className="flex items-center gap-2 text-[12px] text-navy-light">
  <input type="checkbox" checked={calmIntentConfirm}
    onChange={(e) => setCalmIntentConfirm(e.target.checked)} />
  Confirm before changes
</label>
```

- [ ] **Step 2: Verify**

`npm run tauri dev` → toggle visible, flips the setting, takes effect on the next new session.

- [ ] **Step 3: Commit**

```bash
git add src/components/ask/AskTerminalPanel.tsx
git commit -m "feat(ask): UI toggle for intent confirmation"
```

---

## PHASE 4 — Onboarding & copy polish (ship alone)

### Task 4.1: First-run hint + softened copy

**Files:**
- Modify: `src/components/ask/AskTerminalPanel.tsx`, `src/components/ask/StartPanel.tsx`

- [ ] **Step 1: De-jargon the controls + empty-state copy**

Replace developer-flavored strings with plain language. Examples: button "New" → "New chat"; placeholder "Pick a repo to start" → "Pick a project to start". Keep "Runs your local Claude Code on your existing plan — no API key." (already reassuring).

- [ ] **Step 2: Add a dismissible first-run tip**

Show a one-time banner above the StartPanel ("👋 New here? Pick a tool or a common task below — or just type what you want."). Persist dismissal in `localStorage` key `coruro.ask.onboarded`.

```tsx
const [onboarded, setOnboarded] = useState(() => localStorage.getItem('coruro.ask.onboarded') === '1');
// render banner when !onboarded, with a dismiss button that sets the flag + localStorage
```

- [ ] **Step 3: Verify**

`npm run tauri dev` → first open shows the tip; dismiss persists across reloads.

- [ ] **Step 4: Commit**

```bash
git add src/components/ask/AskTerminalPanel.tsx src/components/ask/StartPanel.tsx
git commit -m "polish(ask): first-run tip + plain-language copy"
```

---

## Final gate (after all phases)

- [ ] Run `npx tsc --noEmit` — no type errors
- [ ] Run `npx vitest run` — all tests pass (existing + new template/preamble tests)
- [ ] Run `npm run lint` (or `just gate` if present) — clean
- [ ] `npm run tauri dev` — manual walkthrough: empty StartPanel → click task fills prompt → send → intent confirmation appears → calm themed terminal → toggle works

## Open questions for the user (defaults chosen, confirm or override)

1. **Intent confirmation default** — set ON by default (chosen). OK, or default OFF and let users opt in?
2. **Template list** — 8 drafted in Task 2.1. Want different/more tasks?
3. **Theme aggression** — kept recognizably terminal, warmed palette (chosen). Want it pushed further toward "not a terminal at all"?
