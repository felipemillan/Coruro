import XCTest

@testable import CoruroAICore

/// Locks Coruro invariant #5: the sidecar rejects over-budget payloads before
/// the model is ever invoked.
final class ContextBudgetTests: XCTestCase {
    func testEmptyPayloadIsWithinBudget() {
        XCTAssertEqual(estimatedTokens(""), 0)
        XCTAssertFalse(exceedsContextBudget(""))
    }

    func testSmallAsciiPayloadIsWithinBudget() {
        XCTAssertFalse(exceedsContextBudget("a short repo digest"))
    }

    func testAsciiAtBudgetIsAllowed() {
        // 4096 tokens at 0.25 tokens/ASCII-char == 16384 chars exactly.
        let exact = String(repeating: "a", count: maxContextTokens * 4)
        XCTAssertEqual(estimatedTokens(exact), maxContextTokens)
        XCTAssertFalse(exceedsContextBudget(exact))
    }

    func testOversizedAsciiPayloadExceeds() {
        let tooBig = String(repeating: "a", count: maxContextTokens * 4 + 4)
        XCTAssertTrue(exceedsContextBudget(tooBig))
    }

    func testCjkPayloadIsTokenDenseAndExceedsSooner() {
        // CJK counts ~1 token/char, so a payload that would pass as ASCII fails.
        let cjk = String(repeating: "計", count: maxContextTokens + 1)
        XCTAssertTrue(exceedsContextBudget(cjk))
        // The same character count in ASCII stays well within budget.
        let ascii = String(repeating: "a", count: maxContextTokens + 1)
        XCTAssertFalse(exceedsContextBudget(ascii))
    }
}
