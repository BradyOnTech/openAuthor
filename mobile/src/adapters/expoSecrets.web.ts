import { decodeEnrolledDevice, type DeviceStore, type EnrolledDevice, type SecretStore } from "../core/deviceEnrollment";
import { browserStorage } from "./browserStorage";
import { prepareVerifiedProjectKeyWrite, type VerifiedProjectKeyWrite } from "../core/projectRecovery";
import { validateLocalAuthorization } from "../core/localCompanion";

export class ExpoSecretStore implements SecretStore {
  subscribeLocalAccessChanges(listener: () => void): () => void {
    return browserStorage.subscribe((key) => { if (key === "secret:openauthor.mobile.local-access.v1") listener(); });
  }
  get(key: string): Promise<string | null> { return browserStorage.get(`secret:${key}`); }
  set(key: string, value: string): Promise<void> { return browserStorage.set(`secret:${key}`, value); }
  delete(key: string): Promise<void> { return browserStorage.delete(`secret:${key}`); }
  create(key: string, value: string): Promise<string> { return browserStorage.create(`secret:${key}`, value); }
  async setProjectKeyIfCurrent(input: VerifiedProjectKeyWrite): Promise<void> {
    const slot = `secret:openauthor.project.${input.projectId}.key.${input.keyVersion}`;
    const access = "secret:openauthor.mobile.local-access.v1";
    const device = "device:current";
    await browserStorage.updateRecordsIfUnchanged([access, device, slot], values => {
      const prepared = prepareVerifiedProjectKeyWrite(input, values.get(access) ?? null,
        decodeEnrolledDevice(values.get(device) ?? null), values.get(slot) ?? null);
      return new Map([[slot, input.projectKey], [device, JSON.stringify(prepared.device)]]);
    }, input.current);
  }
  async setLocalAccessIfCurrent(value: string, current: () => void): Promise<void> {
    const access = "secret:openauthor.mobile.local-access.v1", device = "device:current";
    await browserStorage.updateRecordsIfUnchanged([access, device], values => {
      validateLocalAuthorization(value, decodeEnrolledDevice(values.get(device) ?? null));
      return new Map([[access, value]]);
    }, current);
  }
}

export class ExpoDeviceStore implements DeviceStore {
  async current(): Promise<EnrolledDevice | null> {
    const encoded = await browserStorage.get("device:current");
    const value = decodeEnrolledDevice(encoded);
    if (value && value.platform !== "web") {
      throw new Error("Saved browser enrollment is invalid.");
    }
    return value;
  }
  save(device: EnrolledDevice): Promise<void> { return browserStorage.set("device:current", JSON.stringify(device)); }
  clear(): Promise<void> { return browserStorage.delete("device:current"); }
}
