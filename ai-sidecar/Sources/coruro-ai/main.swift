import CoruroAICore
import Foundation
import FoundationModels

// ── JSON contracts ──
struct AiRequest: Decodable {
    var repoName: String
    var description: String?
    var languages: [String]
    var recentCommits: [String]
    var topEntries: [String]
    var readme: String?
}

struct AiResponse: Encodable {
    var ok: Bool
    var summary: String?
    var tags: [String]?
    var model: String?
    var error: String?
    var reason: String?
}

// ── day_notes contracts ──
//
// Wire shape for the `ai_day_notes` Tauri command (WI-3.1 contract freeze).
//
// Required fields:
//   mode  — "day_notes" (string discriminator)
//   repos — array of RepoEntry (metadata-only; no file paths or secrets)
//
// Optional field (Phase 3 / WI-3.2+):
//   priorContext — [String], camelCase JSON key.
//     Absent (not null) when the caller has no prior notes to supply; a missing
//     key decodes to the default `[]` via the Swift initializer default value,
//     keeping legacy payloads without this field fully back-compatible.
//
//     Each string is a sanitized exec-summary sentence produced by
//     `sanitizeExecSummary` on the TypeScript side. Strings MUST NOT contain:
//     raw commit subjects, file paths, tokens, app-event labels, numeric stats,
//     or repo references. The TS sanitizer is the authoritative gate — no raw
//     content may bypass it before being placed in priorContext.
//
// P0 invariants (never bypass):
//   - priorContext byte count is included in the payload line passed to
//     `exceedsContextBudget` BEFORE the guard runs — the guard is never bypassed.
//   - A missing `priorContext` key decodes to [] (back-compat invariant); the
//     caller MUST NOT send null — absent and [] are semantically identical here.
struct DayNotesRequest: Decodable {
    var mode: String
    var repos: [RepoEntry]
    /// Sanitized exec-summary sentences from recent AI-attributed notes.
    /// Absent in legacy payloads → decoded as []. See contract comment above.
    var priorContext: [String] = []

    struct RepoEntry: Decodable {
        var name: String
        var commits: [String]
    }

    // A stored-property default is NOT honored by Swift's *synthesized* Decodable
    // (a missing key throws keyNotFound, not the default). The common payload
    // omits `priorContext` entirely, so without this explicit initializer every
    // such request fails to decode → `badInput` → the note falls back to
    // local-stats and the on-device model is never invoked. decodeIfPresent
    // restores the documented "absent → []" back-compat contract.
    enum CodingKeys: String, CodingKey { case mode, repos, priorContext }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = try c.decode(String.self, forKey: .mode)
        repos = try c.decode([RepoEntry].self, forKey: .repos)
        priorContext = try c.decodeIfPresent([String].self, forKey: .priorContext) ?? []
    }
}

struct DayNotesResponse: Encodable {
    var ok: Bool
    var body: String?
    var model: String?
    var error: String?
}

// ── enrich contracts ──
// Turns a list of secret-free items (MCP servers, local sessions/workspaces)
// into short one-line factual blurbs. The caller guarantees `context` carries
// no secrets; the model only restates what the metadata already implies.
struct EnrichRequest: Decodable {
    var mode: String
    var items: [Item]

    struct Item: Decodable {
        var id: String
        var kind: String
        var context: String
    }
}

struct EnrichResponse: Encodable {
    var ok: Bool
    var blurbs: [Blurb]?
    var model: String?
    var error: String?

    struct Blurb: Encodable {
        var id: String
        var text: String
    }
}

// ── curate contracts ──
// Drives the "Claude Setup Curator". The TypeScript side scans the ~/.claude
// inventory and computes EVERY finding deterministically (remove/consolidate/
// stale/gap/keep), including all counts. The model receives only qualitative
// finding titles + the secret-free summary shape; it NEVER sees transcript
// bodies, names, paths, or any number, and NEVER recomputes or restates one.
struct CurateRequest: Decodable {
    var mode: String
    var findings: [Finding]
    var summary: Summary

    // Title only — no `detail` (holds counts) and no `items` (holds names/paths)
    // are ever sent, so nothing numeric or identifying can leak into the prompt.
    struct Finding: Decodable {
        var id: String
        var category: String   // "remove" | "consolidate" | "stale" | "gap" | "keep"
        var title: String
    }

    // Deterministic per-category rollup the TS side already computed. Decoded
    // for contract symmetry only; the prompt never serializes these integers.
    struct Summary: Decodable {
        var remove: Int
        var consolidate: Int
        var stale: Int
        var gap: Int
        var keep: Int
    }
}

