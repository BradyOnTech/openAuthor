type ReviewReceipt = {
  chapter_titles?: string[];
  canon_fact_ids?: string[];
  storyline_name?: string;
  writing_voice_name?: string;
  warnings?: string[];
  omitted_item_count?: number;
};

export function ReviewContextReceipt({ context }: { context: Record<string, unknown> }) {
  const review = context.review as ReviewReceipt | undefined;
  if (!review || typeof review !== "object") return null;
  const chapters = Array.isArray(review.chapter_titles) ? review.chapter_titles.filter((title) => typeof title === "string") : [];
  const facts = Array.isArray(review.canon_fact_ids) ? review.canon_fact_ids.filter((id) => typeof id === "string") : [];
  const warnings = Array.isArray(review.warnings) ? review.warnings.filter((warning) => typeof warning === "string") : [];
  const budget = (context.context_pack as { budget?: { used?: number; ceiling?: number; is_estimate?: boolean } } | undefined)?.budget;
  return (
    <details className="chat-review-context">
      <summary>Context used{warnings.length ? ` · ${warnings.length} evidence warning${warnings.length === 1 ? "" : "s"}` : ""}</summary>
      <div>
        {budget?.is_estimate && Number.isFinite(budget.used) && Number.isFinite(budget.ceiling) && <p>Estimated request: {budget.used!.toLocaleString()} / {budget.ceiling!.toLocaleString()} tokens, including response reserve.</p>}
        {chapters.length > 0 && <p>Chapters: {chapters.join(", ")}</p>}
        <p>{facts.length} accepted canon fact{facts.length === 1 ? "" : "s"} supplied.</p>
        {typeof review.storyline_name === "string" && review.storyline_name && <p>Storyline: {review.storyline_name}</p>}
        {review.writing_voice_name && <p>Writing Voice: {review.writing_voice_name} (manuscript prose only).</p>}
        <p>Scenes use Plan reading order, not necessarily story chronology.</p>
        {typeof review.omitted_item_count === "number" && review.omitted_item_count > 0 && <p>{review.omitted_item_count} optional context item(s) omitted by policy.</p>}
        {warnings.map((warning, index) => <p className="chat-review-context__warning" key={index}>{warning}</p>)}
        <p className="chat-review-context__note">This records the context supplied for this reply, not a guarantee of a complete review.</p>
      </div>
    </details>
  );
}
