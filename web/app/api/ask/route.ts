import { NextRequest, NextResponse } from "next/server";

/** Full pipeline proxy → backend /api/v1/query, fanned out with /api/v1/retrieve.
 *
 *  Why two calls. `/api/v1/query` narrows `citations` to the passages the LLM
 *  actually cited (`routes_query.py`: `cited = [...] or citations[:3]`), so the
 *  retrieved-but-uncited ones never reach the client. That matters for two
 *  reasons: an evidence panel showing only what was cited is not evidence, and
 *  cross-lingual hits measurably land at rank 4-7 — outside the citation set —
 *  so the one claim most worth showing was invisible.
 *
 *  `diversify: false` is load-bearing: `/query` takes a plain `fused[:top_k]`
 *  while `/retrieve` defaults to MMR, which would return a DIFFERENT passage
 *  set than the one generation saw. With diversify off and a matching top_k,
 *  both hit the same deterministic exact-search index and agree.
 *
 *  Cost is ~13 ms of retrieval running concurrently with a ~1.4 s Gemini call,
 *  so wall time is unchanged. `allSettled` means a retrieve failure costs the
 *  panel, not the answer.
 */
const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export async function POST(req: NextRequest) {
  const started = performance.now();
  try {
    const body = await req.json();
    const topK = typeof body.top_k === "number" ? body.top_k : 6;

    const [queryRes, retrieveRes] = await Promise.allSettled([
      fetch(`${BACKEND}/api/v1/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        // Generous: a cold Gemini call has been observed near 12 s.
        signal: AbortSignal.timeout(60_000),
      }),
      fetch(`${BACKEND}/api/v1/retrieve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: body.query,
          top_k: topK,
          diversify: false,
          explain: false,
        }),
        signal: AbortSignal.timeout(20_000),
      }),
    ]);

    if (queryRes.status === "rejected") throw queryRes.reason;

    if (!queryRes.value.ok) {
      const detail = await queryRes.value.text();
      return NextResponse.json(
        { error: `backend ${queryRes.value.status}`, detail: detail.slice(0, 500) },
        { status: queryRes.value.status },
      );
    }

    const data = await queryRes.value.json();

    // Best effort. A failed retrieve leaves the panel to fall back to
    // citations rather than failing a perfectly good answer.
    let passages: unknown[] = [];
    if (retrieveRes.status === "fulfilled" && retrieveRes.value.ok) {
      try {
        passages = (await retrieveRes.value.json()).passages ?? [];
      } catch {
        /* malformed retrieve body — panel degrades, answer stands */
      }
    }

    return NextResponse.json({
      ...data,
      retrieved_passages: passages,
      _proxy_ms: Math.round(performance.now() - started),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const offline = msg.includes("ECONNREFUSED") || msg.includes("fetch failed");
    return NextResponse.json(
      {
        error: offline ? "backend_unreachable" : "proxy_error",
        detail: offline
          ? `Cannot reach the API at ${BACKEND}. Start it with: uvicorn app.main:app --port 8000`
          : msg,
      },
      { status: 503 },
    );
  }
}
