# Social Publisher

A top-level **"Publisher"** tab that turns a repo's **read-only** git context into
ready-to-post social copy — the same local-first idea as the rest of Coruro,
applied to the "I shipped something, now I have to write about it" problem. You
pick a repository, an angle, and a network; it generates a few voice-driven
variations you can copy and paste into the platform's own compose page.

The Publisher is **assisted-manual** and **optional**. It never logs in, never
stores cookies, and never auto-posts. Generation runs through your own
plan-billed **Claude Code CLI** (headless `claude -p`) — _not_ the on-device
Apple FoundationModels sidecar, and _not_ a separate API key. The only thing it
opens on your behalf is the network's real compose URL, in your real browser.

---

## 1. What it does

1. Pick a **repository** + an **angle** (intent) + optional free-text **guidance**,
   then a **network**, a **format**, a **model**, and how many **variations** you
   want.
2. **Generate** gathers read-only git context (recent commits, local stats, a capped
   README excerpt) and generates N variations **in-app** via a headless `claude -p`
   call. Output is content-only — it can never touch a repo working tree.
3. Switch between variations, **copy** a single segment or the whole variation, then
   **Open compose** opens the platform's real compose page in the browser. You paste
   and click post.
4. Every successful generation is saved to a persisted **history** so you can reopen,
   re-copy, or delete a past draft.

---

## 2. Networks × format matrix

Six networks, each with the formats that actually make sense there. The format
selector only offers valid formats for the chosen network (`src/utils/publisherFormats.ts`
`VALID_FORMATS`).

| Network       | Formats                   | Default    | Compose target                 |
| ------------- | ------------------------- | ---------- | ------------------------------ |
| **LinkedIn**  | single · carousel · story | `single`   | LinkedIn share composer        |
| **X**         | single · thread           | `thread`   | X compose/post                 |
| **Instagram** | carousel · script         | `carousel` | instagram.com (paste manually) |
| **TikTok**    | script                    | `script`   | TikTok upload (paste manually) |
| **Facebook**  | single                    | `single`   | facebook.com (paste manually)  |
| **Reddit**    | story                     | `story`    | reddit.com submit              |

A **multi-segment** format (thread / carousel / script) produces one card per
segment — `Tweet 2/5`, `Slide 3/8`, `Beat 1/4` — each individually copyable, plus a
**Copy all** that joins them in the right shape for the network (numbered thread,
slide dividers, beats). Single / story are one body block. Instagram, TikTok, and
Facebook compose pages do not accept prefilled text, so the UI shows a heads-up to
copy first and paste after the page opens.

---

## 3. How identity steers the output

The prompt (`src/utils/publisherPrompt.ts` `buildPublisherPrompt`, a pure function)
is composed in weighted layers so the post's _subject_ is pinned before any voice or
grounding copy:

- **Author voice (identity).** `Settings.publisherAuthorVoice` is injected at the
  very top — "write as this author … sound like this specific person, not a brand."
  Empty voice falls back to "the engineer who wrote this code."
- **Role + seniority.** Multi-select roles (vibe-coder, founder, developer, CMO, …) and
  a seniority level (junior → exec) adjust the identity block. When all selected roles are
  dev-only the prompt demotes git mechanics to supporting evidence; non-dev roles (CMO,
  growth-marketer) bring a distribution-angle lens.
- **Audience.** An optional free-text field (≤400 chars) surfaces the target reader
  directly in the identity block: "Writing for: indie hackers building SaaS tools."
- **Intent presets (the angle).** Eight presets — Story, Lesson learned, Launch,
  Behind the scenes, Technical deep-dive, Ask for feedback, Milestone, Hot take —
  each declare what the post is _about_, placed directly under identity so the model
  leads with the angle, not the stack.
- **Guided questions.** Three baked questions per intent (stable ids, story-focused).
  Optional free-text answers are injected as a `CONTEXT FROM AUTHOR` block above the
  output contract. Blank answers are silently skipped. Answers can be AI-tailored via
  a headless `claude -p` call (`src/utils/publisherQuestions.ts`).
- **Guidance box.** Optional free text is treated as **binding direction** for the
  next generation. It is **saved as part of the brief** and restored when an entry
  is reopened (view) or repurposed, so steering carries forward as reusable context.
- **Voice + grounding guards.** A distilled voice guide (hook-first, specific over
  vague, no press-release tone) plus a banned-words list strip marketing buzzwords
  and "claude-isms." Reddit gets an extra skeptical-peer guide. The supplied commits,
  stats, and README are framed as **supporting evidence for the angle, never the
  subject** — the model is told not to invent features or metrics the context
  doesn't show.

The model returns a strict JSON envelope (`{variations:[{title, segments[]}]}`),
parsed defensively by `parsePublisherOutput` — code fences stripped, bare arrays
accepted, and any parse failure degrades to a single raw-text variation instead of
throwing.

---

## 4. Model picker, variations, multi-segment copy

