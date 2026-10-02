import { interruptChatTurn, reconcileChatDelivery, sendChatMessageStreamed, type ChatSendPayload } from "./api";

type Snapshot = {
  pending: ChatSendPayload | null;
  reviewDraft: ChatSendPayload | null;
  reconciling: boolean;
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
  private state: Snapshot = { pending: null, reviewDraft: null, reconciling: false, sending: false, requestId: "", text: "", error: "" };
  private listeners = new Set<() => void>();
  private storageKey: string;

  constructor(readonly projectRoot: string, readonly threadId: string) {
    this.storageKey = `openauthor:chat-delivery:${JSON.stringify([projectRoot, threadId])}`;
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const saved = JSON.parse(stored);
        const reviewing = saved.schema_version === 2 && saved.phase === "review";
        const payload = (reviewing ? saved.payload : saved) as ChatSendPayload;
        if (payload.threadId !== threadId || (!reviewing && typeof payload.deliveryId !== "string") || typeof payload.message !== "string") {
          throw new Error("Invalid saved chat delivery.");
        }
        if (reviewing) {
          this.state.reviewDraft = freshReviewDraft(payload);
          this.state.error = typeof saved.notice === "string" ? saved.notice : "Your question is saved. Review current context and grant permission again before sending.";
        } else {
          this.state.pending = payload;
          this.state.error = "The previous response was not confirmed. Retry to recover it or review current context.";
        }
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
    if (this.state.pending || this.state.reviewDraft || this.state.sending || this.state.reconciling) return false;
    return this.startDelivery(payload);
  }

  async sendReviewed(payload: ChatSendPayload): Promise<boolean> {
    const draft = this.state.reviewDraft;
    if (!draft || this.state.pending || this.state.sending || this.state.reconciling || !payload.expectedContextFingerprint ||
      reviewContract(payload) !== reviewContract(draft)) return false;
    return this.startDelivery(payload);
  }

  private async startDelivery(payload: ChatSendPayload): Promise<boolean> {
    const pending = { ...payload, threadId: this.threadId, deliveryId: crypto.randomUUID(), turnId: `turn-${crypto.randomUUID()}` };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(pending));
    } catch {
      this.publish({ error: "Chat recovery storage is full or unavailable. Your prompt has not been sent." });
      return false;
    }
    this.publish({ pending, reviewDraft: null });
    await this.retry();
    // The prompt is now either delivered or retained in the recovery card.
    return true;
  }

  retry = async (): Promise<void> => {
    const payload = this.state.pending;
    if (!payload || this.state.sending || this.state.reconciling) return;
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

  prepareReview = async (): Promise<ChatSendPayload | null> => {
    if (this.state.sending || this.state.reconciling) return null;
    if (this.state.reviewDraft) return this.state.reviewDraft;
    const pending = this.state.pending;
    if (!pending) return null;
    this.publish({ reconciling: true, error: "Checking the saved delivery. Nothing new is being sent…" });
    try {
      const result = await reconcileChatDelivery(this.projectRoot, pending);
      if (result.status === "completed") {
        localStorage.removeItem(this.storageKey);
        this.publish({ pending: null, error: result.message });
        return null;
      }
      if (!result.can_review || !["not_delivered", "indeterminate"].includes(result.status)) {
        this.publish({ error: result.message || "Delivery could not be reconciled. Keep this saved request until its status is confirmed." });
        return null;
      }
      const draft = freshReviewDraft(pending);
      // The old ID is closed by core before changing the durable UI journal.
      // If writing fails, the original identity remains available to reconcile.
      localStorage.setItem(this.storageKey, JSON.stringify({ schema_version: 2, phase: "review", payload: draft, notice: result.message }));
      this.publish({ pending: null, reviewDraft: draft, error: result.message });
      return draft;
    } catch (error) {
      this.publish({ error: `Could not prepare a fresh review: ${error instanceof Error ? error.message : String(error)}` });
      return null;
    } finally { this.publish({ reconciling: false }); }
  };

  updateReviewQuestion = (message: string): ChatSendPayload | null => {
    if (!this.state.reviewDraft || this.state.sending || this.state.reconciling) return null;
    const draft = { ...this.state.reviewDraft, message };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({ schema_version: 2, phase: "review", payload: draft, notice: this.state.error }));
      this.publish({ reviewDraft: draft });
      return draft;
    } catch {
      this.publish({ error: "Could not save the revised question. Keep a copy before closing." });
      return null;
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
    if (this.state.sending || this.state.reconciling) return;
    try {
      localStorage.removeItem(this.storageKey);
      this.publish({ pending: null, reviewDraft: null, error: "" });
    } catch {
      this.publish({ error: "Could not remove the saved prompt. Retry clearing it before sending another." });
    }
  };
}

function freshReviewDraft(payload: ChatSendPayload): ChatSendPayload {
  const { deliveryId, turnId, expectedContextFingerprint, approvedCodexIds, memoryApprovals, storyApprovals, ...draft } = payload;
  return draft;
}

function reviewContract(payload: ChatSendPayload): string {
  return JSON.stringify(Object.entries(freshReviewDraft(payload)).sort(([a], [b]) => a.localeCompare(b)));
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
