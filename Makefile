SHELL := /bin/zsh
PYTHONPATH := .

.PHONY: help setup check capability-check audit-no-mocks test test-scale test-canon-eval test-editorial-eval test-desktop desktop-audit test-all tree demo desktop-web desktop-tauri desktop-build tauri-check tauri-test desktop-prereq desktop-smoke runtime-prepare runtime-check macos-bundle macos-bundle-check codex-contract-check
.PHONY: install-desktop install-js test-contracts test-gateway test-mobile test-desktop-e2e js-audit
.PHONY: mobile-web mobile-web-build test-mobile-e2e test-mobile-hosted-e2e
.PHONY: install-e2e test-e2e test-e2e-all test-e2e-webkit

help:
	@echo "Available targets:"
	@echo "  make setup  - Verify local toolchain availability"
	@echo "  make install-desktop - Install locked shared-contract and desktop dependencies"
	@echo "  make install-js - Install locked dependencies for all JavaScript packages and e2e"
	@echo "  make install-e2e - Install the pinned tester-army/e2e runner"
	@echo "  make test-e2e - Run desktop, phone-web, and backend tester-army/e2e flows"
	@echo "  make test-e2e-all - Run all local flows, including disposable PostgreSQL (OPENAUTHOR_TEST_PG_BIN required)"
	@echo "  make test-e2e-webkit - Run the complete browser flow set on WebKit"
	@echo "  make check  - Run lightweight repository checks"
	@echo "  make capability-check - Validate shipped capability claims and active-shell parity"
	@echo "  make audit-no-mocks - Fail if placeholder/stub markers are present"
	@echo "  make test   - Run Python tests"
	@echo "  make test-scale - Generate the large-project fixture and enforce performance budgets"
	@echo "  make test-canon-eval - Measure Canon diagnostic precision and recall"
	@echo "  make test-editorial-eval - Check deterministic Editorial Pass pattern regressions"
	@echo "  make test-writing-quality - Run original-scene Writing Voice baselines offline"
	@echo "  make test-author-workflow - Verify synthetic import, reviewed edits, undo, and recovery"
	@echo "  make test-desktop - Run desktop unit tests (vitest)"
	@echo "  make desktop-audit - Fail on known npm dependency vulnerabilities"
	@echo "  make test-all - Run Python, desktop, contracts, gateway, and mobile checks"
	@echo "  make js-audit - Audit all five JavaScript packages"
	@echo "  make test-desktop-e2e - Browser authoring workflow using the real Python engine"
	@echo "  make tree   - Print top-level structure"
	@echo "  make demo   - Run a minimal CLI workflow in this repo"
	@echo "  make desktop-web   - Run React web shell (no Rust required)"
	@echo "  make desktop-tauri - Run Tauri desktop shell (Rust required)"
	@echo "  make desktop-build - Compile desktop frontend"
	@echo "  make tauri-check   - Compile-check Tauri backend"
	@echo "  make tauri-test    - Exercise the native Tauri-to-core product bridge"
	@echo "  make desktop-prereq - Validate desktop runtime/toolchain prerequisites"
	@echo "  make desktop-smoke  - Run desktop release smoke gates"
	@echo "  make runtime-prepare - Download and install the pinned bundled Python runtime"
	@echo "  make runtime-check   - Verify the bundled Python and installed openAuthor core"
	@echo "  make macos-bundle    - Build the macOS app bundle (requires runtime-prepare)"
	@echo "  make macos-bundle-check - Verify the packaged runtime and app structure"
	@echo "  make codex-contract-check - Verify subscription context against a local endpoint (no provider credits)"

setup:
	@echo "Checking local tooling..."
	@command -v git >/dev/null 2>&1 && echo "git: OK" || echo "git: MISSING"
	@command -v rg >/dev/null 2>&1 && echo "rg: OK" || echo "rg: MISSING"
	@command -v python3 >/dev/null 2>&1 && echo "python3: OK" || echo "python3: MISSING"

check:
	@echo "Running repository checks..."
	@test -f README.md && echo "README.md: OK" || (echo "README.md missing" && exit 1)
	@test -f docs/brief.md && echo "docs/brief.md: OK" || (echo "docs/brief.md missing" && exit 1)
	@test -f docs/plan.md && echo "docs/plan.md: OK" || (echo "docs/plan.md missing" && exit 1)
	@test -f docs/desktop-architecture.md && echo "docs/desktop-architecture.md: OK" || (echo "docs/desktop-architecture.md missing" && exit 1)
	@test -f docs/desktop-runbook.md && echo "docs/desktop-runbook.md: OK" || (echo "docs/desktop-runbook.md missing" && exit 1)
	@test -f docs/capabilities.md && echo "docs/capabilities.md: OK" || (echo "docs/capabilities.md missing" && exit 1)
	@test -f docs/product-development-plan.md && echo "docs/product-development-plan.md: OK" || (echo "docs/product-development-plan.md missing" && exit 1)
	@test -f openauthor/cli.py && echo "openauthor CLI: OK" || (echo "openauthor/cli.py missing" && exit 1)
	@test -f desktop/src/AppV2.tsx && echo "desktop shell: OK" || (echo "desktop shell missing" && exit 1)
	@$(MAKE) capability-check
	@$(MAKE) audit-no-mocks

