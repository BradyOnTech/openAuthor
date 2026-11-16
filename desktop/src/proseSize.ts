// The size of the prose on the page, chosen by the author and remembered on
// this device. Interface text is unaffected.

const KEY = "openauthor.proseSize";
export const PROSE_SIZES = [15, 16, 17, 18, 19, 20, 22, 24];
export const DEFAULT_PROSE_SIZE = 17;

export function proseSize(): number {
  try {
    const stored = Number(window.localStorage.getItem(KEY));
    return PROSE_SIZES.includes(stored) ? stored : DEFAULT_PROSE_SIZE;
  } catch {
    return DEFAULT_PROSE_SIZE;
  }
}

/** Apply a size to the page and remember it. Returns the size in effect. */
export function setProseSize(size: number): number {
  const next = PROSE_SIZES.includes(size) ? size : DEFAULT_PROSE_SIZE;
  document.documentElement.style.setProperty("--prose-size", `${next}px`);
  try {
    window.localStorage.setItem(KEY, String(next));
  } catch {
    // The page still changes size for this session.
  }
  window.dispatchEvent(new CustomEvent("openauthor-prose-size", { detail: next }));
  return next;
}

/** Move one step up or down the scale, stopping at its ends. */
export function stepProseSize(direction: 1 | -1): number {
  const index = PROSE_SIZES.indexOf(proseSize()) + direction;
  return setProseSize(PROSE_SIZES[Math.max(0, Math.min(PROSE_SIZES.length - 1, index))]);
}

export function applyStoredProseSize(): void {
  document.documentElement.style.setProperty("--prose-size", `${proseSize()}px`);
}
