import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoicePolicySession } from "../src/voice/voicePolicySession";
import type { VoiceLease } from "../src/voice/voiceLease";

const leaseId = "11111111-1111-4111-8111-111111111111";
const epoch = Date.parse("2026-10-02T12:00:00Z");
function lease(short = 30_000, hard = 600_000): VoiceLease {
  return { leaseId, expiresAt: new Date(epoch + hard).toISOString(), leaseExpiresAt: new Date(epoch + short).toISOString(), renewAfterMs: 10_000 };
}
function fixture(initial = lease()) {
  const transport = { start: vi.fn(async () => ({ callId: "call", ...initial })), stop: vi.fn(),
    sendText: vi.fn(), sendContext: vi.fn(), sendToolOutput: vi.fn(), setMuted: vi.fn(), interrupt: vi.fn() };
  const policy = { renew: vi.fn(async (_leaseId: string, _signal: AbortSignal) => lease(Date.now() - epoch + 30_000)), stop: vi.fn(async (_leaseId: string, _signal: AbortSignal) => {}) };
  const onClosed = vi.fn(), onRemoteStopUnconfirmed = vi.fn();
  const session = new VoicePolicySession({ transport, policy, onClosed, onRemoteStopUnconfirmed });
  return { session, transport, policy, onClosed, onRemoteStopUnconfirmed };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(epoch); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("server-owned mobile voice lease", () => {
  it("renews one owned lease and never extends the issued hard duration", async () => {
    const f = fixture(lease(30_000, 40_000));
    f.policy.renew.mockImplementation(async () => ({ ...lease(Math.min(40_000, Date.now() - epoch + 30_000), 40_000) }));
    await f.session.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.policy.renew).toHaveBeenCalledWith(leaseId, expect.any(AbortSignal));
    f.session.sendText("Still authorized");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.onClosed).toHaveBeenCalledOnce(); expect(f.transport.stop).toHaveBeenCalledOnce();
    expect(() => f.session.sendText("Too late")).toThrow("stopped");
    expect(f.policy.stop).toHaveBeenCalledOnce();
  });
  it.each(["revoked", "HTTP500", "lost response"])("closes media on %s without automatic reconnect", async reason => {
    const f = fixture(); f.policy.renew.mockRejectedValue(new Error(reason));
    await f.session.start(); await vi.advanceTimersByTimeAsync(10_000);
    expect(f.transport.stop).toHaveBeenCalledOnce(); expect(f.onClosed).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(f.transport.start).toHaveBeenCalledOnce(); expect(f.policy.renew).toHaveBeenCalledOnce();
  });
  it("times out a pending renewal and ignores its late success", async () => {
    const f = fixture(); let finish!: (value: VoiceLease) => void;
    f.policy.renew.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await f.session.start(); await vi.advanceTimersByTimeAsync(15_000);
    expect(f.transport.stop).toHaveBeenCalledOnce();
    expect(f.policy.renew.mock.calls[0]![1].aborted).toBe(true);
    finish(lease(45_000)); await Promise.resolve(); await vi.advanceTimersByTimeAsync(45_000);
    expect(f.onClosed).toHaveBeenCalledOnce(); expect(f.policy.renew).toHaveBeenCalledOnce();
    expect(f.session.active).toBe(false);
  });
  it.each([
    ["different lease", { leaseId: "22222222-2222-4222-8222-222222222222" }],
    ["extended duration", { expiresAt: new Date(epoch + 900_000).toISOString() }],
    ["expired authority", { leaseExpiresAt: new Date(epoch).toISOString() }],
    ["retreated authority", { leaseExpiresAt: new Date(epoch + 20_000).toISOString() }],
  ])("fails closed on %s", async (_name, changed) => {
    const f = fixture(); f.policy.renew.mockResolvedValue({ ...lease(40_000), ...changed });
    await f.session.start(); await vi.advanceTimersByTimeAsync(10_000);
    expect(f.transport.stop).toHaveBeenCalledOnce(); expect(f.onClosed).toHaveBeenCalledOnce();
  });
  it("closes at the short deadline even when a renewal is outstanding", async () => {
    const f = fixture(lease(2_000)); f.policy.renew.mockImplementation(() => new Promise(() => {}));
    await f.session.start(); await vi.advanceTimersByTimeAsync(2_000);
    expect(f.transport.stop).toHaveBeenCalledOnce(); expect(f.onClosed.mock.calls[0]![0]).toContain("expired");
  });
  it("keeps the hard timer bounded if the client clock moves backwards", async () => {
    const f = fixture(lease(30_000, 20_000));
    await expect(f.session.start()).rejects.toThrow("invalid");
    const valid = fixture(lease(20_000, 20_000)); await valid.session.start();
    vi.setSystemTime(epoch - 600_000);
    valid.policy.renew.mockImplementation(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(valid.transport.stop).toHaveBeenCalledOnce(); expect(valid.session.active).toBe(false);
  });
  it("does not let a late negotiated call reopen a stopped session", async () => {
    const f = fixture(); let finish!: (value: { callId: string } & VoiceLease) => void;
    f.transport.start.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const result = f.session.start(), rejected = expect(result).rejects.toThrow("stopped");
    f.session.stop(); finish({ callId: "call", ...lease() }); await rejected;
    expect(f.policy.renew).not.toHaveBeenCalled(); expect(f.policy.stop).toHaveBeenCalledOnce();
  });
  it("reports unconfirmed remote closure without reopening media or retrying", async () => {
    const f = fixture(); f.policy.stop.mockRejectedValue(new Error("private remote detail"));
    await f.session.start(); f.session.stop(); await Promise.resolve();
    expect(f.onRemoteStopUnconfirmed).toHaveBeenCalledOnce(); expect(f.transport.stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(600_000); expect(f.policy.stop).toHaveBeenCalledOnce();
  });
});
