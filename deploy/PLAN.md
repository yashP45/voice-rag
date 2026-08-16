# Deployment Plan — Voice RAG

Everything below marked **measured** was benchmarked on this project's actual
hardware and data. Everything marked *estimated* is extrapolation, flagged as
such so it isn't mistaken for evidence.

---

## 1. The one constraint that decides everything

**Embedding is the entire bottleneck, and the 200 ms SLO forces it to stay local.**

| Stage | Cost | Measured on |
|---|---|---|
| Embed query | **8.6 ms** (P50) | laptop, ONNX int8, 4 threads |
| Vector search ×5 | **3.8 ms** (P50) | 1,500-doc index |
| All 4 in-path guardrails | **0.22 ms** | — |
| **Retrieval total** | **12.7 ms P50 / 36.9 ms P100** | 300 held-out queries |

A hosted embedding API (Gemini, Cohere, OpenAI) would make *indexing* trivial —
minutes instead of hours. But the **query** must use the same model as the
index, and a hosted call costs 100–300 ms round-trip. That alone blows the
200 ms budget before any search happens.

> **Therefore: embedding stays local (ONNX/CPU), and indexing time is a cost we
> pay once rather than a problem we can API our way out of.**

This is the reasoning behind every choice that follows.

---

## 2. Vector store — FAISS, and the benchmark that justifies it

The brief specifies a **vector DB** in the pipeline, so this is a requirement,
not an optimisation. FAISS *is* a vector database — a Meta-built vector
similarity search engine, and the most widely deployed one in production RAG.
It stores vectors, indexes them, and serves ANN/exact similarity queries. That
is the definition.

**The real question was whether a different vector DB would serve better.
Measured, at 50,000 vectors × 384 dims, top-50:**

| Store | P50 | P100 | Notes |
|---|---|---|---|
| **FAISS `IndexFlatIP`** | **3.31 ms** | 4.80 ms | in-process, exact |
| Qdrant (local, in-process) | **71.22 ms** | 79.68 ms | **21× slower** |

Qdrant's embedded mode was the strongest candidate — a recognisable vector-DB
name with no network hop. It costs 71 ms at only 50k vectors. This system
queries **five** stores per request, so Qdrant would consume the entire 200 ms
budget on retrieval alone, before embedding or generation. A *hosted* Qdrant
would be worse still, adding network latency on top.

### Options considered

| Option | Verdict |
|---|---|
| **FAISS `IndexFlatIP`** | **Chosen.** 3.31 ms, exact, in-process, benchmarked end-to-end at P100 36.9 ms. |
| Qdrant (embedded or server) | **Rejected on measurement** — 21× slower; see above. |
| `usearch` | The strongest fallback: 24 aarch64 wheels, single small dep, exact + ANN. Worth keeping in mind purely as ARM insurance. |
| `lancedb` | On-disk, real ARM wheels. Only compelling if the corpus outgrew RAM. It doesn't — 647k vectors is 0.99 GB. |
| `chromadb` | ARM wheels exist; heavier and slower than FAISS, nothing gained. |
| `pgvector` | Only sensible if Postgres were already in the stack. It isn't. |

### The ARM packaging trap

FAISS is the most fragile dependency on aarch64:

| Package | aarch64 wheels |
|---|---|
| `faiss-cpu` 1.15.0 | **cp310 only** |
| `faiss-cpu` 1.13.2 | cp311, cp312, cp313, cp314 ✅ |
| `onnxruntime` 1.28.0 | cp311+ (no cp310) |

There is **no Python version where the latest of both work on ARM**. The deploy
is viable only because `faiss-cpu==1.13.2` still ships cp312 wheels — which is
why `deploy/setup.sh` pins it explicitly on ARM.

### Why exact, not ANN

IVF/HNSW is deliberately rejected:
1. Exact search is already <10% of the budget — ANN buys speed we don't need
   and pays in recall.
2. The G3/G4 guardrails are calibrated against **absolute cosine values**;
   approximate scores drift query-to-query and would cause random refusals.
3. It would confound the chunking ablation: at ~0.95 recall you can't tell
   "this strategy is worse" from "the index missed it".

`HNSWFlat` is wired behind `settings.index_type` as the >1M-vector path.

---

