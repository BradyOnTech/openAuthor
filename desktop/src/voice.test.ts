import { describe, expect, it } from "vitest";
import { describeVoiceIntent, parseVoiceCommand } from "./voice";

describe("parseVoiceCommand", () => {
  it("matches high-frequency action commands", () => {
    expect(parseVoiceCommand("save scene").intent).toEqual({ kind: "save_scene" });
    expect(parseVoiceCommand("run continuity checks").intent).toEqual({
      kind: "run_continuity_checks"
    });
    expect(parseVoiceCommand("open runs").intent).toEqual({
      kind: "open_tab",
      tab: "runs"
    });
  });

  it("matches scene navigation", () => {
    expect(parseVoiceCommand("open scene 12").intent).toEqual({
      kind: "open_scene",
      sceneId: "scene-0012"
    });
  });

  it("captures generation command options", () => {
    expect(parseVoiceCommand("generate proposal scene 7 tighten pacing").intent).toEqual({
      kind: "generate_proposal",
      sceneId: "scene-0007",
      instruction: "scene 7 tighten pacing"
    });
    expect(parseVoiceCommand("generate proposal").intent).toEqual({
      kind: "generate_proposal",
      sceneId: undefined,
      instruction: undefined
    });
  });

  it("returns null intent for unsupported transcripts", () => {
    const parsed = parseVoiceCommand("this should not match any command");
    expect(parsed.intent).toBeNull();
    expect(parsed.reason).toContain("No supported");
  });
});

describe("describeVoiceIntent", () => {
  it("formats readable intent labels", () => {
    expect(describeVoiceIntent({ kind: "save_scene" })).toBe("save scene");
    expect(
      describeVoiceIntent({
        kind: "generate_proposal",
        sceneId: "scene-0002",
        instruction: "tighten pacing"
      })
    ).toContain("scene-0002");
    expect(
      describeVoiceIntent({
        kind: "dictate_scene",
        sceneId: "scene-0003",
        transcript: "dictated line"
      })
    ).toContain("scene-0003");
  });
});
