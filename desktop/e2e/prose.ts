import { expect, type Locator } from "@playwright/test";

// The prose page is a rich editor, not a form field, so the generic value
// assertions do not apply to it. Its editable element exposes the scene text
// as `value`, exactly as stored, which is what these helpers read.

/** The scene text the editor currently holds. */
export function proseValue(prose: Locator): Promise<string> {
  return prose.evaluate(node => (node as HTMLTextAreaElement).value);
}

/** Waits until the editor holds exactly this text, or text matching this pattern. */
export async function expectProse(prose: Locator, expected: string | RegExp): Promise<void> {
  const value = expect.poll(() => proseValue(prose), { message: "scene prose" });
  if (typeof expected === "string") await value.toBe(expected);
  else await value.toMatch(expected);
}
