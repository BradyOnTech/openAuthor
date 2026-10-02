import { MOBILE_REALTIME_TOOL_NAMES, MOBILE_REALTIME_TOOLS } from "./mobilePolicy.ts";
import type { GatewayPolicy } from "./types.ts";
import { isAbsolute } from "node:path";
import { trustedVoiceToken } from "./sharedVoiceControl.ts";

export interface GatewayConfig {
  host: string;
  port: number;
  shutdownTimeoutMs: number;
  supabase: {
    url: string;
    issuer: string;
    audience: string;
    tenantClaim: string;
    deviceClaim: string;
    authorizationRpc: string;
    publishableKey: string;
    jwksTimeoutMs: number;
    jwksCacheMaxAgeMs: number;
    authorizationTimeoutMs: number;
  };
  openAI: {
    apiKey: string;
    projectId?: string;
    organizationId?: string;
    timeoutMs: number;
    maxResponseBytes: number;
  };
  rateLimit: {
    limit: number;
    windowMs: number;
  };
  leases: {
    journalPath: string;
    leaseTtlMs: number;
    maxDurationMs: number;
    pollIntervalMs: number;
    authorizationTimeoutMs: number;
    maxCalls: number;
  };
  policy: GatewayPolicy;
  voiceControl: { mode: "independent" | "legacy-recovery"; token?: string };
}

const DEFAULT_INSTRUCTIONS =
  "Use only the supplied tools and authorized project context. Read from the local snapshot and queue every proposed change for desktop review.";
const CLAIM_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const RPC_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
const POLICY_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function boundedInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = environment[name]?.trim();
  const resolved = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
}

