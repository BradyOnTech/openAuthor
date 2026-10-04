import { pathToFileURL } from "node:url";
import { isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { OpenAIRealtimeUpstream } from "./openAIRealtimeUpstream.ts";
import { SupabaseControllerVoiceControl, trustedVoiceToken, uuidPattern, voiceCredentialBinding, VoiceControlProblem } from "./sharedVoiceControl.ts";
import { ControllerJournal, VoiceControllerWorker } from "./voiceControllerWorker.ts";

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim(); if (!value) throw new Error(`${name} is required.`); return value;
}
function integer(environment: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
  const value = environment[name] ? Number(environment[name]) : fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new VoiceControlProblem(); return value;
}
export function parseVoiceControllerConfig(environment: NodeJS.ProcessEnv) {
  const supabaseUrl = new URL(required(environment, "SUPABASE_URL"));
  if (supabaseUrl.protocol !== "https:" || supabaseUrl.username || supabaseUrl.password || supabaseUrl.pathname !== "/" || supabaseUrl.search || supabaseUrl.hash) throw new VoiceControlProblem();
  const publishableKey = required(environment, "SUPABASE_PUBLISHABLE_KEY");
  const token = trustedVoiceToken(required(environment, "SUPABASE_VOICE_CONTROLLER_TOKEN"), "mobile_voice_controller");
  const apiKey = required(environment, "OPENAI_API_KEY"), projectId = required(environment, "OPENAI_PROJECT_ID"), organizationId = environment.OPENAI_ORGANIZATION_ID?.trim();
  const binding = voiceCredentialBinding(apiKey, projectId, organizationId);
  const journalPath = required(environment, "VOICE_CONTROLLER_JOURNAL_PATH");
  if (!isAbsolute(journalPath)) throw new VoiceControlProblem();
  // Each supervised process gets a fresh identity. Reusing an ID across live
  // replicas would steal claims; local private journal ownership is separate.
  const controllerId = randomUUID();
  const pollMs = integer(environment, "VOICE_CONTROLLER_POLL_MS", 1000, 100, 30000);
  const claimMs = integer(environment, "VOICE_CONTROLLER_CLAIM_MS", 15000, 1000, 60000);
  const timeoutMs = integer(environment, "VOICE_CONTROLLER_TIMEOUT_MS", 5000, 100, 60000);
  if (!uuidPattern.test(controllerId) || claimMs < Math.max(pollMs * 3, timeoutMs * 2 + pollMs)) throw new VoiceControlProblem();
  return { supabaseUrl: supabaseUrl.origin, publishableKey, token, apiKey, projectId, ...(organizationId ? { organizationId } : {}), binding, journalPath, controllerId, pollMs, claimMs, timeoutMs };
}

export async function startVoiceController(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = parseVoiceControllerConfig(environment);
  const store = new SupabaseControllerVoiceControl(config);
  const journal = new ControllerJournal(config.journalPath, config.binding);
  const upstream = new OpenAIRealtimeUpstream({ apiKey: config.apiKey, projectId: config.projectId, ...(config.organizationId ? { organizationId: config.organizationId } : {}), timeoutMs: config.timeoutMs });
  const worker = new VoiceControllerWorker({ store, journal, upstream, operationTimeoutMs: config.timeoutMs });
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    while (!stopping) {
      try { await worker.runOnce(); }
      catch { process.stderr.write('{"event":"voice_controller_control_unconfirmed"}\n'); }
      if (!stopping) await new Promise(resolve => setTimeout(resolve, config.pollMs));
    }
  } finally { worker.close(); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startVoiceController().catch(() => { process.stderr.write('{"event":"voice_controller_start_failed"}\n'); process.exitCode = 1; });
}
