import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { addEditorialPass, listEditorialPasses, type EditorialPass, type ReviewReasoningEffort } from "../../api";
import type { ProposalProvider, ProposalRecord } from "../../types";
import { proposalGenerationSession, type GenerationInput } from "../../proposalGenerationSession";
import { RevisionContextReview } from "./RevisionContextReview";
import { availableProviders, defaultProvider } from "../../providerSelection";
import { StyleProfilePanel } from "./StyleProfilePanel";
import { useRecoverableDraft } from "../../recoverableDraft";
import { emptyRevisionRequest, validRevisionRequest, type RevisionRequestDraft } from "../../revisionRequestDraft";

export function GenerateProposal({ initialSceneId, initialInstruction = "", tabId = "generate" }: { initialSceneId?: string; initialInstruction?: string; tabId?: string }) {
  const { projectRoot, branches, scenes, runtimeConfig, refreshProposals, refreshRuns, refreshBudget, setError, setMessage } =
    useWorkspace();
  const { openTab, closeTab } = useEditor();

  const providers = useMemo(() => {
    return availableProviders(runtimeConfig).map(({ id, model }) => ({ name: id, model }));
  }, [runtimeConfig]);

  const branch = branches.find(row => row.current)?.name ?? "main";
  const recovery = useRecoverableDraft(`openauthor.revisionRequest.v1:${JSON.stringify([projectRoot, branch, tabId])}`,
    { ...emptyRevisionRequest(initialSceneId ?? scenes[0]?.id ?? "", defaultProvider(runtimeConfig).id), instruction: initialInstruction }, validRevisionRequest);
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
  const setScenePurpose = setter("scenePurpose"), setSceneTurn = setter("sceneTurn"), setSceneEnding = setter("sceneEnding");
  const session = useMemo(() => proposalGenerationSession(projectRoot), [projectRoot]);
  const { busy, job, error: generationError, stopRequested, reviewTask, planReviewTask } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const view = useRef({ projectRoot, mounted: true });
  view.current.projectRoot = projectRoot;
  useEffect(() => {
    view.current.mounted = true;
    return () => { view.current.mounted = false; };
  }, []);
  const [passes, setPasses] = useState<EditorialPass[]>([]);
  const [savingPass, setSavingPass] = useState(false);

  useEffect(() => {
    // The composer can open before the project's scenes finish loading. Keep
    // its state aligned with the displayed default without resetting choices.
    if (sceneId || !scenes[0]?.id) return;
    const firstId = scenes[0].id;
    setSceneId(firstId);
    setCoordinatedSceneIds((ids) => [...new Set([firstId, ...ids.filter(Boolean)])]);
  }, [sceneId, scenes]);

  const providerWasSelected = useRef(recovery.recovered || recovery.dirty);
  useEffect(() => {
    if (!providerWasSelected.current && runtimeConfig) {
      setProvider(defaultProvider(runtimeConfig).id);
    }
  }, [runtimeConfig]);

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
    if (savingPass || !passName.trim() || !passGoal.trim() || !passInstruction.trim()) return;
    setSavingPass(true);
    try {
      setError("");
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
    } finally { setSavingPass(false); }
  }

  async function showResults(proposals: ProposalRecord[] | null) {
    if (!view.current.mounted || view.current.projectRoot !== projectRoot) return;
    try {
      await Promise.all([refreshProposals(), refreshRuns(), refreshBudget()]);
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
      closeTab(tabId);
    } catch (error) {
      setError(`Could not refresh the generation results: ${error instanceof Error ? error.message : String(error)}. Saved work remains recoverable from this panel.`);
    }
  }

  async function handleGenerate() {
    if (!sceneId || !instruction.trim()) return;
    let wordRange: [number, number] | undefined;
    if (recovery.value.minimumWords?.trim() || recovery.value.maximumWords?.trim()) {
      const minimum = Number(recovery.value.minimumWords?.trim() || recovery.value.maximumWords);
      const maximum = Number(recovery.value.maximumWords?.trim() || recovery.value.minimumWords);
      if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 1 || maximum > 20000 || minimum > maximum) {
        setError("Choose whole-number word targets from 1 to 20,000, with the minimum no greater than the maximum.");
        return;
      }
      wordRange = [minimum, maximum];
    }
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
          sceneContract: { purpose: recovery.value.scenePurpose ?? "", turn: recovery.value.sceneTurn ?? "", ending: recovery.value.sceneEnding ?? "", ...(wordRange ? { word_range: wordRange } : {}), ...(recovery.value.quotedTextOnly ? { editable_scope: "quoted_text" as const } : {}) },
          reviewMode: recovery.value.reviewDraft ? "refine" : "off",
          reviewReasoningEffort: provider === "openai-codex" && recovery.value.reviewDraft ? recovery.value.reviewReasoningEffort || undefined : undefined,
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
        flex: 1,
        minHeight: 0,
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
          reviewMode={reviewTask.input.reviewMode}
          reviewReasoningEffort={reviewTask.input.reviewReasoningEffort}
          onSend={async authorization => { await showResults(await session.approveDraft(reviewTask.index, authorization)); }}
          onClose={session.clear} closeLabel="Keep plan; cancel drafting" />}

        <fieldset disabled={busy || Boolean(job)} style={{ display: "contents", border: 0, padding: 0, margin: 0 }}>
        <label><input type="checkbox" checked={Boolean(recovery.value.reviewDraft)} onChange={event => setter("reviewDraft")(event.target.checked)} /> Review and refine the draft</label>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>A fresh critic checks the scene against your intent. A focused revision is kept only when its verification supports the change. Uses up to four draft-stage model calls; local generation skips this review.</p>
        {recovery.value.reviewDraft && provider === "openai-codex" && <label style={{ display: "grid", gap: 6 }}>
          <span>Review reasoning effort</span>
          <select className="input" value={recovery.value.reviewReasoningEffort ?? ""} onChange={event => setter("reviewReasoningEffort")(event.target.value as "" | ReviewReasoningEffort)}>
            <option value="">Model default</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
          <small>More time to reason during critique, focused revision and verification. The first draft keeps its model default. Higher effort may take longer; compare the resulting prose.</small>
        </label>}
        <div>
          <label><input type="checkbox" checked={recovery.value.quotedTextOnly ?? false} onChange={event => setter("quotedTextOnly")(event.target.checked)} /> Preserve text outside quotation marks</label>
          <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Edit only contents of paired “…” or "…" passages, including quoted signs and messages. Narration, quote marks and passage order stay unchanged. Review the identified passages before sending. Nested or unpaired marks need passage editing. Requires an AI provider.</p>
        </div>

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

        {scenes.length > 1 && <div style={{ display: "grid", gap: 8 }}>
          <label><input type="checkbox" checked={coordinated} onChange={e => {
            setCoordinated(e.target.checked);
            if (e.target.checked) { setAlternativeCount(1); setCoordinatedSceneIds(ids => [...new Set([sceneId, ...ids].filter(Boolean))]); }
          }} /> Coordinate this revision across multiple scenes</label>
          {coordinated && scenes.map(scene => <label key={scene.id}>
            <input type="checkbox" checked={coordinatedSceneIds.includes(scene.id)} onChange={e => setCoordinatedSceneIds(ids => e.target.checked ? [...new Set([...ids, scene.id])] : ids.filter(id => id !== scene.id))} /> {scene.title || scene.id}
          </label>)}
        </div>}

        <section aria-label="Editorial Pass library" style={{ display: "grid", gap: 12, padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Editorial Pass</span>
            <select className="input" value={selectedPassId} onChange={event => choosePass(event.target.value)}>
              <option value="">Write your own request</option>
              {passes.map(pass => <option key={pass.id} value={pass.id}>{pass.name}{pass.built_in ? "" : " · custom"}</option>)}
            </select>
          </label>
          {selectedPassId && <div>
            <p>{passes.find(pass => pass.id === selectedPassId)?.goal}</p>
            <ul>{passes.find(pass => pass.id === selectedPassId)?.evaluation_criteria.map(criterion => <li key={criterion}>{criterion}</li>)}</ul>
          </div>}
          <button className="btn" type="button" disabled={savingPass} onClick={() => setShowPassBuilder(value => !value)} style={{ minHeight: 40 }}>
            {showPassBuilder ? "Close Editorial Pass builder" : "Create custom Editorial Pass"}
          </button>
          {showPassBuilder && <fieldset disabled={savingPass} style={{ display: "grid", gap: 12, border: 0, margin: 0, padding: 0 }}>
            <legend>Save a reusable revision request</legend>
            <label style={{ display: "grid", gap: 6 }}><span>Pass name</span><input className="input" value={passName} onChange={event => setPassName(event.target.value)} /></label>
            <label style={{ display: "grid", gap: 6 }}><span>Pass goal</span><input className="input" value={passGoal} onChange={event => setPassGoal(event.target.value)} /></label>
            <label style={{ display: "grid", gap: 6 }}><span>Pass instruction</span><textarea className="input" rows={3} value={passInstruction} onChange={event => setPassInstruction(event.target.value)} /></label>
            <label style={{ display: "grid", gap: 6 }}><span>Evaluation criteria</span><textarea className="input" rows={3} value={passCriteria} onChange={event => setPassCriteria(event.target.value)} placeholder="One review criterion per line" /></label>
            <button className="btn btn--primary" type="button" disabled={!passName.trim() || !passGoal.trim() || !passInstruction.trim()} onClick={() => void createCustomPass()} style={{ minHeight: 40 }}>{savingPass ? "Saving Editorial Pass…" : "Save Editorial Pass"}</button>
          </fieldset>}
        </section>

        <button className="btn" onClick={() => openTab({ id: "writing-voice", kind: "writing-voice", label: "Writing Voice" })}>Edit Writing Voice</button>
        <StyleProfilePanel key={JSON.stringify([projectRoot, branches.find(branch => branch.current)?.name])} projectRoot={projectRoot} scenes={scenes} disabled={busy || Boolean(job)} />

        <details>
          <summary>What this scene should accomplish</summary>
          <p>Optional story intent stays with the edit plan and prose draft. {coordinated ? "This intent applies to each selected scene." : "Leave fields blank to preserve the existing scene's direction."}</p>
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>Scene purpose<textarea className="input" rows={2} maxLength={1200} value={recovery.value.scenePurpose ?? ""} onChange={event => setScenePurpose(event.target.value)} placeholder="What this scene contributes to the story" /></label>
            <label style={{ display: "grid", gap: 6 }}>What changes<textarea className="input" rows={2} maxLength={1200} value={recovery.value.sceneTurn ?? ""} onChange={event => setSceneTurn(event.target.value)} placeholder="A choice, realization, bargain or change in the relationship" /></label>
            <label style={{ display: "grid", gap: 6 }}>Where it stops<textarea className="input" rows={2} maxLength={1200} value={recovery.value.sceneEnding ?? ""} onChange={event => setSceneEnding(event.target.value)} placeholder="The ending beat and what should remain unresolved" /></label>
            <label>Minimum words (optional)<input className="input" type="number" min={1} max={20000} step={1} value={recovery.value.minimumWords ?? ""} onChange={event => setter("minimumWords")(event.target.value)} /></label>
            <label>Maximum words (optional)<input className="input" type="number" min={1} max={20000} step={1} value={recovery.value.maximumWords ?? ""} onChange={event => setter("maximumWords")(event.target.value)} /></label>
            <p>A single number sets an exact target. With draft review enabled, openAuthor counts words and checks the range. Local generation skips creative review.</p>
          </div>
        </details>

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
