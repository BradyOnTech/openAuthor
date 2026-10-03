# Marker audit exit-status repair

The committed Makefile repair (`2a561cc1edacc3117017ef5f39d2a5109b5b3181`) accepts only `rg` exit 1 (no matches). Matches and command/read failures fail. The case-insensitive pattern, scan directories and genuine marker-failure output remain unchanged. Makefile SHA256: `bf11c9a4ee351eab9b761eaee15aee8be468b22ea688816f73e682438d73780e`.

Four private fixtures using the actual final Makefile target recorded: no markers exit 0; marker, missing `rg`, and unavailable input each exit 2 from make. Root's actual final repository `make check` recorded exit 0 with `rg` available and exit 2 without it. The original exit-0 check with missing `rg` is retained as **invalid evidence**.

`receipts.tar.gz` preserves 44 original byte streams: 29 fixture files and their original seal, the committed Makefile, two source-commit files, three independent Spec review files, and eight final repository command files. `receipt-index.json` records original paths, sizes and hashes. The independent Spec review passed. Standards tool text is not archived or relied upon; including it would require a clearly labeled root transcription. No original Standards report is invented.

Run `python3 verify.py` for read-only hash/archive/receipt checks, or `python3 verify.py --current-makefile /absolute/path/to/Makefile` to additionally compare a current source file. The verifier does not execute commands/modules, extract archives, access the network, or inspect author artifacts. This is a narrow gate repair, with no broader dependency audit, author-quality or release acceptance claim.
