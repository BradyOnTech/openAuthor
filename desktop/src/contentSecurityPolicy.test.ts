import { describe, expect, it } from "vitest";
import packagedConfig from "../src-tauri/tauri.conf.json?raw";
import { CONTENT_SECURITY_POLICY } from "../contentSecurityPolicy";

describe("content security policy", () => {
  const packaged = JSON.parse(packagedConfig).app.security;

  it("is the same in the packaged app as in the previewed build the browser suites run", () => {
    expect(packaged.csp).toBe(CONTENT_SECURITY_POLICY);
  });

  it("loads scripts only from the app and never inline", () => {
    const scripts = CONTENT_SECURITY_POLICY.split("; ").find(part => part.startsWith("script-src")) ?? "";
    // Evaluation is allowed only for the contracts package's schema compiler.
    expect(scripts).toBe("script-src 'self' 'unsafe-eval'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toMatch(/https?:|\*/);
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("frame-src 'none'");
  });
});
