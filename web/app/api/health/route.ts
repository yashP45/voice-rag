import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export async function GET() {
  try {
    const [health, stats] = await Promise.all([
      fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(3000) }).then((r) =>
        r.json(),
      ),
      fetch(`${BACKEND}/api/v1/stats`, { signal: AbortSignal.timeout(3000) })
        .then((r) => r.json())
        .catch(() => null),
    ]);
    return NextResponse.json({ ...health, stats });
  } catch {
    return NextResponse.json(
      { status: "down", ready: false, error: `cannot reach ${BACKEND}` },
      { status: 503 },
    );
  }
}
