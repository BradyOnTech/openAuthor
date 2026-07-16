import { useMemo, useState } from "react";
import { rejectProposal } from "../../api";
import { useEditor } from "../../contexts/EditorContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { ProposalRecord } from "../../types";

export function AlternativeComparison({ proposals }: { proposals: ProposalRecord[] }) {
  const { projectRoot, refreshProposals, setError, setMessage } = useWorkspace();
  const { openTab, closeTab } = useEditor();
  const [busy, setBusy] = useState(false);
  const summaries = useMemo(() => proposals.map((proposal, index) => summarize(proposal, index)), [proposals]);

  function review(proposal: ProposalRecord) {
    openTab({ id: `proposal:${proposal.id}`, kind: "proposal", label: `Direction ${proposals.indexOf(proposal) + 1}`, data: proposal });
  }
  async function choose(proposal: ProposalRecord) {
    setBusy(true);
    try {
      await Promise.all(proposals.filter((row) => row.id !== proposal.id).map((row) => rejectProposal(projectRoot, row.id, `Alternative not selected; chose ${proposal.id}.`)));
      await refreshProposals();
      closeTab(`alternatives:${proposal.scene_id}`);
      review(proposal);
      setMessage("Other directions were set aside. Review the chosen Change Set hunk by hunk.");
    } catch (error) {
      setError(`Failed to choose direction: ${error instanceof Error ? error.message : String(error)}`);
    } finally { setBusy(false); }
  }

  return <div style={{ height: "100%", overflow: "auto", background: "var(--bg-deep)" }}><div style={{ maxWidth: 1200, margin: "0 auto", padding: "var(--space-6)" }}>
    <div style={{ marginBottom: "var(--space-5)" }}><div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: ".1em" }}>Creative outcomes, not model telemetry</div><h1 style={{ color: "var(--text-primary)", fontFamily: "var(--font-prose)", fontWeight: 500, margin: "4px 0" }}>Compare Directions</h1><p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>Each direction is still a non-mutating Change Set. Compare scope, voice shape, and canon risk before reviewing exact hunks.</p></div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "var(--space-4)" }}>{summaries.map(({ proposal, ...summary }, index) => <article key={proposal.id} style={{ padding: "var(--space-4)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--bg-surface)" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><h2 style={{ color: "var(--text-primary)", margin: 0, fontSize: "var(--text-lg)" }}>Direction {index + 1}</h2><span className={`badge badge--${summary.risk === "low" ? "applied" : "warning"}`}>{summary.risk} canon risk</span></div><p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", lineHeight: 1.45, minHeight: 60 }}>{proposal.revision_intent?.goal?.replace(/\n\nAlternative direction[\s\S]*/, "") || proposal.instruction}</p><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "var(--space-3) 0" }}><Metric label="Change scope" value={`${summary.hunks} hunks`} /><Metric label="Length" value={`${summary.wordDelta >= 0 ? "+" : ""}${summary.wordDelta} words`} /><Metric label="Voice shape" value={summary.voiceShape} /><Metric label="Memory" value={`${summary.memoryImpacts} affected`} /></div>{summary.warnings.slice(0, 2).map((warning) => <div key={warning} style={{ color: "var(--warning-text)", fontSize: "var(--text-xs)", marginTop: 5 }}>{warning}</div>)}<div style={{ display: "flex", gap: 6, marginTop: "var(--space-4)" }}><button className="btn" onClick={() => review(proposal)}>Review Hunks</button><button className="btn btn--primary" disabled={busy} onClick={() => void choose(proposal)}>Choose Direction</button></div></article>)}</div>
  </div></div>;
}

function summarize(proposal: ProposalRecord, index: number) {
  const changeSet = proposal.change_set;
  const beforeWords = (changeSet?.base_body ?? "").trim().split(/\s+/).filter(Boolean).length;
  const afterWords = (changeSet?.proposed_body ?? "").trim().split(/\s+/).filter(Boolean).length;
  const sentences = (changeSet?.proposed_body ?? "").split(/[.!?]+/).filter((row) => row.trim());
  const average = afterWords / Math.max(1, sentences.length);
  return {
    proposal,
    hunks: changeSet?.hunks.length ?? 0,
    wordDelta: afterWords - beforeWords,
    risk: changeSet?.impact_report.risk ?? "low",
    memoryImpacts: changeSet?.impact_report.affected_story_memory.length ?? 0,
    warnings: changeSet?.impact_report.warnings ?? [],
    voiceShape: average < 10 ? "crisp" : average > 22 ? "expansive" : index === 1 ? "balanced" : "measured",
  };
}

function Metric({ label, value }: { label: string; value: string }) { return <div style={{ padding: 8, borderRadius: "var(--radius-sm)", background: "var(--bg-elevated)" }}><div style={{ color: "var(--text-tertiary)", fontSize: 10, textTransform: "uppercase" }}>{label}</div><div style={{ color: "var(--text-primary)", fontSize: "var(--text-sm)", marginTop: 3 }}>{value}</div></div>; }
