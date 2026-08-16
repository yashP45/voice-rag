import "server-only";

/** Sarvam AI shared config.
 *
 *  `server-only` makes an accidental client import a BUILD-TIME error rather
 *  than a silent key leak. The key must never be `NEXT_PUBLIC_*` — those are
 *  string-substituted into the client bundle and become public credentials.
 */

export const SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text";
export const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech";

/** Sarvam speaks BCP-47 (`hi-IN`), the rest of this app speaks ISO-639-1 (`hi`).
 *  One mapping in one place, both directions. */
const TO_BCP47: Record<string, string> = {
  en: "en-IN",
  hi: "hi-IN",
  ta: "ta-IN",
  bn: "bn-IN",
  te: "te-IN",
  gu: "gu-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  mr: "mr-IN",
  or: "od-IN", // note: Sarvam uses `od-IN`, not the ISO `or-IN`
  pa: "pa-IN",
};

export function toBcp47(lang?: string | null): string | null {
  if (!lang) return null;
  if (lang.includes("-")) return lang;
  return TO_BCP47[lang.toLowerCase()] ?? null;
}

export function toIso639(code?: string | null): string | null {
  if (!code) return null;
  const short = code.split("-")[0].toLowerCase();
  return short === "od" ? "or" : short;
}

/** TTS supports a narrower set than STT. Falling back to Hindi (rather than
 *  erroring) keeps a demo alive if an unexpected language is detected. */
const TTS_SUPPORTED = new Set([
  "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN",
  "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN",
]);

export function ttsLanguage(lang?: string | null): string {
  const code = toBcp47(lang);
  return code && TTS_SUPPORTED.has(code) ? code : "hi-IN";
}

export function requireKey(): string | null {
  return process.env.SARVAM_API_KEY ?? null;
}

export const MISSING_KEY = {
  error: "missing_key",
  detail:
    "SARVAM_API_KEY is not set in web/.env.local. Get a free key at https://dashboard.sarvam.ai",
};
