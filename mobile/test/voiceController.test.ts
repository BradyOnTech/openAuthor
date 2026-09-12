import { describe, expect, it, vi } from "vitest";

import { SnapshotProject, type MobileSnapshot } from "../src/core/snapshotProject";
import { MobileVoiceController } from "../src/voice/voiceController";
import type { MobileVoiceEvent } from "../src/voice/realtimeEvents";

const snapshot: MobileSnapshot = {
  schema: "openauthor.mobile.snapshot", schema_version: 1, project_id: "p1", revision: "r1",
  scenes: [{ id: "s1", title: "One", summary: "", pov: "Mara", status: "draft", created_at: "x", updated_at: "x", body: "A brass key." }],
  codex: { entities: [], relationships: [] }, evidence: [],
};

describe("MobileVoiceController", () => {
  it("serves read tools locally and queues final transcript turns", async () => {
    let receive: ((event: MobileVoiceEvent) => Promise<void>) | undefined;
    const output = vi.fn();
    const context = vi.fn();
    const queued: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const controller = new MobileVoiceController({
      project: SnapshotProject.open(snapshot),
      currentSceneId: "s1",
      createTransport: (onEvent) => {
        receive = onEvent;
        return { start: async () => ({ callId: "c1", expiresAt: "later" }), setMuted: vi.fn(), sendText: vi.fn(), sendContext: context, interrupt: vi.fn(), stop: vi.fn(), sendToolOutput: output };
      },
      queue: async (kind, payload) => { queued.push({ kind, payload }); return "op1"; },
      onEvent: vi.fn(),
    });
    await controller.start();
    expect(context).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", revision: "r1", items: [expect.objectContaining({ sourceId: "s1", content: "A brass key." })] }));
    await receive?.({ providerEventId: "e1", type: "tool.requested", callId: "tool1", name: "scene.get", arguments: { scene_id: "s1" }, argumentsJson: "{}" });
    expect(output).toHaveBeenCalledWith("tool1", expect.objectContaining({ scene: expect.objectContaining({ id: "s1" }) }));
    await receive?.({ providerEventId: "e2", type: "user.transcript.final", itemId: "i1", text: "Where is the key?" });
    await receive?.({ providerEventId: "e3", type: "assistant.transcript.final", itemId: "i2", text: "Below the clock." });
    expect(queued.map((item) => item.kind)).toEqual(["thread_turn", "thread_turn"]);
  });
});
