# Hosted browser fixture module loading

CI run [37184141273](https://github.com/BradyOnTech/openAuthor/actions/runs/37184141273)
failed the first account deletion journey before its panel mounted. The trace
records HTTP 404 for the fixture's direct request to Vite's private,
unversioned `node_modules/.vite/deps/react-dom_client.js` cache file. Its
screenshot shows an empty root. The other 37 authoring browser cases passed.
This failure precedes account enrollment, deletion or authority checks.

The account deletion, companion key recovery and trusted device fixtures now
import two tiny source entry modules served and transformed by Vite. Those
modules re-export the installed React/ReactDOM and sodium packages through
ordinary bare imports, letting Vite resolve their current dependency URLs.
The key recovery helper's later sodium import uses the same source entry.
There are no direct private cache imports left in these fixtures.

The fixture changes preserve every RPC boundary, acknowledgement, status,
revocation, recovery and network interception assertion. They change no app
code, Vite configuration, test timeout or retry policy.

From a fresh desktop install and a deleted Vite dependency cache, all 12 cases
in the three affected specs passed under the existing Playwright configuration,
with `--retries=0`, in 9.1 seconds. The original CI trace is the recorded red
result; the old test also passed during an ordinary local cold-cache run, so
the original startup race is not claimed to reproduce on every local run.
An artificial disabled-entry-scan probe produced separate incremental
optimizer/duplicate-React errors and is excluded from cause evidence.

`ci-failure.json` records the relevant trace response, trace hash and run/head
identity. `ci-failure.png` is the actual CI screenshot. The raw CI failure log
and cold-cache green result are stored as gzip files. `verification.json` and
the source/artifact hashes bind this packet. Full project aggregates and fresh
CI remain the integration checks; this packet covers the 12 affected journeys.
