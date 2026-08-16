#!/usr/bin/env bash
# Build the index on the VM. Runs under nohup so it survives SSH disconnect —
# a multi-hour build dying because a laptop slept is the classic way to lose
# an afternoon.
#
#   bash deploy/build.sh              # full corpus already in data/corpus
#   bash deploy/build.sh 40000        # cap document count
#   bash deploy/build.sh 0 hi,ta,bn   # rebuild corpus from HF with these langs
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/api"

LIMIT="${1:-0}"
LANGS="${2:-}"
CORES=$(nproc)
LOG="$ROOT/api/data/build.log"

export HF_HOME="$ROOT/api/data/hf_cache"
export HF_HUB_DISABLE_SYMLINKS_WARNING=1
export PYTHONIOENCODING=utf-8
# Ingest is a THROUGHPUT problem, unlike serving which is a LATENCY problem —
# so use every core here. app/config.py pins 4 for the serving path.
export OMP_NUM_THREADS="$CORES"

if [ -n "$LANGS" ]; then
  echo "==> rebuilding corpus from HuggingFace (langs: $LANGS)"
  echo "    note: each language file is ~460 MB and has ONE row group, so it"
  echo "    must be downloaded whole — streaming is not possible."
  ./.venv/bin/python scripts/build_corpus.py --langs "$LANGS" --rows-per-lang 6000
fi

if [ ! -f data/corpus/documents.parquet ]; then
  echo "ERROR: data/corpus/documents.parquet missing."
  echo "  Either scp it from your laptop (it is only ~28 MB):"
  echo "    scp api/data/corpus/documents.parquet USER@VM:$ROOT/api/data/corpus/"
  echo "  or rebuild it here:  bash deploy/build.sh 0 hi,ta"
  exit 1
fi

ARGS=(--threads "$CORES" --batch-size 64)
[ "$LIMIT" != "0" ] && ARGS+=(--limit "$LIMIT")

echo "==> building index with ${CORES} threads ${LIMIT:+(limit $LIMIT)}"
echo "    log: $LOG"
nohup ./.venv/bin/python scripts/build_index.py "${ARGS[@]}" > "$LOG" 2>&1 &
PID=$!
echo "    pid: $PID"
echo

cat <<EOF
================================================================
 building in the background. safe to disconnect.

   watch progress : tail -f $LOG
   check running  : ps -p $PID
   stop it        : kill $PID

 when it finishes, either serve from here:
   cd $ROOT/api && ./.venv/bin/python -m uvicorn app.main:app \\
       --host 0.0.0.0 --port 8000 --workers 1

 or pull the artifacts back to your laptop:
   scp -r USER@VM:$ROOT/api/data/index ./api/data/
================================================================
EOF