struct CurateResponse: Encodable {
    var ok: Bool
    var body: String?
    var model: String?
    var error: String?
}

// Guided-generation schema for day notes. The TypeScript side composes the
// full report (tiers, metrics, per-repo stats) deterministically; the model
// contributes ONLY the executive-summary narrative. The small on-device model
// proved unreliable at arithmetic and format-following, so nothing verifiable
// is delegated to it.
@Generable
struct SessionSummary {
    // WI-2.4: the @Guide says only what to write + the format. All prohibitions
    // (numbers, time spans, invention) live in the deterministic sanitizer, which
    // is authoritative — a small quantized model drops hard constraints past the
    // first few, so over-loading the guide degraded output. Prompt shapes; the
    // gate enforces.
    @Guide(description: "One or two sentences summarizing this work session: name the 2-4 repositories with the most significant work and characterize it qualitatively — refactoring, new features, bug fixes, work in progress. First person, past tense. Plain repo names.")
    var executiveSummary: String
}

// Guided-generation schema for one enrich blurb. The on-device model writes a
// single plain sentence describing a tool or project from its metadata.
@Generable
struct GeneratedBlurb {
    @Guide(description: "One informative sentence, up to ~22 words, describing what this tool or project is AND what it is used for. Use the package/metadata for specifics. No preamble like 'This is'; do not merely restate the name. Plain, factual, no marketing, never invent capabilities.")
    var text: String
}

// Guided-generation schema for the Setup Curator. The TypeScript side renders
// every finding and count deterministically; the model contributes ONLY a short
// qualitative note. Nothing verifiable (counts, names) is delegated to the small
// on-device model.
@Generable
struct CurateSummary {
    @Guide(description: "One or two sentences characterizing the overall state of this Claude setup at a high level: name the 2-4 most salient themes qualitatively (e.g. redundant or duplicate installs, disabled plugins worth pruning, project-scoped tools that look unused, gaps worth filling). NEVER repeat, sum, count, or compute any numbers — the report already shows exact counts per category. Second person, present tense, like a quick note to the setup's owner. Plain names without brackets. Only themes present in the input; never invent findings, tools, or capabilities; never claim a time span; no concluding wrap-up phrases.")
    var narrative: String
}

@Generable
struct RepoAnalysis {
    @Guide(description: "One-sentence summary of what this repository is, at most 30 words")
    var summary: String
    @Guide(description: "Between 3 and 6 short lowercase topic tags", .maximumCount(6))
    var tags: [String]
}

func emit(_ r: AiResponse) {
    let data = (try? JSONEncoder().encode(r)) ?? Data("{\"ok\":false,\"error\":\"encode\"}".utf8)
    FileHandle.standardOutput.write(data)
}

func emitDayNotes(_ r: DayNotesResponse) {
    let data = (try? JSONEncoder().encode(r)) ?? Data("{\"ok\":false,\"error\":\"encode\"}".utf8)
    FileHandle.standardOutput.write(data)
}

func emitEnrich(_ r: EnrichResponse) {
    let data = (try? JSONEncoder().encode(r)) ?? Data("{\"ok\":false,\"error\":\"encode\"}".utf8)
    FileHandle.standardOutput.write(data)
}

func emitCurate(_ r: CurateResponse) {
    let data = (try? JSONEncoder().encode(r)) ?? Data("{\"ok\":false,\"error\":\"encode\"}".utf8)
    FileHandle.standardOutput.write(data)
}

func buildPrompt(_ req: AiRequest) -> String {
    var lines: [String] = []
    lines.append("Repository: \(req.repoName)")
    if let d = req.description, !d.isEmpty { lines.append("Description: \(d)") }
    if !req.languages.isEmpty { lines.append("Languages: \(req.languages.joined(separator: ", "))") }
    if !req.topEntries.isEmpty { lines.append("Top-level entries: \(req.topEntries.joined(separator: ", "))") }
    if !req.recentCommits.isEmpty {
        lines.append("Recent commits:")
        for c in req.recentCommits { lines.append("- \(c)") }
    }
    if let r = req.readme, !r.isEmpty { lines.append("README excerpt:\n\(r)") }
    lines.append("\nSummarize this repository and produce topic tags.")
    return lines.joined(separator: "\n")
}

