#!/usr/bin/env bash
#
# Deploy the current origin/main onto this VM. Run BY the GitHub Actions
# workflow over SSH, but safe to run by hand — that is deliberate, so a broken
# pipeline never blocks a deploy.
#
# The logic lives here rather than in the workflow YAML for three reasons: it
# is version-controlled alongside the code it deploys, it can be tested on the
# box without pushing a commit, and the workflow stays thin enough to read.
#
#   bash deploy/vm-deploy.sh            # deploy origin/main
#   bash deploy/vm-deploy.sh --dry-run  # show what would happen
#
set -euo pipefail

REPO="${REPO:-$HOME/voice-rag}"
API_URL="http://127.0.0.1:8000"
WEB_URL="http://127.0.0.1:3000"
DRY=false
[ "${1:-}" = "--dry-run" ] && DRY=true

cd "$REPO"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }

# --- what is deployed now, and what is being asked for -------------------
OLD=$(git rev-parse HEAD)
git fetch --quiet origin main
NEW=$(git rev-parse origin/main)

say "deployed $(git rev-parse --short "$OLD")  ->  requested $(git rev-parse --short "$NEW")"

if [ "$OLD" = "$NEW" ]; then
  echo "already up to date; nothing to do."
  exit 0
fi

CHANGED=$(git diff --name-only "$OLD" "$NEW")
echo "changed files:"; echo "$CHANGED" | sed 's/^/  /'

api_changed=false; web_changed=false
grep -q '^api/'  <<<"$CHANGED" && api_changed=true
grep -q '^web/'  <<<"$CHANGED" && web_changed=true

# Python deps are NOT auto-installed. On aarch64 this project depends on
# faiss-cpu==1.13.2 while requirements.txt pins 1.15.0 (which has no cp312
# aarch64 wheel) — a blind `pip install -r requirements.txt` would break the
# only working combination on this box. Surface it and stop instead.
if grep -q '^api/requirements' <<<"$CHANGED"; then
  die "requirements changed — install by hand on the VM (mind the faiss ARM pin), then re-run."
fi

$DRY && { echo; echo "[dry run] api_changed=$api_changed web_changed=$web_changed"; exit 0; }

# --- roll forward ---------------------------------------------------------
# .env, api/data/, .venv and node_modules are all gitignored, so a hard reset
# cannot touch secrets, the 1.3 GB index, or installed dependencies.
say "checking out $NEW"
git reset --hard "$NEW" --quiet
git rev-parse --short HEAD

rollback() {
  printf '\n\033[31m!! rolling back to %s\033[0m\n' "$(git rev-parse --short "$OLD")"
  git reset --hard "$OLD" --quiet
  $api_changed && sudo systemctl restart voicerag-api || true
  if $web_changed; then
    (cd web && npm ci --no-fund --no-audit --silent && nice -n 15 npm run build) || true
    sudo systemctl restart voicerag-web || true
  fi
  die "deploy failed and was rolled back"
}

wait_healthy() {         # wait_healthy <url> <grep-pattern> <seconds> <label>
  local url=$1 pat=$2 secs=$3 label=$4 i
  for ((i = 1; i <= secs; i++)); do
    if curl -sf -m 3 "$url" 2>/dev/null | grep -q "$pat"; then
      echo "  $label healthy after ${i}s"; return 0
    fi
    sleep 1
  done
  echo "  $label did NOT become healthy in ${secs}s"; return 1
}

# --- backend --------------------------------------------------------------
if $api_changed; then
  say "api changed — restarting voicerag-api"
  # ~10-30 s: the service reloads 1.3 GB of indexes on every start, which is
  # why this only runs when api/ actually changed.
  sudo systemctl restart voicerag-api
  wait_healthy "$API_URL/health" '"ready":true' 150 "api" || rollback
else
  echo "api unchanged — not restarting (avoids a needless index reload)"
fi

# --- frontend -------------------------------------------------------------
if $web_changed; then
  say "web changed — rebuilding"
  cd web
  npm ci --no-fund --no-audit
  # nice: the build is a throughput job sharing 4 cores with a latency-
  # sensitive API. Losing build seconds is cheap; adding them to a live query
  # is not.
  nice -n 15 npm run build
  cd ..
  sudo systemctl restart voicerag-web
  wait_healthy "$WEB_URL/api/health" '"ready"' 90 "web" || rollback
else
  echo "web unchanged — not rebuilding"
fi

say "deployed $(git rev-parse --short HEAD) successfully"
git log -1 --pretty='  %h  %s  (%an)'
