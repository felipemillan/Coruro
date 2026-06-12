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
    var lines: [String] = []
    lines.append("Summarize the following git work session. For each repo, write a TLDR and bullet points. Use @repo_name to reference repos.")
    lines.append("")
    lines.append("Repos:")
    for repo in req.repos {
        lines.append("")
        lines.append("@\(repo.name):")
        if repo.commits.isEmpty {
            lines.append("  (no commits)")
        } else {
            for c in repo.commits {
                lines.append("  - \(c)")
            }
        }
    }
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

    let session = LanguageModelSession(
        instructions: "You are a concise technical writer. Summarize git activity clearly and factually. Do not invent details not present in the commit messages."
    )
    do {
        let prompt = buildDayNotesPrompt(req)
        let result = try await session.respond(to: prompt)
        emitDayNotes(DayNotesResponse(ok: true, body: result.content, model: "apple/foundation-models", error: nil))
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
