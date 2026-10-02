import assert from "node:assert/strict";
import test from "node:test";

import { OpenAIRealtimeUpstream } from "../src/openAIRealtimeUpstream.ts";
import type { RealtimeCallRequest } from "../src/types.ts";

const REQUEST: RealtimeCallRequest = {
  requestId: "request-123",
  sdp: "v=0\r\ns=offer\r\n",
  session: {
    type: "realtime",
    model: "gpt-realtime",
    instructions: "Be concise.",
    output_modalities: ["audio"],
    audio: {
      input: {
        transcription: { model: "gpt-4o-mini-transcribe" },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "low",
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { voice: "marin" },
    },
    tools: [],
    tool_choice: "none",
    safety_identifier: "safe_user_hash",
  },
};

test("posts multipart SDP and server session policy to the Realtime calls endpoint", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response("v=0\r\ns=answer\r\n", {
      status: 201,
      headers: {
        location: "https://api.openai.com/v1/realtime/calls/call_abc123",
        "x-request-id": "openai-request-1",
      },
    });
  };
  const upstream = new OpenAIRealtimeUpstream({
    apiKey: "sk-test-server-key",
    fetchImpl,
  });

  const result = await upstream.createCall(REQUEST);

  assert.equal(capturedUrl, "https://api.openai.com/v1/realtime/calls");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(new Headers(capturedInit?.headers).get("authorization"), "Bearer sk-test-server-key");
  assert.equal(new Headers(capturedInit?.headers).get("x-client-request-id"), "request-123");
  const form = capturedInit?.body as FormData;
  assert.equal(await (form.get("sdp") as File).text(), REQUEST.sdp);
  assert.deepEqual(JSON.parse(await (form.get("session") as File).text()), REQUEST.session);
  assert.deepEqual(result, {
    sdp: "v=0\r\ns=answer\r\n",
    callId: "call_abc123",
    upstreamRequestId: "openai-request-1",
  });
  assert.equal(JSON.stringify(result).includes("sk-test-server-key"), false);
  assert.equal(JSON.stringify(result).includes("Be concise."), false);
});

test("maps upstream failures to safe metadata without response bodies or API keys", async () => {
  const permanentKey = "sk-permanent-never-return";
  const fetchImpl: typeof fetch = async () => new Response(
    `raw provider error containing ${permanentKey}`,
    { status: 429, headers: { "x-request-id": "openai-request-2" } },
  );
  const upstream = new OpenAIRealtimeUpstream({ apiKey: permanentKey, fetchImpl });

  await assert.rejects(
    upstream.createCall(REQUEST),
    (error: unknown) => {
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error as object));
      assert.equal(serialized.includes(permanentKey), false);
      assert.equal(serialized.includes("raw provider error"), false);
      assert.match(serialized, /openai-request-2/);
      return true;
    },
  );
});

test("cancels and rejects an oversized upstream SDP answer", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("v=0\r\ns=answer-too-large\r\n"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const upstream = new OpenAIRealtimeUpstream({
    apiKey: "sk-server-only",
    maxResponseBytes: 8,
    fetchImpl: async () => new Response(stream, {
      status: 201,
      headers: { "x-request-id": "openai-oversized-1" },
    }),
  });

  await assert.rejects(upstream.createCall(REQUEST), /call creation failed/);
  assert.equal(cancelled, true);
});

test("replaces network exceptions without leaking the API key or transport details", async () => {
  const permanentKey = "sk-network-private";
  const upstream = new OpenAIRealtimeUpstream({
    apiKey: permanentKey,
    fetchImpl: async () => {
      throw new Error(`socket failed while using ${permanentKey}`);
    },
  });

  await assert.rejects(
    upstream.createCall(REQUEST),
    (error: unknown) => {
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error as object));
      assert.equal(serialized.includes(permanentKey), false);
      assert.equal(serialized.includes("socket failed"), false);
      assert.match(serialized, /call creation failed/);
      return true;
    },
  );
});

test("hangs up a validated gateway-created call on the same trusted origin", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const upstream = new OpenAIRealtimeUpstream({
    apiKey: "sk-control-private",
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(null, { status: 200 });
    },
  });
  await upstream.hangupCall("rtc_control123");
  assert.equal(requests[0]?.url, "https://api.openai.com/v1/realtime/calls/rtc_control123/hangup");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.equal(new Headers(requests[0]?.init?.headers).get("authorization"), "Bearer sk-control-private");
  assert.equal(requests[0]?.init?.redirect, "error");
  for (const invalid of ["", "../calls/rtc_other", "rtc_123?key=secret", "https://other.example/call", "a".repeat(129)]) {
    await assert.rejects(upstream.hangupCall(invalid));
  }
  assert.equal(requests.length, 1);
});

test("refuses unsafe or missing call Locations and terminates a known call after malformed SDP", async () => {
  for (const location of [null, "https://attacker.example/v1/realtime/calls/rtc_x", "/v1/realtime/calls/rtc_x?query=1", "/v1/realtime/calls/../rtc_x", "/v1/realtime/calls/rtc_x/extra"]) {
    const upstream = new OpenAIRealtimeUpstream({
      apiKey: "sk-server-only",
      fetchImpl: async () => new Response("v=0\r\ns=answer\r\n", { status: 201, headers: location ? { location } : {} }),
    });
    await assert.rejects(upstream.createCall(REQUEST), /call creation failed/);
  }
  const requests: string[] = [];
  const upstream = new OpenAIRealtimeUpstream({
    apiKey: "sk-server-only",
    fetchImpl: async input => {
      requests.push(String(input));
      return requests.length === 1
        ? new Response("invalid-answer", { status: 201, headers: { location: "/v1/realtime/calls/rtc_known" } })
        : new Response(null, { status: 200 });
    },
  });
  await assert.rejects(upstream.createCall(REQUEST), /call creation failed/);
  assert.equal(requests[1], "https://api.openai.com/v1/realtime/calls/rtc_known/hangup");
});

test("never treats failed hangup as confirmed termination or follows a redirect", async () => {
  const upstream = new OpenAIRealtimeUpstream({
    apiKey: "sk-hangup-private",
    fetchImpl: async () => new Response("provider-secret-details", { status: 404 }),
  });
  await assert.rejects(upstream.hangupCall("rtc_still_unknown"), error => {
    assert.equal(String(error).includes("provider-secret-details"), false);
    assert.equal(String(error).includes("sk-hangup-private"), false);
    return true;
  });
});
