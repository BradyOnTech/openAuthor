type CleanupStep = () => Promise<void>;

async function runAllCleanupSteps(steps: CleanupStep[], safeError: string): Promise<void> {
  let failed = false;
  for (const step of steps) {
    try {
      await step();
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error(safeError);
}

export async function clearHostedEncryptedData(input: {
  clearDevice: CleanupStep;
  deleteCache: CleanupStep;
  deleteOutbox: CleanupStep;
}): Promise<void> {
  await runAllCleanupSteps(
    [input.clearDevice, input.deleteCache, input.deleteOutbox],
    "Local encrypted data could not be cleared safely.",
  );
}

export async function revokeAndDeleteHostedLocalData(input: {
  revokeDevice: CleanupStep;
  deleteCache: CleanupStep;
  deleteOutbox: CleanupStep;
  signOut: CleanupStep;
}): Promise<void> {
  await runAllCleanupSteps(
    [input.revokeDevice, input.deleteCache, input.deleteOutbox, input.signOut],
    "Device cleanup could not be completed safely.",
  );
}
