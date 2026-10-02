import type { EditorialReview } from "../../types";
import { EvidencePassages } from "../shared/EvidencePassages";

export function EditorialFindings({ review, feedback, stale }: { review: EditorialReview; feedback: string; stale: boolean }) {
  return <div style={{ display: "grid", gap: "var(--space-3)" }}>
    <p>{review.scope === "chapter" ? "Connected chapter" : "Passage"} · {review.focus.replace(/-/g, " ")} · {review.sources.length} source scene{review.sources.length === 1 ? "" : "s"}</p>
    {stale && <p role="status">A reviewed source or Storyline changed. These findings describe the recorded version; review current prose before acting.</p>}
    {review.summary && <p style={{ whiteSpace: "pre-wrap" }}>{review.summary}</p>}
    {review.warnings.map((warning, index) => <p role="status" key={index}>{warning}</p>)}
    {review.strengths.length > 0 && <div><strong>Preserve</strong><ul>{review.strengths.map((strength, index) => <li key={index}>{strength}</li>)}</ul></div>}
    {review.findings.map(finding => <article key={finding.id} aria-label={finding.title} style={{ padding: "var(--space-3)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
      <h4 style={{ margin: "0 0 8px" }}>{finding.title}</h4>
      <p><span className="badge">{finding.category.replace(/-/g, " ")}</span></p>
      <p style={{ whiteSpace: "pre-wrap" }}>{finding.observation}</p>
      <p><strong>Uncertainty: </strong>{finding.uncertainty}</p>
      <EvidencePassages evidence={finding.evidence} />
      <p><strong>Minimal intervention: </strong>{finding.suggestion}</p>
    </article>)}
    {!review.findings.length && review.kind !== "mechanical" && <p>No source-checked findings were recorded. This does not establish that the passage has no editorial problems.</p>}
    {review.limitations.length > 0 && <details open><summary>Review limits</summary><ul>{review.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul></details>}
    <details><summary>Original response</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{feedback}</pre></details>
  </div>;
}
