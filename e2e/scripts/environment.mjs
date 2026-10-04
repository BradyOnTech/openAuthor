const allowed = new Set([
  "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "CI", "LANG", "LC_ALL", "LC_CTYPE",
  "PLAYWRIGHT_BROWSERS_PATH", "OPENAUTHOR_TEST_PYTHON", "OPENAUTHOR_BROWSER_EXECUTABLE",
  "OPENAUTHOR_TEST_PG_BIN", "OPENAUTHOR_E2E_NATIVE_PLATFORM", "OPENAUTHOR_E2E_NATIVE_APP_PATH",
  "OPENAUTHOR_E2E_NATIVE_DEVICE", "ANDROID_HOME", "ANDROID_SDK_ROOT", "JAVA_HOME", "DEVELOPER_DIR",
]);

export function testEnvironment() {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key))),
    E2E_TELEMETRY_DISABLED: "1",
    DO_NOT_TRACK: "1",
  };
}