## 3. Embedding model — keep `multilingual-e5-small`

| Model | Dim | Multilingual | Why not |
|---|---|---|---|
| **`multilingual-e5-small`** ✅ | 384 | 100 langs | **Current.** Prebuilt ONNX int8, 8.6 ms/query, cross-lingual hi→en verified at 0.85 cosine. |
| `multilingual-e5-base` | 768 | 100 langs | ~3× slower, 2× the RAM and index size. Would push query embed past 25 ms for a modest quality gain. |
| `BGE-M3` | 1024 | 100+ langs | Strongest multilingual quality, but ~560M params — far too slow on CPU for this budget. |
| `paraphrase-multilingual-MiniLM-L12-v2` | 384 | 50 langs | Comparable speed, weaker on retrieval; e5's query/passage asymmetry is purpose-built for this task. |
| `bge-small-en-v1.5` | 384 | **English only** | The checkout on the dev machine. Would drop Hindi and Tamil entirely — note it uses **CLS pooling**, not mean, so the code paths must never be shared. |
| Gemini / Cohere hosted | 768–3072 | yes | Fast indexing, but a network hop at query time breaks the SLO. See §1. |

**Measured facts worth keeping:**
- **int8 beats fp32 by 5.6×** on this CPU (36.4 vs 6.5 chunks/s) *even without
  AVX-512/VNNI* — my initial hypothesis that the int8 build was wrong for this
  chip was incorrect.
- Tokens-per-char vs English: Tamil 1.18×, Hindi 1.27×, Telugu 1.48×,
  **Malayalam 1.66×**. So 512 tokens is ~2,330 chars of English but only
  ~1,400 of Malayalam — the reason all chunking is token-counted, never
  character-counted.

---

## 4. Hardware reality

| | Laptop (dev) | Oracle VM |
|---|---|---|
| Arch | x86_64, 14 cores | **aarch64**, 4 cores (Neoverse-N1) |
| RAM | 16 GB | **23 GB** |
| Disk | — | 192 GB |
| Public IP | no | **yes** |
| Python | 3.12 | **3.8** (too old — needs 3.12) |
| Embed rate | **36.4 chunks/s** (measured) | ~10/s *(estimated)* |
| Full-corpus build | **~5 h** | *~18 h* |

**The VM is a worse build box and a better serving box.** Four ARM cores lose
to fourteen x86 ones; 23 GB RAM and a public IP are exactly what serving needs.

> **Build on the laptop. Serve on the VM.**

---

## 5. Recommended architecture

```
                    ┌─────────────── Vercel ───────────────┐
   Browser ────────▶│  Next.js  ·  /api/{stt,ask,tts}      │
      │             │  keys server-side only               │
      │             └──────────────┬───────────────────────┘
      │                            │
      │                     ┌──────▼──────┐        ┌──────────────┐
      └── mic / speaker ───▶│ Sarvam API  │        │  Gemini API  │
                            │ STT + TTS   │        │ 3.5-flash-lite│
                            └─────────────┘        └──────▲───────┘
                                                          │
              ┌───────────── Oracle VM (aarch64) ─────────┴──────┐
              │  FastAPI :8000  ·  uvicorn --workers 1           │
              │  ONNX e5-small (int8) · 4 FAISS indexes · BM25   │
              │  ~1.8 GB resident                                │
              └──────────────────────────────────────────────────┘
```

`--workers 1` is not optional: each worker loads its own full copy of every
index, so N workers costs N × 1.8 GB.

---

## 6. Execution plan

### Phase A — build the index (laptop, one-time)

Pick a size against measured throughput (36.4 chunks/s, ~4.27 chunks/doc):

| Docs | Chunks | Build time | Index size | Coverage |
|---|---|---|---|---|
| 1,500 *(now)* | 6.4k | done | 12 MB | poor — most questions refused |
| **40,000** | ~171k | **~78 min** | ~340 MB | **good — recommended** |
| 151,684 (all) | ~647k | ~5 h | ~1.3 GB | best |

```bash
cd api
python scripts/build_index.py --threads 14 --batch-size 64 --limit 40000
```

40k is the recommendation: **26× the current coverage for ~78 minutes**, and it
fits comfortably in the VM's RAM with headroom.

### Phase B — recalibrate the guardrails (30 min, blocking)

