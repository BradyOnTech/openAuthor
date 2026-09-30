import { useEffect, useState } from "react";
import {
  addCanonFact,
  addNarrativeSetup,
  addOpenQuestion,
  disposeCanonDiagnostic,
  listCanonFacts,
  listNarrativeSetups,
  listOpenQuestions,
  resolveNarrativeSetup,
  runCanonDiagnostics,
  listCharacterArcStates,
  addCharacterArcState,
} from "../../api";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { flushProjectSceneSaves } from "../../sceneSaveSession";
import { EvidencePassages } from "../shared/EvidencePassages";
import type { CanonDiagnostic, CanonFact, CharacterArcState, NarrativeSetup, OpenQuestion } from "../../types";

export function CanonMemoryEditor() {
  const { projectRoot, scenes, codexEntities, setError, setMessage } = useWorkspace();
  const [facts, setFacts] = useState<CanonFact[]>([]);
  const [setups, setSetups] = useState<NarrativeSetup[]>([]);
  const [questions, setQuestions] = useState<OpenQuestion[]>([]);
  const [diagnostics, setDiagnostics] = useState<CanonDiagnostic[]>([]);
  const [arcStates, setArcStates] = useState<CharacterArcState[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [predicate, setPredicate] = useState("");
  const [value, setValue] = useState("");
  const [sceneId, setSceneId] = useState(scenes[0]?.id ?? "");
  const [excerpt, setExcerpt] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [setupText, setSetupText] = useState("");
  const [questionText, setQuestionText] = useState("");
  const [arcCharacter, setArcCharacter] = useState("");
  const [arcDimension, setArcDimension] = useState("");
  const [arcValue, setArcValue] = useState("");
  const [arcType, setArcType] = useState<"observed" | "planned">("observed");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void load(); }, [projectRoot]);

  async function load() {
    setBusy(true);
    try {
      if (!await flushProjectSceneSaves(projectRoot)) throw new Error("Save your pending writing before running diagnostics.");
      const [nextFacts, nextSetups, nextQuestions, nextArcStates, report] = await Promise.all([
        listCanonFacts(projectRoot), listNarrativeSetups(projectRoot), listOpenQuestions(projectRoot), listCharacterArcStates(projectRoot), runCanonDiagnostics(projectRoot),
      ]);
      setFacts(nextFacts); setSetups(nextSetups); setQuestions(nextQuestions); setArcStates(nextArcStates); setDiagnostics(report.diagnostics);
    } catch (error) {
      setError(`Failed to load Canon Memory: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setBusy(false); }
  }

  async function mutate(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try { await action(); await load(); setMessage(message); }
    catch (error) { setError(`Canon Memory update failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  }

  const entityName = (id: string) => codexEntities.find((row) => row.id === id)?.name || "Story";
  return (
    <div style={{ height: "100%", overflow: "auto", background: "var(--bg-deep)" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "var(--space-6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", marginBottom: "var(--space-5)" }}>
          <div><div style={eyebrow}>Evidence-backed story truth</div><h1 style={pageTitle}>Canon & Continuity</h1></div>
          <button className="btn" style={{ minHeight: 40 }} disabled={busy} onClick={() => void load()}>{busy ? "Checking…" : "Run Diagnostics"}</button>
        </div>
        <p style={{ ...valueStyle, marginBottom: 16 }}>Local checks compare recorded Canon, knowledge, setups and arcs, plus explicit English descriptions of finger counts and eye/hair colors. Not a comprehensive plot, timeline, motivation or prose-quality analysis. Warnings need author review; an empty result is not proof of consistency.</p>

        <section style={panelStyle}>
          <h2 style={sectionTitle}>Add Canon Fact</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.5fr", gap: 8 }}>
            <select className="select" aria-label="Fact subject" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">Story-wide fact</option>{codexEntities.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
            <input className="input" aria-label="Fact predicate" placeholder="role, location, color…" value={predicate} onChange={(event) => setPredicate(event.target.value)} />
            <input className="input" aria-label="Fact value" placeholder="What is true?" value={value} onChange={(event) => setValue(event.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8, marginTop: 8 }}>
            <select className="select" aria-label="Evidence scene" value={sceneId} onChange={(event) => setSceneId(event.target.value)}>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select>
            <input className="input" aria-label="Evidence excerpt" placeholder="Exact supporting passage" value={excerpt} onChange={(event) => setExcerpt(event.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginTop: 8 }}>
            <select className="select" aria-label="Valid from" value={validFrom} onChange={(event) => setValidFrom(event.target.value)}><option value="">True from beginning</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>From {scene.title}</option>)}</select>
            <select className="select" aria-label="Valid to" value={validTo} onChange={(event) => setValidTo(event.target.value)}><option value="">Remains true</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>Until {scene.title}</option>)}</select>
            <button className="btn btn--primary" disabled={busy || !predicate.trim() || !value.trim() || !sceneId || !excerpt.trim()} onClick={() => void mutate(() => addCanonFact(projectRoot, { subjectId, predicate, value, sceneId, excerpt, validFrom, validTo }), "Canon Fact added.")}>Add Fact</button>
          </div>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", marginTop: "var(--space-4)" }}>
          <section style={panelStyle}><h2 style={sectionTitle}>Canon Facts <span style={countStyle}>{facts.length}</span></h2>{facts.map((fact) => <article key={fact.id} style={rowStyle}><strong>{entityName(fact.subject_entity_id)} · {fact.predicate}</strong><div style={valueStyle}>{fact.value}</div><div style={metaStyle}>{fact.validity.from_scene_id || "beginning"} → {fact.validity.to_scene_id || "ongoing"} · {fact.evidence.length} source{fact.evidence.length === 1 ? "" : "s"}</div></article>)}</section>
          <section style={panelStyle}><h2 style={sectionTitle}>Continuity Diagnostics <span style={countStyle}>{diagnostics.length}</span></h2>{!busy && diagnostics.length === 0 && <p style={valueStyle}>No findings from these limited checks.</p>}{diagnostics.map((diagnostic) => <article key={diagnostic.id} style={{ ...rowStyle, borderLeft: `3px solid var(--${diagnostic.severity === "error" ? "danger" : diagnostic.severity === "warning" ? "warning" : "info"})` }}><strong>{diagnostic.title}</strong><div style={valueStyle}>{diagnostic.message}</div><div style={metaStyle}>{diagnostic.evidence.length} evidence passage{diagnostic.evidence.length === 1 ? "" : "s"}{diagnostic.disposition ? ` · ${diagnostic.disposition.disposition}` : ""}</div><EvidencePassages evidence={diagnostic.evidence} />{!diagnostic.disposition && <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>{(["intentional", "dismissed", "deferred"] as const).map((disposition) => <button key={disposition} className="btn btn--sm" style={{ minHeight: 40 }} disabled={busy} onClick={() => void mutate(() => disposeCanonDiagnostic(projectRoot, diagnostic.id, disposition), `Marked ${disposition}.`)}>{disposition}</button>)}</div>}</article>)}</section>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)", marginTop: "var(--space-4)" }}>
          <section style={panelStyle}><h2 style={sectionTitle}>Setups & Payoffs</h2><div style={{ display: "flex", gap: 8 }}><input className="input" placeholder="Narrative promise or planted detail" value={setupText} onChange={(event) => setSetupText(event.target.value)} /><button className="btn" disabled={!setupText.trim() || !sceneId || !excerpt.trim()} onClick={() => void mutate(() => addNarrativeSetup(projectRoot, setupText, sceneId, excerpt), "Setup tracked.")}>Track</button></div>{setups.map((setup) => <article key={setup.id} style={rowStyle}><strong>{setup.description}</strong><div style={metaStyle}>{setup.status === "paid_off" ? "Paid off" : `Open since ${setup.setup_evidence.scene_id}`}</div>{setup.status === "open" && <button className="btn btn--sm" style={{ marginTop: 6 }} disabled={!sceneId || !excerpt.trim()} onClick={() => void mutate(() => resolveNarrativeSetup(projectRoot, setup.id, sceneId, excerpt), "Payoff linked.")}>Use current evidence as payoff</button>}</article>)}</section>
          <section style={panelStyle}><h2 style={sectionTitle}>Open Questions</h2><div style={{ display: "flex", gap: 8 }}><input className="input" placeholder="What should remain unresolved?" value={questionText} onChange={(event) => setQuestionText(event.target.value)} /><button className="btn" disabled={!questionText.trim()} onClick={() => void mutate(() => addOpenQuestion(projectRoot, questionText, sceneId, true), "Open Question tracked.")}>Track</button></div>{questions.map((question) => <article key={question.id} style={rowStyle}><strong>{question.question}</strong><div style={metaStyle}>{question.status.replace(/_/g, " ")}</div></article>)}</section>
        </div>

        <section style={{ ...panelStyle, marginTop: "var(--space-4)" }}>
          <h2 style={sectionTitle}>Character Arcs <span style={countStyle}>{arcStates.length}</span></h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>Track how a character’s belief, desire, relationship, or self-image changes through manuscript evidence. Planned and observed states can diverge without silently rewriting canon.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 120px auto", gap: 8 }}>
            <select className="select" aria-label="Arc character" value={arcCharacter} onChange={(event) => setArcCharacter(event.target.value)}><option value="">Character…</option>{codexEntities.filter((row) => row.type === "character").map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
            <input className="input" aria-label="Arc dimension" placeholder="belief, trust, desire…" value={arcDimension} onChange={(event) => setArcDimension(event.target.value)} />
            <input className="input" aria-label="Arc state" placeholder="What is true here?" value={arcValue} onChange={(event) => setArcValue(event.target.value)} />
            <select className="select" aria-label="Arc state type" value={arcType} onChange={(event) => setArcType(event.target.value as typeof arcType)}><option value="observed">Observed</option><option value="planned">Planned</option></select>
            <button className="btn" disabled={busy || !arcCharacter || !arcDimension.trim() || !arcValue.trim() || !sceneId || !excerpt.trim()} onClick={() => void mutate(() => addCharacterArcState(projectRoot, { characterId: arcCharacter, dimension: arcDimension, value: arcValue, sceneId, excerpt, stateType: arcType }), "Character Arc State added.")}>Add State</button>
          </div>
          {arcStates.map((state) => <article key={state.id} style={rowStyle}><strong>{entityName(state.character_entity_id)} · {state.dimension}</strong><div style={valueStyle}>{state.value}</div><div style={metaStyle}>{state.state_type} in {scenes.find((row) => row.id === state.scene_id)?.title ?? state.scene_id}</div></article>)}
        </section>
      </div>
    </div>
  );
}

const panelStyle = { padding: "var(--space-4)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--bg-surface)" } as const;
const eyebrow = { color: "var(--text-tertiary)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em" } as const;
const pageTitle = { color: "var(--text-primary)", fontFamily: "var(--font-prose)", fontWeight: 500, margin: "4px 0 0" } as const;
const sectionTitle = { color: "var(--text-primary)", fontSize: "var(--text-lg)", margin: "0 0 var(--space-3)" } as const;
const countStyle = { color: "var(--text-tertiary)", fontSize: "var(--text-xs)", fontWeight: 400 } as const;
const rowStyle = { padding: "var(--space-3)", marginTop: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text-primary)" } as const;
const valueStyle = { color: "var(--text-secondary)", fontSize: "var(--text-sm)", marginTop: 4, lineHeight: 1.45 } as const;
const metaStyle = { color: "var(--text-tertiary)", fontSize: "var(--text-xs)", marginTop: 5 } as const;