func buildDayNotesPrompt(_ req: DayNotesRequest) -> String {
    let activeRepos = req.repos.filter { !$0.commits.isEmpty }
    var lines: [String] = []

    // WI-3.3: prior-context continuity block. Entries are already sanitized by
    // the TS side (sanitizeExecSummary) — no raw subjects, paths, tokens,
    // appEvents, stats, or repoRefs reach here. When absent (legacy payloads)
    // priorContext is [] and this block + footer clause are omitted, leaving the
    // prompt byte-identical to the pre-WI-3.3 form. The priorContext bytes are
    // part of `line` (the raw JSON) before exceedsContextBudget runs, so the
    // budget guard is never bypassed.
    let hasPriorContext = !req.priorContext.isEmpty
    if hasPriorContext {
        lines.append("Prior session notes (for continuity — do not repeat verbatim):")
        for note in req.priorContext { lines.append("  - \(note)") }
        lines.append("")
    }

    lines.append("Git activity for my latest work session across \(activeRepos.count) repo(s):")
    lines.append("")
    for repo in activeRepos {
        lines.append("[\(repo.name)]")
        for c in repo.commits { lines.append("  \(c)") }
        lines.append("")
    }
    var instruction = """
    Write the executive summary of this work session: 1-2 sentences naming the 2-4 repos with the most \
    significant work and characterizing it qualitatively (refactoring, fixing, new features, work in progress). \
    First-person past tense. Synthesize — do not repeat the raw lines verbatim.
    """
    if hasPriorContext {
        instruction += " The prior session notes are context only — do NOT echo/summarise prior notes, continuity only."
    }
    lines.append(instruction)
    return lines.joined(separator: "\n")
}

func buildCuratePrompt(_ req: CurateRequest) -> String {
    var lines: [String] = []
    lines.append("Findings from a scan of my Claude Code setup, grouped by recommendation:")
    lines.append("")

    // Emit qualitative titles grouped by category. Counts are intentionally
    // NOT included — the model must not recompute or restate any number.
    let order = ["remove", "consolidate", "stale", "gap", "keep"]
    let labels = [
        "remove": "Candidates to remove",
        "consolidate": "Candidates to consolidate",
        "stale": "Stale / unused",
        "gap": "Gaps worth filling",
        "keep": "Worth keeping",
    ]
    for cat in order {
        let group = req.findings.filter { $0.category == cat }
        guard !group.isEmpty else { continue }
        lines.append("\(labels[cat] ?? cat):")
        for f in group { lines.append("  - \(f.title)") }
        lines.append("")
    }

    lines.append("""
    Write the curator note: 1-2 sentences characterizing the overall state of this setup and the 2-4 \
    most salient themes qualitatively (redundancy, disabled or unused items, gaps worth filling, what is \
    healthy). Do NOT repeat, count, or compute any numbers — the report shows exact counts separately. \
    Second-person present tense. Synthesize the themes — do not list every finding verbatim. \
    Only themes present in the input; never invent findings or tools, and never claim a time span.
    """)
    return lines.joined(separator: "\n")
}

// ── --selftest: device-independent contract check ──
if CommandLine.arguments.contains("--selftest") {
    emit(AiResponse(ok: true, summary: "Selftest summary.", tags: ["selftest", "ok"],
                    model: "selftest", error: nil, reason: nil))
    exit(0)
}

// ── Read request ──
// The caller writes one compact JSON line then keeps the pipe open, so read a
// single line rather than blocking on EOF (which never comes when spawned by Tauri).
guard let line = readLine(strippingNewline: true),
      let input = line.data(using: .utf8) else {
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "badInput", reason: "could not read stdin"))
    exit(0)
}

// ── Dispatch on mode ──
// Check for "mode" field to distinguish day_notes from the default repo analysis.
// Contract:
//   mode == "day_notes"  → DayNotesRequest path (ai_day_notes Rust command)
//   mode == "analyze"    → AiRequest path / default (ai_analyze Rust command)
//   mode == nil          → AiRequest path / default (legacy callers without mode field)
// AiRequest does not declare a `mode` field so the extra key is silently ignored
// by JSONDecoder, preserving backward compatibility.
struct ModeProbe: Decodable { var mode: String? }
let modeProbe = try? JSONDecoder().decode(ModeProbe.self, from: input)

