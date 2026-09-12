import { decodeEnrolledDevice, type DeviceStore, type EnrolledDevice, type SecretStore } from "../core/deviceEnrollment";
import { browserStorage } from "./browserStorage";

export class ExpoSecretStore implements SecretStore {
  get(key: string): Promise<string | null> { return browserStorage.get(`secret:${key}`); }
  set(key: string, value: string): Promise<void> { return browserStorage.set(`secret:${key}`, value); }
  delete(key: string): Promise<void> { return browserStorage.delete(`secret:${key}`); }
  create(key: string, value: string): Promise<string> { return browserStorage.create(`secret:${key}`, value); }
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
