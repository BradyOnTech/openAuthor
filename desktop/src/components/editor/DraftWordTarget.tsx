export function DraftWordTarget({ body, target }: { body: string; target?: [number, number] }) {
  if (!target) return null;
  const words = body.split(/\s+/u).filter(Boolean).length;
  const difference = words < target[0] ? target[0] - words : words > target[1] ? words - target[1] : 0;
  return <section className="review-card__section" aria-label="Draft word target">
    <div className="review-card__section-title">Word target</div>
    <p role="status" style={{ margin: 0, color: difference ? "var(--warning-text)" : "var(--text-secondary)" }}>
      {words.toLocaleString()} words · target {target[0].toLocaleString()}–{target[1].toLocaleString()} · {difference ? `${difference.toLocaleString()} ${words < target[0] ? "below" : "above"} target` : "within target"}
    </p>
    {difference > 0 && <p style={{ marginBottom: 0 }}>Adjust the draft or give focused feedback before applying. This target does not block your edits or require another AI call.</p>}
  </section>;
}
