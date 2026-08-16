#!/usr/bin/env bash
# One-shot VM setup. Handles x86_64 and aarch64, and installs a modern Python
# if the system one is too old.
#
#   bash deploy/setup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/api"

ARCH="$(uname -m)"
echo "==> architecture: $ARCH"

# --- Python ---------------------------------------------------------------
# The code needs 3.10+ (PEP 604 `X | Y` unions). Ubuntu 20.04 ships 3.8,
# which fails at import time, so install 3.12 from deadsnakes when needed.
PY=""
for c in python3.12 python3.11 python3.10; do
  command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }
done

if [ -z "$PY" ]; then
  echo "==> installing Python 3.12 (system python is $(python3 -V 2>&1), too old)"
  sudo apt-get update -qq
  sudo apt-get install -y -qq software-properties-common >/dev/null
  sudo add-apt-repository -y ppa:deadsnakes/ppa >/dev/null 2>&1
  sudo apt-get update -qq
  sudo apt-get install -y -qq python3.12 python3.12-venv python3.12-dev >/dev/null
  PY=python3.12
fi
echo "==> using $($PY -V)"

echo "==> system packages"
sudo apt-get update -qq
sudo apt-get install -y -qq build-essential curl libgomp1 >/dev/null

echo "==> virtualenv"
[ -d .venv ] || "$PY" -m venv .venv
./.venv/bin/python -m pip install --upgrade pip -q

# --- dependencies ---------------------------------------------------------
# On aarch64 the wheel matrix does NOT line up at the latest versions:
#   faiss-cpu 1.15.0 ships aarch64 wheels for cp310 ONLY
#   onnxruntime 1.28.0 ships aarch64 wheels for cp311+ ONLY
# so there is no Python version where both work at their newest releases.
# faiss-cpu 1.13.2 is the most recent version with cp311/cp312 aarch64 wheels,
# which is what makes Python 3.12 viable. Without this pin, pip either fails to
# find a wheel or falls back to a source build that needs a full BLAS toolchain.
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  echo "==> installing dependencies (aarch64 pins)"
  ./.venv/bin/python -m pip install -q "faiss-cpu==1.13.2"
  grep -v '^faiss-cpu' requirements.txt > /tmp/req.arm.txt
  ./.venv/bin/python -m pip install -q -r /tmp/req.arm.txt
else
  echo "==> installing dependencies (x86_64)"
  ./.venv/bin/python -m pip install -q -r requirements.txt
fi

echo "==> verifying the two risky imports"
./.venv/bin/python - <<'PY'
import os
os.environ["OMP_NUM_THREADS"] = "4"
import faiss, onnxruntime, numpy as np
print(f"   faiss       {faiss.__version__}")
print(f"   onnxruntime {onnxruntime.__version__}")
print(f"   numpy       {np.__version__}")
i = faiss.IndexIDMap2(faiss.IndexFlatIP(384))
v = np.random.rand(200, 384).astype("float32"); faiss.normalize_L2(v)
i.add_with_ids(v, np.arange(200).astype("int64"))
d, _ = i.search(v[:1], 1)
assert abs(float(d[0][0]) - 1.0) < 1e-4, "IndexFlatIP self-search must be 1.0"
print("   faiss search OK (inner product behaving as cosine)")
PY

echo "==> pre-downloading the embedding model (~120 MB)"
export HF_HOME="$ROOT/api/data/hf_cache"
export HF_HUB_DISABLE_SYMLINKS_WARNING=1
./.venv/bin/python - <<'PY'
from huggingface_hub import hf_hub_download
for f in ["onnx/model_qint8_avx512_vnni.onnx", "onnx/tokenizer.json"]:
    hf_hub_download("intfloat/multilingual-e5-small", f)
print("   model cached")
PY

mkdir -p data/raw data/corpus data/index data/bench

echo
echo "================================================================"
echo " setup complete on $ARCH with $(./.venv/bin/python -V)"
echo
echo " next:  bash deploy/probe.sh     # confirm cores + estimate"
echo "        bash deploy/build.sh     # build the index"
echo "================================================================"
