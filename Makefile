SHELL := /bin/zsh
PYTHONPATH := .

.PHONY: help setup check test tree demo

help:
	@echo "Available targets:"
	@echo "  make setup  - Verify local toolchain availability"
	@echo "  make check  - Run lightweight repository checks"
	@echo "  make test   - Run local test suite"
	@echo "  make tree   - Print top-level structure"
	@echo "  make demo   - Run a minimal CLI workflow in this repo"

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
	@test -f openauthor/cli.py && echo "openauthor CLI: OK" || (echo "openauthor/cli.py missing" && exit 1)

test:
	@echo "Running tests..."
	@PYTHONPATH=$(PYTHONPATH) python3 -m unittest discover -s tests -p "test_*.py"

tree:
	@find . -maxdepth 2 -not -path '*/\.*' | sort

demo:
	@PYTHONPATH=$(PYTHONPATH) python3 -m openauthor init .
	@PYTHONPATH=$(PYTHONPATH) python3 -m openauthor scene add --title "Opening Scene" --summary "Initial setup"
	@PYTHONPATH=$(PYTHONPATH) python3 -m openauthor scene list
