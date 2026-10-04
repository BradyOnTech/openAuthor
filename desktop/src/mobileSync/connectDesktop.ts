import { cloudConfiguration, desktopAccount } from "../cloud/account";
import { deploymentScope, nativeSecrets } from "../cloud/secretStore";
import { createHostedMobileSyncCoordinator } from "./hostedCoordinator";

export async function connectDesktopMobileSync(projectId: string, projectRoot: string) {
  const config = cloudConfiguration();
  if (!config) throw new Error("Companion hosting has not been configured for this build.");
  const { enrollDesktopForProject } = await import("../cloud/desktopEnrollment");
  const enrollment = await enrollDesktopForProject({
    scope: await deploymentScope(config.url), projectId, account: await desktopAccount(), secrets: nativeSecrets,
  });
  const coordinator = createHostedMobileSyncCoordinator({
    supabaseUrl: config.url, publishableKey: config.publishableKey, projectId, projectRoot,
    accessToken: await enrollment.accessToken(), getAccessToken: enrollment.accessToken,
    projectKeys: enrollment.projectKeys,
    recoveryDeviceKey: enrollment.deviceKey,
  });
  await coordinator.refreshKeyState();
  return coordinator;
}
