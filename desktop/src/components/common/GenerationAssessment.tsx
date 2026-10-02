export function GenerationAssessment({ tier }: { tier?: string | null }) {
  if (!tier) return <span>Not quality-scored</span>;
  const isFormatScore = ["high", "medium", "low"].includes(tier);
  return <span className="badge" title="Checks response formatting, not story correctness, voice or writing quality.">
    {isFormatScore ? `Format score: ${tier}` : "Not quality-scored"}
  </span>;
}
