import type { E2EConfig } from "e2e";
import { mobile } from "@e2e-dev/mobile";

const platform = process.env.OPENAUTHOR_E2E_NATIVE_PLATFORM;
if (platform !== "ios" && platform !== "android") {
  throw new Error("Set OPENAUTHOR_E2E_NATIVE_PLATFORM=ios or android and use a dedicated simulator or emulator with the openAuthor preview build.");
}
const appPath = process.env.OPENAUTHOR_E2E_NATIVE_APP_PATH;
if (appPath !== undefined && appPath.trim() === "") {
  throw new Error("OPENAUTHOR_E2E_NATIVE_APP_PATH must name a preview .app or .apk build when set.");
}

export default {
  projectId: "openauthor-native-preview-workflows",
  tests: "native-tests/mobile-companion.e2e.ts",
  targets: [{
    name: `mobile-native-${platform}`,
    engine: mobile({ platform, device: process.env.OPENAUTHOR_E2E_NATIVE_DEVICE }),
    app: {
      bundleId: "com.openauthor.mobile",
      ...(appPath ? { appPath } : {}),
      identity: "openauthor-native-preview",
      environment: "test",
    },
  }],
  workers: 1,
  retries: 0,
  timeout: 180_000,
  actionTimeout: 20_000,
  assertionTimeout: 15_000,
  cleanupTimeout: 30_000,
  cache: "off",
  trace: "off",
  video: "off",
  reporters: ["list", "junit", "markdown"],
  output: `.e2e/mobile-native-${platform}`,
} satisfies E2EConfig;
