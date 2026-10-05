import type { ProposalRecord, SourceMeaningCheck, SourceMeaningCoverage } from "../../types";

type Report = NonNullable<NonNullable<ProposalRecord["draft"]>["writing_review"]>;

const outcomes: Record<Report["status"], string> = {
  unverified: "Review incomplete · first draft retained",
  kept: "Critic recommended keeping the first draft",
  refined: "Focused revision selected after model verification",
  rejected: "Focused revision rejected · first draft retained",
  uncertain: "Review uncertain · first draft retained",
  failed: "Review failed · first draft retained",
  unavailable: "Creative review unavailable for local generation",
};

function SourceMeaningReview({ checks, coverage, label }: { checks?: SourceMeaningCheck[]; coverage?: SourceMeaningCoverage; label: string }) {
  if (!checks || !coverage) return null;
  const concerns = checks.filter(row => row.assessment === "violation" || row.assessment === "uncertain");
  const descriptions = { preserved: "model reports preserved", permitted_change: "model reports permitted", violation: "potential loss or altered meaning", uncertain: "meaning uncertain" };
  return <details open={concerns.length > 0 || coverage.truncated}>
    <summary>{label} · {coverage.checked_passages} of {coverage.total_passages} changed passages · {concerns.length} concerns</summary>
    <p>These are model interpretations. Compare the original wording yourself.</p>
    {coverage.truncated && <p role="status">Some changes were omitted from the bounded comparison. This review is incomplete.</p>}
    {[...concerns, ...checks.filter(row => !concerns.includes(row))].map(row => <details key={row.id} open={row.assessment === "violation" || row.assessment === "uncertain"}>
      <summary>{descriptions[row.assessment]}</summary>
      <p>{row.reason}</p>
      <strong>Original</strong>{row.source_quote === null ? <p>No original text in this change.</p> : <blockquote>{row.source_quote}</blockquote>}
      <p>Model’s reading: {row.source_meaning}</p>
      <strong>Candidate</strong>{row.candidate_quote === null ? <p>No candidate text in this change.</p> : <blockquote>{row.candidate_quote}</blockquote>}
      <p>Model’s reading: {row.candidate_meaning}</p>
      {row.permission_evidence.length > 0 && <details><summary>Author direction cited for this change</summary>{row.permission_evidence.map((source, index) => <blockquote key={index}>{source.quote}</blockquote>)}</details>}
    </details>)}
  </details>;
}

export function DraftCraftReview({ report, onChoose, disabled = false }: { report: Report; onChoose?: (candidate: "first" | "refined") => void; disabled?: boolean }) {
  return <section className="review-card__section" aria-label="Draft craft review">
    <h3>{outcomes[report.status]}</h3>
    <p>{report.uncertainty}</p>
    {["unverified", "rejected", "uncertain", "failed"].includes(report.status) && <p>Review has not cleared this draft. Inspect the quoted concerns and changes before applying.</p>}
    {report.mechanical_checks && <p>Word target: {report.mechanical_checks.word_range.join("–")} · first draft: {report.mechanical_checks.first_words}{report.mechanical_checks.refined_words !== undefined ? ` · focused revision: ${report.mechanical_checks.refined_words}` : ""}. Counts use whitespace-separated words.</p>}
    {report.author_selected && <p>You selected the {report.author_selected === "first" ? "first draft" : "focused revision"} for hunk review.</p>}
    {onChoose && report.refined_candidate && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button className="btn" disabled={disabled} onClick={() => onChoose("first")}>Review first draft instead</button>
      <button className="btn" disabled={disabled} onClick={() => onChoose("refined")}>Review focused revision instead</button>
      <p>Choosing a candidate rebuilds the hunks and resets their decisions. Your manuscript changes only when you apply.</p>
    </div>}
    {report.error && <p role="alert">{report.error}</p>}
    {report.critique?.uncertainty && <p>{report.critique.uncertainty}</p>}
    {report.critique?.validation_warnings?.map((warning, index) => <p role="status" key={index}>{warning}</p>)}
    <SourceMeaningReview checks={report.critique?.source_checks} coverage={report.critique?.source_coverage} label="First draft source review" />
    {report.critique?.strengths.length ? <details><summary>What the critic would preserve</summary>{report.critique.strengths.map((row, index) => <div key={index}><blockquote>{row.quote}</blockquote><p>{row.reason}</p></div>)}</details> : null}
    {report.critique?.findings.map(row => <div key={row.id}>
      <strong>{row.priority} · {row.category}</strong><blockquote>{row.quote}</blockquote>
      <p>{row.reason}</p><p>{row.suggestion}</p>
      {row.source_evidence.map((source, index) => <details key={index}><summary>Reference: {source.path}</summary><blockquote>{source.quote}</blockquote></details>)}
    </div>)}
    {report.verification && <details><summary>Model verification · {report.verification.verdict}</summary>
      <SourceMeaningReview checks={report.verification.source_checks} coverage={report.verification.source_coverage} label="Focused revision source review" />
      {report.verification.uncertainty && <p>{report.verification.uncertainty}</p>}
      {report.verification.validation_warnings?.map((warning, index) => <p role="status" key={index}>{warning}</p>)}
      {report.verification.resolutions.map(row => <div key={row.id}><strong>{row.id} · {row.resolved ? "reported resolved" : "unresolved"}</strong><blockquote>{row.quote}</blockquote><p>{row.reason}</p></div>)}
      {report.verification.regressions.map((row, index) => <div key={index}><blockquote>{row.quote}</blockquote><p>{row.reason}</p></div>)}
    </details>}
    <details><summary>First draft</summary><div style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-prose)" }}>{report.first_candidate}</div></details>
    {report.refined_candidate && <details><summary>Focused revision{(report.author_selected ?? report.selected) === "first" ? " · not selected" : ""}</summary><div style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-prose)" }}>{report.refined_candidate}</div></details>}
    {report.stages.length > 0 && <details><summary>Review attempts · {report.stages.length} completed model calls</summary>{report.stages.map(row => <p key={row.stage}>{row.stage} · {row.input_tokens} input / {row.output_tokens} output tokens · {row.log_path}</p>)}</details>}
  </section>;
}
