export type AssistantChannel = "text" | "desktop_voice" | "mobile_voice";
export type VoiceChannel = "desktop_voice" | "mobile_voice";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface ContractRecord {
  readonly schema: string;
  readonly schema_version: 1;
}

export interface ContextPackReference extends ContractRecord {
  readonly schema: "openauthor.context-pack.reference";
  readonly pack_id: string;
  readonly project_id: string;
  readonly project_revision: string;
  readonly content_sha256: string;
}

export type ContextScope =
  | "adaptive"
  | "project"
  | "scene"
  | "chapter"
  | "character"
  | "storyline";

export type ContextItemKind =
  | "selection"
  | "scene"
  | "codex_entity"
  | "retrieval"
  | "continuity"
  | "book_index";

export interface ContextPackProjectionItem {
  readonly reference: string;
  readonly kind: ContextItemKind;
  readonly title: string;
  readonly content: string;
  readonly content_sha256: string;
  readonly source_revision: string;
  readonly authority: number;
  readonly retrieval_score?: number;
}

export interface ContextPackProjection extends ContractRecord {
  readonly schema: "openauthor.context-pack.projection";
  readonly pack_id: string;
  readonly project_id: string;
  readonly project_revision: string;
  readonly thread_id: string;
  readonly channel: AssistantChannel;
  readonly scope: ContextScope;
  readonly created_at: string;
  readonly items: readonly ContextPackProjectionItem[];
  readonly warnings: readonly string[];
}

export type AssistantTurnStatus =
  | "accepted"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "superseded";

export interface ContractError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface AssistantTurn extends ContractRecord {
  readonly schema: "openauthor.assistant.turn";
  readonly turn_id: string;
  readonly thread_id: string;
  readonly project_id: string;
  readonly project_revision: string;
  readonly channel: AssistantChannel;
  readonly request_sha256: string;
  readonly status: AssistantTurnStatus;
  readonly created_at: string;
  readonly started_at?: string;
  readonly completed_at?: string;
  readonly context_pack?: ContextPackReference;
  readonly message_ids: readonly string[];
  readonly tool_call_ids: readonly string[];
  readonly error?: ContractError;
  readonly superseded_by?: string;
  readonly revision: number;
}

export type ToolEffect = "read" | "propose" | "mutate" | "risky";

export interface ToolCall extends ContractRecord {
  readonly schema: "openauthor.assistant.tool-call";
  readonly call_id: string;
  readonly turn_id: string;
  readonly project_id: string;
  readonly project_revision: string;
  readonly channel: AssistantChannel;
  readonly tool_name: string;
  readonly effect: ToolEffect;
  readonly arguments: JsonObject;
  readonly arguments_sha256: string;
  readonly requested_at: string;
}

export type ToolOutcomeStatus = "succeeded" | "failed" | "denied" | "cancelled";

export interface ToolOutcome extends ContractRecord {
  readonly schema: "openauthor.assistant.tool-outcome";
  readonly outcome_id: string;
  readonly call_id: string;
  readonly turn_id: string;
  readonly project_id: string;
  readonly project_revision: string;
  readonly status: ToolOutcomeStatus;
  readonly completed_at: string;
  readonly result?: JsonObject;
  readonly result_sha256?: string;
  readonly side_effect_sha256?: string;
  readonly error?: ContractError;
}

export type VoiceSessionState =
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error"
  | "ended";

export interface VoiceSession extends ContractRecord {
  readonly schema: "openauthor.voice.session";
  readonly session_id: string;
  readonly project_id: string;
  readonly project_revision: string;
  readonly device_id: string;
  readonly channel: VoiceChannel;
  readonly state: VoiceSessionState;
  readonly transport: "webrtc";
  readonly model: string;
  readonly voice: string;
  readonly context_pack: ContextPackReference;
  readonly audio_retention: "none";
  readonly transcript_retention: "none" | "project_chat";
  readonly started_at: string;
  readonly ended_at?: string;
  readonly last_event_sequence: number;
}

export interface MobileSnapshotManifest extends ContractRecord {
  readonly schema: "openauthor.mobile.snapshot.manifest";
  readonly project_id: string;
  readonly revision: string;
  readonly content_sha256: string;
  readonly byte_length: number;
}

export interface ProjectPayloadEncryption {
  readonly algorithm: "aes-256-gcm-v1";
  readonly project_key_version: number;
  readonly aad_version: 1;
}

export interface EncryptedSnapshotBlobMetadata extends ContractRecord {
  readonly schema: "openauthor.mobile.snapshot.blob";
  readonly snapshot_id: string;
  readonly project_id: string;
  readonly project_revision: string;
  readonly object_bucket: "mobile-encrypted-sync";
  readonly object_key: string;
  readonly content_type: "text/plain;charset=utf-8";
  readonly encryption: ProjectPayloadEncryption;
  readonly ciphertext_sha256: string;
  readonly ciphertext_byte_length: number;
}

export interface MobileSnapshotEnvelope extends ContractRecord {
  readonly schema: "openauthor.mobile.snapshot.envelope";
  readonly project_id: string;
  readonly project_revision: string;
  readonly snapshot_id: string;
  readonly manifest_sha256: string;
  readonly published_at: string;
  readonly manifest: MobileSnapshotManifest;
  readonly blob: EncryptedSnapshotBlobMetadata;
}

export interface DevicePublicKey {
  readonly algorithm: "x25519-v1";
  readonly format: "raw";
  readonly key_id: string;
  readonly value: string;
  readonly byte_length: 32;
  readonly fingerprint_sha256: string;
}

export interface ProjectKeyEnvelope extends ContractRecord {
  readonly schema: "openauthor.mobile.project-key-envelope";
  readonly project_id: string;
  readonly key_version: number;
  readonly recipient_device_id: string;
  readonly recipient_key_id: string;
  readonly sender_device_id: string;
  readonly algorithm: "x25519-xsalsa20-poly1305-sealedbox-v1";
  readonly sealed_project_key: string;
  readonly sealed_project_key_sha256: string;
  readonly sealed_project_key_byte_length: 80;
  readonly created_at: string;
}

export interface DeviceEnrollment extends ContractRecord {
  readonly schema: "openauthor.mobile.device-enrollment";
  readonly enrollment_id: string;
  readonly subject_id: string;
  readonly project_id: string;
  readonly device_id: string;
  readonly device_name: string;
  readonly platform: "ios" | "android" | "web";
  readonly app_install_id: string;
  readonly public_key: DevicePublicKey;
  readonly status: "active" | "revoked" | "expired";
  readonly enrolled_at: string;
  readonly expires_at?: string;
  readonly revoked_at?: string;
}

export interface EncryptedOutboxPayload {
  readonly algorithm: "aes-256-gcm-v1";
  readonly project_key_version: number;
  readonly nonce: string;
  readonly aad_version: 1;
  readonly ciphertext: string;
  readonly ciphertext_sha256: string;
  readonly ciphertext_byte_length: number;
}

export interface OutboxEnvelope extends ContractRecord {
  readonly schema: "openauthor.mobile.outbox-envelope";
  readonly project_id: string;
  readonly device_id: string;
  readonly operation_id: string;
  readonly base_revision: string;
  readonly kind:
    | "capture_note"
    | "change_set_request"
    | "dictated_passage"
    | "review_decision"
    | "story_memory_suggestion"
    | "thread_turn";
  readonly created_at: string;
  readonly payload: EncryptedOutboxPayload;
}
