"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SLO_MS,
  STAGE_COLORS,
  STAGE_LABELS,
  type MetricsSummary,
  type Percentiles,
} from "@/lib/types";

/** Latency across many requests, not one.
 *
 *  LatencyPanel answers "how fast was THAT query", which a single lucky run can
 *  flatter. This answers "how fast is the pipeline", which is the claim that
 *  actually has to hold: P50 is typical, P70 is what most requests see, and
 *  P100 is the worst single run in the window — the number a budget has to
 *  survive. A wide P50→P100 gap is the thing worth noticing.
 *
 *  The window lives on the server, so it covers every request the API served,
 *  including ones made from the other frontend or by the benchmark script.
 */
const COLS: Array<{ key: keyof Percentiles; label: string; lead?: boolean }> = [
  { key: "p50", label: "P50", lead: true },
  { key: "p70", label: "P70", lead: true },
  { key: "p90", label: "P90" },
  { key: "p95", label: "P95" },
  { key: "p100", label: "P100", lead: true },
  { key: "mean", label: "mean" },
];

/** Stages that leave the machine. The <200 ms budget is a retrieval claim, so
 *  these are dimmed to keep the table from reading as one total. */
const EXTERNAL = new Set(["generate", "generation_ms"]);

export function PercentilePanel() {
  const [m, setM] = useState<MetricsSummary | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/metrics");
      if (!r.ok) throw new Error(String(r.status));
      setM(await r.json());
      setErr(false);
    } catch {
      setErr(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  if (err || !m || m.samples === 0) return null;

  const r = m.retrieval;
  const rows: Percentiles[] = [
    ...(r ? [r] : []),
    ...(m.stages ?? []),
    ...(m.generation ? [m.generation] : []),
    ...(m.total ? [m.total] : []),
  ];

  const label = (s: string) =>
    s === "retrieval_ms" ? "Retrieval (SLO)"
    : s === "total_ms" ? "End to end"
    : s === "generation_ms" ? "Generation"
    : (STAGE_LABELS[s] ?? s);

  const color = (s: string) => STAGE_COLORS[s] ?? "var(--ink-faint)";
  const pass = m.budget_compliance;
  const withinSlo = (r?.p100 ?? Infinity) < SLO_MS;

  return (
    <section className="pinned rise p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Latency distribution
          </h2>
          <p className="mt-1 text-xs text-ink-faint">
            {m.samples.toLocaleString()} requests · rolling window of{" "}
            {m.window.toLocaleString()}
          </p>
        </div>

        {r && (
          <div className="flex flex-wrap items-center gap-5">
            <Figure label="P50" value={r.p50} />
            <Figure label="P70" value={r.p70} />
            <Figure label="P100" value={r.p100} tone={withinSlo ? "ok" : "bad"} />
          </div>
        )}
      </div>

      {pass && (
        <div className="mb-5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-black/[0.06]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${pass.percentage}%`,
                background:
                  pass.percentage >= 99 ? "var(--ok)" : "var(--danger)",
              }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
            <span>
              {pass.within}/{pass.total} under {pass.threshold_ms} ms
            </span>
            <span className="tabular-nums">{pass.percentage.toFixed(1)}%</span>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-ink-faint">
              <th className="pb-2 font-medium">Stage</th>
              {COLS.map((c) => (
                <th key={c.label} className="pb-2 pl-3 text-right font-medium">
                  {c.label}
                </th>
              ))}
              <th className="pb-2 pl-3 text-right font-medium">n</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/10">
            {rows.map((row, i) => {
              const ext = EXTERNAL.has(row.stage);
              const summary =
                row.stage === "retrieval_ms" || row.stage === "total_ms";
              return (
                <tr
                  key={`${row.stage}-${i}`}
                  className={summary ? "bg-black/[0.03]" : undefined}
                >
                  <td className={`py-1.5 ${summary ? "font-medium" : ""}`}>
                    <span
                      className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                      style={{ background: color(row.stage) }}
                    />
                    <span className={ext ? "text-ink-faint" : undefined}>
                      {label(row.stage)}
                    </span>
                    {ext && (
                      <span className="ml-1.5 text-[9px] uppercase text-ink-faint">
                        ext
                      </span>
                    )}
                  </td>
                  {COLS.map((c) => (
                    <td
                      key={c.label}
                      className={`py-1.5 pl-3 text-right tabular-nums ${
                        c.lead && summary ? "font-semibold" : ""
                      } ${ext ? "text-ink-faint" : ""}`}
                      style={
                        row.stage === "retrieval_ms" && (row[c.key] as number) < SLO_MS
                          ? { color: "var(--ok)" }
                          : undefined
                      }
                    >
                      {(row[c.key] as number).toFixed(1)}
                    </td>
                  ))}
                  <td className="py-1.5 pl-3 text-right tabular-nums text-ink-faint">
                    {row.n}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">
        Nearest-rank percentiles, measured server-side with{" "}
        <code>perf_counter_ns</code> — the same definition{" "}
        <code>scripts/benchmark.py</code> uses. <strong>ext</strong> = third-party
        call, excluded from the retrieval budget. A refused query short-circuits
        before generation, so <em>n</em> differs per stage. Resets when the API
        restarts.
      </p>
    </section>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "bad";
}) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-wider text-ink-faint">
        {label}
      </div>
      <div
        className="text-2xl font-bold tabular-nums leading-tight"
        style={{
          color:
            tone === "ok" ? "var(--ok)"
            : tone === "bad" ? "var(--danger)"
            : "var(--ink)",
        }}
      >
        {value.toFixed(1)}
        <span className="ml-0.5 text-xs font-normal text-ink-faint">ms</span>
      </div>
    </div>
  );
}
