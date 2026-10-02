export type PassageChunk = { text: string; changed: boolean };

/** Preserve every source character while highlighting a bounded word comparison. */
export function comparePassage(before: string, after: string): { before: PassageChunk[]; after: PassageChunk[] } {
  const tokenize = (value: string) => value.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) || [];
  const left = tokenize(before), right = tokenize(after);
  let first = 0, leftEnd = left.length, rightEnd = right.length;
  while (first < leftEnd && first < rightEnd && left[first] === right[first]) first++;
  while (leftEnd > first && rightEnd > first && left[leftEnd - 1] === right[rightEnd - 1]) { leftEnd--; rightEnd--; }
  const a = left.slice(first, leftEnd), b = right.slice(first, rightEnd);
  const result = { before: [] as PassageChunk[], after: [] as PassageChunk[] };
  const append = (side: PassageChunk[], text: string, changed: boolean) => {
    if (!text) return;
    if (side[side.length - 1]?.changed === changed) side[side.length - 1].text += text;
    else side.push({ text, changed });
  };
  const prefix = left.slice(0, first).join("");
  append(result.before, prefix, false); append(result.after, prefix, false);
  if (a.length * b.length > 400_000) {
    append(result.before, a.join(""), true); append(result.after, b.join(""), true);
  } else {
    const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        append(result.before, a[i++], false); append(result.after, b[j++], false);
      } else if (j >= b.length || i < a.length && table[i + 1][j] >= table[i][j + 1]) append(result.before, a[i++], true);
      else append(result.after, b[j++], true);
    }
  }
  const suffix = left.slice(leftEnd).join("");
  append(result.before, suffix, false); append(result.after, suffix, false);
  return result;
}
