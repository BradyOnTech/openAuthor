import type { CodexEntity } from "./types";

type Detail = NonNullable<CodexEntity["details"]>[number];
export type MemoryDetailDraft = Detail & { valueInput?: string };
export type MemoryDetailReferences = { entities: ReadonlyArray<{ id: string }>; scenes: ReadonlyArray<{ id: string }> };
export const memoryDetailHelp: Record<Detail["type"], string> = {
  text: "Enter text.",
  number: "Enter a finite JSON number, such as 31 or -2.5. Integers must be within ±9007199254740991.",
  boolean: "Use true or false.",
  date: "Use a valid calendar date in YYYY-MM-DD format.",
  scene: "Choose a current scene ID from this book using the suggestions.",
  entity: "Choose a current Memory entry ID from this book using the suggestions.",
  list: 'Use a JSON array, such as ["key", "coat"], with finite JSON values.',
};

function validJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
  if (Array.isArray(value)) return value.every(validJson);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return Object.values(value).every(validJson);
  return false;
}

export function memoryDetailValueError(type: Detail["type"], value: unknown, references: MemoryDetailReferences): string | null {
  let valid = false;
  switch (type) {
    case "text": valid = typeof value === "string"; break;
    case "number": valid = typeof value === "number" && validJson(value); break;
    case "boolean": valid = typeof value === "boolean"; break;
    case "date":
      valid = typeof value === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
        && Number(value.slice(0, 4)) >= 1
        && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
        && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
      break;
    case "list": valid = Array.isArray(value) && validJson(value); break;
    case "scene": valid = typeof value === "string" && references.scenes.some(row => row.id === value); break;
    case "entity": valid = typeof value === "string" && references.entities.some(row => row.id === value); break;
  }
  return valid ? null : memoryDetailHelp[type] ?? "Choose a supported detail type.";
}

export function parseMemoryDetailInput(type: Detail["type"], input: string, references: MemoryDetailReferences): unknown {
  let value: unknown = input;
  if (type === "number" || type === "boolean" || type === "list") {
    try { value = JSON.parse(input); }
    catch { throw new Error(memoryDetailHelp[type]); }
  }
  const error = memoryDetailValueError(type, value, references);
  if (error) throw new Error(error);
  return value;
}

export function memoryDetailInputText(detail: MemoryDetailDraft): string {
  if (detail.valueInput !== undefined) return detail.valueInput;
  return typeof detail.value === "string" ? detail.value : JSON.stringify(detail.value) ?? "";
}

export function prepareMemoryDetails(details: MemoryDetailDraft[], saved: Detail[], references: MemoryDetailReferences): Detail[] {
  const seen = new Set<string>();
  return details.map(detail => {
    const key = detail.key.trim().toLowerCase();
    if (!key || seen.has(key)) throw new Error("Use nonempty, unique detail keys; remove a detail explicitly to delete it.");
    seen.add(key);
    const previous = saved.find(row => row.key.trim().toLowerCase() === detail.key.trim().toLowerCase() && row.type === detail.type);
    const value = detail.valueInput !== undefined ? parseMemoryDetailInput(detail.type, detail.valueInput, references) : detail.value;
    const unchanged = detail.valueInput === undefined && previous !== undefined
      && JSON.stringify(value) === JSON.stringify(previous.value);
    const error = unchanged ? null : memoryDetailValueError(detail.type, value, references);
    if (error) throw new Error(`Detail '${detail.key}': ${error}`);
    return { key: detail.key, type: detail.type, value, ai_visibility: detail.ai_visibility };
  });
}
