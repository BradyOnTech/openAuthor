import { readWritingVoice, WRITING_VOICE_PURPOSE, type WritingVoice } from "./writingVoice";
import { selectAcceptedCanon, type CanonContext } from "./acceptedCanon";

export type ProjectIdentity = {
  projectId: string;
  revision: string;
};

export type SnapshotScene = {
  id: string;
  title: string;
  summary: string;
  pov: string;
  status: string;
  created_at: string;
  updated_at: string;
  body: string;
  chapter_title?: string;
  act_title?: string;
};

export type SnapshotEvidence = {
  kind: string;
  reference: string;
  content_digest: string;
  authority: number;
};

export type MobileSnapshot = {
  schema: "openauthor.mobile.snapshot";
  schema_version: 1;
  project_id: string;
  revision: string;
  scenes: readonly SnapshotScene[];
  reading_order?: "plan";
  codex: {
    entities: readonly Record<string, unknown>[];
    relationships: readonly Record<string, unknown>[];
  };
  evidence: readonly SnapshotEvidence[];
  writing_voice?: WritingVoice | null;
  accepted_canon?: readonly Record<string, unknown>[];
};

export type SearchResult = {
  kind: "scene" | "codex_entity";
  sourceId: string;
  title: string;
  excerpt: string;
  score: number;
  citation: {
    reference: string;
    contentDigest: string;
    authority: number;
  };
};

