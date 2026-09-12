import type { Server } from "node:http";

import { parseGatewayConfig, type GatewayConfig } from "./config.ts";
import { OpenAIRealtimeUpstream } from "./openAIRealtimeUpstream.ts";
import { FixedWindowSessionRateLimiter } from "./rateLimiter.ts";
import { createSessionGateway } from "./sessionGateway.ts";
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

export function createProductionGateway(
  config: GatewayConfig,
  outputs: {
    auditOutput?: TextOutput;
    diagnosticOutput?: TextOutput;
  } = {},
): Server {
  const auditOutput = outputs.auditOutput ?? process.stdout;
  const diagnosticOutput = outputs.diagnosticOutput ?? process.stderr;
  return createSessionGateway({
    dependencies: {
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
      rateLimiter: new FixedWindowSessionRateLimiter(config.rateLimit),
      upstream: new OpenAIRealtimeUpstream({
        apiKey: config.openAI.apiKey,
        timeoutMs: config.openAI.timeoutMs,
        maxResponseBytes: config.openAI.maxResponseBytes,
      }),
      auditSink: createJsonLineAuditSink(auditOutput),
      diagnosticSink: createJsonLineDiagnosticSink(diagnosticOutput),
      clock: { now: () => new Date() },
    },
    policy: config.policy,
  });
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
  server: Server,
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
      cleanup();
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
  const server = createProductionGateway(config, options);
  await listen(server, config.port, config.host);
  installGracefulShutdown(server, options.signals ?? process, config.shutdownTimeoutMs);
  return server;
}
