import type { OutboxKind } from "./outbox";
import type { SnapshotProject } from "./snapshotProject";

type QueuePending = (
  kind: OutboxKind,
  payload: Record<string, unknown>,
) => Promise<string>;

const WRITE_TO_OUTBOX: Readonly<Record<string, OutboxKind>> = {
  "capture.note": "capture_note",
  capture_note: "capture_note",
  "capture.dictation": "dictated_passage",
  capture_dictation: "dictated_passage",
  "story_memory.suggest": "story_memory_suggestion",
  story_memory_suggest: "story_memory_suggestion",
  "changes.request": "change_set_request",
  changes_request: "change_set_request",
  "review.decide": "review_decision",
  review_decide: "review_decision",
};

function desktopPayload(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...args };
  if (typeof normalized.text === "string") {
    if (name === "changes.request" || name === "changes_request") normalized.instruction ??= normalized.text;
    else normalized.content ??= normalized.text;
    delete normalized.text;
  }
  if (name === "capture.dictation" || name === "capture_dictation") normalized.title ??= "Mobile dictation";
  if (name === "changes.request" || name === "changes_request") normalized.title ??= "Mobile change request";
  return normalized;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

/**
 * The complete mobile tool boundary. Read tools operate on an immutable snapshot;
 * write-like tools can only enqueue reviewable desktop work.
 */
export class MobileAssistantTools {
  constructor(
    private readonly project: SnapshotProject,
    private readonly queuePending: QueuePending,
  ) {}

  async execute(name: string, argumentsValue: unknown): Promise<Record<string, unknown>> {
    const args = argumentsValue && typeof argumentsValue === "object" && !Array.isArray(argumentsValue)
      ? argumentsValue as Record<string, unknown>
      : {};
    const identity = this.project.identity();
    if (name === "scene.list" || name === "scene_list") {
      return {
        revision: identity.revision,
        order_basis: this.project.readingOrder(),
        scenes: this.project.listScenes().map(({ id, title, summary, pov, status, updated_at, chapter_title, act_title }) => ({
          id, title, summary, pov, status, updated_at, chapter_title, act_title,
        })),
      };
    }
    if (name === "scene.get" || name === "scene_get") {
      const scene = this.project.getScene(requiredString(args.scene_id, "scene_id"));
      if (!scene) throw new Error("Scene was not found in this snapshot.");
      return { revision: identity.revision, scene };
    }
    if (name === "retrieval.query" || name === "retrieval_query") {
      const query = requiredString(args.query, "query");
      const limit = typeof args.limit === "number" ? args.limit : 8;
      return { revision: identity.revision, results: this.project.search(query, limit) };
    }
    const kind = WRITE_TO_OUTBOX[name];
    if (kind) {
      const operationId = await this.queuePending(kind, desktopPayload(name, args));
      return {
        status: "pending_desktop_review",
        operationId,
        revision: identity.revision,
      };
    }
    throw new Error(`Tool '${name}' is not available on mobile.`);
  }
}
