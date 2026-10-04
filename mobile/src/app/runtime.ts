import type { AppRuntime } from "./types";
import { PreviewRuntime } from "./previewRuntime";
import { HostedRuntime } from "./hostedRuntime";
import { loadMobileConfig } from "../config";

/** Replaced by the hosted composition root when Expo public configuration is present. */
export function createAppRuntime(): AppRuntime {
  try {
    return new HostedRuntime(loadMobileConfig());
  } catch {
    return new PreviewRuntime();
  }
}
