"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "requesting" | "recording" | "stopping";

/** Probed in order — Chrome/Edge take the first, Firefox falls to ogg. */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

export interface UseRecorder {
  state: RecorderState;
  level: number; // 0..1 RMS, for the meter
  error: string | null;
  durationMs: number;
  start: () => Promise<void>;
  stop: () => Promise<Blob | null>;
  supported: boolean;
}

export function useRecorder(): UseRecorder {
  const [state, setState] = useState<RecorderState>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);

  // Media objects live in refs, never state — they are not renderable values
  // and putting them in state causes re-render storms during recording.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  /* Probed in an effect, not during render. Reading navigator.mediaDevices
     while rendering makes the server say "unsupported" and the client say
     "supported" — a hydration mismatch on every single page load, after which
     React throws away that subtree and re-renders it.

     `null` means "not probed yet" and is what BOTH the server and the first
     client paint see, so they agree. Purely a correctness fix: no styling,
     no layout, no visual change. */
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== "undefined",
    );
  }, []);

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // Releasing tracks is what turns off the browser's red recording dot.
    // Skip it and the dot stays lit through the entire demo video.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    if (!supported) {
      setError(
        typeof window !== "undefined" && !window.isSecureContext
          ? "Microphone needs a secure context — use http://localhost, not a LAN IP."
          : "This browser does not support audio recording.",
      );
      return;
    }

    setError(null);
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // Level meter: AnalyserNode -> rAF -> RMS. Without this the record
      // button is a dead rectangle on camera and users cannot tell it is live.
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3));
        setDurationMs(performance.now() - startedAtRef.current);
        rafRef.current = requestAnimationFrame(tick);
      };

      const mimeType = pickMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = rec;

      startedAtRef.current = performance.now();
      rec.start(250); // timeslice, so data flows during recording
      rafRef.current = requestAnimationFrame(tick);
      setState("recording");
    } catch (err) {
      const e = err as DOMException;
      // Name the failure. "NotReadableError" almost always means another app
      // (OBS, Teams, Zoom) holds the mic exclusively — extremely likely while
      // recording a demo video, and baffling if reported as a generic error.
      const msg =
        e.name === "NotAllowedError"
          ? "Microphone permission denied. Allow it in the browser address bar."
          : e.name === "NotReadableError"
            ? "Microphone is in use by another app (OBS, Teams, Zoom). Close it and retry."
            : e.name === "NotFoundError"
              ? "No microphone found."
              : `${e.name}: ${e.message}`;
      setError(msg);
      setState("idle");
      cleanup();
    }
  }, [supported, cleanup]);

  const stop = useCallback(async (): Promise<Blob | null> => {
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") {
      setState("idle");
      cleanup();
      return null;
    }

    setState("stopping");
    const elapsed = performance.now() - startedAtRef.current;

    // The blob MUST be assembled inside onstop. The final `dataavailable`
    // fires BEFORE onstop, so building it after `.stop()` returns truncates
    // the recording — the classic "last word is missing" bug.
    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
      };
      rec.stop();
    });

    recorderRef.current = null;
    cleanup();
    setState("idle");
    setDurationMs(0);

    if (elapsed < 400) {
      setError("Too short — hold the button while speaking.");
      return null;
    }
    return blob;
  }, [cleanup]);

  // `supported === null` (still probing) reports false, so a caller that
  // only checks this renders a disabled control, never a false negative.
  return {
    state, level, error, durationMs, start, stop,
    supported: supported === true,
  };
}
