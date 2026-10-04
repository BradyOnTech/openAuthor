Supplemental Spec review: 0 actionable findings; no omitted or skipped corpus cases, and no scope creep.

The seven seeded cases and all five expected diagnostics are retained unchanged. Only impossible-timeline-range changes its setup: the fact is accepted with valid scene-0001 through scene-0002 boundaries, then real Plan assign_scene operations produce scene-0002, scene-0001 reading order. Because assign_scene removes and appends each scene and list_scenes reads canonical Plan order, diagnostics still exercise an actual impossible accepted interval after an author reorder. Production validation is not bypassed.

The new regression assertions require this case's expected and actual results to equal {impossible_validity: 1}. Counter aggregation, precision/recall formulas, positive and clean cases, unseeded corpus handling, and empty-corpus ungraded behavior are unchanged. The metrics remain explicitly synthetic seeded Canon diagnostics; they do not establish extraction accuracy, fresh author judgment, or broader completion.

Read-only review against 4a1805d589da22232c8ec50458b05de1b939de6a. No tests were executed in this supplemental review; root owns runtime verification. Original ten-file review and manifest remain untouched.
