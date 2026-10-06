export type PassageChunk = { text: string; changed: boolean };

/** Preserve every source character while highlighting a bounded word comparison. */
export function comparePassage(before: string, after: string): { before: PassageChunk[]; after: PassageChunk[] } {
  return compareText(before, after, true);
}

function compareText(before: string, after: string, allowLineAnchors: boolean): { before: PassageChunk[]; after: PassageChunk[] } {
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
    const oldText = a.join(""), newText = b.join("");
    // Whole-scene revisions can change a few distant paragraphs. Preserve
    // unique unchanged lines as anchors before falling back to a broad mark.
    const oldLines = oldText.match(/[^\n]*\n|[^\n]+$/g) || [];
    const newLines = newText.match(/[^\n]*\n|[^\n]+$/g) || [];
    const uniquePositions = (lines: string[]) => {
      const positions = new Map<string, number>();
      lines.forEach((line, index) => positions.set(line, positions.has(line) ? -1 : index));
      return positions;
    };
    const oldPositions = uniquePositions(oldLines), newPositions = uniquePositions(newLines);
    const anchors: Array<[number, number]> = [];
    if (allowLineAnchors) oldLines.forEach((line, index) => {
      const next = newPositions.get(line);
      if (oldPositions.get(line) === index && next !== undefined && next >= 0 && next > (anchors[anchors.length - 1]?.[1] ?? -1)) anchors.push([index, next]);
    });
    if (anchors.length) {
      let oldStart = 0, newStart = 0;
      for (const [oldEnd, newEnd] of [...anchors, [oldLines.length, newLines.length]]) {
        const part = compareText(oldLines.slice(oldStart, oldEnd).join(""), newLines.slice(newStart, newEnd).join(""), false);
        part.before.forEach(chunk => append(result.before, chunk.text, chunk.changed));
        part.after.forEach(chunk => append(result.after, chunk.text, chunk.changed));
        if (oldEnd < oldLines.length) {
          append(result.before, oldLines[oldEnd], false); append(result.after, newLines[newEnd], false);
        }
        oldStart = oldEnd + 1; newStart = newEnd + 1;
      }
    } else {
      append(result.before, oldText, true); append(result.after, newText, true);
    }
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
