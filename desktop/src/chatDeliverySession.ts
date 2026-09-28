import { interruptChatTurn, sendChatMessageStreamed, type ChatSendPayload } from "./api";

type Snapshot = {
  pending: ChatSendPayload | null;
  sending: boolean;
  requestId: string;
  text: string;
  error: string;
};

const sessions = new Map<string, ChatDeliverySession>();

// A delivery belongs to a book and conversation, not to a mounted panel.
// The local journal is saved before contacting a provider. Explicit retries
// reuse its delivery id so a lost native response cannot duplicate the turn.
export class ChatDeliverySession {
  private state: Snapshot = { pending: null, sending: false, requestId: "", text: "", error: "" };
  private listeners = new Set<() => void>();
  private storageKey: string;

  constructor(readonly projectRoot: string, readonly threadId: string) {
    this.storageKey = `openauthor:chat-delivery:${JSON.stringify([projectRoot, threadId])}`;
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const payload = JSON.parse(stored) as ChatSendPayload;
        if (payload.threadId !== threadId || typeof payload.deliveryId !== "string" || typeof payload.message !== "string") {
          throw new Error("Invalid saved chat delivery.");
        }
        this.state.pending = payload;
        this.state.error = "The previous response was not confirmed. Retry to recover it or try again.";
      }
    } catch {
      this.state.error = "Chat recovery storage could not be read. Keep a copy of your prompt before closing.";
    }
  }

  getSnapshot = (): Snapshot => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(next: Partial<Snapshot>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach(listener => listener());
  }

  async send(payload: ChatSendPayload): Promise<boolean> {
    if (this.state.pending || this.state.sending) return false;
    const pending = { ...payload, threadId: this.threadId, deliveryId: crypto.randomUUID() };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(pending));
    } catch {
      this.publish({ error: "Chat recovery storage is full or unavailable. Your prompt has not been sent." });
      return false;
    }
    this.publish({ pending });
    await this.retry();
    // The prompt is now either delivered or retained in the recovery card.
    return true;
  }

  retry = async (): Promise<void> => {
    const payload = this.state.pending;
    if (!payload || this.state.sending) return;
    this.publish({ sending: true, text: "", error: "", requestId: "" });
    try {
      await sendChatMessageStreamed(this.projectRoot, payload, {
        onStart: requestId => this.publish({ requestId }),
        onDelta: delta => this.publish({ text: this.state.text + delta }),
      });
      // If removal fails, keep the receipt id: retry is safe even after success.
      localStorage.removeItem(this.storageKey);
      this.publish({ pending: null });
    } catch (error) {
      this.publish({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      this.publish({ sending: false, requestId: "", text: "" });
    }
  };

  interrupt = async () => {
    if (!this.state.requestId) return;
    try {
      await interruptChatTurn(this.projectRoot, this.state.requestId);
      this.publish({ error: "Stop requested. Waiting for the provider connection to close…" });
    } catch (error) {
      this.publish({ error: `Stop failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  };

  discard = () => {
    if (this.state.sending) return;
    try {
      localStorage.removeItem(this.storageKey);
      this.publish({ pending: null, error: "" });
    } catch {
      this.publish({ error: "Could not remove the saved prompt. Retry clearing it before sending another." });
    }
  };
}

export function chatDeliverySession(projectRoot: string, threadId: string): ChatDeliverySession {
  const key = JSON.stringify([projectRoot, threadId]);
  let session = sessions.get(key);
  if (!session) {
    session = new ChatDeliverySession(projectRoot, threadId);
    sessions.set(key, session);
  }
  return session;
}
