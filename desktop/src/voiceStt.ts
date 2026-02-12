export type VoiceSttResult = {
  transcript: string;
  isFinal: boolean;
  confidence: number;
};

export type VoiceSttCallbacks = {
  onStart?: () => void;
  onResult?: (result: VoiceSttResult) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
};

export type VoiceSttController = {
  supported: boolean;
  provider: string;
  start: () => void;
  stop: () => void;
  isListening: () => boolean;
  reason?: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function resolveCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const maybeCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  return typeof maybeCtor === "function" ? (maybeCtor as SpeechRecognitionCtor) : null;
}

export function createBrowserVoiceStt(
  callbacks: VoiceSttCallbacks,
  language = "en-US"
): VoiceSttController {
  const Ctor = resolveCtor();
  if (!Ctor) {
    return {
      supported: false,
      provider: "none",
      reason: "SpeechRecognition API unavailable in this runtime.",
      start: () => {
        callbacks.onError?.("SpeechRecognition API unavailable in this runtime.");
      },
      stop: () => {},
      isListening: () => false
    };
  }

  let listening = false;
  const recognition = new Ctor();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = language;

  recognition.onstart = () => {
    listening = true;
    callbacks.onStart?.();
  };

  recognition.onresult = (event) => {
    const resultIndex =
      typeof event?.resultIndex === "number" ? event.resultIndex : 0;
    const results = event?.results;
    if (!results) return;
    for (let index = resultIndex; index < results.length; index += 1) {
      const row = results[index];
      if (!row || !row[0]) continue;
      const alternative = row[0];
      callbacks.onResult?.({
        transcript: String(alternative.transcript || "").trim(),
        isFinal: Boolean(row.isFinal),
        confidence: Number.isFinite(alternative.confidence)
          ? Number(alternative.confidence)
          : 0
      });
    }
  };

  recognition.onerror = (event) => {
    const message = String(event?.error || "speech recognition error");
    callbacks.onError?.(message);
  };

  recognition.onend = () => {
    listening = false;
    callbacks.onEnd?.();
  };

  return {
    supported: true,
    provider: "web_speech_api",
    start: () => {
      try {
        recognition.start();
      } catch (error) {
        callbacks.onError?.(
          error instanceof Error ? error.message : String(error)
        );
      }
    },
    stop: () => {
      try {
        recognition.stop();
      } catch {
        // no-op
      }
    },
    isListening: () => listening
  };
}
