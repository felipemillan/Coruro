# Coruro — marketing copy

> Landing page + social posts for Coruro.
> Target page: fmillan.com/projects/coruro
> Voice: plain, direct, no hype. The story is the on-device-AI + multi-agent
> build discipline as much as the app.
> Distribution model: open source. There is no signed binary and there isn't
> meant to be — no Apple Dev account, and the app doesn't need one. You clone
> the source and run your own build. Keep every CTA pointed at the repo, never
> at a download. Sync claims with README.md before publishing.

---

## Landing page

### Hero

**Coruro** 🗂️
**A Kanban board of your Git repos, read at a glance — summarized by AI that never leaves your Mac.**

Coruro scans a folder of repositories and lays them out as cards. Each card tells you what the project is, how healthy it is, and whether it's in sync — without opening it. The summaries come from Apple's on-device model, so your code is never uploaded, and there's no API key to manage.

It's open source. You clone the repo and run your own build — no signed installer, no store, no account. The whole thing is yours to read, run, and change.

`[ Clone the repo ]` `[ How I built it ]`

**Trust line:** Open source. No account. No cloud. No API keys. Your code never leaves the machine.

---

### What it is

I have too many repos. Local clones, half-finished side projects, client work, things I starred and forgot. The folder is a graveyard — names like `app-final-2` tell me nothing, and opening each one to remember what it was is its own afternoon.

I wanted the opposite: a wall of repos where each one tells me what it is at a glance. So Coruro scans a root folder, finds every Git repo, and draws each as an information-dashboard card on a five-column board — **Inbox · Backlog · Active · Review · Done**. Drag a repo to where it lives. The card carries the rest.

Each card reads like a project's vital signs:

- **What it is** — a one-line AI summary and a few topic tags, generated on-device.
- **What it's built in** — a language-tinted header so the stack registers before you read a word.
- **Whether it's in sync** — dirty / ahead / behind / CI at a glance.
- **How alive it is** — stars, issues, forks for GitHub repos; commits, branches, last-commit age for local-only ones. The grid adapts to what the repo actually is.

No more opening folders to remember what's in them.

---

### What's in it

- **Editorial repo cards** — white card, soft shadow, language-tint header, and an adaptive stat grid. GitHub repos show stars / issues / forks; local-only repos show commits / branches / last-commit age. The card decides which.
- **On-device AI summaries** — a one-line description and topic tags per repo, written by Apple's FoundationModels on your Mac. Runs automatically after a scan, with no network call and no API key.
- **GitHub enrichment** — stars, forks, open issues, PRs, CI status, latest release, topics, and license — cached locally and auto-refreshed.
- **Local Git status** — current branch, clean or dirty, ahead/behind upstream. Read-only. Coruro never touches your working tree.
- **Kanban workflow** — drag repos between columns; keep a per-repo notes timeline stored alongside the repo.
- **Quick actions** — open any repo in your editor, terminal, Finder, or on GitHub, in one click.

---

### Why I built it

Two reasons, honestly.

One: I wanted the tool. A wall of repos I can actually read beats a folder I have to excavate. The 20% of a repo manager I'd use every day is "tell me what this is without making me open it."

Two: I wanted to put Apple's on-device model to real work — not a toy prompt, but a summarizer wired into a Rust backend through a Swift sidecar, cached, bounded to the model's context window, and degrading gracefully on Macs that can't run it. Something with real moving parts. That half turned out to be as interesting as the app.

And because it's open source, you don't take my word for any of the privacy claims — you read the code, build it, and run it yourself.

---

### How it works

```
  Folder of repos
        │  scan
        ▼
  Tauri app (Rust) ──► local Git (read-only): branch, ahead/behind, stats
        │             └► GitHub API: stars, issues, CI, release (cached)
        │  repo context (README excerpt, languages,
        │  recent commit subjects, top-level files)
        ▼
  Swift sidecar ──► Apple FoundationModels (on-device LLM)
        │           returns { summary, tags }
        ▼
  Editorial card on the board
```

