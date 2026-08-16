"use client";

import { AudioPlayer } from "@/components/AudioPlayer";
import type { QueryResponse } from "@/lib/types";

/** Answer and refusal are DIFFERENT components, not one component with a red
 *  border. A refusal is a distinct product state — the system deciding not to
 *  answer is a feature here, and it should look deliberate rather than broken. */

export function AnswerCard({
  data,
  autoPlay,
}: {
  data: QueryResponse;
  autoPlay: boolean;
}) {
  const ground = data.groundedness ?? 1;
  const partial = ground < 0.85;
  const extractive = data.generated_by === "extractive_fallback";

  return (
    <section className="pinned rise p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          Answer
        </span>

        <span
          className="rounded bg-black/[0.06] px-2 py-0.5 text-[11px] text-ink-soft"
          title="Which model produced this"
        >
          {data.generated_by}
        </span>

        {/* Groundedness is the fraction of answer sentences supported by the
            retrieved context — the anti-hallucination number. Shown always,
            because a number only displayed when it's good is marketing. */}
        <span
          className={`rounded px-2 py-0.5 text-[11px] font-medium ${
            partial
              ? "bg-[var(--warn)]/18 text-[#8a5200]"
              : "bg-[var(--green)] text-yellow"
          }`}
          title="Fraction of answer sentences supported by retrieved context (G5)"
        >
          grounded {(ground * 100).toFixed(0)}%
        </span>

        {extractive && (
          <span className="rounded bg-[var(--warn)]/18 px-2 py-0.5 text-[11px] text-[#8a5200]">
            LLM unavailable — passage returned verbatim
          </span>
        )}

        <div className="ml-auto">
          <AudioPlayer
            text={data.answer ?? ""}
            lang={data.detected_lang}
            autoPlay={autoPlay}
          />
        </div>
      </div>

      <p
        lang={data.detected_lang}
        dir="auto"
        className="text-lg leading-relaxed text-ink"
      >
        {data.answer}
      </p>

      {/* Per-sentence support map. Makes the groundedness score inspectable
          rather than a number you have to trust. */}
      {data.sentence_support.length > 0 && partial && (
        <details className="mt-3 border-t border-black/10 pt-3">
          <summary className="cursor-pointer text-xs text-ink-faint">
            Sentence-level support ({data.sentence_support.filter((s) => s.supported).length}
            /{data.sentence_support.length} verified)
          </summary>
          <ul className="mt-2 space-y-1">
            {data.sentence_support.map((s, i) => (
              <li key={i} className="flex gap-2 text-xs">
                <span className={s.supported ? "text-[#1f7a45]" : "text-[var(--warn)]"}>
                  {s.supported ? "✓" : "!"}
                </span>
                <span className="text-ink-soft" dir="auto">
                  {s.sentence}
                </span>
                <span className="ml-auto shrink-0 tabular-nums text-ink-faint">
                  {s.best_score.toFixed(3)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function RefusalCard({
  data,
  autoPlay,
}: {
  data: QueryResponse;
  autoPlay: boolean;
}) {
  const failed = data.guardrails.find((g) => !g.passed);

  return (
    <section className="pinned pin-yellow rise p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* Icon + text label, never colour alone — colour is not accessible
            on its own and the video may be watched on a bad projector. */}
        <span className="text-base" aria-hidden>
          ⛨
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--warn)]">
          Declined to answer
        </span>
        {failed && (
          <span className="rounded bg-[var(--paper-raised)] px-2 py-0.5 font-mono text-[11px] text-[var(--warn)]">
            {failed.id} {failed.name}
          </span>
        )}
        <div className="ml-auto">
          <AudioPlayer
            text={data.refusal_message ?? ""}
            lang={data.detected_lang}
            autoPlay={autoPlay}
          />
        </div>
      </div>

      <p dir="auto" className="text-base leading-relaxed text-ink">
        {data.refusal_message}
      </p>

      {failed?.detail && (
        <p className="mt-2 font-mono text-xs text-[var(--warn)]">
          {failed.detail}
          {failed.score != null && ` (score ${failed.score}`}
          {failed.threshold != null && `, threshold ${failed.threshold})`}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--warn)]/25 pt-3">
        {data.guardrails.map((g) => (
          <span
            key={g.id}
            className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${
              g.passed
                ? "bg-[var(--green)] text-yellow"
                : "bg-[var(--pink)]/15 text-[var(--pink)]"
            }`}
            title={g.detail ?? g.name}
          >
            {g.id} {g.passed ? "pass" : "halt"}
          </span>
        ))}
      </div>
    </section>
  );
}
