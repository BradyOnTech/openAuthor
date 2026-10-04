import type { RealtimeTool } from "./types.ts";

export const MOBILE_REALTIME_TOOL_NAMES = Object.freeze([
  "scene_list",
  "scene_get",
  "retrieval_query",
  "capture_note",
  "capture_dictation",
  "story_memory_suggest",
  "changes_request",
  "review_decide",
] as const);

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});

/**
 * Device-local tools advertised by the trusted gateway. The first three are
 * immutable reads; the remainder only enqueue desktop-review artifacts.
 */
export const MOBILE_REALTIME_TOOLS: readonly RealtimeTool[] = Object.freeze([
  { type: "function", name: "scene_list", description: "List scenes in the authorized local snapshot.", parameters: objectSchema({}) },
  { type: "function", name: "scene_get", description: "Read one scene from the authorized local snapshot.", parameters: objectSchema({ scene_id: { type: "string" } }, ["scene_id"]) },
  { type: "function", name: "retrieval_query", description: "Search scenes and story entities in the authorized local snapshot.", parameters: objectSchema({ query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } }, ["query"]) },
  { type: "function", name: "capture_note", description: "Queue a note for desktop review; never edits manuscript prose.", parameters: objectSchema({ text: { type: "string" }, title: { type: "string" } }, ["text"]) },
  { type: "function", name: "capture_dictation", description: "Queue dictated prose as a pending desktop proposal.", parameters: objectSchema({ text: { type: "string" }, title: { type: "string" }, scene_id: { type: "string" } }, ["text"]) },
  { type: "function", name: "story_memory_suggest", description: "Queue a Story Memory suggestion for desktop review.", parameters: objectSchema({ text: { type: "string" }, title: { type: "string" }, scene_id: { type: "string" } }, ["text"]) },
  { type: "function", name: "changes_request", description: "Queue a requested change as a pending desktop proposal.", parameters: objectSchema({ text: { type: "string" }, title: { type: "string" }, scene_id: { type: "string" } }, ["text"]) },
  { type: "function", name: "review_decide", description: "Queue a review decision for authoritative desktop handling.", parameters: objectSchema({ target_kind: { enum: ["proposal", "story_memory_suggestion"] }, target_id: { type: "string" }, decision: { enum: ["accepted", "rejected", "deferred"] } }, ["target_kind", "target_id", "decision"]) },
]);
