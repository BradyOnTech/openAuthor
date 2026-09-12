import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { addEditorialPass, draftProposal, generateProposal, getStyleProfile, listEditorialPasses, type EditorialPass, type StyleProfile } from "../../api";
import type { ProposalProvider } from "../../types";
import { availableProviders, defaultProvider } from "../../providerSelection";

export function GenerateProposal({ initialSceneId }: { initialSceneId?: string }) {
  const { projectRoot, scenes, runtimeConfig, refreshProposals, refreshRuns, setError, setMessage } =
    useWorkspace();
  const { openTab, closeTab } = useEditor();

  const providers = useMemo(() => {
    return availableProviders(runtimeConfig).map(({ id, model }) => ({ name: id, model }));
  }, [runtimeConfig]);

  const [sceneId, setSceneId] = useState(initialSceneId ?? scenes[0]?.id ?? "");
  const [instruction, setInstruction] = useState("");
  const [provider, setProvider] = useState<ProposalProvider>("local");
  const providerWasSelected = useRef(false);
  const [model, setModel] = useState("");
  const [constraints, setConstraints] = useState("");
  const [protectedElements, setProtectedElements] = useState("");
  const [busy, setBusy] = useState(false);
  const [passes, setPasses] = useState<EditorialPass[]>([]);
  const [selectedPassId, setSelectedPassId] = useState("");
  const [showPassBuilder, setShowPassBuilder] = useState(false);
  const [passName, setPassName] = useState("");
  const [passGoal, setPassGoal] = useState("");
  const [passInstruction, setPassInstruction] = useState("");
  const [passCriteria, setPassCriteria] = useState("");
  const [styleProfile, setStyleProfile] = useState<StyleProfile | null>(null);
  const [alternativeCount, setAlternativeCount] = useState<1 | 3>(1);
  const [coordinated, setCoordinated] = useState(false);
  const [coordinatedSceneIds, setCoordinatedSceneIds] = useState<string[]>(initialSceneId ? [initialSceneId] : scenes[0]?.id ? [scenes[0].id] : []);

  useEffect(() => {
    // The composer can open before the project's scenes finish loading. Keep
    // its state aligned with the displayed default without resetting choices.
    if (sceneId || !scenes[0]?.id) return;
    const firstId = scenes[0].id;
    setSceneId(firstId);
    setCoordinatedSceneIds((ids) => [...new Set([firstId, ...ids.filter(Boolean)])]);
  }, [sceneId, scenes]);

  useEffect(() => {
    if (!providerWasSelected.current && runtimeConfig) {
      setProvider(defaultProvider(runtimeConfig).id);
    }
  }, [runtimeConfig]);

  useEffect(() => {
    void listEditorialPasses(projectRoot)
      .then(setPasses)
      .catch((error) => setError(`Failed to load Editorial Passes: ${error instanceof Error ? error.message : String(error)}`));
    void getStyleProfile(projectRoot).then((profile) => {
      setStyleProfile(profile);
    }).catch((error) => setError(`Failed to load Style Profile: ${error instanceof Error ? error.message : String(error)}`));
  }, [projectRoot, setError]);

  function choosePass(passId: string) {
    setSelectedPassId(passId);
    const editorialPass = passes.find((row) => row.id === passId);
    if (!editorialPass) return;
    setInstruction(`[Editorial Pass: ${editorialPass.name}] ${editorialPass.instruction}`);
  }

  async function createCustomPass() {
    if (!passName.trim() || !passGoal.trim() || !passInstruction.trim()) return;
    try {
      const created = await addEditorialPass(projectRoot, {
        name: passName.trim(), goal: passGoal.trim(), instruction: passInstruction.trim(),
        criteria: passCriteria.split("\n").map((row) => row.trim()).filter(Boolean),
      });
      setPasses((rows) => [...rows, created]);
      setPassName(""); setPassGoal(""); setPassInstruction(""); setPassCriteria(""); setShowPassBuilder(false);
      choosePass(created.id);
      setSelectedPassId(created.id);
      setInstruction(`[Editorial Pass: ${created.name}] ${created.instruction}`);
      setMessage(`Editorial Pass “${created.name}” saved.`);
    } catch (error) {
      setError(`Failed to create Editorial Pass: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function handleGenerate() {
    if (!sceneId || !instruction.trim()) return;
    setBusy(true);
    try {
      const proposals = [];
      const targetSceneIds = coordinated ? coordinatedSceneIds : [sceneId];
      if (targetSceneIds.length === 0) return;
      const groupId = coordinated && targetSceneIds.length > 1 ? `change-group-ui-${Date.now()}` : undefined;
      const directionCount = coordinated ? 1 : alternativeCount;
      for (const targetSceneId of targetSceneIds) {
      for (let index = 0; index < directionCount; index += 1) {
        const direction = alternativeCount === 1 ? "" : `\n\nAlternative direction ${index + 1} of ${alternativeCount}: make this a materially distinct creative approach, not a paraphrase of the other directions.`;
        const generated = await generateProposal(projectRoot, {
          sceneId: targetSceneId,
          instruction: instruction.trim() + direction,
          provider,
          model: model.trim() || undefined,
          temperature: alternativeCount === 1 ? undefined : 0.35 + index * 0.15,
          constraints: constraints.split("\n").map((value) => value.trim()).filter(Boolean),
          protectedElements: protectedElements.split("\n").map((value) => value.trim()).filter(Boolean),
          changeGroupId: groupId,
        });
        proposals.push(await draftProposal(projectRoot, {
          proposalId: generated.id,
          provider,
          model: model.trim() || undefined,
        }));
      }
      }
      setMessage(groupId ? `${proposals.length} coordinated Change Sets ready. Review each scene, then apply the group atomically from Changes.` : alternativeCount === 1 ? `Change Set ready: review each hunk before applying.` : `${alternativeCount} creative directions ready to compare.`);
      await Promise.all([refreshProposals(), refreshRuns()]);
      closeTab("generate");
      if (proposals.length === 1 || groupId) {
        const proposal = proposals[0];
        openTab({ id: `proposal:${proposal.id}`, kind: "proposal", label: proposal.title || proposal.id.slice(0, 8), data: proposal });
      } else {
        openTab({ id: `alternatives:${proposals[0].scene_id}`, kind: "alternatives", label: "Compare Directions", data: proposals });
      }
    } catch (e) {
      setError(`Generation failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        padding: "var(--space-6) var(--space-8)",
        background: "var(--bg-surface)",
        minHeight: "100%",
        overflow: "auto",
      }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <h2
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-xl)",
            fontWeight: "var(--weight-semibold)",
            color: "var(--text-primary)",
          }}
        >
          Create a Change Set
        </h2>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: "var(--leading-relaxed)" }}>
          Describe the revision once. The AI produces concrete prose split into reviewable hunks; it never
          edits your manuscript directly. You choose what to include, and openAuthor records a named Revision.
        </p>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--text-sm)" }}>
          <span style={{ color: "var(--text-secondary)" }}>Scene</span>
          <select className="input" value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || s.id}
              </option>
            ))}
          </select>
        </label>

        <div style={{ padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--bg-elevated)" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--text-primary)", fontSize: "var(--text-sm)" }}>
            <input type="checkbox" checked={coordinated} onChange={(event) => { setCoordinated(event.target.checked); if (event.target.checked) { setAlternativeCount(1); if (sceneId) setCoordinatedSceneIds((ids) => ids.includes(sceneId) ? ids : [...ids, sceneId]); } }} />
            Coordinate this revision across multiple scenes
          </label>
          <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", marginTop: 4 }}>Useful for Storyline experiments, arc changes, and alternate endings. Each scene remains separately reviewable; the chosen group applies as one Revision.</div>
          {coordinated && <div style={{ display: "grid", gap: 5, marginTop: 8 }}>{scenes.map((scene) => <label key={scene.id} style={{ display: "flex", gap: 7, color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}><input type="checkbox" checked={coordinatedSceneIds.includes(scene.id)} onChange={(event) => setCoordinatedSceneIds(event.target.checked ? [...coordinatedSceneIds, scene.id] : coordinatedSceneIds.filter((id) => id !== scene.id))} />{scene.title || scene.id}</label>)}</div>}
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--text-sm)" }}>
          <span style={{ color: "var(--text-secondary)" }}>Start with an Editorial Pass (optional)</span>
          <select className="input" aria-label="Editorial Pass" value={selectedPassId} onChange={(event) => choosePass(event.target.value)}>
            <option value="">Custom revision intent</option>
            {passes.map((editorialPass) => <option key={editorialPass.id} value={editorialPass.id}>{editorialPass.name} — {editorialPass.goal}</option>)}
          </select>
          {selectedPassId && <span style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>You can customize the pass below before generating. Its evaluation criteria remain visible in the Change Set intent.</span>}
          <button className="btn btn--sm" onClick={() => setShowPassBuilder((value) => !value)} style={{ alignSelf: "flex-start" }}>{showPassBuilder ? "Close Pass Builder" : "Build a Custom Pass"}</button>
        </label>

        {showPassBuilder && <div style={{ padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--bg-elevated)", display: "grid", gap: 8 }}>
          <strong style={{ color: "var(--text-primary)", fontSize: "var(--text-sm)" }}>Custom Editorial Pass</strong>
          <input className="input" placeholder="Pass name" value={passName} onChange={(event) => setPassName(event.target.value)} />
          <input className="input" placeholder="Creative goal" value={passGoal} onChange={(event) => setPassGoal(event.target.value)} />
          <textarea className="input" rows={3} placeholder="Readable editorial instructions" value={passInstruction} onChange={(event) => setPassInstruction(event.target.value)} />
          <textarea className="input" rows={2} placeholder="Evaluation criteria, one per line" value={passCriteria} onChange={(event) => setPassCriteria(event.target.value)} />
          <button className="btn btn--primary" disabled={!passName.trim() || !passGoal.trim() || !passInstruction.trim()} onClick={() => void createCustomPass()}>Save Pass</button>
        </div>}

        <div style={{ padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--bg-elevated)" }}>
          <strong>Writing Voice</strong>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{styleProfile ? `Approved voice: ${styleProfile.name}. Your scene-specific instructions can refine this direction.` : "Set the prose traits for this book, learn from your exemplars, and compare short samples."}</p>
          <button className="btn btn--sm" onClick={() => openTab({ id: "writing-voice", kind: "writing-voice", label: "Writing Voice" })}>Edit Writing Voice</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--text-sm)" }}>
            <span style={{ color: "var(--text-secondary)" }}>Constraints (optional, one per line)</span>
            <textarea
              className="input"
              rows={3}
              placeholder="Keep first-person past tense"
              value={constraints}
              onChange={(e) => setConstraints(e.target.value)}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--text-sm)" }}>
            <span style={{ color: "var(--text-secondary)" }}>Protect exactly (optional)</span>
            <textarea
              className="input"
              rows={3}
              placeholder="The quoted oath\nMara does not know the killer"
              value={protectedElements}
              onChange={(e) => setProtectedElements(e.target.value)}
            />
          </label>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--text-sm)" }}>
          <span style={{ color: "var(--text-secondary)" }}>What should change?</span>
          <textarea
            className="input"
            rows={4}
            placeholder="e.g. Tighten the pacing in the middle section and sharpen Elara's dialogue"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </label>

        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--text-sm)", flex: 1 }}>
            <span style={{ color: "var(--text-secondary)" }}>Provider</span>
            <select
              className="input"
              value={provider}
              onChange={(e) => {
                providerWasSelected.current = true;
                setProvider(e.target.value as ProposalProvider);
              }}
            >
              {providers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "var(--text-sm)", flex: 1 }}>
            <span style={{ color: "var(--text-secondary)" }}>Model (optional)</span>
            <input
              className="input"
              placeholder={providers.find((p) => p.name === provider)?.model ?? "default"}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
        </div>

        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 10, color: "var(--text-secondary)", fontSize: "var(--text-xs)" }}>
            <label style={{ display: "flex", gap: 5, alignItems: "center" }}><input type="radio" name="alternatives" checked={alternativeCount === 1} onChange={() => setAlternativeCount(1)} />One focused direction</label>
            <label style={{ display: "flex", gap: 5, alignItems: "center" }}><input type="radio" name="alternatives" checked={alternativeCount === 3} onChange={() => setAlternativeCount(3)} />Compare 3 creative directions</label>
          </div>
          <button
            className="btn btn--primary"
            disabled={busy || !sceneId || !instruction.trim() || (coordinated && coordinatedSceneIds.length < 2)}
            onClick={handleGenerate}
          >
            {busy ? `Building ${coordinated ? "coordinated Change Sets" : alternativeCount === 1 ? "Change Set" : "creative directions"}...` : coordinated ? `Create ${coordinatedSceneIds.length} Coordinated Change Sets` : alternativeCount === 1 ? "Create Change Set" : "Create 3 Alternatives"}
          </button>
        </div>
      </div>
    </div>
  );
}
