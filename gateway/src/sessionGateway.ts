import { createHmac, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import type {
  AuditEvent,
  AuditOutcome,
  GatewayDependencies,
  GatewayPolicy,
  SessionPrincipal,
} from "./types.ts";

export interface SessionGatewayOptions {
  dependencies: GatewayDependencies;
  policy: GatewayPolicy;
}

interface MobileSessionRequest {
  projectId: string;
  deviceId: string;
  sdp: string;
}

class RequestProblem extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly outcome: AuditOutcome;

  constructor(statusCode: number, code: string, message: string, outcome: AuditOutcome) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.outcome = outcome;
  }
}

function opaqueHash(secret: string, namespace: string, value: string): string {
  return createHmac("sha256", secret).update(`${namespace}\0${value}`).digest("base64url");
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function validateGatewayPolicy(policy: GatewayPolicy): void {
  positiveInteger(policy.maxRequestBytes, "maxRequestBytes");
  positiveInteger(policy.maxSdpBytes, "maxSdpBytes");
  positiveInteger(policy.requestBodyTimeoutMs, "requestBodyTimeoutMs");
  positiveInteger(policy.issuanceTtlSeconds, "issuanceTtlSeconds");
  if (policy.maxSdpBytes > policy.maxRequestBytes) {
    throw new Error("maxSdpBytes must not exceed maxRequestBytes.");
  }
  for (const [name, value, maximum] of [
    ["model", policy.model, 128],
    ["voice", policy.voice, 64],
    ["transcriptionModel", policy.transcriptionModel, 128],
    ["instructions", policy.instructions, 32_768],
    ["safetyIdentifierSecret", policy.safetyIdentifierSecret, 4_096],
  ] as const) {
    if (value.length < 1 || value.length > maximum) {
      throw new Error(`${name} is empty or exceeds its configured bound.`);
    }
  }
  if (policy.tools.length > 32 || policy.allowedToolNames.length > 32) {
    throw new Error("Realtime tool policy exceeds the maximum of 32 tools.");
  }
  const names = new Set<string>();
  for (const tool of policy.tools) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name) || names.has(tool.name)) {
      throw new Error("Realtime tool names must be unique safe identifiers.");
    }
    names.add(tool.name);
  }
  const allowed = new Set(policy.allowedToolNames);
  if (allowed.size !== policy.allowedToolNames.length) {
    throw new Error("Realtime tool allowlist contains duplicates.");
  }
  for (const name of allowed) {
    if (!names.has(name)) throw new Error("Realtime tool allowlist references an undefined tool.");
  }
}

async function readMobileSessionRequest(
  request: IncomingMessage,
  maxRequestBytes: number,
  maxSdpBytes: number,
  requestBodyTimeoutMs: number,
): Promise<MobileSessionRequest> {
  const contentLength = Number(request.headers["content-length"] ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    request.resume();
    throw new RequestProblem(413, "request_too_large", "Request body is too large.", "request_too_large");
  }

  const readBody = async (): Promise<Buffer[]> => {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxRequestBytes) {
        request.resume();
        throw new RequestProblem(413, "request_too_large", "Request body is too large.", "request_too_large");
      }
      chunks.push(bytes);
    }
    return chunks;
  };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutBody = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      request.pause();
      reject(new RequestProblem(
        408,
        "request_timeout",
        "Request body was not received in time.",
        "request_timeout",
      ));
    }, requestBodyTimeoutMs);
  });
  let chunks: Buffer[];
  try {
    chunks = await Promise.race([readBody(), timeoutBody]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestProblem(400, "invalid_request", "Request body must be valid JSON.", "invalid_request");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestProblem(400, "invalid_request", "Request body must be an object.", "invalid_request");
  }

  const record = body as Record<string, unknown>;
  const projectId = record.project_id;
  const deviceId = record.device_id;
  const sdp = record.sdp;
  if (
    typeof projectId !== "string" || projectId.length < 1 || projectId.length > 128 ||
    typeof deviceId !== "string" || deviceId.length < 1 || deviceId.length > 128 ||
    typeof sdp !== "string" || sdp.length < 1
  ) {
    throw new RequestProblem(
      400,
      "invalid_request",
      "project_id, device_id, and sdp are required.",
      "invalid_request",
    );
  }
  if (Buffer.byteLength(sdp, "utf8") > maxSdpBytes) {
    throw new RequestProblem(
      413,
      "request_too_large",
      "Request body is too large.",
      "request_too_large",
    );
  }
  return { projectId, deviceId, sdp };
}