Do **not** skip this. Current thresholds are guesses, and two are known-bad:

- `tau_topic` — measured on the small index, in-corpus and off-topic
  distributions **overlap completely** (gibberish scored 0.86, higher than a
  valid query at 0.83). e5 embeddings are anisotropic; cosines compress into a
  narrow high band. G3 is currently near-useless and must be re-measured on the
  real corpus.
- `tau_conf = 0.72` — set by hand, never validated. Caused 5 of 8 voice queries
  to refuse in the last benchmark.
- `tau_flatness` — already fixed (1.15 was **mathematically unreachable**; the
  max at depth 5 with k=60 is 1.0656). Now 1.04 at depth 10.

```bash
python scripts/calibrate_thresholds.py   # (still to be written)
```

### Phase C — ship the backend to the VM

```bash
ssh voicerag-vm                          # alias now configured
bash deploy/setup.sh                     # installs Python 3.12 + ARM pins
scp -r api/data/index voicerag-vm:~/voice-rag/api/data/
```

Then run under systemd so it survives reboot:

```ini
# /etc/systemd/system/voicerag.service
[Unit]
Description=Voice RAG API
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/voice-rag/api
Environment="OMP_NUM_THREADS=4"
Environment="HF_HOME=/home/ubuntu/voice-rag/api/data/hf_cache"
EnvironmentFile=/home/ubuntu/voice-rag/api/.env
ExecStart=/home/ubuntu/voice-rag/api/.venv/bin/python -m uvicorn app.main:app \
          --host 0.0.0.0 --port 8000 --workers 1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Open port 8000 in **both** the OCI security list *and* the instance firewall —
Oracle images ship with iptables rules that silently drop traffic even when the
cloud-side rule is correct. This is the single most common way an OCI deploy
"works locally, times out publicly":

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8000 -j ACCEPT
sudo netfilter-persistent save
```

### Phase D — frontend to Vercel

```bash
cd web && vercel --prod
```

Environment variables (Vercel dashboard, **not** `NEXT_PUBLIC_*` — that prefix
is substituted into the client bundle at build time and publishes the key):

```
BACKEND_URL=http://140.238.224.158:8000
SARVAM_API_KEY=...
```

Mixed content is the catch: a Vercel page is HTTPS and cannot call an HTTP
backend. Either put Caddy in front of the VM for automatic TLS, or use a
Cloudflare Tunnel. Caddy is two lines:

```
voicerag.example.com {
    reverse_proxy localhost:8000
}
```

### Phase E — final artifacts

```bash
python scripts/benchmark.py --n 500 --mode retrieval --warmup 10
python scripts/benchmark.py --n 100 --mode full
python scripts/eval_retrieval.py          # per-strategy ablation (still to write)
```

---

## 7. Honest status against the brief

| Requirement | State |
|---|---|
| Speech-to-text (Sarvam) | ✅ working, verified round-trip |
| Chunking — 4 strategies + BM25 + RRF | ✅ built, token-safe across scripts |
| Retrieval < 200 ms | ✅ **P50 12.7 / P100 36.9 ms**, 300 queries |
| P50/P70/P100 analytics | ✅ retrieval done; full-pipeline pending |
| Harness | ✅ structured output, retries, circuit breaker, 3-tier fallback |
| Guardrails | ⚠️ all 6 implemented; **thresholds need calibration** |
| Live link | ⬜ Phase C/D |
| Ablation table | ⬜ `eval_retrieval.py` not yet written |
| Corpus coverage | ⚠️ **1,500 of 151,684 docs** — the main demo weakness |

### Biggest risks

1. **Coverage.** At 1,500 docs most questions refuse. Phase A fixes it and is
   the highest-value 78 minutes available.
2. **Guardrail calibration.** G3 provably doesn't discriminate right now. A
   judge asking an off-topic question may get an answer, or a valid question may
   refuse. Phase B fixes it.
3. **End-to-end voice latency is ~5.6 s P50** (STT 0.4 s + retrieval 0.08 s +
   Gemini 1.4 s + TTS 1.8 s). The retrieval SLO is met; the *felt* experience is
   slow. Mitigations: speak only the first sentence while the rest renders, cap
   `max_output_tokens`, and overlap TTS with generation.