The Rust backend reads local Git state and GitHub data. For the AI, it builds a small context per repo — a README excerpt, the languages, recent commit subjects, the top-level file names — capped to fit the model's window, and hands it to a standalone Swift binary. That binary runs Apple's on-device model and returns a summary and tags as structured output. A serial, content-hash-cached queue runs it over each repo after a scan and writes the result to the card. Nothing about your code is sent to a server — the model runs on your Mac.

---

### The stack

- **Tauri v2 (Rust)** — native macOS app.
- **React 19 + TypeScript + Zustand + Tailwind CSS 4** — the board UI.
- **Apple FoundationModels (Swift)** — the on-device summarizer, called as a sidecar with `@Generable` structured output.
- **Local Git, read-only** — status and stats, never a mutation.
- **GitHub API** — enrichment, cached locally, token in the macOS Keychain (never on disk).
- **Local-first** — state is one JSON file at `~/.repo_dashboard_state.json`. No server, no account, no telemetry.
- **Open source, MIT licensed** — clone it, read every line, build your own. Full unit-test suite, security-reviewed before going public.

---

### The vibe-code experience (the actual story)

I didn't hand-write most of this. I directed it — and that's the point.

Letting an agent "just build the dashboard" gives you mush. What worked was running it like a small engineering team, and matching the model to each task's complexity:

- **Spec before code.** Each cycle — the card redesign, the AI analysis — started as a written design doc: goals, the data shape, acceptance criteria. No code until that was real.
- **Decompose, then fan out.** I broke each cycle into bite-sized tasks with frozen interfaces, then ran several agents in parallel — cheaper models on the mechanical files, the strongest model on the integration and the novel bits. They couldn't collide because they coded against the same contracts.
- **Verify independently.** The agents wrote and tested their files but never committed. I ran the full test suite, the Rust build, and the type-check myself, then committed in logical chunks. The agents are fast; the verification is mine.
- **Use it until it breaks.** The AI produced nothing on the first wired-up run. I traced it to four separate problems in the Swift-sidecar spawn path — the binary name, an argument scope, a dev path, and a stdin that never closed. Found each by running the real app and watching, not by reading diffs. Fixed, and real on-device summaries started flowing.
- **A security pass before publishing.** An automated review flagged an over-broad argument permission on the sidecar; I tightened it before it went anywhere near a release.

My job wasn't typing. It was scoping each cycle, freezing the contracts, picking which model does what, and using the thing until it broke. The agents do the volume; the discipline is what makes them produce something that holds together.

---

### Honest limitations

I'd rather say this up front.

- **macOS only**, and the AI needs **Apple Silicon + macOS 26 + Apple Intelligence on**. Without it the app works fully — you just don't get the summaries, and a one-time banner tells you why.
- **You build it from source.** There's no signed installer and there isn't meant to be — I don't run an Apple Developer account, and an open-source tool you compile yourself doesn't need one. Clone the repo, run the build script, launch it. That's the distribution model, on purpose.
- **It's a v1 and a portfolio project.** It runs, it's tested, but it's a thing you build and run, not a product in a store.
- **GitHub enrichment needs a token** (optional). It lives in your Keychain, never on disk.

---

### Roadmap

- Semantic search across repos, on-device (Apple `NLContextualEmbedding`).
- Repo relationships, inferred from AI tags and embeddings.
- A statistics view that aggregates the AI-derived insights.
- Smoother build-from-source onboarding — one script, clear prerequisites.

---

### Try it / read it

Build it from source, read the design docs, see how each cycle was specced and how the agent tasks were briefed — that's the part worth stealing.

