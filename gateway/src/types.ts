export interface SessionPrincipal {
  subject: string;
  tenantId: string;
  deviceId: string;
  /** Verified bearer token used only for the user's RLS-authorized hosted RPC. */
  bearerToken: string;
  sessionId?: string;
  expiresAt?: number;
}

export interface PrincipalVerifier {
  verify(authorizationHeader: string | undefined): Promise<SessionPrincipal | null>;
}

export interface SessionAuthorizationRequest {
  principal: SessionPrincipal;
  projectId: string;
  deviceId: string;
}

export interface ProjectDeviceAuthorizer {
  authorize(request: SessionAuthorizationRequest): Promise<boolean>;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export interface SessionRateLimiter {
  consume(key: string, nowMs: number, request: SessionAuthorizationRequest): RateLimitDecision | Promise<RateLimitDecision>;
}

export interface RealtimeTool {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface RealtimeSessionPolicy {
  type: "realtime";
  model: string;
  instructions: string;
  output_modalities: ["audio"];
  audio: {
    input: {
      transcription: { model: string };
      turn_detection: {
        type: "semantic_vad";
        eagerness: "low" | "medium" | "high" | "auto";
        create_response: true;
        interrupt_response: true;
      };
    };
    output: { voice: string };
  };
  tools: RealtimeTool[];
  tool_choice: "auto" | "none";
  safety_identifier: string;
}

export interface RealtimeCallRequest {
  sdp: string;
  session: RealtimeSessionPolicy;
  requestId: string;
  /** Durable gateway registration before the answer can be delivered. */
  onCallCreated?: (callId: string) => Promise<void>;
}

export interface RealtimeCallResult {
  sdp: string;
  callId?: string;
  upstreamRequestId?: string;
}

export interface RealtimeUpstream {
  createCall(request: RealtimeCallRequest): Promise<RealtimeCallResult>;
  hangupCall(callId: string): Promise<void>;
}

export type AuditOutcome =
  | "issued"
  | "unauthenticated"
  | "forbidden"
  | "rate_limited"
  | "invalid_request"
  | "origin_rejected"
  | "request_too_large"
  | "request_timeout"
  | "upstream_error"
  | "internal_error";

export interface AuditEvent {
  event: "realtime_session_issuance";
  requestId: string;
  occurredAt: string;
  outcome: AuditOutcome;
  statusCode: number;
  principalHash?: string;
  projectHash?: string;
  deviceHash?: string;
  upstreamRequestId?: string;
}

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
}

export interface DiagnosticEvent {
  event: "audit_write_failed";
  requestId: string;
  occurredAt: string;
}

export interface DiagnosticSink {
  write(event: DiagnosticEvent): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface GatewayDependencies {
  principalVerifier: PrincipalVerifier;
  authorizer: ProjectDeviceAuthorizer;
  rateLimiter: SessionRateLimiter;
  upstream: RealtimeUpstream;
  auditSink: AuditSink;
  diagnosticSink?: DiagnosticSink;
  clock: Clock;
}

export interface GatewayPolicy {
  allowedOrigins: string[];
  maxRequestBytes: number;
  maxSdpBytes: number;
  requestBodyTimeoutMs: number;
  model: string;
  voice: string;
  transcriptionModel: string;
  semanticVadEagerness: "low" | "medium" | "high" | "auto";
  instructions: string;
  tools: RealtimeTool[];
  allowedToolNames: string[];
  issuanceTtlSeconds: number;
  safetyIdentifierSecret: string;
}
