"use client";

import { LANG_NAMES, STAGE_COLORS, type Passage } from "@/lib/types";

const STRAT_COLOR: Record<string, string> = {
  fixed: "#0ea5e9",
  sentence: "#8b5cf6",
  semantic: "#10b981",
  contextual: "#f59e0b",
  bm25: "#ec4899",
};

/** `queryLang` is the language the question was asked in. Comparing it to
 *  each passage's own language is what turns "multilingual" from a claim into
 *  something visible: a Hindi question retrieving an English passage is the
 *  multilingual embedding space doing the one thing that actually matters.
 *  Both halves were already on the wire — they were just never juxtaposed. */
export function SourcePassages({
  passages,
  queryLang,
  citedIds,
}: {
  passages: Passage[];
  queryLang?: string;
  /** Chunk ids the answer actually cited. The rest were retrieved and
   *  considered but not used — which is information, not noise. */
  citedIds?: Set<string>;
}) {
  const crossed = queryLang
    ? passages.filter((p) => p.lang && p.lang !== queryLang).length
    : 0;
  if (!passages.length) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--rule-strong)] p-6 text-center text-sm text-cream/60">
        No passages retrieved.
      </p>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="label text-yellow">
          Retrieved context · {passages.length} passages
        </h2>
        {crossed > 0 && (
          <span
            className="label rounded-full bg-[var(--pink)] px-2.5 py-0.5 text-white"
            title={`Asked in ${LANG_NAMES[queryLang!] ?? queryLang}, but ${crossed} of ${passages.length} passages came back in another language. One multilingual embedding space, no translation step.`}
          >
            ↔ {crossed}/{passages.length} crossed language
          </span>
        )}
      </div>

      {passages.map((p, i) => (
        <article
          key={p.chunk_id}
          className="pinned rise p-4"
          style={citedIds && !citedIds.has(p.chunk_id) ? { opacity: 0.72 } : undefined}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--green)] text-xs font-semibold tabular-nums text-cream">
              {i + 1}
            </span>

            {p.lang &&
              (queryLang && p.lang !== queryLang ? (
                <span
                  className="rounded bg-[var(--pink)]/15 px-2 py-0.5 text-xs font-medium text-[var(--pink)]"
                  title="Cross-lingual hit: the question and this passage are in different languages"
                >
                  {queryLang} → {p.lang}
                </span>
              ) : (
                <span className="rounded bg-black/[0.06] px-2 py-0.5 text-xs text-ink-soft">
                  {LANG_NAMES[p.lang] ?? p.lang}
                </span>
              ))}

            {/* Query-scoped: the retriever now checks that this document's
                own source query matches the one just asked, so the claim
                "for this query" is one the code actually implements. */}
            {p.is_gold && (
              <span
                className="rounded bg-[var(--green)] px-2 py-0.5 text-xs font-medium text-yellow"
                title="The dataset labelled this exact passage as the answer to this exact question"
              >
                ★ gold for this query
              </span>
            )}

            {citedIds?.has(p.chunk_id) && (
              <span
                className="rounded bg-[var(--green)] px-2 py-0.5 text-xs font-medium text-cream"
                title="The answer cited this passage"
              >
                cited
              </span>
            )}

            <span className="ml-auto text-xs tabular-nums text-ink-faint">
              cos {p.score.toFixed(4)} · rrf {p.rrf_score.toFixed(5)}
            </span>
          </div>

          <p
            lang={p.lang ?? undefined}
            dir="auto"
            className="text-sm leading-relaxed text-ink-soft"
          >
            {p.text}
          </p>

          {/* Which strategies found this document, and at what rank. This is
              the visible evidence that multi-strategy chunking is doing work. */}
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-black/10 pt-3">
            {Object.entries(p.strategies)
              .sort((a, b) => a[1] - b[1])
              .map(([name, rank]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
                  style={{
                    background: `${STRAT_COLOR[name] ?? "var(--ink-faint)"}18`,
                    color: STRAT_COLOR[name] ?? "#64748b",
                  }}
                  title={`${name} ranked this document #${rank}`}
                >
                  {name}
                  <span className="tabular-nums opacity-70">#{rank}</span>
                </span>
              ))}
          </div>
        </article>
      ))}
    </section>
  );
}