- **Model picker.** Opus / Sonnet / Haiku, selectable per generation (default Sonnet).
  The UI value is only a **match key** — the Rust `publisher_generate` command resolves
  it through a whitelist (`resolve_model`) to a compile-time `'static str` before any
  spawn. An unknown id returns a clean error and **never reaches the shell**.
- **1–5 variations.** Each variation must use a different hook/angle; tabs switch
  between them. Variation count is clamped to 1–5.
- **Multi-segment copy.** Per-segment copy buttons plus a per-variation **Copy all**
  that serialises the variation in the network's native shape.

---

## 5. Persisted history

Every ready generation is appended to `publisherHistory` in the local state file
(`src/store/publisherHistorySlice.ts`).

- **Metadata + brief.** Each entry stores the repo **slug** (`repoName`), target,
  format, intent, model, timestamp, the generated variations, and the full
  `PublisherBrief` (roles, seniority, audience, answers). No raw filesystem path is
  persisted (P0).
- **Capped at 200.** Oldest entries are evicted first (`MAX_PUBLISHER_HISTORY`).
- **Re-openable.** A saved draft can be **Opened** (restores all fields + variations),
  **Repurposed** (restores brief + intent, clears variations so you can re-generate for
  a different network/format), re-copied, or deleted (with a 5-second undo).
- **Backward compat.** `sanitisePublisherEntry` synthesises a `brief` from top-level
  fields for entries written before v4 so old history loads cleanly.

---

## 6. Assisted-manual publish flow

There is no "post" button anywhere in Coruro. Publishing is two manual steps:

1. **Copy** the draft (segment or whole variation) to the clipboard.
2. **Open compose** → `publisher_open_compose(target)` maps the network to its
   compose URL and opens it in your real browser via the `opener` plugin. You paste
   and click post.

`compose_url_for` is a pure, tested table; unknown targets are rejected. The two
backend commands (`publisher_generate`, `publisher_open_compose`) live in
`src-tauri/src/publisher.rs`.

---

## 7. Privacy & the P0 invariants

The Publisher is built to leave every Coruro invariant intact:

- **On-device AI is untouched.** Generation uses your own already-authorized
  `claude` CLI (the same plan-billed tier as the Ask/Code PTY, run headless). It is
  not the Apple FoundationModels sidecar and adds no new network path of its own —
  invariant 1 (on-device AI) is unaffected.
- **Git stays read-only.** `claude` is spawned from a neutral `temp_dir()` cwd —
  never a repo path — with `--disallowedTools` blocking Bash/Write/Edit/NotebookEdit/WebFetch/WebSearch
  and no `--dangerously-skip-permissions`. It cannot mutate any working tree. The
  context helpers reuse the existing read-only `git_*` commands; no new git command
  was added.
- **No auto-posting.** Assisted-manual only — copy + open a compose URL. No cookies,
  no headless login, no automation.
- **No secrets, no raw paths persisted.** History carries the brief's user-authored
  text (roles, seniority, audience, guidance, answers) plus a repo **slug** — all
  length-capped and slug-guarded on load. No filesystem path ever reaches disk.
- **Text-only by design.** An image renderer existed briefly in an early draft and
  was **intentionally removed** — the Publisher emits copy-ready text and nothing
  else (no local renderer, no output directory).

---

## 8. Architecture / key files

| File                                 | Role                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/publisher.rs`         | `publisher_generate` (headless `claude -p`, `resolve_model` whitelist) + `publisher_open_compose`                                |
| `src/store/usePublisherStore.ts`     | Runtime-only draft store: gather read-only context, generate, copy, open compose, load history                                   |
| `src/store/publisherHistorySlice.ts` | Persisted history slice: append (cap 200) / delete / clear                                                                       |
| `src/utils/publisherPrompt.ts`       | `buildPublisherPrompt` — pure, layered identity → intent → voice → grounding → output contract                                   |
| `src/utils/publisherFormats.ts`      | `VALID_FORMATS`, `defaultFormatFor`, `segmentLabel`, `joinSegments`, `parsePublisherOutput`                                      |
| `src/components/PublisherTab.tsx`    | Tab UI: compose controls, brief panel (role/seniority/audience/questions), variation tabs, history panel with Repurpose          |
| `src/utils/publisherQuestions.ts`    | `STATIC_QUESTIONS`, `staticQuestionsFor`, `buildTailorQuestionsPrompt`, `parseTailoredQuestions`                                 |
| `src/types.ts`                       | `PublisherRole` / `PublisherSeniority` / `PublisherBrief` / `PublisherQuestion` + all existing publisher types + Settings fields |

---

## 9. Known limitations / future work

- Output quality depends on the picked model and the richness of the repo's git
  context; thin history yields a shorter, honest post rather than invented detail.
- Compose pages that don't accept prefilled text (Instagram, TikTok, Facebook)
  require a manual paste after the page opens.
- Possible follow-ons: scheduled/queued drafts, richer per-network previews, and
  history search.
