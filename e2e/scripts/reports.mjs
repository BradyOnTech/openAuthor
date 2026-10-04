export function sdkVerification(report) {
  const selected = report.run.results.filter(result => result.selected);
  const counts = {};
  for (const result of selected) counts[result.status] = (counts[result.status] ?? 0) + 1;
  return {
    counts,
    verified: report.run.exitCode === 0 && report.run.errors.length === 0
      && selected.length > 0 && selected.length === report.run.results.length
      && selected.every(result => result.status === "passed"),
  };
}

export function playwrightVerification(report) {
  const tests = [];
  function visit(suites) {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) tests.push(...spec.tests);
      visit(suite.suites ?? []);
    }
  }
  visit(report.suites);
  const counts = {};
  for (const test of tests) counts[test.status] = (counts[test.status] ?? 0) + 1;
  return {
    counts,
    verified: report.errors.length === 0 && tests.length > 0 && tests.every(test =>
      test.status === "expected" && test.expectedStatus === "passed"
      && test.results.length > 0 && test.results.every(result => result.status === "passed")),
  };
}
