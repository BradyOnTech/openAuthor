import { useState, useEffect, useRef, useMemo } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import {
  createChatThread,
  updateChatThread,
  sendChatMessageStreamed,
  interruptChatTurn,
  executeChatToolCall,
  createProposal,
  queueStoryMemorySuggestion,
  addSceneNote,
  createStoryline,
  getChatTurnDiff,
  getScene,
  getCodexEntity,
  truncateChatMessages,
  getManuscriptPlan,
  getAssistantTurn,
} from "../../api";
import { parseChatMarkdown, type ChatBlock, type ChatInlineSpan } from "../../chatMarkdown";
import type {
  ChatThreadRecord,
  ChatMessageRecord,
  ChatToolCall,
  ChatRetrievalCitation,
  ChatTurnDiff,
  ChatTurnVcs,
  ProposalProvider,
  SceneSummary,
  CodexEntity,
} from "../../types";
import { availableProviders as getAvailableProviders } from "../../providerSelection";
import { VoiceControl } from "../../voice/VoiceControl";
import { useMemoryConsent } from "../../hooks/useMemoryConsent";
import { ReviewContextReceipt } from "./ReviewContextReceipt";

type ChatStream = {
  requestId: string;
  turnId: string;
  userText: string;
  text: string;
};

type AssistantScope = "project" | "scene" | "chapter" | "character" | "storyline";

