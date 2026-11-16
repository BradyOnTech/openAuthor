// The prose editor measures text to keep the caret in view. jsdom has no
// layout, so ranges report an empty box instead of lacking the method.
if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
  const empty = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => empty;
}
