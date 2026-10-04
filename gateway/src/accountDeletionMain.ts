import { pathToFileURL } from "node:url";
import { AccountDeletionProblem, createAccountDeletionWorker, finalizeAccountAuth, SupabaseAccountDeletionAuthAdmin, SupabaseAccountDeletionJobStore } from "./accountDeletion.ts";

function required(environment: NodeJS.ProcessEnv, key: string) {
  const value = environment[key]?.trim(); if (!value) throw new AccountDeletionProblem("invalid_configuration"); return value;
}
/** Trusted command only. The ordinary Storage scheduler cannot finalize Auth. */
export async function runAccountDeletionCommand(args: string[], environment: NodeJS.ProcessEnv) {
  const options = { supabaseUrl: required(environment, "SUPABASE_URL"), serviceKey: required(environment, "SUPABASE_DELETION_SERVICE_KEY") };
  if (args.length === 2 && args[0] === "--job") return createAccountDeletionWorker(options).runOnce(args[1]!);
  if (args.length === 4 && args[0] === "--finalize-auth" && args[2] === "--reviewed-inventory") {
    const auth = new SupabaseAccountDeletionAuthAdmin({ ...options, serviceKey: required(environment, "SUPABASE_ACCOUNT_AUTH_SERVICE_KEY") });
    return finalizeAccountAuth(new SupabaseAccountDeletionJobStore(options), auth, args[1]!, args[3]!);
  }
  throw new AccountDeletionProblem("invalid_arguments");
}
const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  runAccountDeletionCommand(process.argv.slice(2), process.env).then(
    result => process.stdout.write(`${JSON.stringify(result)}\n`),
    () => { process.stderr.write('{"event":"account_deletion_incomplete"}\n'); process.exitCode = 1; },
  );
}
