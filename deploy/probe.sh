#!/usr/bin/env bash
# Run FIRST on the VM. Reports what the box can do and estimates build time,
# so we size the corpus to the hardware rather than guessing.
#
#   bash probe.sh
set -uo pipefail

echo "=================== VM PROBE ==================="
echo "host    : $(hostname)"
echo "os      : $(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || uname -a)"
echo "kernel  : $(uname -r)"
echo

CORES=$(nproc)
echo "vCPUs   : $CORES"
echo "model   : $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs)"

# int8 throughput depends heavily on these. avx512_vnni is the fast path;
# without it ONNX Runtime emulates int8 (still faster than fp32, just less so).
FLAGS=$(grep -m1 '^flags' /proc/cpuinfo)
for f in avx2 avx512f avx512_vnni avx_vnni amx_int8; do
  if echo "$FLAGS" | grep -qw "$f"; then echo "  $f: YES"; else echo "  $f: no"; fi
done
echo

echo "RAM     : $(free -g | awk '/^Mem:/{print $2" GB total, "$7" GB available"}')"
echo "disk    : $(df -h . | awk 'NR==2{print $4" available on "$6}')"
echo

if command -v nvidia-smi >/dev/null 2>&1; then
  echo "GPU     : $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo 'nvidia-smi present but no GPU')"
else
  echo "GPU     : none (CPU-only path)"
fi
echo

echo "python  : $(python3 --version 2>&1)"
command -v git  >/dev/null && echo "git     : $(git --version)"  || echo "git     : MISSING"
echo

# Local box measured 36.4 chunks/s on 14 cores with the int8 model, so ~2.6
# chunks/s per core. Rough, but good enough to choose a corpus size.
PER_CORE=2.6
RATE=$(awk "BEGIN{printf \"%.1f\", $CORES * $PER_CORE}")
echo "=================== ESTIMATE ==================="
echo "projected embed rate: ~${RATE} chunks/s  (${PER_CORE}/core x ${CORES} cores)"
echo
printf "  %-22s %-14s %s\n" "corpus" "chunks" "est. build time"
for N in 10000 40000 80000 151684; do
  CH=$(awk "BEGIN{printf \"%d\", $N * 4.27}")
  MIN=$(awk "BEGIN{printf \"%.0f\", $CH / $RATE / 60}")
  printf "  %-22s %-14s ~%s min\n" "$(printf "%'d" $N 2>/dev/null || echo $N) docs" "$(printf "%'d" $CH 2>/dev/null || echo $CH)" "$MIN"
done
echo
echo "RAM needed to SERVE the full 151,684-doc index: ~1.8 GB"
echo "================================================"
