import { describe, expect, it } from "vitest";
import { SnapshotProject, type MobileSnapshot } from "../src/core/snapshotProject";

const canonFact = {
  id: "fact-key", status: "accepted", subject_entity_id: "", subject_name: "Project",
  predicate: "key material", value: "brass", validity: { from_scene_id: "s1", to_scene_id: "" },
  scope: "project", confidence: 0.9,
  knowledge: [{ character_entity_id: "mara", character_name: "Mara", state: "does_not_know", from_scene_id: "s1" }],
  evidence: [{ scene_id: "s1", excerpt: "A brass key.", verification: "excerpt_present" }],
};
const snapshot: MobileSnapshot = {
  schema: "openauthor.mobile.snapshot", schema_version: 1, project_id: "p", revision: "r",
  scenes: [{ id: "s1", title: "Key", summary: "", pov: "Mara", status: "draft", created_at: "x", updated_at: "x", body: "A brass key." },
    { id: "s2", title: "Elsewhere", summary: "", pov: "Ivo", status: "draft", created_at: "x", updated_at: "x", body: "Ivo sleeps." }],
  codex: { entities: [{ id: "mara", name: "Mara" }, { id: "ivo", name: "Ivo", aliases: ["Keeper"] }], relationships: [] },
  evidence: [], accepted_canon: [canonFact],
};

describe("accepted mobile canon", () => {
  it("retains exact sources, validity and character knowledge in voice context", () => {
    const project = SnapshotProject.open(snapshot);
    const context = project.buildContext({ utterance: "", currentSceneId: "s1", maxCharacters: 4000 });
    expect(context.acceptedCanon?.facts).toEqual([canonFact]);
    expect(context.acceptedCanon?.purpose).toContain("author knowledge is not character knowledge");
    const required = JSON.stringify(context.acceptedCanon).length + "A brass key.".length;
    expect(context.usedCharacters).toBe(required);
    expect(project.buildContext({ utterance: "", currentSceneId: "s1", maxCharacters: required }).usedCharacters).toBe(required);
    expect(() => project.buildContext({ utterance: "", currentSceneId: "s1", maxCharacters: required - 1 })).toThrow("context limit");
    expect(() => project.buildContext({ utterance: "", maxCharacters: 64 })).toThrow("Accepted story facts");
  });

  it("rechecks downloaded permissions and strips extra fields without mutating records", () => {
    const data = { ...snapshot, codex: { relationships: [], entities: [...snapshot.codex.entities,
      { id: "hidden", name: "Hidden", ai_visibility: "exclude" }, { id: "ask", name: "Ask", ai_visibility: "ask" }] },
    accepted_canon: [
      { ...canonFact, notes: "PRIVATE-NOTES", knowledge: [...canonFact.knowledge, { character_entity_id: "hidden", character_name: "PRIVATE-NAME", state: "knows", from_scene_id: "" }] },
      ...["hidden", "ask", "missing"].map((id) => ({ ...canonFact, id, subject_entity_id: id, value: "PRIVATE-FACT" })),
      ...["suggested", "rejected"].map((status) => ({ ...canonFact, status, value: "PRIVATE-NON-CANON" })),
    ] };
    const original = JSON.stringify(data);
    const selected = SnapshotProject.open(data).acceptedCanon();
    expect(selected?.facts).toEqual([canonFact]);
    expect(JSON.stringify(selected)).not.toContain("PRIVATE-");
    expect(JSON.stringify(data)).toBe(original);
  });

  it("selects focused subjects, sources and known characters while retaining project-wide facts", () => {
    const ivoFact = { ...canonFact, id: "ivo-fact", subject_entity_id: "ivo", subject_name: "Ivo", evidence: [{ scene_id: "s2", excerpt: "Ivo sleeps." }], knowledge: [] };
    const project = SnapshotProject.open({ ...snapshot, accepted_canon: [canonFact, ivoFact] });
    expect(project.acceptedCanon("s1")?.facts.map((row) => row.id)).toEqual(["fact-key"]);
    expect(project.acceptedCanon("s2")?.facts.map((row) => row.id)).toEqual(["fact-key", "ivo-fact"]);
    expect(project.acceptedCanon()?.facts).toHaveLength(2);
    const aliasScene = { ...snapshot.scenes[0]!, pov: "Keeper" };
    expect(SnapshotProject.open({ ...snapshot, scenes: [aliasScene], accepted_canon: [ivoFact] }).acceptedCanon("s1")?.facts).toHaveLength(1);
    const known = { ...ivoFact, knowledge: canonFact.knowledge };
    expect(SnapshotProject.open({ ...snapshot, accepted_canon: [known] }).acceptedCanon("s1")?.facts).toHaveLength(1);
  });

  it("rechecks evidence against downloaded prose and distinguishes old from empty snapshots", () => {
    const project = SnapshotProject.open({ ...snapshot, accepted_canon: [
      { ...canonFact, evidence: [{ scene_id: "s1", excerpt: "Old wording.", verification: "excerpt_present" }] },
      { ...canonFact, id: "gone", evidence: [{ scene_id: "gone", excerpt: "Gone.", verification: "excerpt_present" }] },
    ] });
    expect(project.acceptedCanon()?.facts.map((row) => row.evidence[0]?.verification)).toEqual(["excerpt_missing", "scene_missing"]);
    const { accepted_canon, ...old } = snapshot;
    expect(SnapshotProject.open(old).acceptedCanon()).toBeUndefined();
    expect(SnapshotProject.open({ ...snapshot, accepted_canon: [] }).acceptedCanon()?.facts).toEqual([]);
    expect(() => SnapshotProject.open({ ...snapshot, accepted_canon: [{ ...canonFact, validity: null }] })).toThrow("accepted canon is invalid");
    expect(() => SnapshotProject.open({ ...snapshot, accepted_canon: [{ ...canonFact, evidence: [] }] })).toThrow("accepted canon is invalid");
  });
});
