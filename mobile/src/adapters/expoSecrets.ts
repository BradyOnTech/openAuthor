import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";

import {
  decodeEnrolledDevice,
  type DeviceStore,
  type EnrolledDevice,
  type SecretStore,
} from "../core/deviceEnrollment";

// Native runs one JS runtime. Serialize read-or-create across adapter instances;
// browser tabs use an IndexedDB transaction in the platform-specific adapter.
const secretWrites = new Map<string, Promise<unknown>>();
async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = secretWrites.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(operation);
  secretWrites.set(key, pending);
  try { return await pending; }
  finally { if (secretWrites.get(key) === pending) secretWrites.delete(key); }
}

export class ExpoSecretStore implements SecretStore {
  async get(key: string): Promise<string | null> {
    return await SecureStore.getItemAsync(key);
  }

  async set(key: string, value: string): Promise<void> {
    await serialized(key, () => SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }));
  }

  async delete(key: string): Promise<void> {
    await serialized(key, () => SecureStore.deleteItemAsync(key));
  }

  async create(key: string, value: string): Promise<string> {
    return serialized(key, async () => {
      const existing = await SecureStore.getItemAsync(key);
      if (existing !== null) return existing;
      await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      return value;
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
    await Storage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(device));
  }

  async clear(): Promise<void> {
    await Storage.removeItem(DEVICE_STORAGE_KEY);
  }
}