capability-check:
	@PYTHONPATH=$(PYTHONPATH) python3 scripts/validate_capabilities.py

audit-no-mocks:
	@echo "Scanning for placeholder/stub markers..."
	@audit_status=0; rg -n -i "TODO|FIXME|TBD|NotImplemented|mock data|stubbed|hardcoded demo|will be ported|coming soon|not yet implemented" \
		openauthor desktop/src tests \
		|| audit_status=$$?; \
		if [ "$$audit_status" -eq 0 ]; then \
			echo "Placeholder/stub markers found. Resolve before merge."; exit 1; \
		elif [ "$$audit_status" -ne 1 ]; then \
			echo "Placeholder/stub scan failed: rg exited with status $$audit_status." >&2; exit "$$audit_status"; \
		fi

test:
	@echo "Running tests..."
	@PYTHONPATH=$(PYTHONPATH) python3 -m unittest discover -s tests -p "test_*.py"

test-scale:
	@echo "Running large-project scale gate..."
	@PYTHONPATH=$(PYTHONPATH) python3 scripts/verify_scale_fixture.py

test-canon-eval:
	@PYTHONPATH=$(PYTHONPATH) python3 scripts/evaluate_canon_diagnostics.py

test-editorial-eval:
	@PYTHONPATH=$(PYTHONPATH) python3 scripts/evaluate_editorial_passes.py

.PHONY: test-writing-quality
test-writing-quality:
	@PYTHONPATH=$(PYTHONPATH) python3 scripts/evaluate_writing_voice.py
.PHONY: test-author-workflow
test-author-workflow:
	@PYTHONPATH=$(PYTHONPATH) python3 scripts/evaluate_author_workflow.py smoke

test-desktop:
	@echo "Running desktop tests..."
	@cd desktop && npm run test

desktop-audit:
	@echo "Auditing desktop dependencies..."
	@cd desktop && npm audit --audit-level=low

install-desktop:
	@npm ci --prefix contracts
	@npm ci --prefix desktop

install-js: install-desktop
	@npm ci --prefix gateway
	@npm ci --prefix mobile
	@$(MAKE) install-e2e

install-e2e:
	@npm ci --prefix e2e --ignore-scripts

test-e2e:
	@npm test --prefix e2e

test-e2e-all:
	@npm run test:all --prefix e2e

test-e2e-webkit:
	@npm run test:all --prefix e2e -- --webkit

test-contracts:
	@npm run check --prefix contracts

test-gateway:
	@npm run check --prefix gateway

test-mobile:
	@npm run check --prefix mobile

mobile-web:
	@npm run web --prefix mobile

mobile-web-build:
	@npm run build:web --prefix mobile

test-mobile-e2e: mobile-web-build
	@npm run test:e2e --prefix mobile

test-mobile-hosted-e2e:
	@npm run test:e2e:hosted --prefix mobile

test-desktop-e2e:
	@npm run test:e2e --prefix desktop

js-audit:
	@npm audit --prefix contracts --audit-level=low
	@npm audit --prefix desktop --audit-level=low
	@npm audit --prefix gateway --audit-level=low
	@npm run security:forge --prefix mobile
	@npm run security:braces --prefix mobile
	@npm audit --prefix mobile --audit-level=low
	@npm audit --prefix e2e --audit-level=low

test-all: test test-desktop test-contracts test-gateway test-mobile

tree:
	@find . -maxdepth 2 -not -path '*/\.*' | sort

demo:
	@PYTHONPATH=$(PYTHONPATH) python3 -m openauthor init .
	@PYTHONPATH=$(PYTHONPATH) python3 -m openauthor scene add --title "Opening Scene" --summary "Initial setup"
	@PYTHONPATH=$(PYTHONPATH) python3 -m openauthor scene list

desktop-web:
	@cd desktop && npm run dev

desktop-tauri:
	@source scripts/rust_env.sh && cd desktop && npm run tauri:dev

desktop-build:
	@cd desktop && npm run build

tauri-check:
	@source scripts/rust_env.sh && cargo check --manifest-path desktop/src-tauri/Cargo.toml

tauri-test:
	@source scripts/rust_env.sh && cargo test --manifest-path desktop/src-tauri/Cargo.toml

desktop-prereq:
	@./scripts/desktop_prereq_check.sh

desktop-smoke: desktop-prereq desktop-audit test-desktop desktop-build tauri-check tauri-test
	@echo "Desktop smoke gates passed."

runtime-prepare:
	@./scripts/prepare_bundled_runtime.sh

runtime-check:
	@./scripts/verify_bundled_runtime.sh

macos-bundle: runtime-check
	@cd desktop && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LC_CTYPE=en_US.UTF-8 npm run tauri:build -- --bundles app,dmg

macos-bundle-check:
	@./scripts/verify_macos_bundle.sh

codex-contract-check:
	@OPENAUTHOR_CODEX_CONTRACT_BIN="$(CURDIR)/desktop/src-tauri/resources/runtime/codex/bin/codex" PYTHONPATH=$(PYTHONPATH) python3 -m unittest discover -s tests -p test_codex_runtime_contract.py -v
