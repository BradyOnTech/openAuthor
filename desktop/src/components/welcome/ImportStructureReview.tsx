import type { ImportCorrections, ImportSectionRole, ManuscriptImportPreview } from "../../api";

export function ImportStructureReview({ preview, corrections, dirty, onChange }: {
  preview: ManuscriptImportPreview;
  corrections: ImportCorrections;
  dirty: boolean;
  onChange: (id: string, change: ImportCorrections[string]) => void;
}) {
  return <section className="import-structure-review" aria-label="Import preview">
    <p role="status" className="import-structure-review__summary">
      {preview.scene_count} scenes · {preview.word_count.toLocaleString()} words · {preview.chapter_count} chapters
      {dirty && " — Update Preview to review your corrections."}
    </p>
    {preview.warnings.length > 0 && <ul aria-label="Import limitations">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    <p>Check the boundaries below. A chapter or part containing prose keeps it as a scene. “Body text” keeps the heading in the prose without starting a new scene. No source files are changed.</p>
    <div className="import-structure-review__sections">
      {preview.sections.map((section, index) => <div key={section.id} className="import-structure-review__section">
        <div className="import-structure-review__fields">
          <label>Boundary {index + 1}
            <select className="select" aria-label={`Role for section ${index + 1}`} value={corrections[section.id]?.role ?? section.role} onChange={event => onChange(section.id, { role: event.target.value as ImportSectionRole })}>
              <option value="act">Part / Act</option><option value="chapter">Chapter</option><option value="scene">Scene</option><option value="text">Body text (no split)</option>
            </select>
          </label>
          <label>Title
            <input className="input" aria-label={`Title for section ${index + 1}`} maxLength={1000} value={corrections[section.id]?.title ?? section.title} onChange={event => onChange(section.id, { title: event.target.value })} />
          </label>
        </div>
        <p>{section.word_count.toLocaleString()} words{section.excerpt ? ` · ${section.excerpt}` : " · Heading only"}</p>
      </div>)}
    </div>
    <details><summary>Resulting reading order</summary>
      <ol>{preview.scenes.map(scene => <li key={scene.position}>
        {[scene.act_title, scene.chapter_title, scene.title].filter(Boolean).join(" / ")} ({scene.word_count.toLocaleString()} words)
      </li>)}</ol>
    </details>
  </section>;
}
