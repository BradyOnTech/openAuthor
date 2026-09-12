import { describe, expect, it } from "vitest";
import { createMobileSidecarApi, type MobileSidecarRequester } from "../api";

type Call = {
  projectRoot: string;
  method: string;
  params: Record<string, unknown>;
  timeoutMs: number;
};

function harness(responses: unknown[]) {
  const calls: Call[] = [];
  const request: MobileSidecarRequester = async <T>(
    projectRoot: string,
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<T> => {
    calls.push({ projectRoot, method, params, timeoutMs });
    return responses.shift() as T;
  };
  return { calls, api: createMobileSidecarApi(request) };
}

describe("mobile sidecar API", () => {
  it("prepares plaintext snapshot bytes for desktop-side encryption", async () => {
    const prepared = {
      schema_version: 1 as const,
      media_type: "application/vnd.openauthor.mobile-snapshot+json" as const,
      manifest: {
        schema: "openauthor.mobile.snapshot.manifest" as const,
        schema_version: 1 as const,
        project_id: "project-one",
        revision: "revision-one",
        content_sha256: "a".repeat(64),
        byte_length: 42,
      },
      plaintext_base64: "e30=",
    };
    const { api, calls } = harness([prepared]);

    const result = await api.prepareSnapshot("/project", "project-one");

    expect(result.manifest.revision).toBe("revision-one");
    expect(calls).toEqual([{
      projectRoot: "/project",
      method: "mobile.snapshot.prepare",
      params: { project_id: "project-one" },
      timeoutMs: 30_000,
    }]);
    expect(JSON.stringify(calls)).not.toContain("projectKey");
  });

  it("imports decrypted outbox payloads and lists review-safe artifacts", async () => {
    const { api, calls } = harness([
      { artifact_id: "mobile-inbox-1" },
      [{ id: "mobile-inbox-1" }],
      [{ id: "mobile-review-1" }],
    ]);
    const envelope = {
      projectId: "project-one",
      deviceId: "device-one",
      operationId: "operation-one",
      baseRevision: "revision-one",
      payloadDigest: `sha256:${"b".repeat(64)}`,
    };
    const payload = { kind: "capture_note", content: "A mobile note." };

    await api.importOutboxItem("/project", { envelope, payload });
    await api.listInbox("/project");
    await api.listReviews("/project");

    expect(calls.map((call) => call.method)).toEqual([
      "mobile.outbox.import",
      "mobile.inbox.list",
      "mobile.review.list",
    ]);
    expect(calls[0].params).toEqual({
      envelope: {
        project_id: "project-one",
        device_id: "device-one",
        operation_id: "operation-one",
        base_revision: "revision-one",
        payload_digest: `sha256:${"b".repeat(64)}`,
      },
      payload,
    });
  });
});
