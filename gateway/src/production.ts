import type { Server } from "node:http";

import { parseGatewayConfig, type GatewayConfig } from "./config.ts";
import { OpenAIRealtimeUpstream } from "./openAIRealtimeUpstream.ts";
import { SupabaseRpcSessionRateLimiter } from "./supabaseRateLimiter.ts";
import { createSessionGateway, type SessionGatewayServer } from "./sessionGateway.ts";
import { CallJournal } from "./callJournal.ts";
import { SessionLeases } from "./sessionLeases.ts";
import {
  SupabaseJwksPrincipalVerifier,
  SupabaseRpcProjectDeviceAuthorizer,
} from "./supabaseAdapters.ts";
import type { AuditSink, DiagnosticSink } from "./types.ts";

export interface TextOutput {
  write(chunk: string): unknown;
}

export interface ProcessSignalSource {
  exitCode: string | number | null | undefined;
  once(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
  removeListener(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
}

export interface GatewayProcessOptions {
  signals?: ProcessSignalSource;
  auditOutput?: TextOutput;
  diagnosticOutput?: TextOutput;
}

export function createJsonLineAuditSink(output: TextOutput): AuditSink {
  return {
    async write(event): Promise<void> {
      output.write(`${JSON.stringify(event)}\n`);
    },
  };
}

export function createJsonLineDiagnosticSink(output: TextOutput): DiagnosticSink {
  return {
    async write(event): Promise<void> {
      output.write(`${JSON.stringify(event)}\n`);
    },
  };
}

export async function createProductionGateway(
  config: GatewayConfig,
  outputs: {
    auditOutput?: TextOutput;
    diagnosticOutput?: TextOutput;
  } = {},
): Promise<SessionGatewayServer> {
  const auditOutput = outputs.auditOutput ?? process.stdout;
  const diagnosticOutput = outputs.diagnosticOutput ?? process.stderr;
  const dependencies = {
      principalVerifier: new SupabaseJwksPrincipalVerifier({
        issuer: config.supabase.issuer,
        audience: config.supabase.audience,
        tenantClaim: config.supabase.tenantClaim,
        deviceClaim: config.supabase.deviceClaim,
        jwksTimeoutMs: config.supabase.jwksTimeoutMs,
        jwksCacheMaxAgeMs: config.supabase.jwksCacheMaxAgeMs,
      }),
      authorizer: new SupabaseRpcProjectDeviceAuthorizer({
        supabaseUrl: config.supabase.url,
        publishableKey: config.supabase.publishableKey,
        rpcName: config.supabase.authorizationRpc,
        timeoutMs: config.supabase.authorizationTimeoutMs,
      }),
      rateLimiter: new SupabaseRpcSessionRateLimiter({
        supabaseUrl: config.supabase.url,
        publishableKey: config.supabase.publishableKey,
        limit: config.rateLimit.limit,
        windowMs: config.rateLimit.windowMs,
        timeoutMs: config.supabase.authorizationTimeoutMs,
      }),
      upstream: new OpenAIRealtimeUpstream({
        apiKey: config.openAI.apiKey,
        timeoutMs: config.openAI.timeoutMs,
        maxResponseBytes: config.openAI.maxResponseBytes,
      }),
      auditSink: createJsonLineAuditSink(auditOutput),
      diagnosticSink: createJsonLineDiagnosticSink(diagnosticOutput),
      clock: { now: () => new Date() },
  };
  const journal = new CallJournal(config.leases.journalPath);
  const leases = new SessionLeases({ ...config.leases, journal, ...dependencies });
  try { await leases.initialize(); } catch (error) { journal.close(); throw error; }
  return createSessionGateway({ dependencies, policy: config.policy, leases });
}

async function listen(server: Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });
}

export function installGracefulShutdown(
  server: Server & { shutdownVoiceSessions?: () => Promise<void> },
  signals: ProcessSignalSource,
  timeoutMs: number,
): () => void {
  let shuttingDown = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    signals.removeListener("SIGTERM", shutdown);
    signals.removeListener("SIGINT", shutdown);
    if (timeout) clearTimeout(timeout);
  };
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    signals.exitCode = 0;
    signals.removeListener("SIGTERM", shutdown);
    signals.removeListener("SIGINT", shutdown);
    timeout = setTimeout(() => {
      signals.exitCode = 1;
      server.closeAllConnections();
    }, timeoutMs);
    timeout.unref();
    server.close((error) => {
      if (error) signals.exitCode = 1;
      Promise.resolve(server.shutdownVoiceSessions?.()).catch(() => { signals.exitCode = 1; }).finally(cleanup);
    });
    server.closeIdleConnections();
  };

  signals.once("SIGTERM", shutdown);
  signals.once("SIGINT", shutdown);
  return cleanup;
}

export async function startGatewayProcess(
  environment: NodeJS.ProcessEnv = process.env,
  options: GatewayProcessOptions = {},
): Promise<Server> {
  const config = parseGatewayConfig(environment);
  const server = await createProductionGateway(config, options);
  try { await listen(server, config.port, config.host); } catch (error) { await server.shutdownVoiceSessions(); throw error; }
  installGracefulShutdown(server, options.signals ?? process, config.shutdownTimeoutMs);
  return server;
}
