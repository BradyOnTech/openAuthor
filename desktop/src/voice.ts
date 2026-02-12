export type VoiceIntent =
  | { kind: "save_scene" }
  | { kind: "generate_proposal"; sceneId?: string; instruction?: string }
  | { kind: "run_continuity_checks" }
  | { kind: "open_tab"; tab: "proposals" | "codex" | "checks" | "context" | "runs" | "merge" }
  | { kind: "open_view"; view: "editor" | "outliner" }
  | { kind: "open_scene"; sceneId: string }
  | { kind: "dictate_scene"; sceneId: string; transcript: string };

export type VoiceParseResult = {
  intent: VoiceIntent | null;
  normalized: string;
  confidence: number;
  reason: string;
};

function normalizeTranscript(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSceneId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return undefined;
  return `scene-${String(parsed).padStart(4, "0")}`;
}

function afterPrefix(raw: string, prefix: string): string {
  const lower = raw.trim().toLowerCase();
  if (!lower.startsWith(prefix)) return "";
  return raw.trim().slice(prefix.length).trim();
}

export function parseVoiceCommand(transcript: string): VoiceParseResult {
  const normalized = normalizeTranscript(transcript);
  if (normalized === "") {
    return {
      intent: null,
      normalized,
      confidence: 0,
      reason: "Empty transcript."
    };
  }

  if (
    normalized === "save" ||
    normalized === "save scene" ||
    normalized === "save this scene"
  ) {
    return {
      intent: { kind: "save_scene" },
      normalized,
      confidence: 0.98,
      reason: "Matched save command."
    };
  }

  if (
    normalized === "run checks" ||
    normalized === "run continuity checks" ||
    normalized === "check continuity" ||
    normalized === "run continuity"
  ) {
    return {
      intent: { kind: "run_continuity_checks" },
      normalized,
      confidence: 0.97,
      reason: "Matched continuity checks command."
    };
  }

  const tabMatchers: Array<{
    phrases: string[];
    tab: "proposals" | "codex" | "checks" | "context" | "runs" | "merge";
  }> = [
    { phrases: ["open proposals", "open proposal review", "show proposals"], tab: "proposals" },
    { phrases: ["open codex", "show codex"], tab: "codex" },
    { phrases: ["open checks", "show checks", "open continuity checks"], tab: "checks" },
    { phrases: ["open context", "show context"], tab: "context" },
    { phrases: ["open runs", "show runs"], tab: "runs" },
    { phrases: ["open merge", "show merge", "open guided merge"], tab: "merge" }
  ];
  for (const matcher of tabMatchers) {
    if (matcher.phrases.includes(normalized)) {
      return {
        intent: { kind: "open_tab", tab: matcher.tab },
        normalized,
        confidence: 0.96,
        reason: "Matched tab navigation command."
      };
    }
  }

  if (normalized === "open editor" || normalized === "show editor") {
    return {
      intent: { kind: "open_view", view: "editor" },
      normalized,
      confidence: 0.95,
      reason: "Matched center view command."
    };
  }
  if (normalized === "open outliner" || normalized === "show outliner") {
    return {
      intent: { kind: "open_view", view: "outliner" },
      normalized,
      confidence: 0.95,
      reason: "Matched center view command."
    };
  }

  const sceneMatch = normalized.match(
    /^(?:open|load|select|go to)\s+scene\s+(\d{1,4})$/
  );
  if (sceneMatch) {
    const sceneId = parseSceneId(sceneMatch[1]);
    if (sceneId) {
      return {
        intent: { kind: "open_scene", sceneId },
        normalized,
        confidence: 0.95,
        reason: "Matched scene navigation command."
      };
    }
  }

  if (normalized.startsWith("generate proposal")) {
    const sceneRef = normalized.match(/\bscene\s+(\d{1,4})\b/);
    const sceneId = parseSceneId(sceneRef?.[1]);
    const instruction = afterPrefix(transcript, "generate proposal");
    return {
      intent: {
        kind: "generate_proposal",
        sceneId,
        instruction: instruction === "" ? undefined : instruction
      },
      normalized,
      confidence: 0.9,
      reason: "Matched proposal generation command."
    };
  }

  if (normalized === "generate" || normalized === "generate proposal now") {
    return {
      intent: { kind: "generate_proposal" },
      normalized,
      confidence: 0.84,
      reason: "Matched short proposal generation command."
    };
  }

  return {
    intent: null,
    normalized,
    confidence: 0.2,
    reason: "No supported voice command match."
  };
}

export function describeVoiceIntent(intent: VoiceIntent): string {
  if (intent.kind === "save_scene") return "save scene";
  if (intent.kind === "generate_proposal") {
    const parts = ["generate proposal"];
    if (intent.sceneId) parts.push(`for ${intent.sceneId}`);
    if (intent.instruction) parts.push(`with instruction '${intent.instruction}'`);
    return parts.join(" ");
  }
  if (intent.kind === "run_continuity_checks") return "run continuity checks";
  if (intent.kind === "open_tab") return `open ${intent.tab} tab`;
  if (intent.kind === "open_view") return `open ${intent.view} view`;
  if (intent.kind === "dictate_scene") return `dictation proposal for ${intent.sceneId}`;
  return `open ${intent.sceneId}`;
}
