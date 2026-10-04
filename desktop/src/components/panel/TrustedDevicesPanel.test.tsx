// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrustedDevicesPanel } from "./TrustedDevicesPanel";
import type { HostedMobileSyncCoordinator } from "../../mobileSync/hostedCoordinator";
import type { MobileProjectDevice } from "../../mobileSync/projectKeyProvisioning";
import { RecoverableDraft } from "../../recoverableDraft";

const desktopId = "10000000-0000-4000-8000-000000000001";
const phoneId = "10000000-0000-4000-8000-000000000002";
type Provisioned = { keyVersion: number; recoveryKey: string; envelopeCount: number };
let serial = 0;
function fixture() {
  const projectId = `project-${++serial}`;
  let rows: MobileProjectDevice[] = [
    { deviceId: desktopId, userId: "account-one", platform: "desktop", deviceKeyVersion: 1, keyId: "desktop-key", publicKey: "public", keyAlgorithm: "x25519-v1", projectEnrolledAt: "enrolled", projectRevokedAt: null },
    { deviceId: phoneId, userId: "account-one", platform: "ios", deviceKeyVersion: 2, keyId: "phone-key", publicKey: "public", keyAlgorithm: "x25519-v1", projectEnrolledAt: "enrolled", projectRevokedAt: null },
    { deviceId: "not-enrolled", userId: "account-two", platform: "android", deviceKeyVersion: 1, keyId: "other-key", publicKey: "public", keyAlgorithm: "x25519-v1", projectEnrolledAt: null, projectRevokedAt: null },
  ];
  let state = { status: "ready" as "ready" | "locked", activeKeyVersion: 3 as number | null, latestKeyVersion: 3, message: "Current key 3." };
  const coordinator: HostedMobileSyncCoordinator = {
    getState: () => state, getIdentity: () => ({ userId: "account-one", deviceId: desktopId }),
    refreshKeyState: vi.fn(async () => ({ latestKeyVersion: state.latestKeyVersion, activeKeyVersion: state.activeKeyVersion })),
    listDevices: vi.fn(async () => rows.map(row => ({ ...row }))),
    revokeDevice: vi.fn(async id => { rows = rows.map(row => row.deviceId === id ? { ...row, projectRevokedAt: "revoked-now" } : row); state = { ...state, status: "locked", activeKeyVersion: null }; }),
    provisionProjectKey: vi.fn(async () => { state = { status: "ready", activeKeyVersion: 4, latestKeyVersion: 4, message: "Current key 4." }; return { keyVersion: 4, recoveryKey: "OA1-synthetic-secret", envelopeCount: 1 }; }),
    unlockRecoveryKey: vi.fn(), publishSnapshot: vi.fn(), importOutbox: vi.fn(),
  };
  const props = { coordinator, projectId, projectRoot: "/synthetic", disabled: false, onBusyChange: vi.fn(), onChanged: vi.fn() };
  return { coordinator, props, setRows: (next: MobileProjectDevice[]) => { rows = next; }, getRows: () => rows };
}
async function loaded() { await waitFor(() => expect(screen.getByRole("button", { name: "Refresh trusted devices" }).hasAttribute("disabled")).toBe(false)); }
function reviewRotation() { fireEvent.click(screen.getByRole("button", { name: "Review book key rotation" })); fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed this version/ })); }
afterEach(() => { cleanup(); localStorage.clear(); });

