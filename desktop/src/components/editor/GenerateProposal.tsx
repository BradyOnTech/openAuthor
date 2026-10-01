import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { addEditorialPass, listEditorialPasses, type EditorialPass } from "../../api";
import type { ProposalProvider, ProposalRecord } from "../../types";
import { proposalGenerationSession, type GenerationInput } from "../../proposalGenerationSession";
import { RevisionContextReview } from "./RevisionContextReview";
import { StyleProfilePanel } from "./StyleProfilePanel";
import { useRecoverableDraft } from "../../recoverableDraft";
import { emptyRevisionRequest, validRevisionRequest, type RevisionRequestDraft } from "../../revisionRequestDraft";

export function GenerateProposal({ initialSceneId }: { initialSceneId?: string }) {
  const { projectRoot, branches, scenes, runtimeConfig, refreshProposals, refreshRuns, setError, setMessage } =
    useWorkspace();
  const { openTab, closeTab } = useEditor();

  const providers = useMemo(() => {
    const entries = Object.entries(runtimeConfig?.providers ?? {});
    return entries
      .filter(([, config]) => config.credential_present)
      .map(([name, config]) => ({ name: name as ProposalProvider, model: config.default_model }));
  }, [runtimeConfig]);

  const branch = branches.find(row => row.current)?.name ?? "main";
  const recovery = useRecoverableDraft(`openauthor.revisionRequest.v1:${JSON.stringify([projectRoot, branch])}`,
    emptyRevisionRequest(initialSceneId ?? scenes[0]?.id ?? "", providers.find(row => row.name !== "local")?.name ?? "local"), validRevisionRequest);
  const { sceneId, instruction, provider, model, constraints, protectedElements, selectedPassId,
    showPassBuilder, passName, passGoal, passInstruction, passCriteria, alternativeCount, coordinated, coordinatedSceneIds } = recovery.value;
  function setter<K extends keyof RevisionRequestDraft>(key: K) {
    return (value: RevisionRequestDraft[K] | ((previous: RevisionRequestDraft[K]) => RevisionRequestDraft[K])) => {
      const current = recovery.session.getSnapshot().value;
      recovery.session.edit({ ...current, [key]: typeof value === "function" ? value(current[key]) : value });
    };
  }
  const setSceneId = setter("sceneId"), setInstruction = setter("instruction"), setProvider = setter("provider"), setModel = setter("model");
  const setConstraints = setter("constraints"), setProtectedElements = setter("protectedElements"), setSelectedPassId = setter("selectedPassId");
  const setShowPassBuilder = setter("showPassBuilder"), setPassName = setter("passName"), setPassGoal = setter("passGoal");
  const setPassInstruction = setter("passInstruction"), setPassCriteria = setter("passCriteria"), setAlternativeCount = setter("alternativeCount");
  const setCoordinated = setter("coordinated"), setCoordinatedSceneIds = setter("coordinatedSceneIds");
  const session = useMemo(() => proposalGenerationSession(projectRoot), [projectRoot]);
  const { busy, job, error: generationError, stopRequested, reviewTask, planReviewTask } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const view = useRef({ projectRoot, mounted: true });
  view.current.projectRoot = projectRoot;
  useEffect(() => {
    view.current.mounted = true;
    return () => { view.current.mounted = false; };
  }, []);
  const [passes, setPasses] = useState<EditorialPass[]>([]);

  useEffect(() => {
    void listEditorialPasses(projectRoot)
      .then(setPasses)
      .catch((error) => setError(`Failed to load Editorial Passes: ${error instanceof Error ? error.message : String(error)}`));
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

  async function showResults(proposals: ProposalRecord[] | null) {
    if (!view.current.mounted || view.current.projectRoot !== projectRoot) return;
    try {
      await Promise.all([refreshProposals(), refreshRuns()]);
      if (!proposals || !view.current.mounted || view.current.projectRoot !== projectRoot) return;
      const grouped = Boolean(proposals[0].change_group_id);
      setMessage(grouped ? `${proposals.length} coordinated Change Sets ready. Review each scene, then apply the group atomically from Changes.` : proposals.length === 1 ? "Change Set ready: review each hunk before applying." : `${proposals.length} creative directions ready to compare.`);
      if (proposals.length === 1 || grouped) {
        const proposal = proposals[0];
        openTab({ id: `proposal:${proposal.id}`, kind: "proposal", label: proposal.title || proposal.id.slice(0, 8), data: proposal });
      } else {
        openTab({ id: `alternatives:${proposals[0].scene_id}`, kind: "alternatives", label: "Compare Directions", data: proposals });
      }
      session.clear();
      closeTab("generate");
    } catch (error) {
      setError(`Could not refresh the generation results: ${error instanceof Error ? error.message : String(error)}. Saved work remains recoverable from this panel.`);
    }
  }

  async function handleGenerate() {
    if (!sceneId || !instruction.trim()) return;
    const inputs: GenerationInput[] = [];
    const targetSceneIds = coordinated ? coordinatedSceneIds : [sceneId];
    if (targetSceneIds.length === 0) return;
    const groupId = coordinated && targetSceneIds.length > 1 ? `change-group-ui-${crypto.randomUUID()}` : undefined;
    const directionCount = coordinated ? 1 : alternativeCount;
    for (const targetSceneId of targetSceneIds) {
      for (let index = 0; index < directionCount; index += 1) {
        const direction = directionCount === 1 ? "" : `\n\nAlternative direction ${index + 1} of ${directionCount}: make this a materially distinct creative approach, not a paraphrase of the other directions.`;
        inputs.push({
          sceneId: targetSceneId,
          instruction: instruction.trim() + direction,
          provider,
          model: model.trim() || undefined,
          temperature: directionCount === 1 ? undefined : 0.35 + index * 0.15,
          constraints: constraints.split("\n").map((value) => value.trim()).filter(Boolean),
          protectedElements: protectedElements.split("\n").map((value) => value.trim()).filter(Boolean),
          changeGroupId: groupId,
        });
      }
    }
    await showResults(await session.start(inputs));
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
        <p role={recovery.error ? "alert" : "status"}>{recovery.error || (recovery.dirty
          ? "Unfinished request saved on this device for this book and Storyline. Nothing is sent until you confirm."
          : "Your request stays on this device until you confirm generation.")}</p>
        {recovery.error && <button className="btn" style={{ minHeight: 40 }} onClick={() => recovery.session.edit(recovery.value)}>Retry saving request</button>}
        {sceneId && !scenes.some(scene => scene.id === sceneId) && <p role="alert">The selected scene is no longer available. Choose a current scene before continuing; your instructions are retained.</p>}

        {((job && !reviewTask && !planReviewTask) || generationError) && <section aria-label="Generation recovery" style={{ padding: 16, borderRadius: "var(--radius-md)", background: "var(--bg-elevated)", display: "grid", gap: 12 }}>
          {job && <>
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>{job.tasks.filter(task => task.drafted).length} of {job.tasks.length} Change Sets ready</strong>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{job.tasks[0].input.instruction}</p>
          </>}
          {generationError && <p role="alert">{generationError}</p>}
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Saved steps are reused. An interrupted provider request without a saved result may incur another charge when retried.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {busy ? <button className="btn" style={{ minHeight: 40 }} disabled={stopRequested} onClick={session.stop}>{stopRequested ? "Stopping after current step…" : "Stop after current step"}</button> : job && <>
              {!reviewTask && !planReviewTask && <button className="btn btn--primary" style={{ minHeight: 40 }} onClick={() => void session.retry().then(showResults)}>{job.tasks.every(task => task.drafted) ? "Open results" : "Retry generation"}</button>}
              {generationError && job.tasks.some(task => !task.drafted && (task.authorization || task.planAuthorization)) && <button className="btn" style={{ minHeight: 40 }} onClick={session.reviewDraftAgain}>Start new context review</button>}
              <button className="btn" style={{ minHeight: 40 }} onClick={session.clear}>Start new request</button>
            </>}
          </div>
          {job && <small>Starting a new request keeps existing Change Sets in Changes.</small>}
          {generationError && <small>Retry keeps the original approval. A new draft review retains the edit plan, clears permissions and starts a new request; any earlier provider charges still apply.</small>}
        </section>}

        {planReviewTask && !busy && <RevisionContextReview key={`${job!.id}:${planReviewTask.index}:plan`} projectRoot={projectRoot}
          generationInput={planReviewTask.input} provider={planReviewTask.input.provider} model={planReviewTask.input.model}
          onSend={async authorization => { await showResults(await session.approvePlan(planReviewTask.index, authorization)); }}
          onClose={session.clear} closeLabel="Back to request" />}
        {reviewTask && !busy && <p>Draft {reviewTask.index + 1} of {job!.tasks.length} · Edit plan saved; review context before drafting.</p>}
        {reviewTask && !busy && <RevisionContextReview key={`${job!.id}:${reviewTask.index}:draft`} projectRoot={projectRoot}
          proposalId={reviewTask.proposalId} provider={reviewTask.input.provider} model={reviewTask.input.model}
          onSend={async authorization => { await showResults(await session.approveDraft(reviewTask.index, authorization)); }}
          onClose={session.clear} closeLabel="Keep plan; cancel drafting" />}

        <fieldset disabled={busy || Boolean(job)} style={{ display: "contents", border: 0, padding: 0, margin: 0 }}>
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
            <input type="checkbox" checked={coordinated} onChange={(event) => { setCoordinated(event.target.checked); if (event.target.checked) { setAlternativeCount(1); setCoordinatedSceneIds((ids) => ids.includes(sceneId) ? ids : [...ids, sceneId]); } }} />
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

        <StyleProfilePanel key={JSON.stringify([projectRoot, branches.find(branch => branch.current)?.name])} projectRoot={projectRoot} scenes={scenes} disabled={busy || Boolean(job)} />

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
              onChange={(e) => setProvider(e.target.value as ProposalProvider)}
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
            disabled={busy || Boolean(recovery.error) || !scenes.some(scene => scene.id === sceneId) || !instruction.trim() || (coordinated && (coordinatedSceneIds.length < 2 || coordinatedSceneIds.some(id => !scenes.some(scene => scene.id === id))))}
            onClick={handleGenerate}
          >
            {busy ? `Building ${coordinated ? "coordinated Change Sets" : alternativeCount === 1 ? "Change Set" : "creative directions"}...` : coordinated ? `Create ${coordinatedSceneIds.length} Coordinated Change Sets` : alternativeCount === 1 ? "Create Change Set" : "Create 3 Alternatives"}
          </button>
        </div>
        </fieldset>
      </div>
    </div>
  );
}
