# Day-notes eval harness

Deterministic evaluation of the daily-notes **executive-summary gate** — the
`sanitizeExecSummary` anti-hallucination pass that decides what (if anything) of
the on-device model's output reaches the note.

The on-device Apple model can't be invoked in CI, so this harness does **not**
score live generations. It scores the part that silently rotted: the
deterministic gate, run over recorded sidecar outputs.

## Layout

- `fixtures/*.json` — 20 recorded cases. Each: `{ aiLines, rawSidecarOutput, gated }`.
  - `aiLines` — the number-free lines fed to the model (context only here).
  - `rawSidecarOutput` — what the sidecar returned, pre-gate.
  - `gated` — human-annotated expectation: did the gate reject all of it?
  - At least 5 fixtures are `gated: true` (pure numbers / time-spans → nothing survives).
- `../src/evals/rubric.ts` — scoring (Specificity / Accuracy / Gate-pass-rate).
- `../src/evals/run.ts` — loads fixtures + aggregates.
- `../src/__tests__/dayNotesEvals.test.ts` — the runnable harness / regression gate.

> The TS lives under `src/` (not here) so it is type-checked and linted with the
> rest of the app; `evals/` holds data + docs only.

## Run

```sh
npx vitest run src/__tests__/dayNotesEvals.test.ts
```

## Metrics

- **Gate-pass-rate** — fraction of fixtures that produced a usable (non-gated) summary.
- **Specificity** — content-word richness of the surviving summary (0 when gated).
- **Accuracy** — 1 unless a count/time-span token leaked through the gate.

`sanitizedOutput` is **derived** by the harness from `rawSidecarOutput` (not
stored) so a fixture can never drift out of sync with the real sanitizer; the
test asserts every stored `gated` flag matches the computed gate.

## Extending

Add a `fixtures/NNN.json` file and annotate `gated` by hand. The test will fail
if your annotation disagrees with the deterministic gate — that disagreement is
the signal (either the fixture is mislabeled, or the gate changed behaviour).
