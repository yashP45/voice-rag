# Deploying the index build to a VM

Indexing is CPU-bound and takes ~5 hours on the dev laptop (14 cores). Moving
it to a VM with more cores is the fastest path to the full corpus.

Only **28 MB** needs to be transferred — the corpus parquet. Everything else
(the 955 MB of source parquet, the model) is fetched or already built.

---

## 1. Copy the project up

From your laptop, in `voice-rag/`:

```bash
rsync -avz --progress \
  --exclude 'api/.venv' \
  --exclude 'api/data/hf_cache' \
  --exclude 'api/data/index' \
  --exclude 'web/node_modules' \
  --exclude 'web/.next' \
  --exclude '.git' \
  ./ USER@VM_IP:~/voice-rag/
```

`api/data/corpus/documents.parquet` (28 MB) and `api/data/raw/heldout.jsonl`
(1.1 MB) ARE included — those are the built corpus and the held-out benchmark
queries, and rebuilding them on the VM would mean re-downloading ~955 MB of
source parquet for no benefit.

No secrets are copied: `.env` and `.env.local` are gitignored and excluded by
rsync's defaults only if you also pass `--exclude '.env*'` — add it if your
rsync config differs. You will set the key on the VM in step 3.

## 2. Probe the box

```bash
ssh USER@VM_IP
cd ~/voice-rag
bash deploy/probe.sh
```

Reports cores, RAM, CPU instruction sets, and an estimated build time per
corpus size. **Send me that output and I'll tell you which size to pick.**

The instruction-set lines matter more than you'd expect: with `avx512_vnni`
the int8 model runs on a hardware fast path. Without it (as on the dev laptop)
ONNX Runtime emulates int8 — still 5.6× faster than fp32 there, but slower
than a VNNI-capable box of the same core count.

## 3. Set up

```bash
bash deploy/setup.sh
```

Installs system packages, creates the venv, installs Python deps, verifies
that `faiss` and `onnxruntime` import and that `IndexFlatIP` self-search
returns exactly 1.0 (confirming inner product is behaving as cosine), and
pre-caches the embedding model.

Then add your key:

```bash
echo 'GEMINI_API_KEY=your_key_here' > api/.env
```

## 4. Build

```bash
bash deploy/build.sh              # full corpus
bash deploy/build.sh 40000        # cap at 40k documents
```

Runs under `nohup`, so it survives SSH disconnect — a multi-hour build dying
because a laptop slept is an easy afternoon to lose.

```bash
tail -f api/data/build.log
```

## 5. Then either…

**Serve from the VM** (also gives you the "live working link" the submission
needs):

```bash
cd api
./.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

`--workers 1` is not optional: each worker loads its own full copy of every
index (~1.8 GB), so N workers costs N × that.

Open port 8000 in the VM's firewall/security group, then point the frontend at
it in `web/.env.local`:

```
BACKEND_URL=http://VM_IP:8000
```

**Or pull the artifacts back** and keep serving locally:

```bash
scp -r USER@VM_IP:~/voice-rag/api/data/index ./api/data/
```

The index directory for the full corpus is roughly **1.3 GB** (≈1.0 GB of
vectors + ~0.26 GB of chunk text + the BM25 matrix).

---

## Sizing

Measured on the dev laptop: **36.4 chunks/s** on 14 cores with the int8 model
— about **2.6 chunks/s per core**. The full corpus is ~647k chunks.

| vCPUs | est. rate | 40k docs | full 151,684 docs |
|------:|----------:|---------:|------------------:|
| 8     | ~21/s     | ~2.2 h   | ~8.6 h |
| 16    | ~42/s     | ~1.1 h   | ~4.3 h |
| 32    | ~83/s     | ~34 min  | ~2.2 h |
| 64    | ~166/s    | ~17 min  | ~1.1 h |

Scaling is optimistic — memory bandwidth becomes the limit well before core
count does, so treat these as upper bounds.

**If a GPU is ever an option**, it changes the picture entirely: e5-small on a
T4 does the full corpus in roughly 10–20 minutes. That would mean swapping the
ONNX path for `sentence-transformers` on CUDA for the build only; the serving
path stays on ONNX/CPU.
