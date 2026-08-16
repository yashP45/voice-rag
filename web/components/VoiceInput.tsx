"use client";

import { useRecorder } from "@/hooks/useRecorder";

interface Props {
  onTranscript: (text: string, lang: string | null, sttMs: number) => void;
  onError: (msg: string) => void;
  disabled?: boolean;
}

/** Push-and-hold record button with a live level meter.
 *
 *  The meter is the highest visual-impact-per-line component here: it is the
 *  only proof on camera that the mic is actually live.
 */
export function VoiceInput({ onTranscript, onError, disabled }: Props) {
  const rec = useRecorder();
  const recording = rec.state === "recording";
  const busy = rec.state === "stopping" || disabled;

  const handleStop = async () => {
    const blob = await rec.stop();
    if (!blob) {
      if (rec.error) onError(rec.error);
      return;
    }
    try {
      const fd = new FormData();
      fd.append("audio", blob, "input.webm");
      const started = performance.now();
      const res = await fetch("/api/stt", { method: "POST", body: fd });
      const data = await res.json();
      const ms = Math.round(performance.now() - started);

      if (!res.ok) {
        onError(data.detail ?? data.error ?? "transcription failed");
        return;
      }
      if (!data.text) {
        onError("Nothing was transcribed — try speaking louder or longer.");
        return;
      }
      onTranscript(data.text, data.language_code ?? null, data.provider_ms ?? ms);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!rec.supported) {
    return (
      <div className="rounded-lg border border-[var(--pink)] px-3 py-2 text-xs text-[var(--pink-soft)]">
        Voice input unavailable in this browser. Use the text box.
      </div>
    );
  }

  const bars = 16;
  const active = Math.round(rec.level * bars);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={busy}
        onMouseDown={rec.start}
        onMouseUp={handleStop}
        onMouseLeave={recording ? handleStop : undefined}
        onTouchStart={(e) => {
          e.preventDefault();
          rec.start();
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          handleStop();
        }}
        className={`relative flex h-14 shrink-0 items-center gap-2.5 rounded-full px-7 text-sm select-none ${
          recording
            ? "rec-ring bg-[var(--pink)] text-white shadow-lg shadow-[var(--pink)]/40"
            : "btn-apply"
        } disabled:opacity-40`}
      >
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            recording ? "animate-pulse bg-white" : "bg-[var(--pink)]"
          }`}
        />
        {rec.state === "stopping"
          ? "Transcribing…"
          : recording
            ? `Recording ${(rec.durationMs / 1000).toFixed(1)}s`
            : "Hold to speak"}
      </button>

      {/* level meter */}
      <div className="flex h-14 flex-1 items-center gap-[3px] rounded-full border border-[var(--rule-strong)] bg-[var(--green-deep)] px-4">
        {Array.from({ length: bars }).map((_, i) => {
          const on = recording && i < active;
          return (
            <div
              key={i}
              className={`w-full rounded-full transition-all duration-75 ${
                on ? "bg-yellow" : "bg-[var(--rule)]"
              }`}
              style={{ height: on ? `${20 + (i / bars) * 60}%` : "14%" }}
            />
          );
        })}
      </div>
    </div>
  );
}