Built by **Felipe Millán** — [fmillan.com](https://fmillan.com) · [LinkedIn](https://www.linkedin.com/in/felipemillan/) · [GitHub](https://github.com/felipemillan/)

---

## Social posts

> 30 posts across LinkedIn, X/Twitter, Reddit, and short-form. Pick by channel.
> Three angles: **the product** (what it does), **privacy/on-device** (why it
> matters), **the build** (directing agents). Keep links in first comment on
> LinkedIn; lead with engineering on Reddit.

### LinkedIn (long-form)

**1 — The build story (flagship)**

> I built a desktop dashboard that reads my whole folder of Git repos at a glance — and the AI that summarizes each one never leaves my Mac.
>
> The problem was dumb and familiar: dozens of local repos with names like `app-final-2`, and the only way to remember what each was meant opening it. I wanted a wall of cards where every repo tells me what it is, how healthy it is, and whether it's in sync — without clicking in.
>
> The interesting half was the AI. Not an API call to someone's server — Apple's on-device model, wired into a Rust backend through a Swift sidecar, summarizing each repo locally. No API key, no upload, no per-token bill. Your code stays your code.
>
> But the lesson, again, was about directing agents, not writing code:
> → Spec each cycle before any code — data shape and acceptance criteria first.
> → Decompose into small tasks with frozen interfaces, then fan out several agents in parallel — cheap models on the mechanical files, the strongest one on integration.
> → Verify it myself. Agents wrote and tested; I ran the full suite and the build and committed.
> → Use it until it broke. The AI returned nothing at first — four separate bugs in the sidecar spawn path, all found by running the real app and watching.
>
> The agents do the volume. The discipline is what makes them hold together.
>
> Built on macOS with Apple Intelligence. Link in the comments.

**2 — On-device AI angle**

> "AI feature" usually means: your data goes to someone's server, you manage an API key, and you pay per token.
>
> I wanted to see what the other version looks like. So the AI in my repo dashboard runs entirely on-device — Apple's FoundationModels, on the Mac, summarizing each Git repo with no network call at all.
>
> What that buys you: your source never leaves the machine. No key to leak. No bill that scales with use. It works on a plane.
>
> What it costs you: it only runs on Apple Silicon with Apple Intelligence on, and you wire it up yourself through a Swift sidecar — there's no hosted endpoint to lean on.
>
> For a tool that reads your private code, that trade goes one way for me. On-device wins.
>
> How I built it, in the comments.

**3 — The four-bug debugging story**

> My on-device AI feature worked perfectly in every unit test and produced absolutely nothing when I ran the real app.
>
> Zero summaries. Empty cache. No error.
>
> I found it by doing the unglamorous thing: running the actual app, adding trace logs, and watching. Four separate problems, stacked:
>
> 1. The sidecar was spawned under the wrong name.
> 2. An argument permission was scoped wrong.
> 3. The dev binary wasn't where the spawn path looked for it.
> 4. The Swift process read stdin in a way that never saw end-of-input, so it hung forever.
>
> Each one alone would have been quiet. Together they were a wall of silence.
>
> This is the part of "AI builds the app now" nobody screenshots. The agents wrote clean, tested code. Making it actually run on a real machine was mine — and it's still where the real work lives.

**4 — Multi-agent orchestration**

> People ask how I run multiple AI agents on one codebase without them stepping on each other. Here's the actual setup from my last build.
>
> The trick isn't more agents. It's frozen contracts.
>
> → I spec each cycle first — the data shape, the interfaces, the acceptance criteria.
> → I decompose it into small tasks, each owning its own files.
> → Then I fan out agents in parallel, and I match the model to the task: a cheap fast model for mechanical edits, the strongest model for the integration and the novel logic.
> → They never commit. They write and test against the frozen contracts; I run the suite and the build myself and commit in clean chunks.
>
> The contracts are why they don't collide. The model-matching is why it isn't wasteful. The independent verification is why I trust the result.
>
> It's how I shipped an on-device-AI repo dashboard, cycle by cycle. Repo in the comments.

**5 — Plain product pitch**

> If you keep more Git repos than you can remember, this might land.
>
> I built Coruro: it scans a folder of repos and lays them out as cards on a Kanban board. Each card tells you what the project is (a one-line AI summary), what it's built in, whether it's in sync, and how alive it is — stars and issues for GitHub repos, commit count and last-commit age for local ones.
>
> The summaries are generated on your Mac by Apple's on-device model. No upload, no API key, no cloud.
>
> It's a portfolio project — macOS, build-from-source, MIT. But I use it every day to stop opening folders just to remember what's in them.
>
> Details in the comments.

**6 — Reflection on the workflow**

> Three projects in, here's what directing AI agents actually feels like — and it's not "the AI writes my code."
>
> It feels like managing a fast, literal, tireless team that has zero context for your taste. The leverage isn't in their speed. It's in how well you scope the work before they touch it.
>
> Vague brief → mush. Frozen contracts + small tasks + the right model per task → software that holds together.
>
> My latest: a repo dashboard with on-device AI summaries. The agents wrote most of the lines. I wrote the specs, froze the interfaces, picked the models, ran the tests, and used it until it broke. That last 20% is the whole game.
>
> Writeup in the comments.

### X / Twitter (short + threads)

**7**

> Folder full of repos named like `app-final-2`?
>
> I built a dashboard that reads each one at a glance — what it is, what it's built in, whether it's in sync — summarized by AI running entirely on my Mac. No upload, no API key.

**8**

> The AI in my repo dashboard never makes a network call.
>
> Apple's on-device model summarizes each repo locally. Your source code never leaves the machine.
>
> That's the only kind of AI I want reading my private code.

**9 (thread)**

> I directed AI agents to build a macOS repo dashboard with on-device AI summaries. The agents wrote most of the code. Here's what made them actually useful 🧵

**10**

> What I learned: "build me the app" gives you mush.
>
> What worked: spec first, freeze the interfaces, decompose into tiny tasks, then fan out agents in parallel — each owning separate files, none able to collide.

**11**

> I match the model to the task.
>
> Cheap fast model → mechanical edits, renames, boilerplate.
> Strongest model → integration, the novel logic, the review.
>
> Same as staffing a team. Don't put your principal engineer on find-and-replace.

**12**

> The agents never commit.
>
> They write and test against frozen contracts. I run the full suite + the build myself, then commit in clean chunks.
>
> Their speed is the cheap part. My verification is the trust.

**13**

> The bug that taught me the most: on-device AI passed every unit test, produced nothing in the real app.
>
> Four stacked problems in the sidecar spawn path. Found by running it and watching, not reading diffs.
>
> Use the thing until it breaks. /end

**14**

> Adaptive cards: a GitHub repo shows stars / issues / forks. A local-only repo shows commits / branches / last-commit age.
>
> The card decides which, based on what the repo actually is. Small thing, reads completely differently.

**15**

> No account. No cloud. No API key. No telemetry.
>
> Your repos, your GitHub token in the Keychain, your AI running on your Mac.
>
> Local-first isn't a feature. It's the whole posture.

**16**

> Stack for the curious:
> • Tauri v2 (Rust)
> • React 19 + TS + Zustand + Tailwind 4
> • Apple FoundationModels via a Swift sidecar
> • Git read-only, GitHub cached
> • MIT, fully tested

**17**

> "On-device AI" sounds like a checkbox until you wire it up.
>
> It means a Swift sidecar, a context capped to the model's window, a content-hash cache, and graceful fallback on Macs that can't run it. No endpoint to lean on. Worth it.

**18**

> Honest limits, up front:
> • macOS + Apple Silicon only for the AI
> • open source → you build it from source (no signed binary, by design)
> • it's a v1 portfolio project
>
> Runs, tested, MIT. Read every line, build your own.

### Reddit — three stories

> Persona for all three: a growth marketer who vibe-codes. I'm not selling an
> app — there's nothing to buy, it's open source and you build it yourself. I'm
> publishing the _workflow_: how I'm testing ways to ship real software faster by
> directing agents. Each story leads with that, fits a different sub, and points
> at the repo (clone-and-run), never a download.

**19 — r/SideProject · the maker story (how it got built)**

> **Title:** I'm a growth marketer, not an engineer — I directed AI agents to build a real macOS app, and I'm open-sourcing the whole thing
>
> **Body:**
> I do marketing for a living. I also keep way too many Git repos with names like `app-final-2` that tell me nothing. So I built the tool I wanted: Coruro, a Kanban board of your local repos where each card summarizes the project at a glance — on-device AI, nothing uploaded.
>
> The honest part: I didn't hand-write most of the code. I directed agents to. And I'm publishing it not as a product — it's open source, you clone it and build your own, there's nothing to sell — but as a worked example of _how_ a non-engineer ships real software now.
>
> What made it actually work (vs. "build me an app" mush):
>
> - I specced each cycle first — data shape, acceptance criteria, no code yet.
> - I froze the interfaces, then fanned out several agents in parallel on separate files so they couldn't collide.
> - I matched the model to the task — cheap fast model for mechanical edits, strongest for integration.
> - I verified it myself: agents wrote and tested, I ran the suite and the build and committed.
> - I used it until it broke. The AI passed every test and produced nothing live — four stacked bugs in the Swift-sidecar spawn path, found by running the real app.
>
> Stack: Tauri/Rust + React, Apple's on-device model via a Swift sidecar, MIT. It's macOS + Apple Silicon and you build it from source — that's the model, on purpose. Happy to walk through how I briefed the agents.

**20 — r/Entrepreneur (or r/growthhacking) · the growth-marketer story (why I'm doing this)**

> **Title:** I'm a growth marketer learning to ship my own tools by directing AI agents — here's the open-source app I used as the test
>
> **Body:**
> For most of my career, "I need a tool" meant writing a brief and waiting on an engineer. That gap is where a lot of marketing ideas quietly die. So I've spent a few builds learning to close it myself — directing AI agents to ship real software, not to-do demos.
>
> The latest test is Coruro: a desktop dashboard that reads my whole folder of Git repos at a glance, with summaries generated by Apple's on-device model. It's open source — there's nothing to buy, you clone the repo and run your own build. The point isn't the app. The point is proving the workflow.
>
> What I'm taking back to the day job:
>
> - The skill that moved the needle wasn't coding — it was _scoping_. A tight spec with acceptance criteria is the difference between leverage and mush. Same instinct as a good campaign brief.
> - Speed is real, but it's not the agents being fast. It's me removing ambiguity before they start. Frozen contracts > more prompts.
> - Verification stays human. Agents wrote the volume; I ran the tests and used it until it broke (it broke — four bugs the tests never caught).
>
> If you're on the non-technical side of building and wondering whether this is real yet: it is, with discipline. The repo, the design docs, and the agent briefs are all open — that's the part worth copying, more than the app.

**21 — r/macapps · the product story (for people who'd actually run it)**

> **Title:** Coruro — an open-source Kanban board of your local Git repos, with AI summaries that run entirely on your Mac
>
> **Body:**
> If you keep more repos than you can remember, this is for you. Coruro scans a folder, finds every Git repo, and lays them out as cards on a five-column board (Inbox · Backlog · Active · Review · Done). Each card shows a one-line AI summary + tags, a language-tinted header, sync state (dirty/ahead/behind/CI), and an adaptive stat grid — stars/issues/forks for GitHub repos, commits/branches/last-commit-age for local-only ones.
>
> The AI is the part I'm happiest with: Apple's on-device FoundationModels, called through a Swift sidecar from a Rust (Tauri) backend. No network call, no API key — your code never leaves the machine. On Macs without Apple Intelligence it just skips the summaries and tells you why.
>
> Fully local: state is one JSON file, the GitHub token lives in the Keychain, no telemetry. MIT, tested.
>
> Heads-up on distribution: it's open source and you **build it from source** — macOS + Apple Silicon, clone the repo and run the build script. There's no signed `.dmg` and there isn't meant to be (no Apple Developer account, and an app you compile yourself doesn't need one). I built it by directing AI agents and I'm sharing the whole process; happy to answer anything about the on-device-AI plumbing or the build.

### Short-form / Threads / Mastodon

**22**

> Stop opening folders to remember what's in them. A wall of repo cards, each summarized on-device. Your code never leaves the Mac.

**23**

> The best AI feature is the one that doesn't phone home. On-device summaries for every Git repo, zero network calls.

**24**

> A GitHub repo and a local scratch repo shouldn't show the same stats. So they don't — the card adapts to what the repo actually is.

**25**

> Built with: a Rust backend, a Swift sidecar, Apple's on-device model, and a lot of frozen contracts so the agents couldn't collide.

**26**

> "It passed all the tests" and "it works on a real machine" are two different claims. The gap between them is where I spend my time.

**27**

> No account. No cloud. No API key. The whole app is one local JSON file and a model running on your own Mac.

**28**

> I don't put my best AI model on find-and-replace. Match the model to the task — same as staffing a team.

**29**

> The card tells you what the repo is, what it's built in, and whether it's in sync — before you click in. That's the entire point.

**30**

> Read your repos like a dashboard, not a directory listing. On-device AI does the summarizing; your code stays home. Coruro, macOS, MIT.
