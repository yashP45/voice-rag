import { NextResponse } from "next/server";

/** Latency distribution → backend /api/v1/metrics.
 *
 *  The backend keeps a rolling window of every request it has served, so these
 *  percentiles cover all traffic rather than only what this tab asked. They use
 *  the same nearest-rank definition as scripts/benchmark.py, which means the
 *  live figure and the benchmarked figure are directly comparable instead of
 *  being two different notions of "P50".
 */
const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/api/v1/metrics`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `backend ${res.status}` },
        { status: res.status },
      );
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json(
      { error: "backend_unreachable", detail: `cannot reach ${BACKEND}` },
      { status: 503 },
    );
  }
}
