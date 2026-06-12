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
struct DayNotesRequest: Decodable {
    var mode: String
    var repos: [RepoEntry]

    struct RepoEntry: Decodable {
        var name: String
        var commits: [String]
    }
}

struct DayNotesResponse: Encodable {
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
    @Guide(description: "One or two sentences summarizing the overall narrative of this work session: name the 2-4 repositories with the most significant work and characterize it qualitatively (heavy refactoring, new features, bug fixes, work in progress). NEVER repeat, sum, or compute any numbers — the report already shows exact stats. First person, past tense. Plain repo names without brackets. Never invent details, never claim a time span (day, week), no concluding wrap-up phrases.")
    var executiveSummary: String
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
    lines.append("Git activity for my latest work session across \(activeRepos.count) repo(s):")
    lines.append("")
    for repo in activeRepos {
        lines.append("[\(repo.name)]")
        for c in repo.commits { lines.append("  \(c)") }
        lines.append("")
    }
    lines.append("""
    Write the executive summary of this work session: 1-2 sentences naming the 2-4 repos with the most \
    significant work and characterizing it qualitatively (refactoring, fixing, new features, work in progress). \
    Do NOT repeat or compute any numbers — the report shows exact stats separately. \
    First-person past tense. Synthesize — do not repeat the raw lines verbatim. \
    Only facts present in the input; never invent details or claim a time span.
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

// ── Default: repo analysis mode ──
guard let req = try? JSONDecoder().decode(AiRequest.self, from: input) else {
    emit(AiResponse(ok: false, summary: nil, tags: nil, model: nil, error: "badInput", reason: "could not decode request"))
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
