import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";

import {
  decodeEnrolledDevice,
  type DeviceStore,
  type EnrolledDevice,
  type SecretStore,
} from "../core/deviceEnrollment";
import { prepareVerifiedProjectKeyWrite, type VerifiedProjectKeyWrite } from "../core/projectRecovery";
import { validateLocalAuthorization } from "../core/localCompanion";

// Native runs one JS runtime. Serialize local writes across adapter instances;
// browser tabs use an IndexedDB transaction in the platform-specific adapter.
let localWrites: Promise<unknown> = Promise.resolve();
async function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const previous = localWrites;
  const pending = previous.catch(() => {}).then(operation);
  localWrites = pending;
  return await pending;
}

export class ExpoSecretStore implements SecretStore {
  subscribeLocalAccessChanges(_listener: () => void): () => void { return () => {}; }

  async get(key: string): Promise<string | null> {
    return await SecureStore.getItemAsync(key);
  }

  async set(key: string, value: string): Promise<void> {
    await serialized(() => SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }));
  }

  async delete(key: string): Promise<void> {
    await serialized(() => SecureStore.deleteItemAsync(key));
  }

  async create(key: string, value: string): Promise<string> {
    return serialized(async () => {
      const existing = await SecureStore.getItemAsync(key);
      if (existing !== null) return existing;
      await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      return value;
    });
  }

  async setProjectKeyIfCurrent(input: VerifiedProjectKeyWrite): Promise<void> {
    await serialized(async () => {
      const slot = `openauthor.project.${input.projectId}.key.${input.keyVersion}`;
      const originalDevice = await Storage.getItem(DEVICE_STORAGE_KEY);
      const originalKey = await SecureStore.getItemAsync(slot);
      const prepared = prepareVerifiedProjectKeyWrite(input,
        await SecureStore.getItemAsync("openauthor.mobile.local-access.v1"),
        decodeEnrolledDevice(originalDevice), originalKey);
      // Index first: a failed native key write leaves a harmless indexed slot
      // that cleanup can still find. Every device/secret mutation shares this
      // runtime queue; no network work is performed while it is held.
      let keyDispatched = false;
      try {
        await Storage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(prepared.device));
        input.current();
        keyDispatched = true;
        await SecureStore.setItemAsync(prepared.slot, input.projectKey, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
        input.current();
      } catch (reason) {
        // SecureStore cannot cancel an already-dispatched native write. Keep
        // the queue held while restoring its prior value; remove the reserved
        // index only after the candidate is confirmed removed/restored.
        try {
          if (keyDispatched) {
            if (originalKey === null) await SecureStore.deleteItemAsync(slot);
            else await SecureStore.setItemAsync(slot, originalKey, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
          }
          await Storage.setItem(DEVICE_STORAGE_KEY, originalDevice!);
        } catch {
          throw new Error("Book key recovery could not be rolled back safely. Keep this device signed out and retry explicit device cleanup.");
        }
        throw reason;
      }
    });
  }

  async setLocalAccessIfCurrent(value: string, current: () => void): Promise<void> {
    await serialized(async () => {
      const slot = "openauthor.mobile.local-access.v1";
      current();
      const previous = await SecureStore.getItemAsync(slot);
      validateLocalAuthorization(value, decodeEnrolledDevice(await Storage.getItem(DEVICE_STORAGE_KEY)));
      current();
      try {
        await SecureStore.setItemAsync(slot, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
        current();
      } catch (reason) {
        try {
          if (previous === null) await SecureStore.deleteItemAsync(slot);
          else await SecureStore.setItemAsync(slot, previous, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
        } catch { throw new Error("Local authorization could not be rolled back safely. Keep this device signed out and retry local cleanup."); }
        throw reason;
      }
    });
  }
}

const DEVICE_STORAGE_KEY = "openauthor.mobile.enrolled-device.v1";

export class ExpoDeviceStore implements DeviceStore {
  async current(): Promise<EnrolledDevice | null> {
    const value = decodeEnrolledDevice(await Storage.getItem(DEVICE_STORAGE_KEY));
    if (value?.platform === "web") throw new Error("Saved device enrollment platform is invalid.");
    return value;
  }

  async save(device: EnrolledDevice): Promise<void> {
    await serialized(() => Storage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(device)));
  }

  async clear(): Promise<void> {
    await serialized(() => Storage.removeItem(DEVICE_STORAGE_KEY));
  }
}
