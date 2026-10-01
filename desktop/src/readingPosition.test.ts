import { expect, it } from "vitest";
import { isReadingPosition, locateReadingPosition } from "./readingPosition";
import type { ManuscriptReading } from "./types";
const reading: ManuscriptReading = { schema_version: 1, scenes: [], word_count: 0, sections: [
  { id: "first", title: "First", act_title: "", scene_ids: [] },
  { id: "last", title: "Last", act_title: "", scene_ids: Array.from({ length: 26 }, (_, i) => `scene-${i}`) },
] };
it("finds the same scene after it moved chapters and restores its page", () => {
  const position = { sectionId: "first", sceneId: "scene-25", offset: 250 };
  expect(locateReadingPosition(reading, position)).toEqual({ sectionId: "last", page: 1, anchor: position });
});
it("falls back to chapter beginning for deleted scenes and book beginning for deleted chapters", () => {
  expect(locateReadingPosition(reading, { sectionId: "last", sceneId: "deleted", offset: 500 })).toEqual({ sectionId: "last", page: 0, anchor: null });
  expect(locateReadingPosition(reading, { sectionId: "deleted", sceneId: "deleted", offset: 500 })).toEqual({ sectionId: "first", page: 0, anchor: null });
});
it("rejects invalid offsets and payload shapes", () => {
  for (const value of [null, [], {}, { sectionId: "first", sceneId: "scene", offset: Infinity }, { sectionId: 9, sceneId: "scene", offset: 0 }]) expect(isReadingPosition(value)).toBe(false);
});
