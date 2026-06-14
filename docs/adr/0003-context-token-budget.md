# 3. Enforce the 4096-token context budget on every AI path

Status: Accepted

## Context

Invariant #5 is that the sidecar context stays under the model's 4096-token
window. Previously this was a soft character-proxy cap on only the analyze path;
`day_notes`, `enrich`, and `curate` were uncapped, and the sidecar only noticed
an overflow at runtime, after invoking the model (catching
`exceededContextWindowSize`).

## Decision

Enforce one shared budget in both languages, mirrored:

- **TypeScript** (`src/utils/aiContext.ts`) — `MAX_CONTEXT_TOKENS = 4096`,
  `estimatePayloadTokens`, and `capItemsToContextBudget` trim every multi-item
  payload to budget before `invoke`. All four paths use it.
- **Swift** (`CoruroAICore`) — `estimatedTokens` / `exceedsContextBudget` run as a
  pre-check in every mode and emit `contextOverflow` **before** the model is
  invoked.

The estimator is deliberately conservative and consistent across languages: ASCII
counts ~0.25 tokens/char, every non-ASCII scalar a full token (CJK/emoji are far
more token-dense). Over-counting caps earlier rather than risking an overflow.

## Consequences

- The invariant is enforced at the actual boundary (Swift pre-check) and pre-empted
  on the way in (TS trimming), and is unit-tested in both languages.
- The estimate is intentionally pessimistic, so a borderline-large real payload may
  be trimmed slightly more than a perfect tokenizer would. Acceptable: correctness
  over squeezing the last few tokens.
