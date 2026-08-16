import { NextRequest, NextResponse } from "next/server";

/** Server-side proxy to the Python backend.
 *
 *  Everything reaches the backend through here rather than from the browser.
 *  Two reasons that matter later: API keys (ElevenLabs, Gemini) never enter the
 *  client bundle — `NEXT_PUBLIC_*` values are string-substituted at build time,
 *  so a key there is a published credential anyone can lift from DevTools —
 *  and proxying separates provider time from network time in the waterfall.
 *
 *  Use 127.0.0.1, not localhost: Node 18+ resolves `localhost` to ::1 first,
 *  while uvicorn binds IPv4, producing ECONNREFUSED that looks like a dead server.
 */
const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export async function POST(req: NextRequest) {
  const started = performance.now();
  try {
    const body = await req.json();
    const res = await fetch(`${BACKEND}/api/v1/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
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