export function ChatPanel() {
  const {
    projectFound, projectRoot,
    chatThreads, refreshChatThreads,
    activeChatThreadId, setActiveChatThreadId,
    chatMessages, refreshChatMessages,
    chatSending, setChatSending,
    scenes, codexEntities,
    refreshProposals,
    runtimeConfig,
    setError, setMessage,
  } = useWorkspace();
  const { tabs, activeTabId, openTab } = useEditor();
  const [stream, setStream] = useState<ChatStream | null>(null);
  const [editing, setEditing] = useState<{ messageId: string; text: string } | null>(null);
  const memoryConsent = useMemoryConsent(projectRoot, activeChatThreadId);

  if (!projectFound) {
    return (
      <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-sm)" }}>
        Open a project to start chatting.
      </div>
    );
  }

  const activeThread = chatThreads.find((t) => t.id === activeChatThreadId);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const currentSceneId = activeTab?.kind === "scene" ? activeTab.id.replace("scene:", "") : undefined;

  async function handleOpenCitation(citation: ChatRetrievalCitation) {
    try {
      if (citation.source_type === "scene") {
        const detail = await getScene(projectRoot, citation.source_ref);
        openTab({
          id: `scene:${citation.source_ref}`,
          kind: "scene",
          label: citation.source_title || detail.title || citation.source_ref,
          data: detail,
        });
      } else if (citation.source_type === "codex") {
        const entity = await getCodexEntity(projectRoot, citation.source_ref);
        openTab({
          id: `codex:${citation.source_ref}`,
          kind: "codex",
          label: citation.source_title || entity.name || citation.source_ref,
          data: entity,
        });
      }
    } catch (e) {
      setError(`Failed to open citation: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleInterrupt() {
    if (!stream) return;
    try {
      await interruptChatTurn(projectRoot, stream.requestId);
      setMessage("Interrupt requested.");
    } catch (e) {
      setError(`Interrupt failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function performSend(
    text: string,
    sceneIds: string[],
    codexIds: string[],
    scope: AssistantScope,
    replacementFromMessageId?: string,
    approvedCodexIds: string[] = [],
  ) {
    if (!activeChatThreadId || !text.trim()) return false;
    setError("");
    setChatSending(true);
    let activeTurnId = "";
    try {
      await sendChatMessageStreamed(
        projectRoot,
        {
          threadId: activeChatThreadId,
          message: text,
          currentSceneId,
          sceneIds,
          codexIds,
          approvedCodexIds,
          scope,
          replacementFromMessageId,
        },
        {
          onStart: (requestId, turnId) => {
            activeTurnId = turnId;
            setStream({ requestId, turnId, userText: text, text: "" });
          },
          onDelta: (delta) =>
            setStream((prev) => (prev ? { ...prev, text: prev.text + delta } : prev)),
        }
      );
      await refreshChatMessages();
      await refreshChatThreads();
      return true;
    } catch (e) {
      if (activeTurnId) {
        try {
          const turn = await getAssistantTurn(projectRoot, activeTurnId);
          await refreshChatMessages();
          if (turn.status === "completed") {
            setMessage("Recovered the completed Assistant turn after a transport timeout.");
            return true;
          }
          if (turn.status === "accepted" || turn.status === "running") {
            setMessage("The Assistant turn is still running. It was not sent again.");
            return true;
          }
        } catch {
          // Fall through to the original transport error when no durable turn exists.
        }
      }
      await refreshChatMessages();
      setError(`Chat send failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setStream(null);
      setChatSending(false);
    }
  }

  function handleStartEdit(message: ChatMessageRecord) {
    if (chatSending) return;
    setEditing({ messageId: message.id, text: message.content });
  }

  async function handleComposerSend(text: string, sceneIds: string[], codexIds: string[], scope: AssistantScope) {
    if (!activeChatThreadId || !text.trim()) return false;
    let approvedCodexIds: string[] | null;
    try {
      approvedCodexIds = await memoryConsent.requestApproval(codexIds);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return false;
    }
    if (approvedCodexIds === null) return false;
    if (editing) {
      const target = editing;
      setEditing(null);
      try {
        await truncateChatMessages(projectRoot, {
          threadId: activeChatThreadId,
          fromMessageId: target.messageId,
        });
        await refreshChatMessages();
      } catch (e) {
        setError(`Edit failed: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    }
    return performSend(text, sceneIds, codexIds, scope, undefined, approvedCodexIds);
  }

  async function handleRegenerate() {
    if (!activeChatThreadId || chatSending) return;
    setEditing(null);
    const lastUser = [...chatMessages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const mentions = extractMentionIds(lastUser.content, scenes, codexEntities);
    const previousContext = lastUser.context_used as {
      profile?: { scope?: AssistantScope };
      scene_ids?: string[];
      codex_entity_ids?: string[];
    };
    const previousScope = previousContext.profile?.scope;
    // A scope-picker selection need not appear as an @mention in the prose.
    // Regeneration must retain that target, with fresh permission for Memory.
    if (previousScope === "chapter") mentions.sceneIds = previousContext.scene_ids ?? [];
    if (previousScope === "character") mentions.codexIds = previousContext.codex_entity_ids ?? [];
    let approvedCodexIds: string[] | null;
    try {
      approvedCodexIds = await memoryConsent.requestApproval(mentions.codexIds);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (approvedCodexIds === null) return;
    await performSend(
      lastUser.content,
      mentions.sceneIds,
      mentions.codexIds,
      previousScope ?? "project",
      lastUser.id,
      approvedCodexIds,
    );
  }

  const editDiscardCount = editing
    ? chatMessages.length - chatMessages.findIndex((m) => m.id === editing.messageId)
    : 0;

  return (
    <div className="chat-panel">
      <button className="btn btn--ghost btn--sm" onClick={() => openTab({ id: "writing-voice", kind: "writing-voice", label: "Writing Voice" })}>Writing Voice</button>
      <ThreadHeader
        threads={chatThreads}
        activeThread={activeThread}
        messages={chatMessages}
        runtimeConfig={runtimeConfig}
        projectRoot={projectRoot}
        onSelectThread={setActiveChatThreadId}
        onThreadCreated={(t) => {
          refreshChatThreads();
          setActiveChatThreadId(t.id);
        }}
        onThreadUpdated={refreshChatThreads}
        setError={setError}
      />
      <MessageList
        messages={chatMessages}
        sending={chatSending}
        stream={stream}
        projectRoot={projectRoot}
        threadId={activeChatThreadId}
        currentSceneId={currentSceneId}
        onToolExecuted={refreshChatMessages}
        onOpenCitation={handleOpenCitation}
        onProposalQueued={() => {
          refreshProposals();
          setMessage("Change Set queued for review.");
        }}
        onRegenerate={handleRegenerate}
        onEditMessage={handleStartEdit}
        setError={setError}
      />
      {activeChatThreadId && (
        <VoiceControl
          projectRoot={projectRoot}
          threadId={activeChatThreadId}
          currentSceneId={currentSceneId}
          onRecorded={async () => {
            await refreshChatMessages();
            await refreshChatThreads();
          }}
          setError={setError}
          setMessage={setMessage}
        />
      )}
      {memoryConsent.review}
      <Composer
        projectRoot={projectRoot}
        threadId={activeChatThreadId}
        sending={chatSending || memoryConsent.pending}
        streaming={stream !== null}
        scenes={scenes}
        codexEntities={codexEntities}
        activeThread={activeThread}
        currentSceneId={currentSceneId}
        onInterrupt={handleInterrupt}
        onSend={handleComposerSend}
        editing={editing}
        editDiscardCount={editDiscardCount}
        onCancelEdit={() => setEditing(null)}
      />
    </div>
  );
}


/* ── Mentions ───────────────────────────────────────────────────── */

function extractMentionIds(
  text: string,
  scenes: SceneSummary[],
  codexEntities: CodexEntity[]
): { sceneIds: string[]; codexIds: string[] } {
  const sceneIds = new Set<string>();
  const codexIds = new Set<string>();
  const mentionRe = /@(scene|codex):([^\s]+)/g;
  let match;
  while ((match = mentionRe.exec(text)) !== null) {
    const kind = match[1];
    const token = match[2];
    if (kind === "scene") {
      const s = scenes.find((s) => s.id === token || s.title === token);
      if (s) sceneIds.add(s.id);
    } else if (kind === "codex") {
      const e = codexEntities.find((e) => e.id === token || e.name === token);
      if (e) codexIds.add(e.id);
    }
  }
  return { sceneIds: [...sceneIds], codexIds: [...codexIds] };
}


/* ── Context-used helpers ───────────────────────────────────────── */

function messageCitations(message: ChatMessageRecord): ChatRetrievalCitation[] {
  const retrieval = (message.context_used as {
    retrieval?: { citations?: ChatRetrievalCitation[] };
  }).retrieval;
  if (!retrieval || !Array.isArray(retrieval.citations)) return [];
  const seen = new Set<string>();
  const unique: ChatRetrievalCitation[] = [];
  for (const citation of retrieval.citations) {
    const key = `${citation.source_type}:${citation.source_ref}`;
    if (citation.source_ref && !seen.has(key)) {
      seen.add(key);
      unique.push(citation);
    }
  }
  return unique;
}

function messageVcs(message: ChatMessageRecord): ChatTurnVcs {
  const vcs = (message.context_used as { vcs?: ChatTurnVcs }).vcs;
  return vcs && typeof vcs === "object" ? vcs : {};
}

function messageSceneIds(message: ChatMessageRecord): string[] {
  const ids = (message.context_used as { scene_ids?: string[] }).scene_ids;
  return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id !== "") : [];
}


/* ── Thread Header ──────────────────────────────────────────────── */

function ThreadHeader({
  threads,
  activeThread,
  messages,
  runtimeConfig,
  projectRoot,
  onSelectThread,
  onThreadCreated,
  onThreadUpdated,
  setError,
}: {
  threads: ChatThreadRecord[];
  activeThread?: ChatThreadRecord;
  messages: ChatMessageRecord[];
  runtimeConfig: ReturnType<typeof useWorkspace>["runtimeConfig"];
  projectRoot: string;
  onSelectThread: (id: string) => void;
  onThreadCreated: (t: ChatThreadRecord) => void;
  onThreadUpdated: () => void;
  setError: (e: string) => void;
}) {
  const [showThreadList, setShowThreadList] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [creating, setCreating] = useState(false);

  const spend = useMemo(() => {
    let tokens = 0;
    let cost = 0;
    let hasCost = false;
    for (const message of messages) {
      tokens += (message.usage.input_tokens ?? 0) + (message.usage.output_tokens ?? 0);
      if (message.usage.estimated_cost_usd != null) {
        cost += message.usage.estimated_cost_usd;
        hasCost = true;
      }
    }
    return { tokens, cost, hasCost };
  }, [messages]);

  const availableProviders = useMemo(() => {
    return getAvailableProviders(runtimeConfig);
  }, [runtimeConfig]);

  async function handleNewThread() {
    if (creating) return;
    setCreating(true);
    try {
      const provider = availableProviders[0]?.id ?? "local";
      const model = availableProviders[0]?.model;
      const t = await createChatThread(projectRoot, {
        title: "New Chat",
        provider,
        model,
      });
      onThreadCreated(t);
    } catch (e) {
      setError(`Failed to create thread: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
      setShowThreadList(false);
    }
  }

  async function handleChangeModel(provider: ProposalProvider, model: string) {
    if (!activeThread) return;
    try {
      await updateChatThread(projectRoot, {
        id: activeThread.id,
        provider,
        model,
      });
      onThreadUpdated();
    } catch (e) {
      setError(`Failed to update model: ${e instanceof Error ? e.message : String(e)}`);
    }
    setShowModelPicker(false);
  }

  async function handleToggleMode() {
    if (!activeThread) return;
    const newMode = activeThread.mode === "chat" ? "agent" : "chat";
    try {
      await updateChatThread(projectRoot, { id: activeThread.id, mode: newMode });
      onThreadUpdated();
    } catch (e) {
      setError(`Failed to toggle mode: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="chat-header">
      <div className="chat-header__left">
        <button
          className="chat-header__thread-btn"
          onClick={() => { setShowThreadList(!showThreadList); setShowModelPicker(false); }}
          title="Switch thread"
        >
          {activeThread ? truncate(activeThread.title, 20) : "No thread"}
          <span className="chat-header__chevron">{"▾"}</span>
        </button>
      </div>

      <div className="chat-header__right">
        {activeThread && spend.tokens > 0 && (
          <span
            className="chat-header__spend"
            title={`This thread has used ${spend.tokens.toLocaleString()} tokens${spend.hasCost ? ` (~$${spend.cost.toFixed(4)})` : ""}.`}
          >
            {formatTokens(spend.tokens)}
            {spend.hasCost && <> {"·"} ${spend.cost.toFixed(3)}</>}
          </span>
        )}
        {activeThread && (
          <button
            className={`chat-header__mode-badge chat-header__mode-badge--${activeThread.mode}`}
            onClick={handleToggleMode}
            title={`Mode: ${activeThread.mode}. Click to toggle.`}
          >
            {activeThread.mode === "agent" ? "⚙" : "✨"} {activeThread.mode}
          </button>
        )}
        {activeThread && (
          <button
            className="chat-header__model-badge"
            onClick={() => { setShowModelPicker(!showModelPicker); setShowThreadList(false); }}
            title="Change model"
          >
            {shortModel(activeThread.model)}
          </button>
        )}
        <button
          className="chat-header__new-btn"
          onClick={handleNewThread}
          disabled={creating}
          title="New thread"
        >
          +
        </button>
      </div>

      {showThreadList && (
        <div className="chat-dropdown chat-dropdown--threads">
          {threads.length === 0 && (
            <div className="chat-dropdown__empty">No threads yet</div>
          )}
          {threads.map((t) => (
            <div
              key={t.id}
              className={`chat-dropdown__item${t.id === activeThread?.id ? " chat-dropdown__item--active" : ""}`}
              onClick={() => { onSelectThread(t.id); setShowThreadList(false); }}
            >
              <span className="chat-dropdown__item-title">{t.title || t.id.slice(0, 12)}</span>
              <span className="chat-dropdown__item-meta">
                {shortModel(t.model)} {"·"} {timeAgo(t.updated_at)}
              </span>
            </div>
          ))}
        </div>
      )}

      {showModelPicker && (
        <div className="chat-dropdown chat-dropdown--models">
          {availableProviders.map((p) => (
            <div
              key={p.id}
              className={`chat-dropdown__item${activeThread?.provider === p.id ? " chat-dropdown__item--active" : ""}`}
              onClick={() => handleChangeModel(p.id, p.model)}
            >
              <span className="chat-dropdown__item-title">{p.id}</span>
              <span className="chat-dropdown__item-meta">{p.model}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


/* ── Message List ───────────────────────────────────────────────── */

function MessageList({
  messages,
  sending,
  stream,
  projectRoot,
  threadId,
  currentSceneId,
  onToolExecuted,
  onOpenCitation,
  onProposalQueued,
  onRegenerate,
  onEditMessage,
  setError,
}: {
  messages: ChatMessageRecord[];
  sending: boolean;
  stream: ChatStream | null;
  projectRoot: string;
  threadId: string;
  currentSceneId?: string;
  onToolExecuted: () => void;
  onOpenCitation: (citation: ChatRetrievalCitation) => void;
  onProposalQueued: () => void;
  onRegenerate: () => void;
  onEditMessage: (message: ChatMessageRecord) => void;
  setError: (e: string) => void;
}) {
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, sending, stream, autoScroll]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  if (messages.length === 0 && !sending && !stream) {
    return (
      <div className="chat-panel__messages">
        <div className="chat-empty">
          <div className="chat-empty__icon">{"✨"}</div>
          <div className="chat-empty__text">
            {threadId ? "Send a message to start the conversation." : "Create or select a thread to begin."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-panel__messages" ref={containerRef} onScroll={handleScroll}>
      {messages.map((msg) => (
        <ChatMessage
          key={msg.id}
          message={msg}
          projectRoot={projectRoot}
          threadId={threadId}
          currentSceneId={currentSceneId}
          canRegenerate={msg.id === lastAssistantId && !sending}
          canEdit={msg.role === "user" && !sending}
          onToolExecuted={onToolExecuted}
          onOpenCitation={onOpenCitation}
          onProposalQueued={onProposalQueued}
          onRegenerate={onRegenerate}
          onEdit={() => onEditMessage(msg)}
          setError={setError}
        />
      ))}
      {stream && (
        <div className="chat-message chat-message--user chat-message--optimistic">
          <div className="chat-message__header">
            <span className="chat-message__role chat-message__role--user">user</span>
            <span className="chat-message__time">sending{"…"}</span>
          </div>
          <div className="chat-message__body">
            <RenderedContent content={stream.userText} />
          </div>
        </div>
      )}
      {stream && stream.text !== "" ? (
        <div className="chat-message chat-message--assistant chat-message--streaming">
          <div className="chat-message__header">
            <span className="chat-message__role chat-message__role--assistant">assistant</span>
            <span className="chat-message__time">streaming{"…"}</span>
          </div>
          <div className="chat-message__body">
            <RenderedContent content={stream.text} />
            <span className="chat-streaming-cursor" />
          </div>
        </div>
      ) : sending ? (
        <div className="chat-message chat-message--typing">
          <div className="chat-message__header">
            <span className="chat-message__role chat-message__role--assistant">assistant</span>
          </div>
          <div className="chat-typing-indicator">
            <span /><span /><span />
          </div>
        </div>
      ) : null}
      <div ref={bottomRef} />
      {!autoScroll && (
        <button
          className="chat-scroll-btn"
          onClick={() => {
            setAutoScroll(true);
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          {"↓"} Latest
        </button>
      )}
    </div>
  );
}


/* ── Chat Message ───────────────────────────────────────────────── */

function ChatMessage({
  message,
  projectRoot,
  threadId,
  currentSceneId,
  canRegenerate,
  canEdit,
  onToolExecuted,
  onOpenCitation,
  onProposalQueued,
  onRegenerate,
  onEdit,
  setError,
}: {
  message: ChatMessageRecord;
  projectRoot: string;
  threadId: string;
  currentSceneId?: string;
  canRegenerate: boolean;
  canEdit: boolean;
  onToolExecuted: () => void;
  onOpenCitation: (citation: ChatRetrievalCitation) => void;
  onProposalQueued: () => void;
  onRegenerate: () => void;
  onEdit: () => void;
  setError: (e: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const { openTab } = useEditor();
  const [queueingProposal, setQueueingProposal] = useState(false);
  const [diff, setDiff] = useState<ChatTurnDiff | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [savingArtifact, setSavingArtifact] = useState<"memory" | "note" | "storyline" | null>(null);
  const [savedArtifact, setSavedArtifact] = useState("");

  const citations = message.role === "assistant" ? messageCitations(message) : [];
  const vcs = messageVcs(message);
  const proposalSceneId = messageSceneIds(message)[0] ?? currentSceneId ?? "";
  const isAssistant = message.role === "assistant";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setError(`Copy failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleQueueProposal() {
    if (proposalSceneId === "" || queueingProposal) return;
    setQueueingProposal(true);
    try {
      await createProposal(projectRoot, {
        title: proposalTitle(message.content),
        instruction: message.content,
        sceneId: proposalSceneId,
      });
      onProposalQueued();
    } catch (e) {
      setError(`Failed to queue proposal: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setQueueingProposal(false);
    }
  }

  async function handleToggleDiff() {
    if (!diffOpen && diff === null) {
      setDiffLoading(true);
      try {
        const result = await getChatTurnDiff(projectRoot, {
          threadId,
          messageId: message.id,
        });
        setDiff(result);
      } catch (e) {
        setError(`Turn diff failed: ${e instanceof Error ? e.message : String(e)}`);
        setDiffLoading(false);
        return;
      }
      setDiffLoading(false);
    }
    setDiffOpen(!diffOpen);
  }

  async function handlePromote(kind: "memory" | "note" | "storyline") {
    if (savingArtifact || !message.content.trim()) return;
    setSavingArtifact(kind);
    const title = proposalTitle(message.content).replace(/^Assistant suggestion:\s*/i, "").slice(0, 72) || "Assistant insight";
    try {
      if (kind === "memory") {
        await queueStoryMemorySuggestion(projectRoot, { title, content: message.content, sceneId: proposalSceneId });
        setSavedArtifact("Queued in Story Memory for review.");
      } else if (kind === "note") {
        await addSceneNote(projectRoot, { title, content: message.content, sceneId: proposalSceneId });
        setSavedArtifact(proposalSceneId ? "Saved as a scene note." : "Saved as a project note.");
      } else {
        await createStoryline(projectRoot, {
          name: title,
          hypothesis: message.content,
          scope: proposalSceneId ? `Explore from ${proposalSceneId}` : "Explore this Assistant direction",
          success: "The alternative strengthens the story without violating protected canon.",
          switch: false,
        });
        setSavedArtifact("Created as a Storyline experiment.");
      }
      setSaveMenuOpen(false);
    } catch (e) {
      setError(`Could not save Assistant result: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingArtifact(null);
    }
  }

  return (
    <div className={`chat-message chat-message--${message.role}`}>
      <div className="chat-message__header">
        <span className={`chat-message__role chat-message__role--${message.role}`}>
          {message.role}
        </span>
        <span className="chat-message__time">{formatTime(message.created_at)}</span>
      </div>

      {message.role === "tool" ? (
        <div className="chat-message__body chat-message__body--tool">
          {message.content}
        </div>
      ) : (
        <div className="chat-message__body">
          <RenderedContent content={message.content} />
        </div>
      )}

      {isAssistant && <ReviewContextReceipt context={message.context_used} />}

      {citations.length > 0 && (
        <div className="chat-citations">
          {citations.map((citation) => (
            <button
              key={`${citation.source_type}:${citation.source_ref}`}
              className={`chat-citation-chip chat-citation-chip--${citation.source_type}`}
              onClick={() => onOpenCitation(citation)}
              title={citation.excerpt || citation.source_ref}
            >
              {citation.source_type === "scene" ? "○" : "◆"}{" "}
              {citation.source_title || citation.source_ref}
            </button>
          ))}
        </div>
      )}

      {message.tool_calls.length > 0 && (
        <div className="chat-tool-calls">
          {message.tool_calls.map((tc, i) => (
            <ToolCallCard
              key={`${message.id}-tc-${i}`}
              toolCall={tc}
              index={i}
              messageId={message.id}
              projectRoot={projectRoot}
              threadId={threadId}
              onExecuted={onToolExecuted}
              setError={setError}
            />
          ))}
        </div>
      )}

      {canEdit && (
        <div className="chat-message__actions">
          <button
            className="chat-action-btn"
            onClick={onEdit}
            title="Edit this message and resend — it and all later messages will be replaced."
          >
            ✎ Edit
          </button>
        </div>
      )}

      {isAssistant && (message.content.trim() !== "" || canRegenerate) && (
        <div className="chat-message__actions">
          <button className="chat-action-btn" onClick={handleCopy} title="Copy message text">
            {copied ? "✓ Copied" : "Copy"}
          </button>
          {canRegenerate && (
            <button
              className="chat-action-btn"
              onClick={onRegenerate}
              title="Rewind this turn and generate a fresh reply. Spend logs for the discarded turn are kept."
            >
              ↻ Regenerate
            </button>
          )}
          <button
            className="chat-action-btn"
            onClick={handleQueueProposal}
            disabled={proposalSceneId === "" || queueingProposal}
            title={
              proposalSceneId === ""
                ? "Open a scene or mention one to target a proposal."
                : `Queue this reply as a proposal for ${proposalSceneId}.`
            }
          >
            {queueingProposal ? "Queueing…" : "→ Change Set"}
          </button>
          <button className="chat-action-btn" aria-expanded={saveMenuOpen} onClick={() => setSaveMenuOpen(!saveMenuOpen)} title="Turn this reply into a durable project artifact">
            Save as…
          </button>
          {vcs.base_commit && (
            <button
              className="chat-action-btn"
              onClick={handleToggleDiff}
              disabled={diffLoading}
              title="Show manuscript changes since this turn"
            >
              {diffLoading ? "Loading…" : diffOpen ? "Hide changes" : "Changes"}
            </button>
          )}
        </div>
      )}

      {saveMenuOpen && (
        <div className="chat-promote-options" role="group" aria-label="Save reply as">
          <button className="chat-action-btn" disabled={savingArtifact !== null} onClick={() => void handlePromote("memory")}>Story Memory suggestion</button>
          <button className="chat-action-btn" disabled={savingArtifact !== null} onClick={() => void handlePromote("note")}>{proposalSceneId ? "Scene note" : "Project note"}</button>
          <button className="chat-action-btn" disabled={savingArtifact !== null} onClick={() => void handlePromote("storyline")}>Storyline experiment</button>
          <button className="chat-action-btn" onClick={() => { openTab({ id: "writing-voice", kind: "writing-voice", label: "Writing Voice", data: { voiceBrief: message.content } }); setSaveMenuOpen(false); }}>Writing Voice brief</button>
        </div>
      )}
      {savedArtifact && <div className="chat-message__usage">✓ {savedArtifact}</div>}

      {diffOpen && diff && (
        <div className="chat-diff-panel">
          {diff.files.length === 0 ? (
            <div className="chat-diff-panel__empty">No authoring changes since this turn.</div>
          ) : (
            diff.files.map((file) => (
              <div key={file.path} className="chat-diff-panel__row">
                <span className={`chat-diff-panel__status chat-diff-panel__status--${file.status.charAt(0)}`}>
                  {file.status}
                </span>
                <span className="chat-diff-panel__path">{file.path}</span>
                {file.added != null && file.deleted != null && (
                  <span className="chat-diff-panel__stats">
                    +{file.added} {"−"}{file.deleted}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {isAssistant && message.usage.input_tokens != null && (
        <div className="chat-message__usage">
          {message.usage.input_tokens} in / {message.usage.output_tokens} out
          {message.usage.estimated_cost_usd != null && (
            <> {"·"} ${message.usage.estimated_cost_usd.toFixed(4)}</>
          )}
          {message.usage.latency_ms != null && (
            <> {"·"} {(message.usage.latency_ms / 1000).toFixed(1)}s</>
          )}
        </div>
      )}
    </div>
  );
}


/* ── Tool Call Card ─────────────────────────────────────────────── */

function ToolCallCard({
  toolCall,
  index,
  messageId,
  projectRoot,
  threadId,
  onExecuted,
  setError,
}: {
  toolCall: ChatToolCall;
  index: number;
  messageId: string;
  projectRoot: string;
  threadId: string;
  onExecuted: () => void;
  setError: (e: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [executing, setExecuting] = useState(false);

  async function handleExecute() {
    setExecuting(true);
    try {
      await executeChatToolCall(projectRoot, {
        threadId,
        assistantMessageId: messageId,
        index,
      });
      onExecuted();
    } catch (e) {
      setError(`Tool execution failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExecuting(false);
    }
  }

  const classIcon = toolCall.classification === "read" ? "○"
    : toolCall.classification === "write" ? "●"
    : "⚠";

  return (
    <div className={`tool-call-card tool-call-card--${toolCall.classification}`}>
      <div className="tool-call-card__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-card__icon">{classIcon}</span>
        <span className="tool-call-card__name">{toolCall.tool}</span>
        <span className="tool-call-card__status">
          {toolCall.executed ? "✓" : toolCall.error ? "✗" : "pending"}
        </span>
        <span className="tool-call-card__chevron">{expanded ? "▴" : "▾"}</span>
      </div>
      {expanded && (
        <div className="tool-call-card__body">
          <div className="tool-call-card__args">
            <pre>{JSON.stringify(toolCall.args, null, 2)}</pre>
          </div>
          {toolCall.result_summary && (
            <div className="tool-call-card__result">{toolCall.result_summary}</div>
          )}
          {toolCall.error && (
            <div className="tool-call-card__error">{toolCall.error}</div>
          )}
          {!toolCall.executed && !toolCall.error && (
            <button
              className="btn btn--ai btn--sm"
              onClick={handleExecute}
              disabled={executing}
            >
              {executing ? "Executing..." : `Execute ${toolCall.tool}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}


/* ── Composer with @ Mentions ───────────────────────────────────── */

function Composer({
  projectRoot,
  threadId,
  sending,
  streaming,
  scenes,
  codexEntities,
  activeThread,
  currentSceneId,
  onSend,
  onInterrupt,
  editing,
  editDiscardCount,
  onCancelEdit,
}: {
  projectRoot: string;
  threadId: string;
  sending: boolean;
  streaming: boolean;
  scenes: SceneSummary[];
  codexEntities: CodexEntity[];
  activeThread?: ChatThreadRecord;
  currentSceneId?: string;
  onSend: (text: string, sceneIds: string[], codexIds: string[], scope: AssistantScope) => Promise<boolean>;
  onInterrupt: () => void;
  editing: { messageId: string; text: string } | null;
  editDiscardCount: number;
  onCancelEdit: () => void;
}) {
  const [text, setText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [scope, setScope] = useState<AssistantScope>("project");
  const [scopeId, setScopeId] = useState("");
  const [chapters, setChapters] = useState<Array<{ id: string; title: string; scene_ids: string[] }>>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    setText(editing.text);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  }, [editing]);

  useEffect(() => {
    let active = true;
    void getManuscriptPlan(projectRoot).then((plan) => {
      if (active) setChapters(plan.acts.flatMap((act) => act.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, scene_ids: chapter.scene_ids }))));
    }).catch(() => { if (active) setChapters([]); });
    return () => { active = false; };
  }, [projectRoot]);

  const mentionResults = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const items: { kind: "scene" | "codex"; id: string; label: string; detail: string }[] = [];

    for (const s of scenes) {
      if (s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) {
        items.push({ kind: "scene", id: s.id, label: s.title || s.id, detail: s.status });
      }
      if (items.length >= 8) break;
    }
    for (const e of codexEntities) {
      if (e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q)) {
        items.push({ kind: "codex", id: e.id, label: e.name, detail: e.type });
      }
      if (items.length >= 12) break;
    }
    return items;
  }, [mentionQuery, scenes, codexEntities]);

  function handleInput(value: string) {
    setText(value);
    autoGrow();

    // Detect @ mention trigger
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = value.slice(0, pos);
    const atIdx = before.lastIndexOf("@");
    if (atIdx >= 0 && (atIdx === 0 || before[atIdx - 1] === " " || before[atIdx - 1] === "\n")) {
      const query = before.slice(atIdx + 1);
      if (!query.includes(" ") && !query.includes("\n")) {
        setMentionQuery(query);
        setMentionIndex(0);
        return;
      }
    }
    setMentionQuery(null);
  }

  function insertMention(item: { kind: string; id: string; label: string }) {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const before = text.slice(0, pos);
    const atIdx = before.lastIndexOf("@");
    const after = text.slice(pos);
    const tag = `@${item.kind}:${item.id}`;
    const newText = before.slice(0, atIdx) + tag + " " + after;
    setText(newText);
    setMentionQuery(null);
    ta.focus();
  }

  function autoGrow() {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Mention navigation
    if (mentionQuery !== null && mentionResults.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionResults.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionResults[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    // Send on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleSend() {
    if (!text.trim() || sending || !threadId) return;
    if ((scope === "chapter" || scope === "character") && !scopeId) return;
    if (scope === "scene" && !currentSceneId) return;

    const mentions = extractMentionIds(text, scenes, codexEntities);
    if (scope === "scene" && currentSceneId && !mentions.sceneIds.includes(currentSceneId)) mentions.sceneIds.push(currentSceneId);
    if (scope === "chapter") {
      for (const sceneId of chapters.find((chapter) => chapter.id === scopeId)?.scene_ids ?? []) {
        if (!mentions.sceneIds.includes(sceneId)) mentions.sceneIds.push(sceneId);
      }
    }
    if (scope === "character" && scopeId && !mentions.codexIds.includes(scopeId)) mentions.codexIds.push(scopeId);
    const msg = text;
    const sent = await onSend(msg, mentions.sceneIds, mentions.codexIds, scope);
    if (sent) {
      setText((current) => current === msg ? "" : current);
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    } else {
      textareaRef.current?.focus();
    }
  }

  const contextHints: string[] = [];
  if (activeThread) {
    if (activeThread.context_profile.include_current_scene && currentSceneId) {
      contextHints.push("scene");
    }
    if (activeThread.context_profile.include_codex !== "off") {
      contextHints.push("codex");
    }
    if (activeThread.context_profile.retrieval_mode !== "off") {
      contextHints.push("retrieval");
    }
  }

  return (
    <div className="chat-composer-wrap">
      {editing && (
        <div className="chat-edit-banner">
          <span>
            Editing an earlier message {"—"} sending replaces {editDiscardCount}{" "}
            message{editDiscardCount === 1 ? "" : "s"}.
          </span>
          <button
            className="chat-action-btn"
            onClick={() => {
              onCancelEdit();
              setText("");
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {contextHints.length > 0 && (
        <div className="chat-context-hints">
          {contextHints.map((h) => (
            <span key={h} className="chat-context-hint">{h}</span>
          ))}
          <span className="chat-context-hint chat-context-hint--tip">@ to mention</span>
        </div>
      )}
      <div className="chat-composer" style={{ position: "relative" }}>
        {mentionQuery !== null && mentionResults.length > 0 && (
          <div className="mention-autocomplete">
            {mentionResults.map((item, i) => (
              <div
                key={`${item.kind}-${item.id}`}
                className={`mention-autocomplete__item${i === mentionIndex ? " mention-autocomplete__item--active" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); insertMention(item); }}
                onMouseEnter={() => setMentionIndex(i)}
              >
                <span className="mention-autocomplete__icon">
                  {item.kind === "scene" ? "○" : "◆"}
                </span>
                <span className="mention-autocomplete__label">{item.label}</span>
                <span className="mention-autocomplete__detail">{item.detail}</span>
              </div>
            ))}
          </div>
        )}
        <div className="chat-composer__scope">
          <select className="input" aria-label="Assistant conversation scope" value={scope} disabled={sending || !threadId} onChange={(event) => { setScope(event.target.value as typeof scope); setScopeId(""); }}>
            <option value="project">Book</option>
            <option value="scene" disabled={!currentSceneId}>Scene</option>
            <option value="chapter" disabled={chapters.length === 0}>Chapter</option>
            <option value="character" disabled={codexEntities.length === 0}>Character</option>
            <option value="storyline">Storyline</option>
          </select>
          {scope === "chapter" && <select className="input" aria-label="Assistant chapter scope" value={scopeId} disabled={sending || !threadId} onChange={(event) => setScopeId(event.target.value)}><option value="">Choose…</option>{chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select>}
          {scope === "character" && <select className="input" aria-label="Assistant character scope" value={scopeId} disabled={sending || !threadId} onChange={(event) => setScopeId(event.target.value)}><option value="">Choose…</option>{codexEntities.filter((entity) => entity.type === "character").map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select>}
        </div>
        <textarea
          ref={textareaRef}
          className="chat-composer__input"
          placeholder={threadId ? "Type a message... (@ to mention)" : "Select a thread first"}
          value={text}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={!threadId || sending}
        />
        {sending && streaming ? (
          <button className="btn btn--sm" onClick={onInterrupt} title="Interrupt this turn">
            Stop
          </button>
        ) : (
          <button
            className="btn btn--ai btn--sm"
            onClick={handleSend}
            disabled={!text.trim() || sending || !threadId || ((scope === "chapter" || scope === "character") && !scopeId)}
          >
            {sending ? "…" : "Send"}
          </button>
        )}
      </div>
    </div>
  );
}


/* ── Markdown Renderer ──────────────────────────────────────────── */

function RenderedContent({ content }: { content: string }) {
  const blocks = useMemo(() => parseChatMarkdown(content), [content]);
  return (
    <>
      {blocks.map((block, index) => (
        <RenderedBlock key={index} block={block} />
      ))}
    </>
  );
}

function RenderedBlock({ block }: { block: ChatBlock }) {
  if (block.kind === "code") {
    return (
      <pre className="chat-code-block">
        <code>{block.code}</code>
      </pre>
    );
  }
  if (block.kind === "heading") {
    const spans = <Spans spans={block.spans} />;
    if (block.level === 1) return <h3 className="chat-heading">{spans}</h3>;
    if (block.level === 2) return <h4 className="chat-heading">{spans}</h4>;
    return <h5 className="chat-heading">{spans}</h5>;
  }
  if (block.kind === "list") {
    const items = block.items.map((item, i) => (
      <li key={i}>
        <Spans spans={item} />
      </li>
    ));
    return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
  }
  if (block.kind === "quote") {
    return (
      <blockquote className="chat-quote">
        <Lines lines={block.lines} />
      </blockquote>
    );
  }
  return (
    <p>
      <Lines lines={block.lines} />
    </p>
  );
}

function Lines({ lines }: { lines: ChatInlineSpan[][] }) {
  return (
    <>
      {lines.map((line, index) => (
        <span key={index}>
          <Spans spans={line} />
          {index < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

function Spans({ spans }: { spans: ChatInlineSpan[] }) {
  return (
    <>
      {spans.map((span, index) => {
        if (span.kind === "bold") return <strong key={index}>{span.text}</strong>;
        if (span.kind === "italic") return <em key={index}>{span.text}</em>;
        if (span.kind === "code") {
          return <code key={index} className="chat-inline-code">{span.text}</code>;
        }
        if (span.kind === "link" && span.href) {
          return (
            <a
              key={index}
              className="chat-link"
              href={span.href}
              target="_blank"
              rel="noopener noreferrer"
              title={span.href}
            >
              {span.text}
            </a>
          );
        }
        return <span key={index}>{span.text}</span>;
      })}
    </>
  );
}


/* ── Utilities ──────────────────────────────────────────────────── */

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function shortModel(model: string): string {
  // "openai/gpt-4.1-mini" -> "gpt-4.1-mini"
  const slash = model.lastIndexOf("/");
  const name = slash >= 0 ? model.slice(slash + 1) : model;
  return truncate(name, 18);
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens} tok`;
  return `${(tokens / 1000).toFixed(1)}k tok`;
}

function proposalTitle(content: string): string {
  const firstLine = content.split("\n").find((line) => line.trim() !== "") ?? "Chat reply";
  const clean = firstLine.replace(/^#+\s*/, "").replace(/[*`>]/g, "").trim();
  return truncate(clean === "" ? "Chat reply" : clean, 72);
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
