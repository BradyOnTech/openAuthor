import { describe, expect, it, vi } from "vitest";

import { SnapshotProject, type MobileSnapshot } from "../src/core/snapshotProject";
import { MobileVoiceController } from "../src/voice/voiceController";
import type { MobileVoiceEvent } from "../src/voice/realtimeEvents";
import { writingVoice } from "./writingVoiceFixture";

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
      project: SnapshotProject.open({ ...snapshot, writing_voice: writingVoice, accepted_canon: [{
        id: "fact-key", status: "accepted", subject_entity_id: "", predicate: "key", value: "brass",
        validity: { from_scene_id: "s1", to_scene_id: "" }, knowledge: [], evidence: [{ scene_id: "s1", excerpt: "A brass key." }],
      }] }),
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
    expect(context).toHaveBeenCalledWith(expect.objectContaining({ writingVoice: expect.objectContaining({ profile: writingVoice }) }));
    expect(context).toHaveBeenCalledWith(expect.objectContaining({ acceptedCanon: expect.objectContaining({ facts: [expect.objectContaining({ id: "fact-key", value: "brass" })] }) }));
    await receive?.({ providerEventId: "e1", type: "tool.requested", callId: "tool1", name: "scene.get", arguments: { scene_id: "s1" }, argumentsJson: "{}" });
    expect(output).toHaveBeenCalledWith("tool1", expect.objectContaining({ scene: expect.objectContaining({ id: "s1" }) }));
    await receive?.({ providerEventId: "e2", type: "user.transcript.final", itemId: "i1", text: "Where is the key?" });
    await receive?.({ providerEventId: "e3", type: "assistant.transcript.final", itemId: "i2", text: "Below the clock." });
    expect(queued.map((item) => item.kind)).toEqual(["thread_turn", "thread_turn"]);
  });

  it("rejects oversized required context before creating a transport or opening a voice session", () => {
    const createTransport = vi.fn();
    expect(() => new MobileVoiceController({
      project: SnapshotProject.open({ ...snapshot, writing_voice: writingVoice,
        scenes: [{ ...snapshot.scenes[0]!, body: "x".repeat(12_000) }] }),
      currentSceneId: "s1", createTransport, queue: vi.fn(), onEvent: vi.fn(),
    })).toThrow("selected scene and Writing Voice exceed");
    expect(() => new MobileVoiceController({
      project: SnapshotProject.open({ ...snapshot, accepted_canon: [{
        id: "large-fact", status: "accepted", subject_entity_id: "", predicate: "constraint", value: "x".repeat(12_000),
        validity: { from_scene_id: "", to_scene_id: "" }, knowledge: [], evidence: [{ scene_id: "s1", excerpt: "A brass key." }],
      }] }),
      currentSceneId: "s1", createTransport, queue: vi.fn(), onEvent: vi.fn(),
    })).toThrow("Accepted story facts");
    expect(createTransport).not.toHaveBeenCalled();
  });
});