if modeProbe?.mode == "day_notes" {
    guard let req = try? JSONDecoder().decode(DayNotesRequest.self, from: input) else {
        emitDayNotes(DayNotesResponse(ok: false, body: nil, model: nil, error: "badInput"))
        exit(0)
    }

    // ── Context budget (invariant #5): reject before invoking the model ──
    if exceedsContextBudget(line) {
        emitDayNotes(DayNotesResponse(ok: false, body: nil, model: nil, error: "contextOverflow"))
        exit(0)
    }

    // ── Availability ──
    switch SystemLanguageModel.default.availability {
    case .available:
        break
    case .unavailable(.deviceNotEligible):
        emitDayNotes(DayNotesResponse(ok: false, body: nil, model: nil, error: "unavailable")); exit(0)
    case .unavailable(.appleIntelligenceNotEnabled):
        emitDayNotes(DayNotesResponse(ok: false, body: nil, model: nil, error: "unavailable")); exit(0)
    case .unavailable(.modelNotReady):
        emitDayNotes(DayNotesResponse(ok: false, body: nil, model: nil, error: "unavailable")); exit(0)
    case .unavailable:
        emitDayNotes(DayNotesResponse(ok: false, body: nil, model: nil, error: "unavailable")); exit(0)
    }

    guard req.repos.contains(where: { !$0.commits.isEmpty }) else {
        emitDayNotes(DayNotesResponse(ok: false, body: nil, model: nil, error: "noActivity"))
        exit(0)
    }

    let session = LanguageModelSession(
        instructions: "You summarize git work sessions for a personal journal. First person, past tense, specific and natural — like updating a teammate. Never invent details not present in the input, and never claim a time span (day, week) the input does not state."
    )
    do {
        let prompt = buildDayNotesPrompt(req)
        let result = try await session.respond(to: prompt, generating: SessionSummary.self)
        emitDayNotes(DayNotesResponse(ok: true, body: result.content.executiveSummary, model: "apple/foundation-models", error: nil))
    } catch let e as LanguageModelSession.GenerationError where {
        if case .exceededContextWindowSize = e { return true } else { return false }
    }() {
        emitDayNotes(DayNotesResponse(ok: false, body: nil, model: nil, error: "contextOverflow"))
    } catch {
        emitDayNotes(DayNotesResponse(ok: false, body: nil, model: nil, error: "generation"))
    }
    exit(0)
}

if modeProbe?.mode == "enrich" {
    guard let req = try? JSONDecoder().decode(EnrichRequest.self, from: input) else {
        emitEnrich(EnrichResponse(ok: false, blurbs: nil, model: nil, error: "badInput"))
        exit(0)
    }

    // ── Context budget (invariant #5): reject before invoking the model ──
    if exceedsContextBudget(line) {
        emitEnrich(EnrichResponse(ok: false, blurbs: nil, model: nil, error: "contextOverflow"))
        exit(0)
    }

    // ── Availability ──
    switch SystemLanguageModel.default.availability {
    case .available:
        break
    case .unavailable(.deviceNotEligible):
        emitEnrich(EnrichResponse(ok: false, blurbs: nil, model: nil, error: "unavailable")); exit(0)
    case .unavailable(.appleIntelligenceNotEnabled):
        emitEnrich(EnrichResponse(ok: false, blurbs: nil, model: nil, error: "unavailable")); exit(0)
    case .unavailable(.modelNotReady):
        emitEnrich(EnrichResponse(ok: false, blurbs: nil, model: nil, error: "unavailable")); exit(0)
    case .unavailable:
        emitEnrich(EnrichResponse(ok: false, blurbs: nil, model: nil, error: "unavailable")); exit(0)
    }

    // Cap the batch; ignore anything beyond the limit. PAIRED CONSTANT — must match
    // MAX_ITEMS in src/utils/claudeEnrich.ts; any change requires updates to both.
    let items = req.items.prefix(40)

    let session = LanguageModelSession(
        instructions: "You describe developer tools and projects. Given a name and metadata (including a package identifier when available), reply with ONE informative sentence (up to ~22 words) saying what it is and what it is used for. Use the package name to be specific. No preamble, no 'This is', never just restate the name, no marketing, never invent capabilities."
    )

    // Keep blurbs card-sized: first sentence only, hard-capped.
    func tighten(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let dot = s.firstIndex(of: ".") { s = String(s[...dot]) }
        s = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.count > 170 { s = String(s.prefix(169)).trimmingCharacters(in: .whitespaces) + "…" }
        return s
    }

    var collected: [EnrichResponse.Blurb] = []
    for item in items {
        let prompt: String
        switch item.kind {
        case "mcp":
            prompt = "In one sentence, what is this MCP server and what is it used for? Metadata: \(item.context)."
        case "session":
            prompt = "In one sentence, what is this local coding project likely about? Project: \(item.context)."
        default:
            prompt = "In one sentence, what is this developer tool and what is it used for? Metadata: \(item.context)."
        }
        // Skip an item that fails to generate; never abort the whole batch.
        do {
            let result = try await session.respond(to: prompt, generating: GeneratedBlurb.self)
            let text = tighten(result.content.text)
            if !text.isEmpty {
                collected.append(EnrichResponse.Blurb(id: item.id, text: text))
            }
        } catch {
            continue
        }
    }

    emitEnrich(EnrichResponse(ok: true, blurbs: collected, model: "apple-fm", error: nil))
    exit(0)
}