export type MobileContextPack = {
  schemaVersion: 1;
  projectId: string;
  revision: string;
  utterance: string;
  writingVoice?: { profile: WritingVoice; purpose: string };
  acceptedCanon?: CanonContext;
  items: Array<{
    kind: SearchResult["kind"];
    sourceId: string;
    title: string;
    content: string;
    citation: SearchResult["citation"];
  }>;
  usedCharacters: number;
  maxCharacters: number;
};

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Mobile snapshot ${name} is required.`);
  }
  return value;
}

function tokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function excerpt(value: string, limit = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function scoreText(queryTokens: string[], value: string): number {
  if (queryTokens.length === 0) return 0;
  const valueTokens = tokens(value);
  const counts = new Map<string, number>();
  for (const token of valueTokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  let score = 0;
  for (const token of new Set(queryTokens)) {
    const count = counts.get(token) ?? 0;
    if (count > 0) score += 1 + Math.min(count - 1, 2) * 0.1;
  }
  return score / new Set(queryTokens).size;
}

// Downloads retain the author's records. Model-facing search must project them
// at read time, including snapshots downloaded before privacy filtering shipped.
// Mobile has no per-entry consent flow yet, so `ask` remains unavailable to AI.
function assistantMemoryText(entity: Record<string, unknown>): string | null {
  if ((entity.ai_visibility ?? "include") !== "include") return null;
  const fields = [entity.name, entity.type, entity.description, entity.category,
    ...(Array.isArray(entity.aliases) ? entity.aliases : []),
    ...(Array.isArray(entity.tags) ? entity.tags : [])];
  const details = Array.isArray(entity.details) ? entity.details : [];
  for (const detail of details) {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) continue;
    const row = detail as Record<string, unknown>;
    if ((row.ai_visibility ?? "include") !== "include") continue;
    fields.push(`${String(row.key ?? "")}: ${JSON.stringify(row.value ?? "")}`);
  }
  return fields.filter((value) => typeof value === "string").join("\n");
}

function evidenceFor(
  snapshot: MobileSnapshot,
  kind: SearchResult["kind"],
  sourceId: string,
): SearchResult["citation"] {
  const reference = `${kind}:${sourceId}`;
  const direct = snapshot.evidence.find((item) => item.reference === reference);
  return {
    reference,
    contentDigest: direct?.content_digest ?? "",
    authority: direct?.authority ?? (kind === "scene" ? 100 : 90),
  };
}

export class SnapshotProject {
  readonly #snapshot: MobileSnapshot;
  readonly #sceneById: Map<string, SnapshotScene>;

  private constructor(snapshot: MobileSnapshot) {
    this.#snapshot = snapshot;
    this.#sceneById = new Map(snapshot.scenes.map((scene) => [scene.id, scene]));
  }

  static open(snapshot: MobileSnapshot): SnapshotProject {
    if (snapshot.schema !== "openauthor.mobile.snapshot" || snapshot.schema_version !== 1) {
      throw new Error("Unsupported mobile snapshot schema.");
    }
    requiredString(snapshot.project_id, "project identity");
    requiredString(snapshot.revision, "revision anchor");
    const ids = new Set<string>();
    for (const scene of snapshot.scenes) {
      const sceneId = requiredString(scene.id, "scene id");
      if (ids.has(sceneId)) throw new Error(`Duplicate scene id '${sceneId}'.`);
      ids.add(sceneId);
    }
    readWritingVoice(snapshot.writing_voice);
    selectAcceptedCanon(snapshot);
    return new SnapshotProject(snapshot);
  }

  identity(): ProjectIdentity {
    return {
      projectId: this.#snapshot.project_id,
      revision: this.#snapshot.revision,
    };
  }

  listScenes(): SnapshotScene[] {
    return this.#snapshot.scenes.map((scene) => ({ ...scene }));
  }

  readingOrder(): string {
    return this.#snapshot.reading_order === "plan"
      ? "Desktop Plan reading order · not necessarily story chronology"
      : "Downloaded scene order · republish from desktop for Plan order";
  }

  writingVoice(): WritingVoice | null {
    return readWritingVoice(this.#snapshot.writing_voice);
  }

  acceptedCanon(sceneId?: string): CanonContext | undefined {
    return selectAcceptedCanon(this.#snapshot, sceneId);
  }

  getScene(sceneId: string): SnapshotScene | null {
    const scene = this.#sceneById.get(sceneId);
    return scene ? { ...scene } : null;
  }

  search(query: string, limit = 8): SearchResult[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("Search limit must be between 1 and 50.");
    }
    const queryTokens = tokens(query);
    if (queryTokens.length === 0) return [];
    const results: SearchResult[] = [];
    for (const scene of this.#snapshot.scenes) {
      const searchable = `${scene.title}\n${scene.summary}\n${scene.pov}\n${scene.body}\n${scene.chapter_title ?? ""}\n${scene.act_title ?? ""}`;
      const score = scoreText(queryTokens, searchable);
      if (score === 0) continue;
      results.push({
        kind: "scene",
        sourceId: scene.id,
        title: scene.title,
        excerpt: excerpt(scene.body || scene.summary),
        score,
        citation: evidenceFor(this.#snapshot, "scene", scene.id),
      });
    }
    for (const entity of this.#snapshot.codex.entities) {
      const serialized = assistantMemoryText(entity);
      if (serialized === null) continue;
      const id = typeof entity.id === "string" ? entity.id : "";
      const title = typeof entity.name === "string" ? entity.name : id;
      if (!id || !title) continue;
      const score = scoreText(queryTokens, serialized);
      if (score === 0) continue;
      results.push({
        kind: "codex_entity",
        sourceId: id,
        title,
        excerpt: excerpt(serialized),
        score,
        citation: evidenceFor(this.#snapshot, "codex_entity", id),
      });
    }
    return results
      .sort((left, right) => (
        right.score - left.score
        || left.kind.localeCompare(right.kind)
        || left.sourceId.localeCompare(right.sourceId)
      ))
      .slice(0, limit);
  }

  buildContext(input: {
    utterance: string;
    currentSceneId?: string;
    maxCharacters: number;
  }): MobileContextPack {
    if (!Number.isSafeInteger(input.maxCharacters) || input.maxCharacters < 64) {
      throw new Error("Context character budget must be at least 64.");
    }
    const candidates: SearchResult[] = [];
    const profile = this.writingVoice();
    const writingVoice = profile ? { profile, purpose: WRITING_VOICE_PURPOSE } : undefined;
    // Required preferences are admitted in full. This measures local context
    // content, not provider tokens, the entire request or a session cost limit.
    const voiceCharacters = writingVoice ? JSON.stringify(writingVoice).length : 0;
    if (voiceCharacters > input.maxCharacters) {
      throw new Error("The approved Writing Voice exceeds this voice session's context limit. Shorten the profile on desktop and publish a new snapshot before starting voice.");
    }
    const acceptedCanon = this.acceptedCanon(input.currentSceneId);
    const canonCharacters = acceptedCanon ? JSON.stringify(acceptedCanon).length : 0;
    if (voiceCharacters + canonCharacters > input.maxCharacters) {
      throw new Error("Accepted story facts and Writing Voice exceed this voice session's context limit. Choose a more focused scene or review outdated facts on desktop, then publish a fresh snapshot.");
    }
    if (input.currentSceneId) {
      const scene = this.#sceneById.get(input.currentSceneId);
      if (!scene) throw new Error("The selected scene is unavailable in this snapshot. Reopen the book and select a current scene.");
      candidates.push({
        kind: "scene",
        sourceId: scene.id,
        title: scene.title,
        excerpt: scene.body || scene.summary,
        score: Number.POSITIVE_INFINITY,
        citation: evidenceFor(this.#snapshot, "scene", scene.id),
      });
    }
    for (const result of this.search(input.utterance, 12)) {
      if (!candidates.some((item) => item.kind === result.kind && item.sourceId === result.sourceId)) {
        candidates.push(result);
      }
    }

    let remaining = input.maxCharacters - voiceCharacters - canonCharacters;
    const items: MobileContextPack["items"] = [];
    for (const candidate of candidates) {
      const focused = candidate.kind === "scene" && candidate.sourceId === input.currentSceneId;
      if (focused && candidate.excerpt.length > remaining) {
        throw new Error("The selected scene and Writing Voice exceed this voice session's context limit when combined with accepted story facts. Choose a shorter scene or discuss the book without a selected scene.");
      }
      if (remaining <= 0) break;
      const content = focused ? candidate.excerpt : excerpt(candidate.excerpt, remaining);
      if (!content) continue;
      items.push({
        kind: candidate.kind,
        sourceId: candidate.sourceId,
        title: candidate.title,
        content,
        citation: candidate.citation,
      });
      remaining -= content.length;
    }
    return {
      schemaVersion: 1,
      projectId: this.#snapshot.project_id,
      revision: this.#snapshot.revision,
      utterance: input.utterance,
      ...(writingVoice ? { writingVoice } : {}),
      ...(acceptedCanon ? { acceptedCanon } : {}),
      items,
      usedCharacters: input.maxCharacters - remaining,
      maxCharacters: input.maxCharacters,
    };
  }
}
