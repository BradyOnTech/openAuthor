import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useEditor } from "../../contexts/EditorContext";
import {
  createChatThread,
  updateChatThread,
  sendChatMessage,
  executeChatToolCall,
} from "../../api";
import type {
  ChatThreadRecord,
  ChatMessageRecord,
  ChatToolCall,
  ChatSendResult,
  ProposalProvider,
  SceneSummary,
  CodexEntity,
} from "../../types";

export function ChatPanel() {
  const {
    projectFound, projectRoot,
    chatThreads, refreshChatThreads,
    activeChatThreadId, setActiveChatThreadId,
    chatMessages, setChatMessages, refreshChatMessages,
    chatSending, setChatSending,
    scenes, codexEntities,
    runtimeConfig,
    setError, setMessage,
  } = useWorkspace();
  const { tabs, activeTabId } = useEditor();

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

  return (
    <div className="chat-panel">
      <ThreadHeader
        threads={chatThreads}
        activeThread={activeThread}
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
        projectRoot={projectRoot}
        threadId={activeChatThreadId}
        onToolExecuted={refreshChatMessages}
        setError={setError}
      />
      <Composer
        projectRoot={projectRoot}
        threadId={activeChatThreadId}
        currentSceneId={currentSceneId}
        sending={chatSending}
        scenes={scenes}
        codexEntities={codexEntities}
        activeThread={activeThread}
        onSend={async (text, mentionedSceneIds, mentionedCodexIds) => {
          if (!activeChatThreadId || !text.trim()) return;
          setChatSending(true);
          try {
            const result = await sendChatMessage(projectRoot, {
              threadId: activeChatThreadId,
              message: text,
              currentSceneId,
              sceneIds: mentionedSceneIds,
              codexIds: mentionedCodexIds,
            });
            setChatMessages((prev) => [
              ...prev,
              result.user_message,
              result.assistant_message,
              ...result.tool_messages,
            ]);
          } catch (e) {
            setError(`Chat send failed: ${e instanceof Error ? e.message : String(e)}`);
          } finally {
            setChatSending(false);
          }
        }}
        setError={setError}
      />
    </div>
  );
}


/* ── Thread Header ──────────────────────────────────────────────── */

