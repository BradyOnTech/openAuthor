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
  it("does not send context or enable audio after a stopped connection finishes late", async () => {
    let finish!: (value: { callId: string; expiresAt: string }) => void;
    const context = vi.fn(), mute = vi.fn(), stop = vi.fn();
    const controller = new MobileVoiceController({
      project: SnapshotProject.open(snapshot), queue: vi.fn(), onEvent: vi.fn(),
      createTransport: () => ({ start: () => new Promise(resolve => { finish = resolve; }), setMuted: mute,
        sendText: vi.fn(), sendContext: context, interrupt: vi.fn(), stop, sendToolOutput: vi.fn() }),
    });
    const starting = controller.start();
    const rejected = expect(starting).rejects.toThrow(/stopped|cancelled/i);
    controller.stop();
    finish({ callId: "late-call", expiresAt: "later" });
    await rejected;
    expect(context).not.toHaveBeenCalled();
    expect(mute).not.toHaveBeenCalled();
    await expect(controller.start()).rejects.toThrow(/stopped|cancelled/i);
  });

  it("ignores tools and transcript events after stop without reopening local data or adding captures", async () => {
    let receive!: (event: MobileVoiceEvent) => Promise<void>;
    const output = vi.fn(), queue = vi.fn(), onEvent = vi.fn();
    const controller = new MobileVoiceController({
      project: SnapshotProject.open(snapshot), queue, onEvent,
      createTransport: handler => { receive = handler; return {
        start: async () => ({ callId: "call", expiresAt: "later" }), setMuted: vi.fn(), sendContext: vi.fn(),
        sendText: vi.fn(), interrupt: vi.fn(), stop: vi.fn(), sendToolOutput: output,
      }; },
    });
    await controller.start(); controller.stop();
    await receive({ type: "tool.requested", providerEventId: "late-tool", callId: "tool", name: "scene.get", arguments: { scene_id: "s1" }, argumentsJson: "{}" });
    await receive({ type: "tool.requested", providerEventId: "late-write", callId: "write", name: "capture.note", arguments: { text: "late" }, argumentsJson: "{}" });
    await receive({ type: "assistant.transcript.final", providerEventId: "late-turn", itemId: "late", text: "Old session." });
    expect(output).not.toHaveBeenCalled(); expect(queue).not.toHaveBeenCalled(); expect(onEvent).not.toHaveBeenCalled();
    expect(() => controller.sendText("Late input")).toThrow(/stopped|cancelled/i);
  });

  it("does not send a tool result when stop races its already-running local work", async () => {
    let receive!: (event: MobileVoiceEvent) => Promise<void>;
    let finish!: (value: string) => void;
    const output = vi.fn();
    const controller = new MobileVoiceController({
      project: SnapshotProject.open(snapshot), queue: () => new Promise(resolve => { finish = resolve; }), onEvent: vi.fn(),
      createTransport: handler => { receive = handler; return {
        start: async () => ({ callId: "call", expiresAt: "later" }), setMuted: vi.fn(), sendContext: vi.fn(),
        sendText: vi.fn(), interrupt: vi.fn(), stop: vi.fn(), sendToolOutput: output,
      }; },
    });
    await controller.start();
    const work = receive({ type: "tool.requested", providerEventId: "running", callId: "tool", name: "capture.note", arguments: { text: "Existing capture" }, argumentsJson: "{}" });
    controller.stop(); finish("retained-operation"); await work;
    expect(output).not.toHaveBeenCalled();
  });

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
