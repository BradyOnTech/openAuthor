import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
} from "jose";

import type {
  PrincipalVerifier,
  ProjectDeviceAuthorizer,
  SessionAuthorizationRequest,
  SessionPrincipal,
} from "./types.ts";

export interface SupabaseJwksPrincipalVerifierOptions {
  issuer: string;
  jwksUrl?: string;
  audience?: string;
  tenantClaim?: string;
  deviceClaim?: string;
  requiredRole?: string;
  algorithms?: readonly ("RS256" | "ES256")[];
  maxTokenBytes?: number;
  jwksTimeoutMs?: number;
  jwksCooldownMs?: number;
  jwksCacheMaxAgeMs?: number;
}

const CLAIM_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function requiredClaimName(value: string | undefined, fallback: string): string {
  const name = value ?? fallback;
  if (!CLAIM_NAME_PATTERN.test(name)) {
    throw new Error("Supabase JWT claim names must be simple identifiers.");
  }
  return name;
}

function requiredPositiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return resolved;
}

function validatedUrl(value: string, name: string, allowLoopbackHttp = false): URL {
  const url = new URL(value);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(allowLoopbackHttp && url.protocol === "http:" && loopback)) {
    throw new Error(`${name} must use HTTPS.`);
  }
  if (url.username || url.password || url.hash || url.search) {
    throw new Error(`${name} must not contain credentials, a query, or a fragment.`);
  }
  return url;
}

function bearerToken(header: string | undefined, maxTokenBytes: number): string | null {
  if (header === undefined || Buffer.byteLength(header, "utf8") > maxTokenBytes + 7) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header);
  return match?.[1] ?? null;
}

export class SupabaseJwksPrincipalVerifier implements PrincipalVerifier {
  readonly #issuer: string;
  readonly #audience: string;
  readonly #tenantClaim: string;
  readonly #deviceClaim: string;
  readonly #requiredRole: string;
  readonly #algorithms: readonly ("RS256" | "ES256")[];
  readonly #maxTokenBytes: number;
  readonly #jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(options: SupabaseJwksPrincipalVerifierOptions) {
    const issuerUrl = validatedUrl(options.issuer.replace(/\/$/, ""), "Supabase issuer");
    this.#issuer = issuerUrl.toString().replace(/\/$/, "");
    this.#audience = options.audience ?? "authenticated";
    // The verified issuer is the natural tenant boundary for one Supabase
    // project. Deployments may override this with a signed custom claim.
    this.#tenantClaim = requiredClaimName(options.tenantClaim, "iss");
    this.#deviceClaim = requiredClaimName(options.deviceClaim, "device_id");
    this.#requiredRole = options.requiredRole ?? "authenticated";
    this.#algorithms = Object.freeze([...(options.algorithms ?? ["RS256", "ES256"])]);
    if (this.#algorithms.length < 1) throw new Error("At least one JWT algorithm is required.");
    this.#maxTokenBytes = requiredPositiveInteger(options.maxTokenBytes, 16_384, "maxTokenBytes");
    const jwksUrl = validatedUrl(
      options.jwksUrl ?? `${this.#issuer}/.well-known/jwks.json`,
      "Supabase JWKS URL",
      true,
    );
    this.#jwks = createRemoteJWKSet(jwksUrl, {
      timeoutDuration: requiredPositiveInteger(options.jwksTimeoutMs, 5_000, "jwksTimeoutMs"),
      cooldownDuration: requiredPositiveInteger(options.jwksCooldownMs, 30_000, "jwksCooldownMs"),
      cacheMaxAge: requiredPositiveInteger(options.jwksCacheMaxAgeMs, 600_000, "jwksCacheMaxAgeMs"),
    });
  }

  async verify(authorizationHeader: string | undefined): Promise<SessionPrincipal | null> {
    const token = bearerToken(authorizationHeader, this.#maxTokenBytes);
    if (token === null) return null;
    try {
      const { payload } = await jwtVerify(token, this.#jwks, {
        issuer: this.#issuer,
        audience: this.#audience,
        algorithms: [...this.#algorithms],
        requiredClaims: [
          "sub",
          "iat",
          "exp",
          "role",
          this.#tenantClaim,
          this.#deviceClaim,
        ],
      });
      const subject = payload.sub;
      const tenantId = payload[this.#tenantClaim];
      const deviceId = payload[this.#deviceClaim];
      if (
        typeof subject !== "string" || subject.length < 1 || subject.length > 128 ||
        typeof tenantId !== "string" || tenantId.length < 1 || tenantId.length > 128 ||
        typeof deviceId !== "string" || deviceId.length < 1 || deviceId.length > 128 ||
        payload.role !== this.#requiredRole
      ) {
        return null;
      }
      return { subject, tenantId, deviceId, bearerToken: token };
    } catch (error) {
      if (error instanceof joseErrors.JOSEError) return null;
      throw new Error("Supabase JWKS verification is unavailable.");
    }
  }
}

export interface SupabaseRpcProjectDeviceAuthorizerOptions {
  supabaseUrl: string;
  publishableKey: string;
  rpcName?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export class SupabaseAuthorizationError extends Error {
  readonly statusCode?: number;

  constructor(statusCode?: number) {
    super("Supabase project/device authorization is unavailable.");
    this.name = "SupabaseAuthorizationError";
    if (statusCode !== undefined) this.statusCode = statusCode;
  }
}

export class SupabaseRpcProjectDeviceAuthorizer implements ProjectDeviceAuthorizer {
  readonly #rpcUrl: string;
  readonly #publishableKey: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;

  constructor(options: SupabaseRpcProjectDeviceAuthorizerOptions) {
    const baseUrl = validatedUrl(options.supabaseUrl.replace(/\/$/, ""), "Supabase URL");
    const rpcName = options.rpcName ?? "authorize_realtime_session";
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(rpcName)) {
      throw new Error("Supabase RPC name is invalid.");
    }
    if (options.publishableKey.length < 1 || options.publishableKey.length > 16_384) {
      throw new Error("A bounded Supabase publishable key is required.");
    }
    this.#rpcUrl = new URL(`/rest/v1/rpc/${rpcName}`, baseUrl).toString();
    this.#publishableKey = options.publishableKey;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = requiredPositiveInteger(options.timeoutMs, 5_000, "timeoutMs");
    this.#maxResponseBytes = requiredPositiveInteger(
      options.maxResponseBytes,
      1_024,
      "maxResponseBytes",
    );
  }

  async authorize(request: SessionAuthorizationRequest): Promise<boolean> {
    if (request.principal.deviceId !== request.deviceId) return false;
    let response: Response;
    try {
      response = await this.#fetch(this.#rpcUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          apikey: this.#publishableKey,
          authorization: `Bearer ${request.principal.bearerToken}`,
          "cache-control": "no-store",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          p_project_id: request.projectId,
          p_device_id: request.deviceId,
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new SupabaseAuthorizationError();
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      return false;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new SupabaseAuthorizationError(response.status);
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > this.#maxResponseBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new SupabaseAuthorizationError(response.status);
    }
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > this.#maxResponseBytes) {
            await reader.cancel().catch(() => undefined);
            throw new SupabaseAuthorizationError(response.status);
          }
          chunks.push(value);
        }
      }
    } catch (error) {
      if (error instanceof SupabaseAuthorizationError) throw error;
      throw new SupabaseAuthorizationError(response.status);
    }
    const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
    try {
      return JSON.parse(text) === true;
    } catch {
      throw new SupabaseAuthorizationError(response.status);
    }
  }
}
