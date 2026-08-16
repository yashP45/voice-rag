import { NextRequest, NextResponse } from "next/server";

/** Full pipeline proxy → backend /api/v1/query.
 *  Retrieval + guardrails + generation + groundedness in one call. */
const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export async function POST(req: NextRequest) {
  const started = performance.now();
  try {
    const body = await req.json();
    const res = await fetch(`${BACKEND}/api/v1/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Generous: a cold Gemini call has been observed near 12 s.
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: `backend ${res.status}`, detail: detail.slice(0, 500) },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json({
      ...data,
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
