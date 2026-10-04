import assert from "node:assert/strict";
import test from "node:test";

import { MOBILE_REALTIME_TOOL_NAMES, MOBILE_REALTIME_TOOLS } from "../src/mobilePolicy.ts";

test("mobile Realtime tools match the device-local read/propose boundary", () => {
  assert.deepEqual(MOBILE_REALTIME_TOOLS.map((tool) => tool.name), MOBILE_REALTIME_TOOL_NAMES);
  assert.deepEqual(MOBILE_REALTIME_TOOL_NAMES, [
    "scene_list", "scene_get", "retrieval_query", "capture_note",
    "capture_dictation", "story_memory_suggest", "changes_request", "review_decide",
  ]);
  for (const tool of MOBILE_REALTIME_TOOLS) {
    assert.equal(tool.type, "function");
    assert.equal(tool.parameters.additionalProperties, false);
  }
});