function ThreadHeader({
  threads,
  activeThread,
  runtimeConfig,
  projectRoot,
  onSelectThread,
  onThreadCreated,
  onThreadUpdated,
  setError,
}: {
  threads: ChatThreadRecord[];
  activeThread?: ChatThreadRecord;
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

  const availableProviders = useMemo(() => {
    if (!runtimeConfig) return [];
    const providers: { id: ProposalProvider; model: string }[] = [];
    const p = runtimeConfig.providers;
    if (p["openai-codex"].credential_present) providers.push({ id: "openai-codex", model: p["openai-codex"].default_model });
    if (p.openai.credential_present) providers.push({ id: "openai", model: p.openai.default_model });
    if (p.anthropic.credential_present) providers.push({ id: "anthropic", model: p.anthropic.default_model });
    if (p.openrouter.credential_present) providers.push({ id: "openrouter", model: p.openrouter.default_model });
    providers.push({ id: "local", model: p.local.default_model });
    return providers;
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
          <span className="chat-header__chevron">{"\u25BE"}</span>
        </button>
      </div>

      <div className="chat-header__right">
        {activeThread && (
          <button
            className={`chat-header__mode-badge chat-header__mode-badge--${activeThread.mode}`}
            onClick={handleToggleMode}
            title={`Mode: ${activeThread.mode}. Click to toggle.`}
          >
            {activeThread.mode === "agent" ? "\u2699" : "\u2728"} {activeThread.mode}
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
                {shortModel(t.model)} {"\u00B7"} {timeAgo(t.updated_at)}
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
  projectRoot,
  threadId,
  onToolExecuted,
  setError,
}: {
  messages: ChatMessageRecord[];
  sending: boolean;
  projectRoot: string;
  threadId: string;
  onToolExecuted: () => void;
  setError: (e: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, sending, autoScroll]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }

  if (messages.length === 0 && !sending) {
    return (
      <div className="chat-panel__messages">
        <div className="chat-empty">
          <div className="chat-empty__icon">{"\u2728"}</div>
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
          onToolExecuted={onToolExecuted}
          setError={setError}
        />
      ))}
      {sending && (
        <div className="chat-message chat-message--typing">
          <div className="chat-message__header">
            <span className="chat-message__role chat-message__role--assistant">assistant</span>
          </div>
          <div className="chat-typing-indicator">
            <span /><span /><span />
          </div>
        </div>
      )}
      <div ref={bottomRef} />
      {!autoScroll && (
        <button
          className="chat-scroll-btn"
          onClick={() => {
            setAutoScroll(true);
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          {"\u2193"} Latest
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
  onToolExecuted,
  setError,
}: {
  message: ChatMessageRecord;
  projectRoot: string;
  threadId: string;
  onToolExecuted: () => void;
  setError: (e: string) => void;
}) {
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

      {message.role === "assistant" && message.usage.input_tokens != null && (
        <div className="chat-message__usage">
          {message.usage.input_tokens} in / {message.usage.output_tokens} out
          {message.usage.estimated_cost_usd != null && (
            <> {"\u00B7"} ${message.usage.estimated_cost_usd.toFixed(4)}</>
          )}
          {message.usage.latency_ms != null && (
            <> {"\u00B7"} {(message.usage.latency_ms / 1000).toFixed(1)}s</>
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

  const classIcon = toolCall.classification === "read" ? "\u25CB"
    : toolCall.classification === "write" ? "\u25CF"
    : "\u26A0";

  return (
    <div className={`tool-call-card tool-call-card--${toolCall.classification}`}>
      <div className="tool-call-card__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-card__icon">{classIcon}</span>
        <span className="tool-call-card__name">{toolCall.tool}</span>
        <span className="tool-call-card__status">
          {toolCall.executed ? "\u2713" : toolCall.error ? "\u2717" : "pending"}
        </span>
        <span className="tool-call-card__chevron">{expanded ? "\u25B4" : "\u25BE"}</span>
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
  currentSceneId,
  sending,
  scenes,
  codexEntities,
  activeThread,
  onSend,
  setError,
}: {
  projectRoot: string;
  threadId: string;
  currentSceneId?: string;
  sending: boolean;
  scenes: SceneSummary[];
  codexEntities: CodexEntity[];
  activeThread?: ChatThreadRecord;
  onSend: (text: string, sceneIds: string[], codexIds: string[]) => Promise<void>;
  setError: (e: string) => void;
}) {
  const [text, setText] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

    // Extract @mentions
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

    const msg = text;
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await onSend(msg, [...sceneIds], [...codexIds]);
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
                  {item.kind === "scene" ? "\u25CB" : "\u25C6"}
                </span>
                <span className="mention-autocomplete__label">{item.label}</span>
                <span className="mention-autocomplete__detail">{item.detail}</span>
              </div>
            ))}
          </div>
        )}
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
        <button
          className="btn btn--ai btn--sm"
          onClick={handleSend}
          disabled={!text.trim() || sending || !threadId}
        >
          {sending ? "\u2026" : "Send"}
        </button>
      </div>
    </div>
  );
}


/* ── Simple Content Renderer ────────────────────────────────────── */

function RenderedContent({ content }: { content: string }) {
  // Simple renderer: code blocks, bold, italic, line breaks
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const inner = part.slice(3, -3);
          const nlIdx = inner.indexOf("\n");
          const code = nlIdx >= 0 ? inner.slice(nlIdx + 1) : inner;
          return (
            <pre key={i} className="chat-code-block">
              <code>{code}</code>
            </pre>
          );
        }
        return <InlineText key={i} text={part} />;
      })}
    </>
  );
}

function InlineText({ text }: { text: string }) {
  // Split into paragraphs
  const paragraphs = text.split(/\n\n+/);
  return (
    <>
      {paragraphs.map((p, i) => {
        if (!p.trim()) return null;
        const lines = p.split("\n");
        return (
          <p key={i}>
            {lines.map((line, lineIndex) => (
              <span key={`${i}-${lineIndex}`}>
                {renderInlineText(line, `${i}-${lineIndex}`)}
                {lineIndex < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

function renderInlineText(text: string, keyPrefix: string): React.ReactNode[] {
  const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const pieces = text.split(tokenPattern).filter((piece) => piece !== "");
  return pieces.map((piece, index) => {
    const key = `${keyPrefix}-${index}`;
    if (piece.startsWith("**") && piece.endsWith("**")) {
      return <strong key={key}>{piece.slice(2, -2)}</strong>;
    }
    if (piece.startsWith("*") && piece.endsWith("*")) {
      return <em key={key}>{piece.slice(1, -1)}</em>;
    }
    if (piece.startsWith("`") && piece.endsWith("`")) {
      return <code key={key} className="chat-inline-code">{piece.slice(1, -1)}</code>;
    }
    return <span key={key}>{piece}</span>;
  });
}


/* ── Utilities ──────────────────────────────────────────────────── */

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "\u2026";
}

function shortModel(model: string): string {
  // "openai/gpt-4.1-mini" -> "gpt-4.1-mini"
  const slash = model.lastIndexOf("/");
  const name = slash >= 0 ? model.slice(slash + 1) : model;
  return truncate(name, 18);
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
