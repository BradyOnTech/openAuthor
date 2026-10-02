# Typed Memory values — 2026-10-02

New and edited detail values are validated before database or snapshot changes.
Numbers remain numbers, booleans remain booleans, dates require a valid calendar
YYYY-MM-DD value, references name current book records, and lists are JSON arrays.
Invalid collections, duplicate keys and accidentally blank keys fail visibly;
removing a detail is an explicit action.

The editor provides per-type help, reference suggestions and inline errors. It
retains raw edited input separately from the stored value through failures and
reopening. Existing JSON lists display without turning nested objects into
`[object Object]`. Private notes and detail visibility retain their existing rules.

Historical values are not migrated or coerced. Unchanged legacy values can
accompany unrelated or privacy edits; changed values must satisfy the current
contract. A legacy numeric string is converted only after an explicit value edit.
Unresolved historical references need author repair and are not silently deleted.

Red regressions reproduced invalid create/update acceptance and silent row loss
before each fix. Final local checks passed 29 core/privacy/API tests and 23
rendered editor/recovery/API tests, plus TypeScript and whitespace checks.
Independent source review found no blocking defect. This is synthetic local
verification; no author book, provider call or physical-device acceptance was used.

See [verification.json](verification.json) for commands, exact source hashes and
legacy limits, [red results](red-results.txt), [core output](core-tests.txt) and
[editor output](editor-tests.txt).
