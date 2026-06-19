// Day-notes eval runner (WI-2.1). Loads the JSON fixtures under evals/fixtures
// and scores them with the deterministic rubric. Run via the test harness:
//   npx vitest run src/__tests__/dayNotesEvals.test.ts
// (the repo has no standalone TS runner; vitest provides the vite glob below.)

import { aggregate, type Aggregate, type Fixture } from './rubric';

/** Load every fixture from evals/fixtures/*.json (eager, build-time glob). */
export function loadFixtures(): Array<{ id: string; f: Fixture }> {
  const mods = import.meta.glob<Fixture>('../../evals/fixtures/*.json', {
    eager: true,
    import: 'default',
  });
  return Object.entries(mods)
    .map(([path, f]) => {
      const file = path.split('/').pop() ?? path;
      return { id: file.replace(/\.json$/, ''), f };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Score every fixture and return the aggregate report. Deterministic. */
export function runEvals(): Aggregate {
  return aggregate(loadFixtures());
}