describe("TrustedDevicesPanel", () => {
  it("pins an unchanged initial version through failed rotation/reopen and refuses newer authority without implicit rebasing", async () => {
    const { props, coordinator } = fixture();
    let authority = 3;
    const rotate = vi.fn(async (expected: number) => {
      if (expected !== authority) throw new Error("The previous book key version changed");
      authority = 4;
      throw new Error("Rotation response lost");
    });
    coordinator.provisionProjectKey = rotate;
    const view = render(<TrustedDevicesPanel {...props} />); await loaded();
    reviewRotation(); fireEvent.click(screen.getByRole("button", { name: "Rotate book key for reviewed devices" }));
    await screen.findByText(/Rotation response lost/);
    const key = `openauthor.companionDeviceReview.v1:${JSON.stringify([props.projectRoot, props.projectId, "account-one", desktopId])}`;
    const retained = JSON.parse(localStorage.getItem(key)!);
    expect(retained.base.previousVersion).toBe("3"); expect(retained.value.previousVersion).toBe("3"); expect(retained.value.reviewIntent).toBe(true);
    coordinator.getState = () => ({ status: "locked", activeKeyVersion: null, latestKeyVersion: 4, message: "Current authority advanced." });
    view.unmount(); render(<TrustedDevicesPanel {...props} />); await loaded();
    expect((screen.getByLabelText("Expected previous book key version") as HTMLInputElement).value).toBe("3");
    expect(screen.getByText(/Recovered device-management draft/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Book key rotation review" })).toBeNull();
    expect(screen.getByRole("button", { name: "Review book key rotation" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Refresh trusted devices" })); await loaded();
    reviewRotation(); fireEvent.click(screen.getByRole("button", { name: "Rotate book key for reviewed devices" }));
    await screen.findByText(/previous book key version changed/);
    expect(rotate).toHaveBeenCalledTimes(2); expect(rotate.mock.calls.map(call => call[0])).toEqual([3, 3]);
    expect(JSON.parse(localStorage.getItem(key)!).value.previousVersion).toBe("3");
  });

  it("names full current-device identity and makes project revocation deliberate before separately reviewing rotation", async () => {
    const { props, coordinator } = fixture();
    render(<TrustedDevicesPanel {...props} />); await loaded();
    expect(screen.getAllByText(desktopId).length).toBeGreaterThan(0);
    expect(screen.getByText("desktop · This desktop")).toBeTruthy();
    expect(screen.getByText(/cannot erase downloaded/)).toBeTruthy();
    const revoke = screen.getByRole("button", { name: "Revoke selected device for this book" });
    expect(revoke.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Device to revoke"), { target: { value: phoneId } });
    expect(revoke.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /I intend to revoke/ }));
    fireEvent.click(revoke);
    await waitFor(() => expect(coordinator.revokeDevice).toHaveBeenCalledWith(phoneId, "lost-device"));
    await waitFor(() => expect(screen.getByText(/Revoked for this book/)).toBeTruthy());
    expect(coordinator.provisionProjectKey).not.toHaveBeenCalled();
    reviewRotation();
    const review = screen.getByRole("region", { name: "Book key rotation review" });
    expect(within(review).getByText(desktopId)).toBeTruthy(); expect(within(review).queryByText(phoneId)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Rotate book key for reviewed devices" }));
    await waitFor(() => expect(coordinator.provisionProjectKey).toHaveBeenCalledWith(3, "lost-device", [{ deviceId: desktopId, keyId: "desktop-key" }]));
    expect(coordinator.publishSnapshot).not.toHaveBeenCalled();
    await screen.findByText("OA1-synthetic-secret");
    expect(localStorage.getItem(`openauthor.companionDeviceReview.v1:${JSON.stringify([props.projectRoot, props.projectId, "account-one", desktopId])}`) || "").not.toContain("secret");
  });

  it("invalidates confirmation when the expected version/reason changes or devices are refreshed", async () => {
    const { props, coordinator } = fixture(); render(<TrustedDevicesPanel {...props} />); await loaded();
    reviewRotation();
    fireEvent.change(screen.getByLabelText("Expected previous book key version"), { target: { value: "2" } });
    expect(screen.queryByRole("region", { name: "Book key rotation review" })).toBeNull();
    reviewRotation(); fireEvent.click(screen.getByRole("button", { name: "Refresh trusted devices" })); await loaded();
    expect(screen.queryByRole("region", { name: "Book key rotation review" })).toBeNull();
    expect(coordinator.provisionProjectKey).not.toHaveBeenCalled();
  });

  it("recovers version/reason/target after reopening, without restoring consent or sending an operation", async () => {
    const { props, coordinator } = fixture(); const view = render(<TrustedDevicesPanel {...props} />); await loaded();
    fireEvent.change(screen.getByLabelText("Expected previous book key version"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Device to revoke"), { target: { value: phoneId } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "untrusted-device" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I intend to revoke/ })); view.unmount();
    render(<TrustedDevicesPanel {...props} />); await loaded();
    expect((screen.getByLabelText("Expected previous book key version") as HTMLInputElement).value).toBe("2");
    expect((screen.getByLabelText("Device to revoke") as HTMLSelectElement).value).toBe(phoneId);
    expect((screen.getByLabelText("Reason") as HTMLSelectElement).value).toBe("untrusted-device");
    expect((screen.getByRole("checkbox", { name: /I intend to revoke/ }) as HTMLInputElement).checked).toBe(false);
    expect(coordinator.revokeDevice).not.toHaveBeenCalled(); expect(coordinator.provisionProjectKey).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard device-management draft" }));
    expect((screen.getByLabelText("Device to revoke") as HTMLSelectElement).value).toBe("");
  });

  it("retains scoped busy/error state through project/account navigation and never delivers the old outcome to another scope", async () => {
    const old = fixture(); let reject!: (error: Error) => void;
    old.coordinator.provisionProjectKey = vi.fn(() => new Promise<Provisioned>((_resolve, fail) => { reject = fail; }));
    const view = render(<TrustedDevicesPanel {...old.props} />); await loaded(); reviewRotation();
    fireEvent.click(screen.getByRole("button", { name: "Rotate book key for reviewed devices" }));
    await waitFor(() => expect(old.props.onBusyChange).toHaveBeenLastCalledWith(true)); view.unmount();
    const other = fixture(); other.coordinator.getIdentity = () => ({ userId: "account-two", deviceId: desktopId });
    const nextView = render(<TrustedDevicesPanel {...other.props} />); await loaded();
    const calls = other.props.onChanged.mock.calls.length;
    await act(async () => reject(new Error("Lost response for old account")));
    expect(screen.queryByText(/Lost response for old account/)).toBeNull(); expect(other.props.onChanged).toHaveBeenCalledTimes(calls);
    nextView.unmount(); render(<TrustedDevicesPanel {...old.props} />); await loaded();
    expect(screen.getByRole("alert").textContent).toContain("Lost response for old account");
    expect(old.coordinator.provisionProjectKey).toHaveBeenCalledTimes(1);
  });

  it("keeps a reopened pending operation busy and shows its scoped successful recovery key only after completion", async () => {
    const { props, coordinator } = fixture(); let finish!: (result: { keyVersion: number; recoveryKey: string; envelopeCount: number }) => void;
    coordinator.provisionProjectKey = vi.fn(() => new Promise<Provisioned>(resolve => { finish = resolve; }));
    const view = render(<TrustedDevicesPanel {...props} />); await loaded(); reviewRotation(); fireEvent.click(screen.getByRole("button", { name: "Rotate book key for reviewed devices" }));
    await waitFor(() => expect(props.onBusyChange).toHaveBeenLastCalledWith(true)); view.unmount(); render(<TrustedDevicesPanel {...props} />);
    await screen.findByText(/Device operation in progress/);
    expect(screen.getByRole("button", { name: "Review book key rotation" }).hasAttribute("disabled")).toBe(true);
    await act(async () => finish({ keyVersion: 4, recoveryKey: "scoped-in-memory-secret", envelopeCount: 2 }));
    await screen.findByText("scoped-in-memory-secret");
    expect(localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Hide recovery key" })); expect(screen.queryByText("scoped-in-memory-secret")).toBeNull();
  });

  it("preserves a newer journal edit when an earlier rotation completes", async () => {
    const { props, coordinator } = fixture(); let finish!: (result: { keyVersion: number; recoveryKey: string; envelopeCount: number }) => void;
    coordinator.provisionProjectKey = vi.fn(() => new Promise<Provisioned>(resolve => { finish = resolve; }));
    render(<TrustedDevicesPanel {...props} />); await loaded();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "routine-key-rotation" } }); reviewRotation();
    fireEvent.click(screen.getByRole("button", { name: "Rotate book key for reviewed devices" }));
    const key = `openauthor.companionDeviceReview.v1:${JSON.stringify([props.projectRoot, props.projectId, "account-one", desktopId])}`;
    const journal = new RecoverableDraft(key, { previousVersion: "3", reason: "lost-device", targetDeviceId: "" }, (value): value is { previousVersion: string; reason: string; targetDeviceId: string } => !!value);
    journal.edit({ previousVersion: "3", reason: "untrusted-device", targetDeviceId: phoneId });
    await act(async () => finish({ keyVersion: 4, recoveryKey: "new-key", envelopeCount: 2 }));
    await waitFor(() => expect((screen.getByLabelText("Reason") as HTMLSelectElement).value).toBe("untrusted-device"));
    expect((screen.getByLabelText("Device to revoke") as HTMLSelectElement).value).toBe(phoneId);
  });

  it("blocks both writes when refresh fails and retains entered draft", async () => {
    const { props, coordinator } = fixture(); render(<TrustedDevicesPanel {...props} />); await loaded();
    fireEvent.change(screen.getByLabelText("Expected previous book key version"), { target: { value: "2" } });
    (coordinator.listDevices as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Session changed"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh trusted devices" })); await screen.findByText(/Session changed/);
    expect(screen.getByRole("button", { name: "Review book key rotation" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Revoke selected device for this book" }).hasAttribute("disabled")).toBe(true);
    expect((screen.getByLabelText("Expected previous book key version") as HTMLInputElement).value).toBe("2");
  });
});
