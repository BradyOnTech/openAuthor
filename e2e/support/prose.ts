import { expect } from "e2e";

// The desktop prose page is a rich editor rather than a form field, so the
// generic value assertion cannot read it. Its editable element exposes the
// scene text as `value`, exactly as stored.

type Evaluates = { evaluate: <T>(fn: () => T) => Promise<T> };

/** Waits until the open scene's prose is exactly this text. */
export async function expectProse(browser: Evaluates, expected: string): Promise<void> {
  await expect.poll(() => browser.evaluate(() => {
    const field = document.querySelector<HTMLElement & { value?: string }>('[aria-label="Scene prose"]');
    return field && typeof field.value === "string" ? field.value : null;
  })).toBe(expected);
}