if modeProbe?.mode == "curate" {
    guard let req = try? JSONDecoder().decode(CurateRequest.self, from: input) else {
        emitCurate(CurateResponse(ok: false, body: nil, model: nil, error: "badInput"))
        exit(0)
    }

    // ── Context budget (invariant #5): reject before invoking the model ──
    if exceedsContextBudget(line) {
        emitCurate(CurateResponse(ok: false, body: nil, model: nil, error: "contextOverflow"))
        exit(0)
    }

    // ── Availability ──
    switch SystemLanguageModel.default.availability {
    case .available:
        break
    case .unavailable(.deviceNotEligible):
        emitCurate(CurateResponse(ok: false, body: nil, model: nil, error: "unavailable")); exit(0)
    case .unavailable(.appleIntelligenceNotEnabled):
        emitCurate(CurateResponse(ok: false, body: nil, model: nil, error: "unavailable")); exit(0)
    case .unavailable(.modelNotReady):
        emitCurate(CurateResponse(ok: false, body: nil, model: nil, error: "unavailable")); exit(0)
    case .unavailable:
        emitCurate(CurateResponse(ok: false, body: nil, model: nil, error: "unavailable")); exit(0)
    }

    // Nothing to narrate if there are no findings; the TS report still renders.
    guard !req.findings.isEmpty else {
        emitCurate(CurateResponse(ok: false, body: nil, model: nil, error: "noFindings"))
        exit(0)
    }

    let session = LanguageModelSession(
        instructions: "You write a brief qualitative note about the state of someone's Claude Code setup for a curator report. Second person, present tense, specific and natural. The report already shows every exact count and finding separately, so NEVER repeat, sum, or compute any numbers. Never invent findings, tools, or capabilities not present in the input, and never claim a time span the input does not state."
    )
    do {
        let prompt = buildCuratePrompt(req)
        let result = try await session.respond(to: prompt, generating: CurateSummary.self)
        emitCurate(CurateResponse(ok: true, body: result.content.narrative, model: "apple/foundation-models", error: nil))
    } catch let e as LanguageModelSession.GenerationError where {
        if case .exceededContextWindowSize = e { return true } else { return false }
    }() {
        emitCurate(CurateResponse(ok: false, body: nil, model: nil, error: "contextOverflow"))
    } catch {
        emitCurate(CurateResponse(ok: false, body: nil, model: nil, error: "generation"))
    }
    exit(0)
}

// ── Default: repo analysis mode ──
guard let req = try? JSONDecoder().decode(AiRequest.self, from: input) else {
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "badInput", reason: "could not decode request"))
    exit(0)
}

// ── Context budget (invariant #5): reject before invoking the model ──
if exceedsContextBudget(line) {
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "contextOverflow", reason: "payload exceeds context budget"))
    exit(0)
}

// ── Availability ──
switch SystemLanguageModel.default.availability {
case .available:
    break
case .unavailable(.deviceNotEligible):
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "unavailable", reason: "deviceNotEligible")); exit(0)
case .unavailable(.appleIntelligenceNotEnabled):
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "unavailable", reason: "appleIntelligenceNotEnabled")); exit(0)
case .unavailable(.modelNotReady):
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "unavailable", reason: "modelNotReady")); exit(0)
case .unavailable:
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "unavailable", reason: "modelNotReady")); exit(0)
}

// ── Generate ──
let session = LanguageModelSession(
    instructions: "You describe software repositories concisely and factually. Never invent features not evidenced by the input."
)
do {
    let result = try await session.respond(to: buildPrompt(req), generating: RepoAnalysis.self)
    emit(AiResponse(ok: true, summary: result.content.summary, tags: result.content.tags,
                    model: "apple-on-device", error: nil, reason: nil))
} catch let e as LanguageModelSession.GenerationError where {
    if case .exceededContextWindowSize = e { return true } else { return false }
}() {
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "contextOverflow", reason: nil))
} catch {
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "generation", reason: String(describing: error)))
}
