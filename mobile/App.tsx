import { randomUUID } from "expo-crypto";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { createAppRuntime } from "./src/app/runtime";
import type { AppProject, AppSession, PendingItem, VoiceHandle } from "./src/app/types";
import { CAPTURE_KINDS, emptyCompanionState, reconcileCompanionState, type CaptureDraft, type CompanionState } from "./src/core/companionRecovery";
import type { SnapshotProject, SnapshotScene } from "./src/core/snapshotProject";
import { initialVoiceSession, reduceVoiceSession } from "./src/voice/voiceSession";

type Tab = "scenes" | "assistant" | "capture" | "review" | "settings";
type CaptureStatus = "empty" | "draft" | "saving";
const runtime = createAppRuntime();

function Button(props: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        props.variant === "secondary" && styles.buttonSecondary,
        props.variant === "danger" && styles.buttonDanger,
        pressed && styles.pressed,
        props.disabled && styles.disabled,
      ]}
    >
      <Text style={props.variant === "secondary" ? styles.buttonSecondaryText : styles.buttonText}>
        {props.label}
      </Text>
    </Pressable>
  );
}

function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return <Text accessibilityRole="alert" style={styles.error}>{message}</Text>;
}

function SignIn({ onSignedIn, message }: { onSignedIn(session: AppSession): void; message?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      onSignedIn(await runtime.signIn(email, password));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign in failed.");
    } finally {
      setPassword("");
      setBusy(false);
    }
  };
  const openDownloads = async () => {
    setBusy(true);
    setError("");
    try { onSignedIn(await runtime.openDownloadedLibrary()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Downloaded books could not be opened."); }
    finally { setPassword(""); setBusy(false); }
  };
  if (runtime.mode === "preview") return (
    <SafeAreaView style={styles.centered}>
      <View style={styles.authCard}>
        <Text style={styles.brand}>openAuthor Companion</Text>
        <Text style={styles.h1}>Your book, away from your desk.</Text>
        <Text style={styles.body}>Read scenes, discuss your story, and capture ideas for desktop review.</Text>
        <Text style={styles.notice}>Preview only. Sign-in, book sync, and voice need a configured backend. Sample captures disappear when you reload.</Text>
        <Button label="Explore sample book" onPress={() => void runtime.signIn("preview@openauthor.local", "").then(onSignedIn)} />
      </View>
    </SafeAreaView>
  );
  return (
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
      <View style={styles.authCard}>
        <Text style={styles.brand}>openAuthor</Text>
        <Text style={styles.h1}>Your manuscript, in conversation.</Text>
        <Text style={styles.muted}>Read, capture, and talk through your story without editing prose directly from mobile.</Text>
        <TextInput
          accessibilityLabel="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor="#697386"
          style={styles.input}
          value={email}
        />
        <TextInput
          accessibilityLabel="Password"
          autoCapitalize="none"
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor="#697386"
          secureTextEntry
          style={styles.input}
          value={password}
        />
        <ErrorBanner message={error || message || ""} />
        <Button label={busy ? "Signing in…" : "Sign in"} disabled={busy} onPress={() => void submit()} />
        <Button label="Open downloaded books" variant="secondary" disabled={busy} onPress={() => void openDownloads()} />
        <Text style={styles.muted}>Previously downloaded books work without a connection. Signing out locks them until you sign in online again.</Text>
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ProjectPicker({ session, onOpen, onSignedOut, onSession }: { session: AppSession; onOpen(project: AppProject): void; onSignedOut(message?: string): void; onSession(session: AppSession | null): void }) {
  const [projects, setProjects] = useState<AppProject[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [switching, setSwitching] = useState(false);
  const switchLibrary = async () => {
    if (switching) return;
    setSwitching(true);
    setError("");
    try {
      onSession(session.downloadedOnly ? await runtime.restoreSession({ online: true }) : await runtime.openDownloadedLibrary());
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Library connection failed."); }
    finally { setSwitching(false); }
  };
  useEffect(() => {
    let active = true;
    setError("");
    runtime.projects().then((value) => { if (active) setProjects(value); }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : "Projects could not be loaded.");
    });
    return () => { active = false; };
  }, [attempt]);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.pageHeader}>
        <Text style={styles.brandSmall}>openAuthor</Text>
        <Text style={styles.h1}>{session.downloadedOnly ? "Downloaded books" : "Projects"}</Text>
      </View>
      {session.downloadedOnly && <Text style={styles.notice}>Local copies · not refreshed from desktop. Reading and captures work offline. Reconnect to the online library for voice and upload.</Text>}
      <ErrorBanner message={error} />
      {!projects && !error && <ActivityIndicator color="#7d5cff" size="large" />}
      {!!error && <Button label="Retry loading projects" variant="secondary" onPress={() => setAttempt((value) => value + 1)} />}
      {runtime.mode === "hosted" && <Button label={session.downloadedOnly ? "Reconnect to online library" : "Use downloaded books"} disabled={switching} variant="secondary" onPress={() => void switchLibrary()} />}
      <Button label="Sign out" variant="secondary" onPress={() => void runtime.signOut().then(() => onSignedOut()).catch(() => onSignedOut("Sign-out cleanup did not finish. The local view was closed; sign in to retry."))} />
      {projects?.length === 0 && <Text style={styles.empty}>{session.downloadedOnly ? "No downloaded books on this device. Connect online and open a published book first." : "No mobile-enabled projects yet. Enable one from desktop Mobile Inbox first."}</Text>}
      <ScrollView contentContainerStyle={styles.list}>
        {projects?.map((project) => (
          <Pressable
            accessibilityHint={project.downloaded ? "Opens the downloaded snapshot without refreshing it" : "Opens the latest encrypted mobile snapshot"}
            accessibilityRole="button"
            key={project.id}
            onPress={() => onOpen(project)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            <Text style={styles.cardTitle}>{project.title}</Text>
            <Text style={styles.muted}>{project.role} · {project.lastPublishedAt ? `${project.downloaded ? "downloaded" : "published"} ${new Date(project.lastPublishedAt).toLocaleString()}` : "Open to check publication"}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function BookUnlock({ projectId, onUnlocked, onEdit }: { projectId: string; onUnlocked(keyVersion: number): void; onEdit(): void }) {
  const [version, setVersion] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const unlock = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await runtime.importRecoveryKey(projectId, Number(version), code);
      if (active.current) { setCode(""); onUnlocked(Number(version)); }
    } catch (caught) {
      if (active.current) setError(caught instanceof Error ? caught.message : "The book could not be unlocked.");
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  };
  return <View style={styles.card}>
    <Text style={styles.cardTitle}>Unlock this book on your phone</Text>
    <Text style={styles.body}>Enter this book's recovery key and current version from desktop Mobile Inbox. Newly provisioned keys can be verified before a snapshot is published. Older books need an encrypted snapshot with their existing key or a reviewed key rotation on desktop. Reading still needs a published snapshot. If desktop has already shared a key with this device, use Retry opening book instead.</Text>
    <Text style={styles.muted}>The key is checked on this device and is never sent to the server. Keep it out of chat and email.</Text>
    <Text style={styles.muted}>Rotating creates a new key. It does not restore data encrypted with a missing old key.</Text>
    <TextInput accessibilityLabel="Book key version" keyboardType="number-pad" editable={!busy} onChangeText={(value) => { setVersion(value); onEdit(); }}
      placeholder="Key version, e.g. 1" placeholderTextColor="#697386" style={styles.input} value={version} />
    <TextInput accessibilityLabel="Book recovery key" autoCapitalize="none" autoCorrect={false} secureTextEntry editable={!busy}
      onChangeText={(value) => { setCode(value); onEdit(); }} placeholder="OA1-…" placeholderTextColor="#697386" style={styles.input} value={code} />
    <ErrorBanner message={error} />
    <Button label={busy ? "Checking and unlocking…" : "Verify key and open book"} disabled={busy || !version.trim() || !code.trim()}
      onPress={() => void unlock()} />
  </View>;
}

function ScenesView({ project, onScene }: { project: SnapshotProject; onScene(scene: SnapshotScene): void }) {
  const [query, setQuery] = useState("");
  const scenes = query.trim()
    ? project.search(query, 30).filter((item) => item.kind === "scene").map((item) => project.getScene(item.sourceId)).filter(Boolean) as SnapshotScene[]
    : project.listScenes();
  return (
    <ScrollView contentContainerStyle={styles.list}>
      <TextInput accessibilityLabel="Search scenes" onChangeText={setQuery} placeholder="Search scenes and characters" placeholderTextColor="#697386" style={styles.input} value={query} />
      <Text style={styles.muted}>{query.trim() ? "Search results · ranked by relevance" : project.readingOrder()}</Text>
      {scenes.length === 0 && <Text style={styles.empty}>No matching scenes in this snapshot.</Text>}
      {scenes.map((scene) => (
        <Pressable accessibilityRole="button" accessibilityLabel={`Read ${scene.title}`} key={scene.id} onPress={() => onScene(scene)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{scene.title}</Text>
            <Text style={styles.pill}>{scene.status}</Text>
          </View>
          <Text style={styles.muted}>{scene.pov || "No POV"}</Text>
          {scene.chapter_title && <Text style={styles.muted}>{[scene.act_title, scene.chapter_title].filter(Boolean).join(" · ")}</Text>}
          <Text numberOfLines={3} style={styles.body}>{scene.summary || scene.body}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function SceneReader({ project, scene, onScene, onBack, onDiscuss, scrollY, onScroll, visible }: {
  project: SnapshotProject; scene: SnapshotScene; onScene(scene: SnapshotScene): void; onBack(): void; onDiscuss(): void;
  scrollY: number; onScroll(y: number): void; visible: boolean;
}) {
  const scenes = project.listScenes();
  const position = scenes.findIndex((item) => item.id === scene.id);
  const reader = useRef<ScrollView>(null);
  const restored = useRef(false);
  const restore = () => {
    if (visible && !restored.current) { restored.current = true; reader.current?.scrollTo({ y: scrollY, animated: false }); }
  };
  useEffect(() => {
    if (visible) restore();
    else restored.current = false;
  }, [visible]);
  const previous = scenes[position - 1];
  const next = scenes[position + 1];
  return (
    <ScrollView ref={reader} contentContainerStyle={styles.reader} onContentSizeChange={restore} onLayout={restore}
      scrollEventThrottle={150} onScroll={(event) => { if (visible && restored.current) onScroll(event.nativeEvent.contentOffset.y); }}>
      <Button label="Back to scenes" onPress={onBack} variant="secondary" />
      <Text style={styles.h1}>{scene.title}</Text>
      <Text style={styles.muted}>{scene.pov} · {scene.status}</Text>
      {scene.chapter_title && <Text style={styles.muted}>{[scene.act_title, scene.chapter_title].filter(Boolean).join(" · ")}</Text>}
      <Text style={styles.muted}>Scene {position + 1} of {scenes.length} · {project.readingOrder()}</Text>
      <Button label="Discuss this scene" onPress={onDiscuss} variant="secondary" />
      <Text selectable style={styles.manuscript}>{scene.body}</Text>
      <Text style={styles.readOnly}>Read-only snapshot · edits happen on desktop</Text>
      <Button label="Previous scene" disabled={!previous} onPress={() => { if (previous) onScene(previous); }} variant="secondary" />
      <Button label="Next scene" disabled={!next} onPress={() => { if (next) onScene(next); }} variant="secondary" />
    </ScrollView>
  );
}

function CaptureView(props: {
  project: SnapshotProject; draft: CaptureDraft | null; ready: boolean; retention: string;
  onDraft(draft: CaptureDraft | null): void; persistDraft(): Promise<void>;
  onCreated(item: PendingItem): void; onStatusChange(status: CaptureStatus): void;
}) {
  const kind = props.draft?.kind ?? "capture_note";
  const text = props.draft?.text ?? "";
  const change = (nextText: string, nextKind = kind) => props.onDraft(nextText.length > 0 ? {
    operationId: randomUUID(), kind: nextKind, text: nextText,
    baseRevision: props.draft?.baseRevision ?? props.project.identity().revision,
  } : (nextKind === "capture_note" ? null : {
    operationId: randomUUID(), kind: nextKind, text: "", baseRevision: props.project.identity().revision,
  }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    props.onStatusChange(busy ? "saving" : text.length > 0 ? "draft" : "empty");
  }, [busy, text, props.onStatusChange]);
  const submit = async () => {
    if (inFlight.current || !text.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const identity = props.project.identity();
      // Persist the idempotency identity before inserting into the outbox. If
      // the app closes after insertion, retrying cannot create a duplicate.
      if (runtime.mode === "hosted") await props.persistDraft();
      const item = await runtime.capture({ projectId: identity.projectId,
        baseRevision: props.draft?.baseRevision ?? identity.revision,
        ...(props.draft ? { operationId: props.draft.operationId } : {}), kind, text });
      if (active.current) {
        props.onDraft(null);
        setMessage("Saved to the encrypted review outbox.");
        props.onCreated(item);
      }
    } catch (caught) {
      if (active.current) setMessage(caught instanceof Error ? caught.message : "Capture failed.");
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
      <Text style={styles.sectionTitle}>Capture for desktop review</Text>
      <Text style={styles.muted}>{runtime.mode === "hosted"
        ? "Unfinished captures are saved encrypted on this device. Save pending item when ready for desktop review."
        : "Your sample draft stays while switching tabs. Save it before closing this book."}</Text>
      {runtime.mode === "hosted" && <Text accessibilityLiveRegion="polite" style={styles.muted}>{props.retention}</Text>}
      {!!props.draft && props.draft.baseRevision !== props.project.identity().revision && <Text style={styles.notice}>This draft began on an earlier snapshot. Desktop will review it against that revision.</Text>}
      {runtime.mode === "preview" && <Text style={styles.notice}>Sample capture only. It is not synced and disappears on reload.</Text>}
      <View style={styles.chips}>
        {CAPTURE_KINDS.map((value) => (
          <Pressable accessibilityRole="button" aria-pressed={kind === value} accessibilityState={{ selected: kind === value, disabled: busy || !props.ready }} disabled={busy || !props.ready} key={value} onPress={() => change(text, value)} style={[styles.chip, kind === value && styles.chipActive]}>
            <Text style={kind === value ? styles.chipActiveText : styles.chipText}>{value.replaceAll("_", " ")}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel="Capture text"
        editable={!busy && props.ready}
        multiline
        maxLength={48 * 1024}
        onChangeText={(value) => change(value)}
        placeholder="A note, dictated passage, memory suggestion, or requested change…"
        placeholderTextColor="#697386"
        style={[styles.input, styles.composer]}
        textAlignVertical="top"
        value={text}
      />
      {!!message && <Text accessibilityLiveRegion="polite" style={styles.muted}>{message}</Text>}
      <Button label={busy ? "Saving…" : "Save pending item"} disabled={busy || !props.ready || !text.trim()} onPress={() => void submit()} />
    </ScrollView>
  );
}

function ReviewView({ projectId, revision }: { projectId: string; revision: string }) {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const active = useRef(false);
  const syncInFlight = useRef(false);
  const loadAttempt = useRef(0);
  const reload = useCallback(async () => {
    const attempt = ++loadAttempt.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const next = await runtime.pending(projectId);
      if (active.current && attempt === loadAttempt.current) setItems(next);
    } catch (caught) {
      if (active.current && attempt === loadAttempt.current) {
        setLoadFailed(true);
        setMessage(caught instanceof Error ? caught.message : "Review queue failed.");
      }
    } finally {
      if (active.current && attempt === loadAttempt.current) setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    active.current = true;
    void reload();
    return () => { active.current = false; loadAttempt.current++; };
  }, [reload]);
  const sync = async () => {
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    setMessage("");
    try {
      const result = await runtime.flush(projectId);
      if (active.current) setMessage(`${result.uploaded} uploaded · ${result.remaining} waiting. Open desktop to import and review uploaded items.`);
    } catch (caught) {
      if (active.current) setMessage(caught instanceof Error ? caught.message : "Sync failed.");
    } finally {
      // A partial upload can succeed before a later item fails.
      if (active.current) {
        await reload();
        if (active.current) setSyncing(false);
      }
      syncInFlight.current = false;
    }
  };
  return (
    <ScrollView contentContainerStyle={styles.list}>
      <View style={styles.rowBetween}>
        <View style={[styles.flex, { minWidth: 0 }]}><Text style={styles.sectionTitle}>Pending review</Text><Text style={styles.muted}>Snapshot {revision.slice(0, 8)}</Text></View>
        <Button label={syncing ? "Syncing…" : "Sync now"} disabled={syncing || loading} onPress={() => void sync()} variant="secondary" />
      </View>
      <Text style={styles.muted}>Saved on this device until upload. Desktop import and review happen separately.</Text>
      {!!message && <Text accessibilityLiveRegion="polite" style={styles.notice}>{message}</Text>}
      {loading && <Text style={styles.muted}>Reading saved captures…</Text>}
      {loadFailed && <Button label="Retry loading captures" disabled={loading || syncing} onPress={() => { setMessage(""); void reload(); }} variant="secondary" />}
      {!loading && !loadFailed && items.length === 0 && <Text style={styles.empty}>No items are waiting to upload from this device. Uploaded items may still need desktop review.</Text>}
      {items.map((item) => (
        <View key={item.operationId} style={styles.card}>
          <View style={styles.rowBetween}><Text style={styles.cardTitle}>{item.kind.replaceAll("_", " ")}</Text><Text style={styles.pill}>{item.status}</Text></View>
          {item.unreadable && <Text style={styles.notice}>Preview unavailable</Text>}
          <Text selectable style={styles.body}>{item.summary}</Text>
          <Text style={styles.muted}>{item.createdAt ? new Date(item.createdAt).toLocaleString() : "Capture time unavailable"}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function AssistantView({ project, sceneId, onOpenScene, onClearScene }: { project: SnapshotProject; sceneId?: string; onOpenScene(sceneId: string): void; onClearScene(): void }) {
  const [voice, dispatch] = useReducer(reduceVoiceSession, undefined, initialVoiceSession);
  const [handle, setHandle] = useState<VoiceHandle | null>(null);
  const [text, setText] = useState("");
  const [localError, setLocalError] = useState("");
  const [showContext, setShowContext] = useState(false);
  const handleRef = useRef<VoiceHandle | null>(null);
  const attemptRef = useRef<AbortController | null>(null);
  const release = useCallback(() => {
    attemptRef.current?.abort();
    attemptRef.current = null;
    handleRef.current?.stop();
    handleRef.current = null;
    setHandle(null);
  }, []);
  const stop = useCallback(() => {
    release();
    dispatch({ type: "end" });
  }, [release]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") stop();
    });
    return () => { subscription.remove(); stop(); };
  }, [stop, project, sceneId]);
  const start = async () => {
    if (attemptRef.current || handleRef.current) return;
    const attempt = new AbortController();
    attemptRef.current = attempt;
    setLocalError("");
    dispatch({ type: "start", callId: "pending" });
    try {
      const next = await runtime.startVoice({
        projectId: project.identity().projectId,
        ...(sceneId ? { currentSceneId: sceneId } : {}),
        signal: attempt.signal,
        onEvent: (event) => {
          if (attempt.signal.aborted) return;
          // These local transport errors have already closed media resources.
          // Retire the UI handle too, preserving the error and allowing retry.
          if (event.type === "session.error" && ["disconnected", "playback_failed"].includes(event.code)) release();
          dispatch(event);
        },
      });
      if (attempt.signal.aborted) { next.stop(); return; }
      handleRef.current = next;
      setHandle(next);
    } catch (caught) {
      if (attempt.signal.aborted) return;
      setLocalError(caught instanceof Error ? caught.message : "Voice could not start.");
      dispatch({ type: "end" });
    } finally {
      if (!handleRef.current && attemptRef.current === attempt) attemptRef.current = null;
    }
  };
  const send = () => {
    if (!text.trim() || !handle) return;
    try { handle.sendText(text.trim()); setText(""); }
    catch (caught) { setLocalError(caught instanceof Error ? caught.message : "Message could not be sent."); }
  };
  const citations = useMemo(() => project.search(voice.userTranscript, 3), [project, voice.userTranscript]);
  const writingVoice = project.writingVoice();
  const canon = project.acceptedCanon(sceneId);
  const staleFacts = canon?.facts.filter((fact) => fact.evidence.some((item) => item.verification !== "excerpt_present")).length ?? 0;
  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.conversation}>
        <Text style={styles.sectionTitle}>Copilot voice</Text>
        {sceneId && <Text style={styles.muted}>Discussing: {project.getScene(sceneId)?.title}</Text>}
        <Text style={styles.muted}>{canon
          ? `${canon.facts.length} accepted story ${canon.facts.length === 1 ? "fact" : "facts"} selected from this snapshot${sceneId ? " for this scene" : " for the book"}.`
          : "Accepted story facts are unavailable in this older snapshot. Publish and reopen to include them."}</Text>
        {staleFacts > 0 && <Text style={styles.notice}>{staleFacts} selected {staleFacts === 1 ? "fact has" : "facts have"} missing source passages in this snapshot. Check their evidence on desktop.</Text>}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{writingVoice ? `Writing Voice: ${writingVoice.name}` : "No Writing Voice in this snapshot"}</Text>
          <Pressable accessibilityRole="button" aria-expanded={showContext} onPress={() => setShowContext((value) => !value)} style={styles.contextToggle}>
            <Text style={styles.back}>{showContext ? "Hide context details" : "Show context details"}</Text>
          </Pressable>
          {showContext && <>
            {writingVoice && <Text style={styles.body}>{writingVoice.description}</Text>}
            <Text style={styles.muted}>{writingVoice
              ? "This session uses the downloaded profile for proposed prose, not Copilot's speaking personality."
              : "Approve a Writing Voice on desktop and publish a fresh snapshot to include it here."}</Text>
            <Text style={styles.muted}>Desktop changes are not live. Reopen the book after publication and start a new session to use an updated profile.</Text>
            {sceneId && <>
              <Text style={styles.muted}>Changing the selected scene ends active voice.</Text>
              <Button label="Discuss without a selected scene" variant="secondary" onPress={() => { stop(); setLocalError(""); onClearScene(); }} />
            </>}
          </>}
        </View>
        {!!voice.userTranscript && <View style={styles.userBubble}><Text style={styles.bubbleLabel}>You</Text><Text style={styles.body}>{voice.userTranscript}</Text></View>}
        {!!voice.assistantTranscript && <View style={styles.assistantBubble}><Text style={styles.bubbleLabel}>Copilot</Text><Text style={styles.body}>{voice.assistantTranscript}</Text></View>}
        {citations.length > 0 && <View style={styles.chips}>{citations.map((item) => (
          <Pressable
            accessibilityHint="Opens a related snapshot passage; not a verified source for the answer"
            accessibilityRole="link"
            key={`${item.kind}:${item.sourceId}`}
            onPress={() => { if (item.kind === "scene") { stop(); onOpenScene(item.sourceId); } }}
          >
            <Text style={styles.citation}>Related: {item.title}</Text>
          </Pressable>
        ))}</View>}
        {!voice.userTranscript && !voice.assistantTranscript && <Text style={styles.empty}>Start voice, then speak or type. Copilot can discuss this snapshot and queue suggestions, not edit your manuscript.</Text>}
      </ScrollView>
      <View style={styles.sessionStatus}>
        <Text style={styles.muted}>Status: {voice.status}{voice.muted ? " · muted" : ""}</Text>
        <Text style={styles.muted}>Voice uses OpenAI. Selected story context and microphone audio are sent for this session.</Text>
        <ErrorBanner message={localError || voice.error?.message || ""} />
      </View>
      <View style={styles.voiceControls}>
        {!handle ? (voice.status === "connecting" ? <Button label="Cancel connection" variant="secondary" onPress={stop} /> : <Button label="Start voice" disabled={runtime.mode === "preview"} onPress={() => void start()} />) : <>
          <Button label={voice.muted ? "Unmute" : "Mute"} onPress={() => { handle.mute(!voice.muted); dispatch({ type: "mute.changed", muted: !voice.muted }); }} variant="secondary" />
          {voice.status === "speaking" && <Button label="Interrupt" onPress={() => { try { handle.interrupt(); } catch { setLocalError("Voice connection is no longer active."); } }} variant="secondary" />}
          <Button label="End" onPress={stop} variant="danger" />
        </>}
      </View>
      {!!handle && <View style={styles.textComposer}>
        <TextInput accessibilityLabel="Message Copilot" onChangeText={setText} placeholder="Type to the same conversation" placeholderTextColor="#697386" style={[styles.input, styles.flex]} value={text} />
        <Button label="Send" disabled={!text.trim()} onPress={send} />
      </View>}
    </View>
  );
}

function SettingsView({ projectId, onSignedOut, requestLeave }: { projectId: string; onSignedOut(message?: string): void; requestLeave(action: () => void): void }) {
  const [recovery, setRecovery] = useState("");
  const [restoreCode, setRestoreCode] = useState("");
  const [restoreVersion, setRestoreVersion] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const erase = () => {
    const message = "This revokes the device and deletes its local keys, snapshots, and pending captures. Unsynced work cannot be recovered.";
    const remove = () => void runtime.revokeDeviceAndDeleteLocalData().then(() => onSignedOut()).catch(() => onSignedOut("The local view was closed. Device cleanup did not finish; reconnect to complete revocation."));
    if (Platform.OS === "web") { if (globalThis.confirm(`Remove this device?\n\n${message}`)) remove(); }
    else Alert.alert("Remove this device?", message, [{ text: "Cancel", style: "cancel" }, { text: "Remove device", style: "destructive", onPress: remove }]);
  };
  const exportKey = async () => {
    try {
      const result = await runtime.exportRecoveryKey(projectId);
      setRecovery(`Version ${result.keyVersion}\n${result.recoveryKey}`);
      setRecoveryMessage("Keep this offline. Anyone with it can decrypt this project snapshot.");
    } catch (caught) {
      setRecoveryMessage(caught instanceof Error ? caught.message : "Recovery key export failed.");
    }
  };
  const restoreKey = async () => {
    const keyVersion = Number(restoreVersion);
    try {
      await runtime.importRecoveryKey(projectId, keyVersion, restoreCode);
      setRestoreCode("");
      setRecoveryMessage(`Project key version ${keyVersion} restored to secure storage.`);
    } catch (caught) {
      setRecoveryMessage(caught instanceof Error ? caught.message : "Recovery key import failed.");
    }
  };
  return (
    <ScrollView contentContainerStyle={styles.list}>
      <Text style={styles.sectionTitle}>Privacy & security</Text>
      <View style={styles.card}><Text style={styles.cardTitle}>Foreground voice only</Text><Text style={styles.body}>Microphone capture stops whenever openAuthor leaves the foreground. No background audio mode is enabled.</Text></View>
      <View style={styles.card}><Text style={styles.cardTitle}>Downloaded books</Text><Text style={styles.body}>Downloaded copies and saved captures remain on this device until you remove them. They may not reflect remote access or book changes. Signing out locks local access until you sign in online again.</Text></View>
      <View style={styles.card}><Text style={styles.cardTitle}>Encrypted mobile data</Text><Text style={styles.body}>{Platform.OS === "web" ? "Local data is encrypted in this browser profile, not an OS keychain. Other scripts from this origin can access it. Use a trusted device; clearing site data removes unsynced work." : "Project keys stay in device secure storage."} Hosted snapshots and pending items contain ciphertext.</Text></View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Project recovery key</Text>
        <Text style={styles.body}>Export a printable key or restore a specific project-key version. Never send this key through chat or email.</Text>
        <Button label="Reveal recovery key" variant="secondary" onPress={() => void exportKey()} />
        {!!recovery && <Text accessibilityLabel="Project recovery key" selectable style={styles.recoveryKey}>{recovery}</Text>}
        <TextInput accessibilityLabel="Recovery key version" keyboardType="number-pad" onChangeText={setRestoreVersion} placeholder="Key version" placeholderTextColor="#697386" style={styles.input} value={restoreVersion} />
        <TextInput accessibilityLabel="Recovery key" autoCapitalize="none" autoCorrect={false} secureTextEntry onChangeText={setRestoreCode} placeholder="OA1-…" placeholderTextColor="#697386" style={styles.input} value={restoreCode} />
        <Button label="Restore recovery key" variant="secondary" disabled={!restoreVersion || !restoreCode.trim()} onPress={() => void restoreKey()} />
        {!!recoveryMessage && <Text accessibilityLiveRegion="polite" style={styles.muted}>{recoveryMessage}</Text>}
      </View>
      <Button label="Sign out" variant="secondary" onPress={() => requestLeave(() => void runtime.signOut().then(() => onSignedOut()).catch(() => onSignedOut("Sign-out cleanup did not finish. The local view was closed; sign in to retry.")))} />
      <Button label="Revoke device and delete local data" variant="danger" onPress={() => requestLeave(erase)} />
    </ScrollView>
  );
}

function ProjectShell({ selected, onExit, onSignedOut }: { selected: AppProject; onExit(): void; onSignedOut(message?: string): void }) {
  const [loaded, setLoaded] = useState<{ project: SnapshotProject; freshness: string; offline: boolean } | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("scenes");
  const [scene, setScene] = useState<SnapshotScene | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [verifiedKeyVersion, setVerifiedKeyVersion] = useState<number | null>(null);
  const [recovery, setRecovery] = useState<CompanionState>(emptyCompanionState);
  const recoveryRef = useRef(recovery);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [retention, setRetention] = useState("Reading saved drafts…");
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const writeRef = useRef<Promise<void>>(Promise.resolve());
  const writeSequence = useRef(0);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const persist = (value: CompanionState): Promise<void> => {
    if (!recoveryReady || runtime.mode === "preview") return Promise.resolve();
    const sequence = ++writeSequence.current;
    setRetention("Saving reading position and capture draft…");
    const write = writeRef.current.catch(() => {}).then(() => runtime.saveCompanionState(selected.id, value));
    writeRef.current = write;
    void write.then(() => {
      if (mounted.current && sequence === writeSequence.current) { setRecoveryError(""); setRetention("Reading position and capture draft saved on this device."); }
    }).catch(() => {
      if (mounted.current && sequence === writeSequence.current) {
        setRecoveryError("Recovery could not be saved. Your current draft is still here; retry before closing the app.");
        setRetention("Draft changes are not saved for restart.");
      }
    });
    return write;
  };
  const updateRecovery = (next: CompanionState) => {
    recoveryRef.current = next;
    setRecovery(next);
    void persist(next).catch(() => {});
  };
  const chooseTab = (value: Tab) => {
    setTab(value);
    if (value === "scenes" || value === "capture" || value === "review") updateRecovery({ ...recoveryRef.current, tab: value });
  };
  const chooseScene = (value: SnapshotScene | null) => {
    setScene(value);
    updateRecovery({ ...recoveryRef.current, reading: value && loaded ? {
      sceneId: value.id, revision: loaded.project.identity().revision, scrollY: 0,
    } : null });
  };
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("empty");
  const [captureRevision, setCaptureRevision] = useState(0);
  const [leaveMessage, setLeaveMessage] = useState("");
  useEffect(() => { setLeaveMessage(""); }, [captureStatus]);
  const requestLeave = (action: () => void) => {
    if (captureStatus === "saving") {
      setLeaveMessage("Your capture is still saving. Please wait before leaving this book.");
      return;
    }
    if (runtime.mode === "hosted") {
      if (!recoveryReady) { action(); return; }
      setLeaveMessage("Saving reading position and draft before leaving…");
      void persist(recoveryRef.current).then(() => { if (mounted.current) action(); }).catch(() => {
        if (mounted.current) setLeaveMessage("The draft could not be saved for restart. Keep this book open and retry, or save it to the review outbox.");
      });
      return;
    }
    if (captureStatus === "empty") { action(); return; }
    const message = "Your unfinished capture has not been saved. Stay and choose Save pending item to keep it, or discard the draft and leave.";
    if (Platform.OS === "web") {
      if (globalThis.confirm(`Discard unfinished capture?\n\n${message}`)) action();
    } else {
      Alert.alert("Discard unfinished capture?", message, [
        { text: "Stay", style: "cancel" },
        { text: "Discard and leave", style: "destructive", onPress: action },
      ]);
    }
  };
  useEffect(() => {
    let active = true;
    setError("");
    runtime.openProject(selected.id).then(async (value) => {
      if (!active) return;
      setLoaded(value);
      try {
        const saved = reconcileCompanionState(value.project, await runtime.loadCompanionState(selected.id));
        if (!active) return;
        recoveryRef.current = saved;
        setRecovery(saved);
        setScene(saved.reading ? value.project.getScene(saved.reading.sceneId) : null);
        setTab(saved.tab);
        setRecoveryReady(true);
        setRecoveryError("");
        setRetention("Reading position and capture draft saved on this device.");
      } catch {
        if (active) { setRecoveryReady(false); setRecoveryError("Saved recovery could not be unlocked. Reading remains available; retry to restore your capture. No saved work was deleted."); }
      }
    })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Project could not be opened."); });
    return () => { active = false; };
  }, [selected.id, attempt, recoveryAttempt]);
  if (!loaded) return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.list}>
    <Text style={styles.h1}>{selected.title}</Text>
    <ErrorBanner message={error} />
    {verifiedKeyVersion !== null && <Text accessibilityLiveRegion="polite" style={styles.notice}>Key version {verifiedKeyVersion} verified and saved on this device. Publish a snapshot from desktop to read this book.</Text>}
    {!error && <ActivityIndicator color="#7d5cff" size="large" />}
    {!!error && <>
      <Button label="Retry opening book" variant="secondary" onPress={() => setAttempt((value) => value + 1)} />
      {runtime.mode === "hosted" && <BookUnlock key={selected.id} projectId={selected.id} onEdit={() => setVerifiedKeyVersion(null)}
        onUnlocked={(keyVersion) => { setVerifiedKeyVersion(keyVersion); setAttempt((value) => value + 1); }} />}
    </>}
    <Button label="Back to projects" variant="secondary" onPress={onExit} />
  </ScrollView></SafeAreaView>;
  if (!recoveryReady && !recoveryError) return <SafeAreaView style={styles.safe}>
    <View style={styles.pageHeader}><Text style={styles.h1}>{selected.title}</Text></View>
    <ActivityIndicator color="#7d5cff" size="large" />
    <Text accessibilityLiveRegion="polite" style={styles.muted}>Restoring your reading position and unfinished capture…</Text>
    <Button label="Back to projects" variant="secondary" onPress={onExit} />
  </SafeAreaView>;
  const identity = loaded.project.identity();
  return (
    <SafeAreaView style={styles.safe}>
      {runtime.mode === "preview" && <Text style={styles.notice}>Sample book · voice and sync unavailable</Text>}
      <View style={styles.projectHeader}>
        <Pressable accessibilityRole="button" style={styles.backButton} onPress={() => requestLeave(onExit)}><Text style={styles.back}>‹ Projects</Text></Pressable>
        <View style={styles.flex}><Text numberOfLines={1} style={styles.projectTitle}>{selected.title}</Text><Text style={styles.muted}>{loaded.freshness}{loaded.offline ? " · downloaded copy" : ""}</Text></View>
      </View>
      <ErrorBanner message={leaveMessage} />
      <ErrorBanner message={recoveryError} />
      {!!recoveryError && <Button label="Retry reading and capture recovery" variant="secondary" onPress={() => {
        if (recoveryReady) void persist(recoveryRef.current).catch(() => {});
        else setRecoveryAttempt((value) => value + 1);
      }} />}
      {!recoveryReady && !recoveryError && <Text accessibilityLiveRegion="polite" style={styles.muted}>Reading saved drafts…</Text>}
      <View style={styles.flex}>
        {/* Keep only passive reading/capture views mounted across tabs. Voice
            must still unmount and stop the microphone when leaving Assistant. */}
        <View accessibilityElementsHidden={tab !== "scenes"} importantForAccessibility={tab === "scenes" ? "auto" : "no-hide-descendants"} style={[styles.flex, tab !== "scenes" && styles.hidden]}>
          {scene ? <SceneReader key={scene.id} project={loaded.project} scene={scene} onScene={chooseScene} onBack={() => chooseScene(null)} onDiscuss={() => setTab("assistant")}
            visible={tab === "scenes"} scrollY={recovery.reading?.scrollY ?? 0} onScroll={(y) => {
              const current = recoveryRef.current;
              if (current.reading && Math.abs(current.reading.scrollY - y) >= 1) updateRecovery({ ...current, reading: { ...current.reading, scrollY: y } });
            }} /> : <ScenesView project={loaded.project} onScene={chooseScene} />}
        </View>
        {tab === "assistant" && <AssistantView
          project={loaded.project}
          onClearScene={() => chooseScene(null)}
          {...(scene ? { sceneId: scene.id } : {})}
          onOpenScene={(sceneId) => {
            const cited = loaded.project.getScene(sceneId);
            if (cited) {
              chooseScene(cited);
              chooseTab("scenes");
            }
          }}
        />}
        <View accessibilityElementsHidden={tab !== "capture"} importantForAccessibility={tab === "capture" ? "auto" : "no-hide-descendants"} style={[styles.flex, tab !== "capture" && styles.hidden]}>
          <CaptureView project={loaded.project} draft={recovery.capture} ready={recoveryReady} retention={retention}
            onDraft={(draft) => updateRecovery({ ...recoveryRef.current, capture: draft })}
            persistDraft={() => persist(recoveryRef.current)} onStatusChange={setCaptureStatus} onCreated={() => {
            setCaptureRevision((value) => value + 1);
            if (tab === "capture") chooseTab("review");
          }} />
        </View>
        {tab === "review" && <ReviewView key={captureRevision} projectId={identity.projectId} revision={identity.revision} />}
        {tab === "settings" && <SettingsView projectId={identity.projectId} onSignedOut={onSignedOut} requestLeave={requestLeave} />}
      </View>
      <View accessibilityRole="tablist" style={styles.tabBar}>
        {(["scenes", "assistant", "capture", "review", "settings"] as const).map((value) => (
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: tab === value }} aria-selected={tab === value} key={value} onPress={() => chooseTab(value)} style={styles.tab}>
            <Text style={tab === value ? styles.tabTextActive : styles.tabText}>{value[0]?.toUpperCase()}{value.slice(1)}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  const [restoring, setRestoring] = useState(true);
  const [session, setSession] = useState<AppSession | null>(null);
  const [project, setProject] = useState<AppProject | null>(null);
  const [restoreError, setRestoreError] = useState("");
  const restoreAttempt = useRef(0);
  useEffect(() => runtime.subscribeLocalAccessLock(() => {
    restoreAttempt.current++;
    setProject(null);
    setSession(null);
    setRestoring(false);
    setRestoreError("Local access was locked. Sign in online to reopen downloaded books.");
  }), []);
  useEffect(() => {
    const attempt = ++restoreAttempt.current;
    runtime.restoreSession().then((value) => { if (attempt === restoreAttempt.current) setSession(value); })
      .catch(() => { if (attempt === restoreAttempt.current) setSession(null); })
      .finally(() => { if (attempt === restoreAttempt.current) setRestoring(false); });
    return () => { restoreAttempt.current++; };
  }, []);
  const openDownloads = async () => {
    const attempt = ++restoreAttempt.current;
    try {
      const value = await runtime.openDownloadedLibrary();
      if (attempt === restoreAttempt.current) { setSession(value); setRestoring(false); }
    } catch (caught) {
      if (attempt === restoreAttempt.current) {
        setRestoreError(caught instanceof Error ? caught.message : "Downloaded books could not be opened.");
        setRestoring(false);
      }
    }
  };
  if (restoring) return <SafeAreaView style={styles.centered}>
    <ActivityIndicator color="#7d5cff" size="large" />
    <Text style={styles.muted}>Connecting to your library…</Text>
    {runtime.mode === "hosted" && <Button label="Open downloaded books" variant="secondary" onPress={() => void openDownloads()} />}
  </SafeAreaView>;
  return <><StatusBar style="light" />{!session ? <SignIn message={restoreError} onSignedIn={(value) => { setRestoreError(""); setSession(value); }} /> : project ? <ProjectShell key={project.id} selected={project} onExit={() => setProject(null)} onSignedOut={(message) => { setProject(null); setSession(null); setRestoreError(message ?? ""); }} /> : <ProjectPicker key={session.downloadedOnly ? "downloaded" : "online"} session={session} onSession={setSession} onOpen={setProject} onSignedOut={(message) => { setSession(null); setRestoreError(message ?? ""); }} />}</>;
}

const colors = { bg: "#0c0d12", surface: "#171923", border: "#2a2e3d", text: "#f4f1ff", muted: "#a8adbd", accent: "#7d5cff", danger: "#c84762" };
const styles = StyleSheet.create({
  hidden: { display: "none" },
  backButton: { minHeight: 48, justifyContent: "center" },
  contextToggle: { minHeight: 44, justifyContent: "center" },
  sessionStatus: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  safe: { flex: 1, backgroundColor: colors.bg }, flex: { flex: 1 }, centered: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: 24, gap: 18 },
  authScroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  authCard: { gap: 16, backgroundColor: colors.surface, borderRadius: 24, borderWidth: 1, borderColor: colors.border, padding: 24 },
  brand: { color: "#b8a7ff", fontSize: 18, fontWeight: "800", letterSpacing: 1 }, brandSmall: { color: "#b8a7ff", fontSize: 15, fontWeight: "800" },
  h1: { color: colors.text, fontSize: 29, lineHeight: 35, fontWeight: "700" }, sectionTitle: { color: colors.text, fontSize: 22, fontWeight: "700" }, projectTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 }, body: { color: colors.text, fontSize: 16, lineHeight: 24 }, manuscript: { color: colors.text, fontSize: 18, lineHeight: 30, paddingVertical: 14 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: 13, paddingHorizontal: 15, paddingVertical: 12, color: colors.text, backgroundColor: "#11131a", fontSize: 16 }, composer: { minHeight: 180 },
  button: { minHeight: 50, minWidth: 88, borderRadius: 13, backgroundColor: colors.accent, paddingHorizontal: 18, paddingVertical: 14, alignItems: "center", justifyContent: "center" }, buttonSecondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#625b7a" }, buttonDanger: { backgroundColor: colors.danger }, buttonText: { color: "#fff", fontWeight: "700" }, buttonSecondaryText: { color: colors.text, fontWeight: "700" }, pressed: { opacity: 0.72 }, disabled: { opacity: 0.42 },
  error: { color: "#ff9aaf", backgroundColor: "#351821", borderRadius: 10, padding: 12 }, notice: { color: "#d7ceff", backgroundColor: "#242038", borderRadius: 10, padding: 12 },
  pageHeader: { padding: 20, gap: 5 }, projectHeader: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border }, back: { color: "#b8a7ff", fontSize: 16 },
  list: { padding: 16, gap: 13, paddingBottom: 30 }, card: { gap: 8, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16 }, cardTitle: { color: colors.text, fontSize: 17, fontWeight: "700", flexShrink: 1 }, rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  pill: { color: "#cfc4ff", backgroundColor: "#2d2750", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, overflow: "hidden", fontSize: 12 }, empty: { color: colors.muted, textAlign: "center", padding: 30, lineHeight: 23 },
  reader: { padding: 20, gap: 12, paddingBottom: 50 }, readOnly: { color: colors.muted, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 18 },
  recoveryKey: { color: colors.text, backgroundColor: "#101118", borderRadius: 10, padding: 12, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), lineHeight: 21 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, chip: { minHeight: 48, justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9 }, chipActive: { backgroundColor: "#3b2e79", borderColor: "#7964d9" }, chipText: { color: colors.muted }, chipActiveText: { color: colors.text }, citation: { color: "#cfc4ff", backgroundColor: "#25203f", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, overflow: "hidden" },
  conversation: { padding: 16, gap: 14, paddingBottom: 24 }, userBubble: { alignSelf: "flex-end", maxWidth: "88%", backgroundColor: "#342a61", borderRadius: 16, padding: 14, gap: 5 }, assistantBubble: { alignSelf: "flex-start", maxWidth: "92%", backgroundColor: colors.surface, borderRadius: 16, padding: 14, gap: 5 }, bubbleLabel: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  voiceControls: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 8 }, textComposer: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.border },
  tabBar: { minHeight: 64, flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: "#111219" }, tab: { flex: 1, minHeight: 56, alignItems: "center", justifyContent: "center", paddingHorizontal: 2 }, tabText: { color: "#a8adbd", fontSize: 12 }, tabTextActive: { color: "#c7bbff", fontSize: 12, fontWeight: "800" },
});
