// ContextBudget — shared, testable enforcement of Coruro invariant #5:
// the on-device model context must stay under a fixed token budget. Extracted
// into a library target so it can be unit-tested (the executable target's
// top-level script code cannot be imported by a test target).

/// Maximum number of tokens the sidecar may feed the on-device model.
public let maxContextTokens = 4096

/// Conservative chars→tokens estimate. ASCII counts at ~0.25 tokens/char
/// (≈ the usual 4-chars-per-token rule); every non-ASCII scalar (CJK, emoji,
/// accented text) counts as a full token because those are far more
/// token-dense. Over-counting is deliberate: it caps payloads earlier rather
/// than risk an overflow at the model boundary.
public func estimatedTokens(_ text: String) -> Int {
    var tokens = 0.0
    for scalar in text.unicodeScalars {
        tokens += scalar.isASCII ? 0.25 : 1.0
    }
    return Int(tokens.rounded(.up))
}

/// True when `payload` would exceed the model context window and must be
/// rejected before any model invocation.
public func exceedsContextBudget(_ payload: String, maxTokens: Int = maxContextTokens) -> Bool {
    estimatedTokens(payload) > maxTokens
}