function commaSeparated(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function secureUrl(value: string, name: string, originOnly = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL.`);
  }
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || (originOnly && url.pathname !== "/")
  ) {
    throw new Error(
      `${name} must use HTTPS without credentials, query, fragment${originOnly ? ", or path" : ""}.`,
    );
  }
  return originOnly ? url.origin : url.toString().replace(/\/$/, "");
}

function identifier(value: string, name: string, pattern: RegExp): string {
  if (!pattern.test(value)) throw new Error(`${name} is invalid.`);
  return value;
}

function policyIdentifier(value: string, name: string): string {
  if (!POLICY_IDENTIFIER_PATTERN.test(value)) throw new Error(`${name} is invalid.`);
  return value;
}

function allowedOrigins(environment: NodeJS.ProcessEnv): string[] {
  const values = commaSeparated(environment.GATEWAY_ALLOWED_ORIGINS).map((value) =>
    secureUrl(value, "GATEWAY_ALLOWED_ORIGINS origin", true)
  );
  if (new Set(values).size !== values.length) {
    throw new Error("GATEWAY_ALLOWED_ORIGINS must not contain duplicates.");
  }
  return values;
}

function toolNames(environment: NodeJS.ProcessEnv): string[] {
  const values = environment.REALTIME_ALLOWED_TOOL_NAMES === undefined
    ? [...MOBILE_REALTIME_TOOL_NAMES]
    : commaSeparated(environment.REALTIME_ALLOWED_TOOL_NAMES);
  if (new Set(values).size !== values.length) {
    throw new Error("REALTIME_ALLOWED_TOOL_NAMES must not contain duplicates.");
  }
  const available = new Set<string>(MOBILE_REALTIME_TOOL_NAMES);
  for (const value of values) {
    if (!available.has(value)) {
      throw new Error(`REALTIME_ALLOWED_TOOL_NAMES contains unknown mobile tool '${value}'.`);
    }
  }
  return values;
}

function semanticVadEagerness(value: string | undefined): GatewayPolicy["semanticVadEagerness"] {
  const resolved = value?.trim() || "low";
  if (resolved !== "low" && resolved !== "medium" && resolved !== "high" && resolved !== "auto") {
    throw new Error("REALTIME_VAD_EAGERNESS must be low, medium, high, or auto.");
  }
  return resolved;
}

function boundedText(value: string, name: string, maximum: number): string {
  if (value.length < 1 || value.length > maximum) {
    throw new Error(`${name} is empty or exceeds ${maximum} characters.`);
  }
  return value;
}

export function parseGatewayConfig(environment: NodeJS.ProcessEnv): GatewayConfig {
  const journalPath = required(environment, "GATEWAY_CALL_JOURNAL_PATH");
  if (!isAbsolute(journalPath)) throw new Error("GATEWAY_CALL_JOURNAL_PATH must be absolute.");
  const leaseTtlMs = boundedInteger(environment, "GATEWAY_SESSION_LEASE_MS", 30000, 1000, 120000);
  const maxDurationMs = boundedInteger(environment, "GATEWAY_SESSION_MAX_DURATION_MS", 600000, 1000, 3600000);
  const pollIntervalMs = boundedInteger(environment, "GATEWAY_SESSION_POLL_MS", 5000, 100, 30000);
  if (leaseTtlMs > maxDurationMs || pollIntervalMs >= leaseTtlMs) throw new Error("Gateway session lease bounds are inconsistent.");
  const supabaseUrl = secureUrl(required(environment, "SUPABASE_URL"), "SUPABASE_URL", true);
  const openAIApiKey = boundedText(required(environment, "OPENAI_API_KEY"), "OPENAI_API_KEY", 16_384);
  const mode = environment.GATEWAY_VOICE_CONTROL_MODE?.trim() || "independent";
  if (mode !== "independent" && mode !== "legacy-recovery") throw new Error("GATEWAY_VOICE_CONTROL_MODE must be independent or legacy-recovery.");
  const projectId = environment.OPENAI_PROJECT_ID?.trim();
  const organizationId = environment.OPENAI_ORGANIZATION_ID?.trim();
  if (mode === "independent" && !projectId) throw new Error("OPENAI_PROJECT_ID is required for independent control.");
  for (const [name, value] of [["OPENAI_PROJECT_ID", projectId], ["OPENAI_ORGANIZATION_ID", organizationId]]) {
    if (value && !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`${name} is invalid.`);
  }
  const controlToken = mode === "independent" ? trustedVoiceToken(required(environment, "SUPABASE_VOICE_GATEWAY_TOKEN"), "mobile_voice_gateway") : undefined;
  const safetyIdentifierSecret = boundedText(
    required(environment, "SAFETY_IDENTIFIER_SECRET"),
    "SAFETY_IDENTIFIER_SECRET",
    4_096,
  );
  if (Buffer.byteLength(safetyIdentifierSecret, "utf8") < 32) {
    throw new Error("SAFETY_IDENTIFIER_SECRET must contain at least 32 UTF-8 bytes.");
  }
  if (safetyIdentifierSecret === openAIApiKey) {
    throw new Error("SAFETY_IDENTIFIER_SECRET must not reuse OPENAI_API_KEY.");
  }
  const maxRequestBytes = boundedInteger(
    environment,
    "GATEWAY_MAX_REQUEST_BYTES",
    64 * 1_024,
    1_024,
    1_048_576,
  );
  const maxSdpBytes = boundedInteger(
    environment,
    "GATEWAY_MAX_SDP_BYTES",
    48 * 1_024,
    1_024,
    262_144,
  );
  if (maxSdpBytes > maxRequestBytes) {
    throw new Error("GATEWAY_MAX_SDP_BYTES must not exceed GATEWAY_MAX_REQUEST_BYTES.");
  }
  const host = environment.HOST?.trim() || "0.0.0.0";
  if (!/^[A-Za-z0-9.:[\]-]{1,253}$/.test(host)) throw new Error("HOST is invalid.");

  return {
    host,
    port: boundedInteger(environment, "PORT", 8_080, 0, 65_535),
    shutdownTimeoutMs: boundedInteger(
      environment,
      "GATEWAY_SHUTDOWN_TIMEOUT_MS",
      10_000,
      100,
      120_000,
    ),
    supabase: {
      url: supabaseUrl,
      issuer: secureUrl(
        environment.SUPABASE_ISSUER?.trim() || `${supabaseUrl}/auth/v1`,
        "SUPABASE_ISSUER",
      ),
      audience: boundedText(
        environment.SUPABASE_AUDIENCE?.trim() || "authenticated",
        "SUPABASE_AUDIENCE",
        256,
      ),
      tenantClaim: identifier(
        environment.SUPABASE_TENANT_CLAIM?.trim() || "iss",
        "SUPABASE_TENANT_CLAIM",
        CLAIM_PATTERN,
      ),
      deviceClaim: identifier(
        environment.SUPABASE_DEVICE_CLAIM?.trim() || "device_id",
        "SUPABASE_DEVICE_CLAIM",
        CLAIM_PATTERN,
      ),
      authorizationRpc: identifier(
        environment.SUPABASE_AUTHORIZATION_RPC?.trim() || "authorize_realtime_session",
        "SUPABASE_AUTHORIZATION_RPC",
        RPC_PATTERN,
      ),
      publishableKey: boundedText(
        required(environment, "SUPABASE_PUBLISHABLE_KEY"),
        "SUPABASE_PUBLISHABLE_KEY",
        16_384,
      ),
      jwksTimeoutMs: boundedInteger(
        environment,
        "GATEWAY_JWKS_TIMEOUT_MS",
        5_000,
        100,
        60_000,
      ),
      jwksCacheMaxAgeMs: boundedInteger(
        environment,
        "GATEWAY_JWKS_CACHE_MAX_AGE_MS",
        600_000,
        1_000,
        86_400_000,
      ),
      authorizationTimeoutMs: boundedInteger(
        environment,
        "GATEWAY_SUPABASE_TIMEOUT_MS",
        5_000,
        100,
        60_000,
      ),
    },
    openAI: {
      apiKey: openAIApiKey,
      ...(projectId ? { projectId } : {}), ...(organizationId ? { organizationId } : {}),
      timeoutMs: boundedInteger(
        environment,
        "GATEWAY_OPENAI_TIMEOUT_MS",
        10_000,
        100,
        60_000,
      ),
      maxResponseBytes: boundedInteger(
        environment,
        "GATEWAY_OPENAI_MAX_RESPONSE_BYTES",
        256 * 1_024,
        1_024,
        1_048_576,
      ),
    },
    rateLimit: {
      limit: boundedInteger(environment, "GATEWAY_RATE_LIMIT", 5, 1, 1_000),
      windowMs: boundedInteger(
        environment,
        "GATEWAY_RATE_WINDOW_MS",
        60_000,
        1_000,
        86_400_000,
      ),
    },
    leases: {
      journalPath, leaseTtlMs, maxDurationMs, pollIntervalMs,
      authorizationTimeoutMs: boundedInteger(environment, "GATEWAY_SESSION_CONTROL_TIMEOUT_MS", 5000, 100, 60000),
      maxCalls: boundedInteger(environment, "GATEWAY_SESSION_MAX_CALLS", 500, 1, 1000),
    },
    policy: {
      allowedOrigins: allowedOrigins(environment),
      maxRequestBytes,
      maxSdpBytes,
      requestBodyTimeoutMs: boundedInteger(
        environment,
        "GATEWAY_REQUEST_BODY_TIMEOUT_MS",
        5_000,
        100,
        60_000,
      ),
      model: policyIdentifier(
        environment.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime",
        "OPENAI_REALTIME_MODEL",
      ),
      voice: policyIdentifier(
        environment.OPENAI_REALTIME_VOICE?.trim() || "marin",
        "OPENAI_REALTIME_VOICE",
      ),
      transcriptionModel: policyIdentifier(
        environment.OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-mini-transcribe",
        "OPENAI_TRANSCRIPTION_MODEL",
      ),
      semanticVadEagerness: semanticVadEagerness(environment.REALTIME_VAD_EAGERNESS),
      instructions: boundedText(
        environment.OPENAI_REALTIME_INSTRUCTIONS?.trim() || DEFAULT_INSTRUCTIONS,
        "OPENAI_REALTIME_INSTRUCTIONS",
        32_768,
      ),
      tools: MOBILE_REALTIME_TOOLS.map((tool) => structuredClone(tool)),
      allowedToolNames: toolNames(environment),
      issuanceTtlSeconds: boundedInteger(
        environment,
        "GATEWAY_ISSUANCE_TTL_SECONDS",
        60,
        10,
        300,
      ),
      safetyIdentifierSecret,
    },
    voiceControl: { mode, ...(controlToken ? { token: controlToken } : {}) },
  };
}
