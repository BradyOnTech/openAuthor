import { pathToFileURL } from "node:url";

import { ProjectDeletionProblem, ProjectDeletionWorker, SupabaseDeletionStorage, SupabaseProjectDeletionJobStore } from "./projectDeletion.ts";

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new ProjectDeletionProblem("invalid_worker_configuration");
  return value;
}

/** A separate trusted process, never a route on the public voice gateway. */
export async function runProjectDeletionCommand(args: string[], environment: NodeJS.ProcessEnv): Promise<{ job_id: string; phase: string; acknowledged_paths: number; runs: number }> {
  if (args.length !== 2 || args[0] !== "--job") throw new ProjectDeletionProblem("invalid_worker_arguments");
  const configuration = { supabaseUrl: required(environment, "SUPABASE_URL"), serviceKey: required(environment, "SUPABASE_DELETION_SERVICE_KEY") };
  const jobs = new SupabaseProjectDeletionJobStore(configuration);
  const storage = new SupabaseDeletionStorage(configuration);
  const worker = new ProjectDeletionWorker({ jobs, storage });
  let lease = await jobs.claim(args[1]!);
  let acknowledged = 0;
  // Every successful batch advances durable state. Errors end this invocation;
  // a later lease owner reconciles pending intent before destructive retry.
  for (let runs = 1; runs <= 1000; runs++) {
    const result = await worker.runOnce(lease);
    acknowledged += result.acknowledged_paths;
    if (result.phase !== "deleting") return { job_id: lease.job_id, phase: result.phase, acknowledged_paths: acknowledged, runs };
    lease = await jobs.assertLease(lease);
  }
  throw new ProjectDeletionProblem("run_bound");
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  runProjectDeletionCommand(process.argv.slice(2), process.env).then(
    result => { process.stdout.write(`${JSON.stringify(result)}\n`); },
    () => { process.stderr.write('{"event":"project_deletion_incomplete"}\n'); process.exitCode = 1; },
  );
}
