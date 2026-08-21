export interface StageTiming {
  stage: string;
  ms: number;
  start_ms: number;
  end_ms: number;
  ok: boolean;
  detail?: Record<string, unknown> | null;
}

export interface TimingBreakdown {
  total_ms: number;
  retrieval_ms: number;
  generation_ms?: number | null;
  stt_ms?: number | null;
  tts_ms?: number | null;
  stages: StageTiming[];
}

export interface Passage {
  doc_id: string;
  chunk_id: string;
  text: string;
  lang: string | null;
  score: number;
  rrf_score: number;
  is_gold: boolean;
  strategies: Record<string, number>;
}

export interface RetrieveResponse {
  query: string;
  normalized_query: string;
  detected_lang: string;
  passages: Passage[];
  n_candidates: number;
  top_score: number;
  rrf_flatness: number;
  off_topic_similarity: number | null;
  timing: TimingBreakdown;
  per_strategy?: Record<string, { chunk_id: string; score: number }[]> | null;
}

/** Stage -> colour is fixed by IDENTITY, never reassigned by rank or order.
 *  A viewer who learns "violet is retrieve" must stay right on the next query. */
export const STAGE_COLORS: Record<string, string> = {
  normalize: "#64748b",
  embed: "#0ea5e9",
  "guard.offtopic": "#f59e0b",
  retrieve: "#8b5cf6",
  fuse: "#10b981",
  rerank: "#ec4899",
  generate: "#ef4444",
  "guards.input": "#f59e0b",
  "guard.confidence": "#f97316",
  "guard.citations": "#a855f7",
  "guard.groundedness": "#14b8a6",
  overhead: "#94a3b8",
};

export const STAGE_LABELS: Record<string, string> = {
  normalize: "Normalize",
  embed: "Embed query",
  "guard.offtopic": "Guardrail: off-topic",
  retrieve: "Vector search ×5",
  fuse: "RRF fusion",
  rerank: "Rerank",
  generate: "Generate (Gemini)",
  "guards.input": "Guardrails G1+G2",
  "guard.confidence": "Guardrail G4",
  "guard.citations": "Guardrail G6",
  "guard.groundedness": "Guardrail G5",
  overhead: "Overhead",
};

export const LANG_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  ta: "Tamil",
  bn: "Bengali",
  te: "Telugu",
  ur: "Urdu",
};

export const SLO_MS = 200;

export interface GuardrailCheck {
  id: string;
  name: string;
  passed: boolean;
  score?: number | null;
  threshold?: number | null;
  detail?: string | null;
}

export interface SentenceSupport {
  sentence: string;
  supported: boolean;
  best_score: number;
  supporting_chunk_id?: string | null;
}

export interface Citation {
  doc_id: string;
  chunk_id: string;
  text: string;
  lang?: string | null;
  score: number;
  /** True only when the dataset labelled THIS passage as the answer to THIS
   *  query. Query-scoped server-side — see MultiIndexRetriever.is_gold_for. */
  is_gold?: boolean;
}

export interface QueryResponse {
  query: string;
  detected_lang: string;
  answered: boolean;
  answer?: string | null;
  refusal_reason?: string | null;
  refusal_message?: string | null;
  citations: Citation[];
  guardrails: GuardrailCheck[];
  groundedness?: number | null;
  sentence_support: SentenceSupport[];
  generated_by: string;
  tool_hops: number;
  retrieval: Record<string, unknown>;
  timing: TimingBreakdown;
  /** Injected by app/api/ask — the full retrieved set. /api/v1/query itself
   *  only returns the subset the LLM cited, so without this the evidence
   *  panel shows citations rather than evidence. */
  retrieved_passages?: Passage[];
}

export const GUARD_LABELS: Record<string, string> = {
  "guards.input": "Guardrails: G1 sanity + G2 safety",
  "guard.offtopic": "Guardrail G3: off-topic",
  "guard.confidence": "Guardrail G4: retrieval confidence",
  "guard.citations": "Guardrail G6: citation validity",
  "guard.groundedness": "Guardrail G5: groundedness",
};

/** One latency distribution from GET /api/metrics. Nearest-rank percentiles,
 *  the same definition scripts/benchmark.py uses. */
export interface Percentiles {
  stage: string;
  n: number;
  p50: number;
  p70: number;
  p90: number;
  p95: number;
  p99: number;
  p100: number;
  mean: number;
  stdev: number;
}

/** GET /api/metrics — rolling window over every request the API has served. */
export interface MetricsSummary {
  samples: number;
  window: number;
  budget_ms: number;
  retrieval?: Percentiles;
  total?: Percentiles | null;
  generation?: Percentiles | null;
  stages?: Percentiles[];
  budget_compliance?: {
    threshold_ms: number;
    within: number;
    total: number;
    percentage: number;
    measures: string;
  };
  by_language?: Record<string, { n: number; p50: number; p100: number }>;
  outcomes?: Record<string, number>;
  endpoints?: Record<string, number>;
  note?: string;
}
