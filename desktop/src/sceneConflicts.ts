import type { SceneDetail } from "./types";

export type SceneConflict = {
  code: "scene_edit_conflict";
  reason: "scene_changed" | "storyline_changed";
  current: SceneDetail;
  conflicting_fields: string[];
  recovery_path: string;
};

export class SceneEditConflictError extends Error {
  constructor(readonly conflict: SceneConflict) {
    super("Scene changed elsewhere. Review both versions before saving.");
    this.name = "SceneEditConflictError";
  }
}