function auditIdentity(
  policy: GatewayPolicy,
  principal: SessionPrincipal,
  input: MobileSessionRequest,
): Pick<AuditEvent, "principalHash" | "projectHash" | "deviceHash"> {
  return {
    principalHash: opaqueHash(policy.safetyIdentifierSecret, "principal", principal.subject),
    projectHash: opaqueHash(policy.safetyIdentifierSecret, "project", input.projectId),
    deviceHash: opaqueHash(policy.safetyIdentifierSecret, "device", input.deviceId),
  };
}

function sendError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify({ error: { code, message, request_id: requestId } }));
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function writeAudit(
  dependencies: GatewayDependencies,
  event: AuditEvent,
): Promise<void> {
  try {
    await dependencies.auditSink.write(event);
  } catch {
    try {
      await dependencies.diagnosticSink?.write({
        event: "audit_write_failed",
        requestId: event.requestId,
        occurredAt: dependencies.clock.now().toISOString(),
      });
    } catch {
      // Diagnostics must never expose content or break the HTTP response path.
    }
  }
}

export function createSessionGateway(options: SessionGatewayOptions): Server {
  const dependencies = options.dependencies;
  const policy = structuredClone(options.policy);
  validateGatewayPolicy(policy);
  const allowedToolNames = new Set(policy.allowedToolNames);
  const realtimeTools = policy.tools.filter((tool) => allowedToolNames.has(tool.name));
  return createServer(async (request, response) => {
    const requestId = randomUUID();
    try {
    if (request.url === "/healthz" && request.method === "GET") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (request.url !== "/v1/realtime/sessions") {
      sendError(response, 404, "not_found", "Route not found.", requestId);
      return;
    }

    const origin = request.headers.origin;
    if (origin && !policy.allowedOrigins.includes(origin)) {
      request.resume();
      await writeAudit(dependencies, {
        event: "realtime_session_issuance",
        requestId,
        occurredAt: dependencies.clock.now().toISOString(),
        outcome: "origin_rejected",
        statusCode: 403,
      });
      sendError(response, 403, "origin_not_allowed", "Request origin is not allowed.", requestId);
      return;
    }
    if (origin) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-max-age": "600",
        "cache-control": "no-store",
      });
      response.end();
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("allow", "POST, OPTIONS");
      sendError(response, 405, "method_not_allowed", "Method not allowed.", requestId);
      return;
    }

    const principal = await dependencies.principalVerifier.verify(request.headers.authorization);
    if (!principal) {
      await writeAudit(dependencies, {
        event: "realtime_session_issuance",
        requestId,
        occurredAt: dependencies.clock.now().toISOString(),
        outcome: "unauthenticated",
        statusCode: 401,
      });
      sendError(response, 401, "unauthenticated", "Authentication is required.", requestId);
      return;
    }

    let input: MobileSessionRequest;
    try {
      input = await readMobileSessionRequest(
        request,
        policy.maxRequestBytes,
        policy.maxSdpBytes,
        policy.requestBodyTimeoutMs,
      );
    } catch (error) {
      const problem = error instanceof RequestProblem
        ? error
        : new RequestProblem(400, "invalid_request", "Request could not be read.", "invalid_request");
      await writeAudit(dependencies, {
        event: "realtime_session_issuance",
        requestId,
        occurredAt: dependencies.clock.now().toISOString(),
        outcome: problem.outcome,
        statusCode: problem.statusCode,
        principalHash: opaqueHash(policy.safetyIdentifierSecret, "principal", principal.subject),
      });
      sendError(response, problem.statusCode, problem.code, problem.message, requestId);
      return;
    }

    if (principal.deviceId !== input.deviceId) {
      await writeAudit(dependencies, {
        event: "realtime_session_issuance",
        requestId,
        occurredAt: dependencies.clock.now().toISOString(),
        outcome: "forbidden",
        statusCode: 403,
        ...auditIdentity(policy, principal, input),
      });
      sendError(response, 403, "forbidden", "This project or device is not authorized.", requestId);
      return;
    }

    const authorized = await dependencies.authorizer.authorize({
      principal,
      projectId: input.projectId,
      deviceId: input.deviceId,
    });
    if (!authorized) {
      await writeAudit(dependencies, {
        event: "realtime_session_issuance",
        requestId,
        occurredAt: dependencies.clock.now().toISOString(),
        outcome: "forbidden",
        statusCode: 403,
        ...auditIdentity(policy, principal, input),
      });
      sendError(response, 403, "forbidden", "This project or device is not authorized.", requestId);
      return;
    }

    const now = dependencies.clock.now();
    const rateLimitKey = opaqueHash(
      policy.safetyIdentifierSecret,
      "rate-limit",
      `${principal.tenantId}\0${principal.subject}`,
    );
    const rateLimit = await dependencies.rateLimiter.consume(rateLimitKey, now.getTime(), {
      principal, projectId: input.projectId, deviceId: input.deviceId,
    });
    if (!rateLimit.allowed) {
      const retryAfterSeconds = rateLimit.retryAfterSeconds ?? 1;
      await writeAudit(dependencies, {
        event: "realtime_session_issuance",
        requestId,
        occurredAt: now.toISOString(),
        outcome: "rate_limited",
        statusCode: 429,
        ...auditIdentity(policy, principal, input),
      });
      response.setHeader("retry-after", String(retryAfterSeconds));
      sendJson(response, 429, {
        error: {
          code: "rate_limited",
          message: "Too many Realtime session requests.",
          request_id: requestId,
          retry_after_seconds: retryAfterSeconds,
        },
      });
      return;
    }

    const safetyIdentifier = opaqueHash(
      policy.safetyIdentifierSecret,
      `safety:${principal.tenantId}`,
      principal.subject,
    );
    let upstreamResult;
    try {
      upstreamResult = await dependencies.upstream.createCall({
        sdp: input.sdp,
        requestId,
        session: {
          type: "realtime",
          model: policy.model,
          instructions: policy.instructions,
          output_modalities: ["audio"],
          audio: {
            input: {
              transcription: { model: policy.transcriptionModel },
              turn_detection: {
                type: "semantic_vad",
                eagerness: policy.semanticVadEagerness,
                create_response: true,
                interrupt_response: true,
              },
            },
            output: { voice: policy.voice },
          },
          tools: realtimeTools.map((tool) => ({
            ...tool,
            parameters: structuredClone(tool.parameters),
          })),
          tool_choice: realtimeTools.length > 0 ? "auto" : "none",
          safety_identifier: safetyIdentifier,
        },
      });
    } catch {
      await writeAudit(dependencies, {
        event: "realtime_session_issuance",
        requestId,
        occurredAt: now.toISOString(),
        outcome: "upstream_error",
        statusCode: 502,
        ...auditIdentity(policy, principal, input),
      });
      sendError(
        response,
        502,
        "realtime_upstream_unavailable",
        "A Realtime session could not be created.",
        requestId,
      );
      return;
    }
    await writeAudit(dependencies, {
      event: "realtime_session_issuance",
      requestId,
      occurredAt: now.toISOString(),
      outcome: "issued",
      statusCode: 201,
      ...auditIdentity(policy, principal, input),
      ...(upstreamResult.upstreamRequestId
        ? { upstreamRequestId: upstreamResult.upstreamRequestId }
        : {}),
    });
    sendJson(response, 201, {
      sdp: upstreamResult.sdp,
      ...(upstreamResult.callId ? { call_id: upstreamResult.callId } : {}),
      expires_at: new Date(now.getTime() + policy.issuanceTtlSeconds * 1_000).toISOString(),
      request_id: requestId,
    });
    } catch {
      request.resume();
      await writeAudit(dependencies, {
        event: "realtime_session_issuance",
        requestId,
        occurredAt: dependencies.clock.now().toISOString(),
        outcome: "internal_error",
        statusCode: 500,
      });
      if (!response.headersSent) {
        sendError(
          response,
          500,
          "internal_error",
          "The session request could not be completed.",
          requestId,
        );
      } else if (!response.writableEnded) {
        response.end();
      }
    }
  });
}
