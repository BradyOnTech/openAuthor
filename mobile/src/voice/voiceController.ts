import { MobileAssistantTools } from "../core/mobileAssistant";
import type { OutboxKind } from "../core/outbox";
import type { SnapshotProject } from "../core/snapshotProject";
import type { MobileVoiceEvent } from "./realtimeEvents";

type VoiceTransport = {
  start(): Promise<{ callId: string; expiresAt: string }>;
  setMuted(muted: boolean): void;
  sendText(text: string): void;
  sendContext(context: unknown): void;
  sendToolOutput(callId: string, output: unknown): void;
  interrupt(): void;
  stop(): void;
};

type Queue = (kind: OutboxKind, payload: Record<string, unknown>) => Promise<string>;

/** Coordinates the provider event stream without granting it a manuscript-write path. */
export class MobileVoiceController {
  readonly #transport: VoiceTransport;
  readonly #tools: MobileAssistantTools;
  readonly #queue: Queue;
  readonly #onEvent: (event: MobileVoiceEvent) => void;
  readonly #threadId: string;
  readonly #context: unknown;

  constructor(input: {
    project: SnapshotProject;
    createTransport(onEvent: (event: MobileVoiceEvent) => Promise<void>): VoiceTransport;
    queue: Queue;
    onEvent(event: MobileVoiceEvent): void;
    threadId?: string;
    currentSceneId?: string;
  }) {
    this.#queue = input.queue;
    this.#onEvent = input.onEvent;
    this.#threadId = input.threadId ?? "mobile-voice";
    this.#tools = new MobileAssistantTools(input.project, input.queue);
    this.#context = input.project.buildContext({
      utterance: "Discuss this book and its story",
      ...(input.currentSceneId ? { currentSceneId: input.currentSceneId } : {}),
      maxCharacters: 12_000,
    });
    this.#transport = input.createTransport((event) => (
      this.#receive(event).catch(() => {
        // Transport stays alive when local transcript persistence fails; the
        // encrypted outbox will retry work that was successfully enqueued.
      })
    ));
  }

  async #receive(event: MobileVoiceEvent): Promise<void> {
    this.#onEvent(event);
    if (event.type === "tool.requested") {
      if (!event.arguments) {
        this.#transport.sendToolOutput(event.callId, { error: "Tool arguments were invalid JSON." });
        return;
      }
      try {
        this.#transport.sendToolOutput(
          event.callId,
          await this.#tools.execute(event.name, event.arguments),
        );
      } catch (error) {
        this.#transport.sendToolOutput(event.callId, {
          error: error instanceof Error ? error.message : "Mobile tool failed.",
        });
      }
      return;
    }
    if (event.type === "user.transcript.final" || event.type === "assistant.transcript.final") {
      const text = event.text.trim();
      if (text) {
        await this.#queue("thread_turn", {
          channel: "mobile_voice",
          content: text,
          provider_event_id: event.providerEventId,
          role: event.type === "user.transcript.final" ? "user" : "assistant",
          thread_id: this.#threadId,
          turn_id: event.itemId || event.providerEventId,
        });
      }
    }
  }

  async start(): Promise<{ callId: string; expiresAt: string }> {
    try {
      const session = await this.#transport.start();
      this.#transport.sendContext(this.#context);
      this.#transport.setMuted(false);
      return session;
    } catch (error) {
      this.#transport.stop();
      throw error;
    }
  }

  mute(muted: boolean): void {
    this.#transport.setMuted(muted);
  }

  sendText(text: string): void {
    this.#transport.sendText(text);
  }

  interrupt(): void {
    this.#transport.interrupt();
  }

  stop(): void {
    this.#transport.stop();
  }
}
