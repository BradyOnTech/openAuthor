import { compactRevisions } from "./api";

// Old automatic saves are thinned at most once a day per book, quietly, a
// little after the book opens. The engine decides whether anything is due and
// works in short slices that never hold up a save; this only asks it to.

const START_DELAY_MS = 20_000;
const PAUSE_BETWEEN_PASSES_MS = 3_000;
const MAX_PASSES = 20;

/** Start upkeep for an open book. Returns a function that cancels what has not run yet. */
export function scheduleHistoryUpkeep(projectRoot: string, delayMs = START_DELAY_MS): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pass = async (remaining: number) => {
    if (cancelled) return;
    try {
      const result = await compactRevisions(projectRoot, { ifDue: remaining === MAX_PASSES });
      if (cancelled || !result.ran || result.complete || remaining <= 1) return;
      // A large backlog is worked off in bounded passes with room between them.
      timer = setTimeout(() => void pass(remaining - 1), PAUSE_BETWEEN_PASSES_MS);
    } catch {
      // Upkeep is optional. History stays as it is and the next day tries again.
    }
  };
  timer = setTimeout(() => void pass(MAX_PASSES), delayMs);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
