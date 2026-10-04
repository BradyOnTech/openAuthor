# Performance Budgets

`docs/performance-budgets.json` is the executable Phase A baseline for a large single-book or moderate series project.

The fixture contains:

- 400 scenes
- 300 proposals
- 300 generation runs
- 72 Codex entities
- a built retrieval index

`make test-scale` creates the fixture in a temporary directory, collects three samples, and fails when any observed maximum exceeds its budget.

| Operation | Maximum |
| --- | ---: |
| Scene list | 750 ms |
| Proposal list | 300 ms |
| Generation list | 300 ms |
| Retrieval status | 150 ms |
| Core project load | 1,000 ms |
| Scene open | 150 ms |
| Scene save | 250 ms |
| Project metadata search | 800 ms |
| Continuity analysis | 1,500 ms |

These are release guardrails, not user-experience targets. `Core project load` includes scenes, Codex, proposals, and generation history; `Project metadata search` matches the current active search surface across scene metadata and Codex. The save test rewrites a real scene file atomically. Continuity analysis runs the current deterministic checks across the full fixture.

Packaged application startup, UI paint, save acknowledgement, Change Set diff rendering, and Story Memory analysis still require native UI instrumentation in later phases. Until then, this gate protects the core operations beneath those experiences without pretending to measure pixels it cannot observe.

The author-facing targets reserved for native instrumentation are: cold launch to Welcome within 3,000 ms, warm project-ready load within 2,000 ms, scene-open paint within 300 ms, and save acknowledgement within 500 ms on the supported reference Mac. They are documented targets, not claimed measurements, until the packaged-app harness lands.

Budget changes require a written explanation. A regression should be fixed or explicitly accepted; thresholds should not be raised merely to make the local checks pass.
