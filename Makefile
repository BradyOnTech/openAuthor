SHELL := /bin/zsh
PYTHONPATH := .

.PHONY: help setup check audit-no-mocks test test-desktop test-all tree demo desktop-web desktop-tauri desktop-build tauri-check desktop-prereq desktop-smoke

help:
	@echo "Available targets:"
	@echo "  make setup  - Verify local toolchain availability"
	@echo "  make check  - Run lightweight repository checks"
	@echo "  make audit-no-mocks - Fail if placeholder/stub markers are present"
	@echo "  make test   - Run Python tests"
	@echo "  make test-desktop - Run desktop unit tests (vitest)"
	@echo "  make test-all - Run Python and desktop tests"
	@echo "  make tree   - Print top-level structure"
	@echo "  make demo   - Run a minimal CLI workflow in this repo"
	@echo "  make desktop-web   - Run React web shell (no Rust required)"
	@echo "  make desktop-tauri - Run Tauri desktop shell (Rust required)"
	@echo "  make desktop-build - Compile desktop frontend"
	@echo "  make tauri-check   - Compile-check Tauri backend"
	@echo "  make desktop-prereq - Validate desktop runtime/toolchain prerequisites"
	@echo "  make desktop-smoke  - Run desktop release smoke gates"

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
	@test -f openauthor/cli.py && echo "openauthor CLI: OK" || (echo "openauthor/cli.py missing" && exit 1)
	@test -f desktop/src/App.tsx && echo "desktop shell: OK" || (echo "desktop shell missing" && exit 1)
	@$(MAKE) audit-no-mocks

audit-no-mocks:
	@echo "Scanning for placeholder/stub markers..."
	@! rg -n -i "TODO|FIXME|TBD|NotImplemented|mock data|stubbed|hardcoded demo" \
		openauthor desktop/src tests \
		|| (echo "Placeholder/stub markers found. Resolve before merge." && exit 1)

test:
	@echo "Running tests..."
	@PYTHONPATH=$(PYTHONPATH) python3 -m unittest discover -s tests -p "test_*.py"

test-desktop:
	@echo "Running desktop tests..."
	@cd desktop && npm run test

test-all: test test-desktop

tree:
	@find . -maxdepth 2 -not -path '*/\.*' | sort

demo:
	@PYTHONPATH=$(PYTHONPATH) python3 -m openauthor init .
	@PYTHONPATH=$(PYTHONPATH) python3 -m openauthor scene add --title "Opening Scene" --summary "Initial setup"
	@PYTHONPATH=$(PYTHONPATH) python3 -m openauthor scene list

desktop-web:
	@cd desktop && npm run dev

desktop-tauri:
	@cd desktop && npm run tauri:dev

desktop-build:
	@cd desktop && npm run build

tauri-check:
	@source "$$HOME/.cargo/env" && cargo check --manifest-path desktop/src-tauri/Cargo.toml

desktop-prereq:
	@./scripts/desktop_prereq_check.sh

desktop-smoke: desktop-prereq test-desktop desktop-build tauri-check
	@echo "Desktop smoke gates passed."
