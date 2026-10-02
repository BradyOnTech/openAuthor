import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";

import {
  SupabaseJwksPrincipalVerifier,
  SupabaseRpcProjectDeviceAuthorizer,
} from "../src/supabaseAdapters.ts";

const ISSUER = "https://fiction-project.supabase.co/auth/v1";

test("verifies a device-bound Supabase access token through JWKS", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const jwksServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys: [{ ...jwk, alg: "RS256", kid: "key-1", use: "sig" }] }));
  });
  jwksServer.listen(0, "127.0.0.1");
  await once(jwksServer, "listening");
  const address = jwksServer.address() as AddressInfo;

  try {
    const token = await new SignJWT({
      role: "authenticated",
      device_id: "device-mara-phone",
      session_id: "10000000-0000-4000-8000-000000000001",
    })
      .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "JWT" })
      .setIssuer(ISSUER)
      .setAudience("authenticated")
      .setSubject("author-mara")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const verifier = new SupabaseJwksPrincipalVerifier({
      issuer: ISSUER,
      jwksUrl: `http://127.0.0.1:${address.port}/auth/v1/.well-known/jwks.json`,
      audience: "authenticated",
      deviceClaim: "device_id",
    });

    const principal = await verifier.verify(`Bearer ${token}`);

    assert.deepEqual(principal, {
      subject: "author-mara",
      tenantId: ISSUER,
      deviceId: "device-mara-phone",
      bearerToken: token,
      sessionId: "10000000-0000-4000-8000-000000000001",
      expiresAt: decodeJwt(token).exp! * 1000,
    });

    const unboundToken = await new SignJWT({
      role: "authenticated",
    })
      .setProtectedHeader({ alg: "RS256", kid: "key-1", typ: "JWT" })
      .setIssuer(ISSUER)
      .setAudience("authenticated")
      .setSubject("author-mara")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    assert.equal(await verifier.verify(`Bearer ${unboundToken}`), null);
    assert.equal(await verifier.verify("bearer malformed-token"), null);
  } finally {
    jwksServer.close();
    await once(jwksServer, "close");
  }
});

test("fails closed before RPC for a different device and hides hosted failures", async () => {
  let fetchCount = 0;
  const principal = {
    subject: "author-mara",
    tenantId: "tenant-fiction",
    deviceId: "device-mara-phone",
    bearerToken: "verified-user-jwt-private",
  };
  const mismatched = new SupabaseRpcProjectDeviceAuthorizer({
    supabaseUrl: "https://fiction-project.supabase.co",
    publishableKey: "sb_publishable_fiction",
    fetchImpl: async () => {
      fetchCount += 1;
      return Response.json(true);
    },
  });
  assert.equal(await mismatched.authorize({
    principal,
    projectId: "project-glass-harbor",
    deviceId: "device-other",
  }), false);
  assert.equal(fetchCount, 0);

  const failing = new SupabaseRpcProjectDeviceAuthorizer({
    supabaseUrl: "https://fiction-project.supabase.co",
    publishableKey: "sb_publishable_fiction",
    fetchImpl: async () => new Response("private database error", { status: 500 }),
  });
  await assert.rejects(
    failing.authorize({
      principal,
      projectId: "project-glass-harbor",
      deviceId: "device-mara-phone",
    }),
    (error: unknown) => {
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error as object));
      assert.equal(serialized.includes("private database error"), false);
      assert.equal(serialized.includes(principal.bearerToken), false);
      return true;
    },
  );
});

test("authorizes a JWT-bound device through the hosted Supabase RPC", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return Response.json(true);
  };
  const authorizer = new SupabaseRpcProjectDeviceAuthorizer({
    supabaseUrl: "https://fiction-project.supabase.co",
    publishableKey: "sb_publishable_fiction",
    rpcName: "authorize_realtime_session",
    fetchImpl,
  });

  const authorized = await authorizer.authorize({
    principal: {
      subject: "author-mara",
      tenantId: "tenant-fiction",
      deviceId: "device-mara-phone",
      bearerToken: "verified-user-jwt",
    },
    projectId: "project-glass-harbor",
    deviceId: "device-mara-phone",
  });

  assert.equal(authorized, true);
  assert.equal(
    capturedUrl,
    "https://fiction-project.supabase.co/rest/v1/rpc/authorize_realtime_session",
  );
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get("authorization"), "Bearer verified-user-jwt");
  assert.equal(headers.get("apikey"), "sb_publishable_fiction");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
    p_project_id: "project-glass-harbor",
    p_device_id: "device-mara-phone",
  });
});
