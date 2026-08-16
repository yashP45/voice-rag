"use client";

import { useState } from "react";
import {
  SLO_MS,
  STAGE_COLORS,
  STAGE_LABELS,
  type TimingBreakdown,
} from "@/lib/types";

/** The latency waterfall.
 *
 *  Renders `start_ms`/`end_ms` offsets rather than bare durations, so stages
 *  that genuinely overlap (the five index searches run concurrently) are drawn
 *  as overlapping bars instead of being misrepresented as sequential.
 */
export function LatencyPanel({ timing }: { timing: TimingBreakdown }) {
  const [table, setTable] = useState(false);

  const stages = timing.stages ?? [];
  const measured = stages.reduce((a, s) => a + s.ms, 0);
  const overhead = Math.max(0, timing.total_ms - measured);
  const scale = Math.max(timing.total_ms, 0.001);
  const withinSlo = timing.retrieval_ms < SLO_MS;
  const pct = Math.min(100, (timing.retrieval_ms / SLO_MS) * 100);

  const color = (s: string) => STAGE_COLORS[s] ?? "var(--ink-faint)";
  const label = (s: string) => STAGE_LABELS[s] ?? s;

  return (
    <section className="pinned rise p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Pipeline latency
          </h2>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-5xl font-bold tabular-nums tracking-tight text-ink">
              {timing.retrieval_ms.toFixed(1)}
            </span>
            <span className="text-lg text-ink-faint">ms</span>
          </div>
        </div>
        <div className="text-right">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              withinSlo
                ? "bg-[var(--green)] text-yellow"
                : "bg-[var(--pink)]/15 text-[var(--pink)]"
            }`}
          >
            {withinSlo ? "✓" : "✕"} SLO &lt; {SLO_MS} ms
          </span>
          <button
            onClick={() => setTable((v) => !v)}
            className="mt-2 block w-full text-xs text-ink-faint underline-offset-2 hover:underline dark:text-ink-faint"
          >
            {table ? "chart view" : "table view"}
          </button>
        </div>
      </div>

      {/* budget bar */}
      <div className="mb-5">
        <div className="h-2 w-full overflow-hidden rounded-full bg-black/[0.06]">
          <div
            className={`h-full rounded-full ${withinSlo ? "bg-[var(--ok)]" : "bg-[var(--danger)]"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
          <span>0</span>
          <span>{pct.toFixed(1)}% of budget used</span>
          <span>{SLO_MS} ms</span>
        </div>
      </div>

      {table ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="pb-2 font-medium">Stage</th>
              <th className="pb-2 text-right font-medium">Start</th>
              <th className="pb-2 text-right font-medium">Duration</th>
              <th className="pb-2 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/10">
            {stages.map((s, i) => (
              <tr key={i}>
                <td className="py-1.5">
                  <span
                    className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ background: color(s.stage) }}
                  />
                  {label(s.stage)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-ink-faint">
                  {s.start_ms.toFixed(2)}
                </td>
                <td className="py-1.5 text-right font-medium tabular-nums">
                  {s.ms.toFixed(2)} ms
                </td>
                <td className="py-1.5 text-right tabular-nums text-ink-faint">
                  {((s.ms / scale) * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="space-y-1">
          {stages.map((s, i) => {
            const left = (s.start_ms / scale) * 100;
            const width = Math.max((s.ms / scale) * 100, 0.6);
            return (
              <div key={i} className="flex items-center gap-3 py-1">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: color(s.stage) }}
                />
                <span className="w-40 shrink-0 truncate text-sm text-ink-soft">
                  {label(s.stage)}
                </span>
                <div className="relative h-5 flex-1 overflow-hidden rounded bg-black/[0.06]">
                  <div
                    className="absolute inset-y-0 rounded"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      background: color(s.stage),
                    }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums text-ink">
                  {s.ms.toFixed(2)} ms
                </span>
              </div>
            );
          })}

          {overhead > 0.01 && (
            <div className="flex items-center gap-3 py-1 opacity-60">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: STAGE_COLORS.overhead }}
              />
              <span className="w-40 shrink-0 text-sm text-ink-faint">
                Overhead
              </span>
              <div className="h-5 flex-1 rounded bg-black/[0.06]" />
              <span className="w-20 shrink-0 text-right text-sm tabular-nums text-ink-faint">
                {overhead.toFixed(2)} ms
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
