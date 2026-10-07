# Writing briefs in openAuthor

The writing brief gives the author control over scene intent, character knowledge, reveal timing and permitted invention. It draws on the existing Plan, Story Memory, Canon and Writing Voice; it does not create another story bible.

**Author workflow**

Open a scene's saved brief in Plan or Create a Change Set. Save its purpose, turn, ending, character goals, knowledge at this story time, reveal limits and scene-specific voice direction. Choose creative freedom and describe permitted inventions. Saved direction belongs to that scene and Storyline. Unsaved editing is recovered locally and is not supplied to AI.

Create a Change Set can override those fields for one request. Blank request fields inherit the saved brief. Removing saved direction requires editing the saved brief. Coordinated requests inherit each scene's own brief before applying shared request overrides.

Before generation, inspect the assembled brief, book direction, chapter and beat context, permitted Memory, approved voice excerpts, and included continuity prose. Return to edit the brief before sending the plan. The effective direction is retained with the Change Set and inherited by feedback revisions. Later changes to the saved scene brief do not silently rewrite an existing Change Set's direction.

For a manual Change Set, the effective brief is retained when its first draft is delivered. Subsequent regeneration and feedback revisions inherit that retained brief, including an empty brief. Request overrides are merged with saved direction before checking whether described story changes have the required permission text.

**Creative freedom**

- Preserve story decisions: revise expression while retaining events, facts, motives, knowledge, relationships, agreements and the ending.
- Local details: also allow sensory and staging details consistent with the direction. This does not authorize new promises, consequential actions, history or revelations.
- Described story changes: allow the specific developments entered by the author. Protected details and reveal limits remain binding directions.

Without an explicit choice, an existing scene or proposed candidate uses preservation; a new empty scene allows local details. These are model instructions, not a proof that every semantic constraint is obeyed. Existing selected-passage replacement and quoted-text editing provide their respective exact text boundaries. The author still reviews the prose before applying it.

**Book context and voice**

Writing Voice supplies approved traits and, when the author opts in, quoted exemplar observations. The preview shows the actual quotations included; absent or stale examples are not silently replaced by generated prose. Missing viewpoint, voice excerpts, knowledge or reveal limits are visible gaps, not automatic blockers or invitations to establish new canon.

Scene drafting now receives the ending of the closest earlier nonempty scene in saved reading order, up to 6,000 characters. The preview reports omitted characters. Initial planning retains its existing selectable neighboring context. Passage editing retains its existing bounded selection context and uses the saved scene brief without adding other scene prose.

Brief edits use the existing planning conflict and Storyline guards. Exact context fingerprints cover the brief, source excerpts and writing policies. Changing those inputs invalidates an earlier preview before delivery; changes during generation preserve the attempt in Runs and block applying it as the reviewed result.

**Review**

Feedback revisions show the previous and revised drafts together with text changes highlighted. This comparison is separate from manuscript hunks, which still compare against the saved scene. Unchanged lines anchor long comparisons; broadly rewritten passages may receive broader highlighting. Highlights expose wording changes and do not classify their story meaning.

Draft review displays the actual word count against the retained target, including an overshoot or shortfall, even when automatic model review is off. This uses whitespace-separated words, matching the core review check. The count updates with the proposed text. A missed target remains visible for manual editing or feedback and does not prevent the author from applying a draft.

These controls establish inspectable author direction. Better fiction must still be demonstrated with actual scenes and author judgments, including original, tie and neither outcomes. Application tests verify retention, context delivery and edit behavior; they do not measure literary quality.
