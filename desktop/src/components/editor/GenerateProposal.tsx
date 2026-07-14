import { useMemo, useState } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import { generateProposal } from "../../api";
import type { ProposalProvider } from "../../types";

export function GenerateProposal({ initialSceneId }: { initialSceneId?: string }) {
  const { projectRoot, scenes, runtimeConfig, refreshProposals, refreshRuns, setError, setMessage } =
    useWorkspace();
  const { openTab, closeTab } = useEditor();

  const providers = useMemo(() => {
    const entries = Object.entries(runtimeConfig?.providers ?? {});
    return entries
      .filter(([, config]) => config.credential_present)
      .map(([name, config]) => ({ name: name as ProposalProvider, model: config.default_model }));
  }, [runtimeConfig]);

  const [sceneId, setSceneId] = useState(initialSceneId ?? scenes[0]?.id ?? "");
  const [instruction, setInstruction] = useState("");
  const [provider, setProvider] = useState<ProposalProvider>(
    (providers.find((p) => p.name !== "local")?.name ?? "local") as ProposalProvider
  );
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleGenerate() {
    if (!sceneId || !instruction.trim()) return;
    setBusy(true);
    try {
      const proposal = await generateProposal(projectRoot, {
        sceneId,
        instruction: instruction.trim(),
        provider,
        model: model.trim() || undefined,
      });
      setMessage(`Proposal drafted: ${proposal.title}`);
      await Promise.all([refreshProposals(), refreshRuns()]);
      closeTab("generate");
      openTab({
        id: `proposal:${proposal.id}`,
        kind: "proposal",
        label: proposal.title || proposal.id.slice(0, 8),
        data: proposal,
      });
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
          Ask the AI for an edit proposal
        </h2>
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: "var(--leading-relaxed)" }}>
          The AI never edits your manuscript directly. It writes a proposal you review, draft, and apply —
          every step is undoable through snapshots.
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
          <button
            className="btn btn--primary"
            disabled={busy || !sceneId || !instruction.trim()}
            onClick={handleGenerate}
          >
            {busy ? "Generating..." : "Generate proposal"}
          </button>
        </div>
      </div>
    </div>
  );
}
