import { NextRequest, NextResponse } from "next/server";
import {
  MISSING_KEY,
  SARVAM_STT_URL,
  requireKey,
  toBcp47,
  toIso639,
} from "@/lib/sarvam";

/** Speech-to-text proxy → Sarvam Saaras.
 *
 *  Sarvam is used rather than ElevenLabs (the brief allows either) because it
 *  has a usable free tier and is purpose-built for Indic languages, which is
 *  what this corpus is.
 *
 *  Response shape differs from ElevenLabs in ways worth naming: the field is
 *  `transcript`, not `text`, and `language_code` is BCP-47 (`hi-IN`) rather
 *  than ISO-639-1 (`hi`) — both normalized here so the rest of the app sees
 *  one consistent shape.
 */
export async function POST(req: NextRequest) {
  const key = requireKey();
  if (!key) return NextResponse.json(MISSING_KEY, { status: 500 });

  try {
    const inbound = await req.formData();
    const audio = inbound.get("audio");
    if (!(audio instanceof Blob)) {
      return NextResponse.json(
        { error: "no_audio", detail: "form field 'audio' missing" },
        { status: 400 },
      );
    }
    // A fumbled click produces a sub-400ms clip that is a hard API error.
    // Cheaper to reject here than to round-trip it.
    if (audio.size < 1200) {
      return NextResponse.json(
        { error: "too_short", detail: "Recording too short — hold longer." },
        { status: 400 },
      );
    }

    const model = process.env.SARVAM_STT_MODEL || "saaras:v3";

    // MediaRecorder always stamps the codec onto the MIME type
    // ("audio/webm;codecs=opus"). Sarvam matches the Content-Type against an
    // exact allow-list that contains "audio/webm" but NOT the codec-qualified
    // form, so the parameter must be stripped or every recording 400s.
    // Re-wrapping is done here rather than in the browser so it holds for any
    // client and any codec the browser happens to pick.
    const baseType = (audio.type || "audio/webm").split(";")[0].trim();
    const ext =
      baseType === "audio/ogg" ? "ogg"
      : baseType === "audio/mp4" ? "m4a"
      : baseType === "audio/wav" ? "wav"
      : "webm";
    const clean = new Blob([await audio.arrayBuffer()], { type: baseType });

    const out = new FormData();
    // Filename matters too: the container is also sniffed from the extension,
    // and a mismatch with the declared MIME produces a confusing 400.
    out.append("file", clean, `input.${ext}`);
    out.append("model", model);

    const hint = inbound.get("language_code");
    // "unknown" asks Sarvam to auto-detect, which is what we want by default —
    // the whole point is that the user may speak any of several languages.
    out.append(
      "language_code",
      (typeof hint === "string" && toBcp47(hint)) || "unknown",
    );

    const started = performance.now();
    const res = await fetch(SARVAM_STT_URL, {
      method: "POST",
      headers: { "api-subscription-key": key },
      body: out,
      signal: AbortSignal.timeout(30_000),
    });
    const providerMs = Math.round(performance.now() - started);

    const raw = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: `sarvam_${res.status}`, detail: raw.slice(0, 600) },
        { status: res.status },
      );
    }

    const data = JSON.parse(raw);
    return NextResponse.json({
      text: (data.transcript ?? "").trim(),
      language_code: toIso639(data.language_code),
      language_code_raw: data.language_code ?? null,
      language_probability: data.language_probability ?? null,
      provider_ms: providerMs,
      request_id: data.request_id ?? null,
      model,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "stt_failed", detail: msg }, { status: 500 });
  }
}
