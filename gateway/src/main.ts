import { pathToFileURL } from "node:url";

import { startGatewayProcess } from "./production.ts";

export async function main(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  await startGatewayProcess(environment);
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch(() => {
    process.stderr.write('{"event":"gateway_start_failed"}\n');
    process.exitCode = 1;
  });
}
