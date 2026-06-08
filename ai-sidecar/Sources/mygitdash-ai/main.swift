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

// ── --selftest: device-independent contract check ──
if CommandLine.arguments.contains("--selftest") {
    emit(AiResponse(ok: true, summary: "Selftest summary.", tags: ["selftest", "ok"],
                    model: "selftest", error: nil, reason: nil))
    exit(0)
}

// ── Read request ──
let input = FileHandle.standardInput.readDataToEndOfFile()
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
