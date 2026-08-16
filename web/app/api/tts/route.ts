import { NextRequest, NextResponse } from "next/server";
import { MISSING_KEY, SARVAM_TTS_URL, requireKey, ttsLanguage } from "@/lib/sarvam";

/** Text-to-speech proxy → Sarvam Bulbul.
 *
 *  Two Sarvam-specific details this handles:
 *
 *  1. `language_code` is REQUIRED (unlike ElevenLabs, where it is optional).
 *     `ttsLanguage` maps our ISO codes to BCP-47 and falls back to hi-IN for
 *     anything unsupported, so an unexpected detection degrades to wrong-accent
 *     audio rather than a 400 in the middle of a demo.
 *
 *  2. The response is JSON with base64 in `audios[0]`, NOT binary audio. We
 *     decode here and hand the browser real bytes, so the client stays
 *     provider-agnostic and `<audio>` can consume it directly.
 */
const MAX_CHARS = 2400; // bulbul:v3 limit is 2500; leave headroom

export async function POST(req: NextRequest) {
  const key = requireKey();
  if (!key) return NextResponse.json(MISSING_KEY, { status: 500 });

  try {
    const { text, lang } = await req.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "no_text" }, { status: 400 });
    }

    // `||` not `??`: an env var present-but-empty (`SARVAM_SPEAKER=`) is the
    // common case in a template .env, and `??` would pass "" straight through
    // to the API, which rejects it.
    const model = process.env.SARVAM_TTS_MODEL || "bulbul:v3";
    const speaker =
      process.env.SARVAM_SPEAKER || (model.startsWith("bulbul:v3") ? "shubh" : "anushka");

    const started = performance.now();
    const res = await fetch(SARVAM_TTS_URL, {
      method: "POST",
      headers: {
        "api-subscription-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: text.slice(0, MAX_CHARS),
        target_language_code: ttsLanguage(lang),
        model,
        speaker,
        output_audio_codec: "mp3",
        speech_sample_rate: 22050,
      }),
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
    const b64 = data.audios?.[0];
    if (!b64) {
      return NextResponse.json(
        { error: "no_audio_returned", detail: raw.slice(0, 300) },
        { status: 502 },
      );
    }

    const bytes = Buffer.from(b64, "base64");
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(bytes.byteLength),
        "X-Provider-Ms": String(providerMs),
        "X-Model": model,
        "X-Language": ttsLanguage(lang),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "tts_failed", detail: msg }, { status: 500 });
  }
}
