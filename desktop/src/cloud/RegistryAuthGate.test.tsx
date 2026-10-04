// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegistryAuthGate } from "./RegistryAuthGate";

const mocks = vi.hoisted(() => ({ session: vi.fn(), native: true }));
vi.mock("./account", () => ({
  cloudConfiguration: () => ({ url: "https://example.com", publishableKey: "public" }),
  desktopAccount: async () => ({ session: mocks.session }),
}));
vi.mock("./secretStore", () => ({ hasNativeCredentialStore: () => mocks.native }));
vi.mock("./CloudSignIn", () => ({ CloudSignIn: () => <p>Secure sign-in</p> }));

describe("local-first account gate", () => {
  afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
  it("honors explicit local mode even when cloud hosting is configured", () => {
    vi.stubEnv("VITE_PROJECT_REGISTRY", "local");
    render(<RegistryAuthGate>{(mode) => <p>Writing with {mode} books</p>}</RegistryAuthGate>);
    expect(screen.getByText("Writing with local books")).toBeTruthy();
    expect(screen.queryByText("Secure sign-in")).toBeNull();
  });
  it("does not replace local writing when a late cloud restore finishes", async () => {
    vi.stubEnv("VITE_PROJECT_REGISTRY", "supabase");
    let resolve!: (value: unknown) => void;
    mocks.session.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<RegistryAuthGate>{(mode) => <p>Writing with {mode} books</p>}</RegistryAuthGate>);
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Continue with local books" }));
    await act(async () => { resolve({ userId: "verified-user" }); });
    expect(screen.getByText("Writing with local books")).toBeTruthy();
    expect(screen.queryByText("Writing with auto books")).toBeNull();
  });
});
