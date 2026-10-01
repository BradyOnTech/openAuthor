import { expect, type Page, type TestInfo } from "@playwright/test";

/** Real app/runtime/controller; test-only media and gateway boundaries. No audio
 * is captured and no OpenAI endpoint is contacted. Not an acoustic/device test. */
export async function exerciseVoiceControls(page: Page, testInfo: TestInfo) {
  let negotiations = 0;
  await page.route("https://companion-gateway.test/**", async (route) => {
    expect(new URL(route.request().url()).pathname).toBe("/v1/realtime/sessions");
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    expect(route.request().postDataJSON()).toMatchObject({ sdp: "fixture-offer" });
    negotiations++;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      sdp: "fixture-answer", call_id: `fixture-${negotiations}`, expires_at: new Date(Date.now() + 60_000).toISOString(),
    }) });
  });
  await page.evaluate(() => {
    type Track = { enabled: boolean; stopped: boolean; stop(): void };
    const probe = {
      mode: "deny", tracks: [] as Track[], sent: [] as Array<Record<string, any>>,
      contextBeforeAudio: false, permissionPending: false,
      grant: () => {}, emit: (_event: Record<string, unknown>) => {}, disconnect: () => {}, remoteAudio: () => {},
    };
    (window as any).__voiceProbe = probe;
    const stream = () => {
      const track = { enabled: true, stopped: false, stop() { this.stopped = true; this.enabled = false; } };
      probe.tracks.push(track);
      return { getTracks: () => [track] };
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      if (probe.mode === "deny") throw new DOMException("Microphone permission denied.", "NotAllowedError");
      if (probe.mode === "pending") {
        probe.permissionPending = true;
        return new Promise((resolve) => { probe.grant = () => { probe.permissionPending = false; resolve(stream()); }; });
      }
      return stream();
    } });
    class Peer {
      ontrack: null | ((event: { streams: MediaStream[] }) => void) = null;
      channel = {
        readyState: "open", onclose: null as null | (() => void), onerror: null,
        send(value: string) {
          const event = JSON.parse(value);
          probe.sent.push(event);
          if (event.item?.content?.[0]?.text?.startsWith("Story reference material")) {
            probe.contextBeforeAudio = probe.tracks.at(-1)?.enabled === false;
          }
        },
        close() { this.readyState = "closed"; },
        addEventListener(_name: string, receive: (event: { data: string }) => void) {
          probe.emit = (event) => receive({ data: JSON.stringify(event) });
        },
      };
      constructor() {
        probe.disconnect = () => { this.channel.readyState = "closed"; this.channel.onclose?.(); };
        probe.remoteAudio = () => this.ontrack?.({ streams: [new MediaStream()] });
      }
      addTrack() {}
      createDataChannel() { return this.channel; }
      async createOffer() { return { type: "offer", sdp: "fixture-offer" }; }
      async setLocalDescription() {}
      async setRemoteDescription() { probe.emit({ type: "session.created", session: { id: "fixture-session" } }); }
      close() {}
    }
    Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: Peer });
  });

  const start = page.getByRole("button", { name: "Start voice", exact: true });
  await start.click();
  await expect(page.getByRole("alert")).toHaveText("Microphone permission denied.");
  expect(negotiations).toBe(0);
  await expect(start).toBeEnabled();

  await page.evaluate(() => { (window as any).__voiceProbe.mode = "pending"; });
  await start.click();
  await expect.poll(() => page.evaluate(() => (window as any).__voiceProbe.permissionPending)).toBe(true);
  await page.getByRole("button", { name: "Cancel connection", exact: true }).click();
  await page.evaluate(() => { (window as any).__voiceProbe.grant(); });
  await expect.poll(() => page.evaluate(() => (window as any).__voiceProbe.tracks.every((track: any) => track.stopped))).toBe(true);
  expect(negotiations).toBe(0);

  await page.evaluate(() => { (window as any).__voiceProbe.mode = "grant"; });
  await start.click();
  await expect(page.getByRole("button", { name: "Mute", exact: true })).toBeVisible();
  await expect(page.getByText("Status: listening", { exact: true })).toBeInViewport();
  expect(await page.evaluate(() => (window as any).__voiceProbe.contextBeforeAudio)).toBe(true);
  const reference = await page.evaluate(() => (window as any).__voiceProbe.sent.find((event: any) => event.item?.content?.[0]?.text?.startsWith("Story reference material")).item.content[0].text);
  expect(reference).toContain("The Snow Key");
  expect(reference).toContain("Winter restraint");
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__voiceProbe.tracks.at(-1).enabled)).toBe(false);
  await page.getByRole("button", { name: "Unmute", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__voiceProbe.tracks.at(-1).enabled)).toBe(true);
  await page.getByRole("textbox", { name: "Message Copilot", exact: true }).fill("What does the brass key open?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__voiceProbe.sent.some((event: any) => event.item?.content?.[0]?.text === "What does the brass key open?"))).toBe(true);
  await page.evaluate(() => {
    (window as any).__voiceProbe.emit({ type: "response.created", response: { id: "fixture-response" } });
    (window as any).__voiceProbe.emit({ type: "response.output_audio_transcript.delta", item_id: "fixture-reply", delta: "The scene leaves that question open." });
  });
  await page.getByRole("button", { name: "Interrupt", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__voiceProbe.sent.slice(-2).map((event: any) => event.type))).toEqual(["response.cancel", "output_audio_buffer.clear"]);
  await page.evaluate(() => { (window as any).__voiceProbe.emit({ type: "response.done", response: { id: "fixture-response", status: "cancelled" } }); });
  await page.screenshot({ path: testInfo.outputPath("voice-controls-simulated.png"), fullPage: true });

  await page.evaluate(() => { (window as any).__voiceProbe.disconnect(); });
  await expect(page.getByRole("alert")).toContainText("Voice disconnected");
  await expect.poll(() => page.evaluate(() => (window as any).__voiceProbe.tracks.every((track: any) => track.stopped))).toBe(true);
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.getByRole("button", { name: "End", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      HTMLMediaElement.prototype.play = originalPlay;
      return Promise.reject(new DOMException("Fixture playback denied", "NotAllowedError"));
    };
    (window as any).__voiceProbe.remoteAudio();
  });
  await expect(page.getByRole("alert")).toContainText("browser blocked voice playback");
  await expect.poll(() => page.evaluate(() => (window as any).__voiceProbe.tracks.every((track: any) => track.stopped))).toBe(true);
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.getByRole("button", { name: "End", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Scenes", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__voiceProbe.tracks.every((track: any) => track.stopped))).toBe(true);
  await page.getByRole("tab", { name: "Assistant", exact: true }).click();
  await start.click();
  await expect(page.getByRole("button", { name: "End", exact: true })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__voiceProbe.tracks.every((track: any) => track.stopped))).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(start).toBeVisible();
  expect(negotiations).toBe(4);
}
