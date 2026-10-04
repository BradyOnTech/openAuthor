# Repository Braces fork

This is `@openauthor/braces@3.0.3-openauthor.1`, derived from the immutable
`braces@3.0.3` npm archive. It is a modified distribution, not an upstream fix.
The seven maintained CommonJS sources under `mobile/security/braces` enforce
bounded input and AST depth, validate plain-data ASTs and traverse expansion
queues iteratively. The original MIT license and attribution are retained.

GHSA-vfj7-8cjw-p6xm remains open upstream. The scoped fork has no upstream npm
advisory identity: a clean npm audit cannot establish its safety. The mandatory
source/copy inventory guards and adversarial compatibility tests provide the
repository's evidence. Embedded copies in Expo Doctor and workspace resolution
still require the separate byte-bound postinstall repair and preflight guards.

Combinatorial output growth, arbitrary getters/proxies and custom transforms
are outside the bounded stack protection. Expo exports continue to exclude
pattern tooling. Signed native artifacts and physical-device acceptance remain
separate gates. Replace this fork only after reviewing and testing an upstream
release against the same regressions.
