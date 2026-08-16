"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  text: string;
  lang?: string | null;
  autoPlay?: boolean;
}

/** Speaks the answer via /api/tts.
 *
 *  The play/pause race this guards against:
 *  `audio.play()` returns a PROMISE that resolves when playback actually
 *  begins. Calling `pause()` before it resolves rejects it with
 *  "The play() request was interrupted by a call to pause()". React StrictMode
 *  double-invokes effects in development, so an autoplay effect fires twice and
 *  the second run's cleanup pauses the first run's still-pending play — making
 *  this reproduce every time in dev.
 *
 *  Three guards, all needed:
 *    1. `playPromiseRef` — always await the pending play() before pause().
 *    2. `runIdRef` — a monotonic token; a stale async run that finishes late
 *       discards its own result instead of clobbering the current one.
 *    3. `spokenRef` — autoplay fires once per distinct text, so a re-render
 *       with identical props does not restart audio.
 */
export function AudioPlayer({ text, lang, autoPlay = false }: Props) {
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerMs, setProviderMs] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const runIdRef = useRef(0);
  const spokenRef = useRef<string | null>(null);

  /** Pause safely: never interrupt a play() that has not settled yet. */
  const stopAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (playPromiseRef.current) await playPromiseRef.current.catch(() => {});
      audio.pause();
    } catch {
      /* already gone */
    }
    playPromiseRef.current = null;
  }, []);

  const releaseUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      // Fire-and-forget on unmount; nothing is left to await into.
      void stopAudio().finally(() => {
        audioRef.current = null;
        releaseUrl();
      });
    };
  }, [stopAudio, releaseUrl]);

  const speak = useCallback(async () => {
    if (!text) return;

    if (playing) {
      await stopAudio();
      setPlaying(false);
      return;
    }

    const runId = ++runIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang }),
      });
      if (runId !== runIdRef.current) return; // superseded — drop this result

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.detail ?? d.error ?? `tts ${res.status}`);
        return;
      }
      setProviderMs(Number(res.headers.get("X-Provider-Ms")) || null);

      const blob = await res.blob();
      if (runId !== runIdRef.current) return;

      await stopAudio();
      releaseUrl();

      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        if (runId === runIdRef.current) setPlaying(false);
      };
      audio.onerror = () => {
        if (runId === runIdRef.current) {
          setError("playback failed");
          setPlaying(false);
        }
      };

      const p = audio.play();
      playPromiseRef.current = p;
      await p;
      if (runId === runIdRef.current) setPlaying(true);
    } catch (e) {
      if (runId !== runIdRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      // A browser autoplay block is expected policy, not a defect — say so
      // plainly instead of showing a scary error.
      setError(
        msg.includes("interrupted") || msg.includes("NotAllowedError")
          ? "Tap Listen to play audio"
          : msg,
      );
      setPlaying(false);
    } finally {
      if (runId === runIdRef.current) setLoading(false);
    }
  }, [text, lang, playing, stopAudio, releaseUrl]);

  // Autoplay exactly once per distinct answer.
  useEffect(() => {
    if (!autoPlay || !text) return;
    if (spokenRef.current === text) return;
    spokenRef.current = text;
    void speak();
    // `speak` intentionally omitted: it changes identity on every `playing`
    // flip, which would retrigger autoplay mid-playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, text]);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={speak}
        disabled={loading || !text}
        className="inline-flex items-center gap-1.5 btn-pink rounded-full px-4 py-1.5 text-xs disabled:opacity-40"
      >
        {loading ? "…" : playing ? "◼ Stop" : "▶ Listen"}
      </button>
      {providerMs !== null && (
        <span className="label text-ink-faint">TTS {providerMs} ms</span>
      )}
      {error && <span className="text-xs text-[var(--warn)]">{error}</span>}
    </div>
  );
}
