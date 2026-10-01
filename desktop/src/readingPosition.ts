import type { ManuscriptReading } from "./types";
export const READING_PAGE_SIZE = 25;
export type ReadingPosition = { sectionId: string; sceneId: string; offset: number | null };
export function isReadingPosition(value: unknown): value is ReadingPosition {
  const row = value as ReadingPosition;
  return !!row && typeof row.sectionId === "string" && typeof row.sceneId === "string"
    && (row.offset === null || (typeof row.offset === "number" && Number.isFinite(row.offset) && Math.abs(row.offset) < 10000000));
}
export function locateReadingPosition(reading: ManuscriptReading, saved: ReadingPosition | null) {
  const anchored = saved?.sceneId ? reading.sections.find((row) => row.scene_ids.includes(saved.sceneId)) : undefined;
  const section = anchored || reading.sections.find((row) => row.id === saved?.sectionId) || reading.sections[0];
  return { sectionId: section?.id || "", page: anchored ? Math.floor(anchored.scene_ids.indexOf(saved!.sceneId) / READING_PAGE_SIZE) : 0, anchor: anchored ? saved : null };
}
