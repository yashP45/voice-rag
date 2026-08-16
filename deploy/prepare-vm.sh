#!/usr/bin/env bash
#
# One-time VM preparation for the auto-deploy pipeline. Idempotent — safe to
# re-run.
#
# Does three things:
#   1. Ends the port-3000 turf war between a hand-started `nohup next start`
#      and voicerag-web.service, so systemd genuinely owns the frontend.
#   2. Converts ~/voice-rag from an rsync'd directory into a real git clone,
#      so a deploy is `git reset --hard` and "what is running?" has an answer.
#   3. Installs the CI deploy public key (pass as $1 or DEPLOY_PUBKEY).
#
# ORDER MATTERS: run this only AFTER the commits you want live are on
# origin/main. Step 2 checks out origin/main, so anything only present on the
# box as an uncommitted hand-edit is replaced by whatever GitHub has.
#
#   bash deploy/prepare-vm.sh "ssh-ed25519 AAAA... voicerag-ci"
#
set -euo pipefail

REPO="$HOME/voice-rag"
ORIGIN="https://github.com/yashP45/voice-rag.git"
PUBKEY="${1:-${DEPLOY_PUBKEY:-}}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# ─── 1. give systemd sole ownership of :3000 ──────────────────────────────
say "1/3  resolving the port-3000 conflict"

# The unit has Restart=always, so while a hand-started process holds the port
# systemd retries every 5s forever. Stop the unit FIRST, otherwise it grabs the
# port the instant the manual process dies and we cannot tell them apart.
sudo systemctl stop voicerag-web 2>/dev/null || true

# Identify the squatter by the PORT IT HOLDS, never by command name. Next
# spawns a worker that renames itself to "next-server (v16.3.1)" — it does not
# match `next start -p 3000` at all, and when its parents are killed it is
# reparented to init and quietly keeps the socket. Matching on the cmdline kills
# the wrapper, leaves the listener, and the unit crash-loops on EADDRINUSE
# looking exactly like it did before.
port_holders() {
  sudo ss -tlnpH 'sport = :3000' 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u
}

HOLDERS=$(port_holders)
if [ -n "$HOLDERS" ]; then
  echo "  stopping process(es) holding :3000 -> $(tr '\n' ' ' <<<"$HOLDERS")"
  # shellcheck disable=SC2086
  sudo kill $HOLDERS 2>/dev/null || true
  for _ in $(seq 1 10); do [ -z "$(port_holders)" ] && break; sleep 1; done
  STILL=$(port_holders)
  if [ -n "$STILL" ]; then
    echo "  forcing: $(tr '\n' ' ' <<<"$STILL")"
    # shellcheck disable=SC2086
    sudo kill -9 $STILL 2>/dev/null || true
    sleep 2
  fi
else
  echo "  nothing holding :3000"
fi
[ -z "$(port_holders)" ] && echo "  :3000 is free" || echo "  WARNING: :3000 still occupied"

sudo systemctl reset-failed voicerag-web 2>/dev/null || true

# ─── 2. turn the directory into a git clone ───────────────────────────────
say "2/3  converting $REPO into a git clone of $ORIGIN"
cd "$REPO"

if [ -d .git ]; then
  echo "  already a git repo"
  git remote set-url origin "$ORIGIN"
else
  # Snapshot the tracked-source-shaped files before git takes over. Small:
  # excludes the 1.3 GB index, the venv and node_modules.
  BK="$HOME/pre-git-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
  tar czf "$BK" \
      --exclude='api/.venv' --exclude='api/data' \
      --exclude='web/node_modules' --exclude='web/.next' \
      api web deploy 2>/dev/null || true
  echo "  backup: $BK ($(du -h "$BK" 2>/dev/null | cut -f1))"

  git init -q
  git remote add origin "$ORIGIN"
fi

git fetch --quiet origin main
echo "  origin/main is $(git rev-parse --short origin/main)"

# .env, api/data/, api/.venv/ and node_modules/ are all gitignored, so this
# cannot touch secrets, the index, or installed dependencies.
git checkout -f -B main origin/main --quiet
git reset --hard origin/main --quiet
echo "  checked out $(git rev-parse --short HEAD)"

chmod +x deploy/*.sh 2>/dev/null || true

# ─── 3. install the CI deploy key ─────────────────────────────────────────
say "3/3  installing the CI deploy key"
if [ -z "$PUBKEY" ]; then
  echo "  no key supplied — skipping (pass it as \$1 to install)"
else
  mkdir -p ~/.ssh && chmod 700 ~/.ssh
  touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
  # Strip any previous copy so re-running does not pile up duplicates.
  COMMENT=$(awk '{print $NF}' <<<"$PUBKEY")
  grep -v "$COMMENT" ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp 2>/dev/null || true
  mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys
  # The key may only run commands; it cannot be used to tunnel into the
  # private network that the OCI firewall otherwise protects.
  echo "no-agent-forwarding,no-port-forwarding,no-X11-forwarding $PUBKEY" >> ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys
  echo "  installed (restricted: no port/agent/X11 forwarding)"
fi

# ─── bring the frontend back up under systemd ─────────────────────────────
say "starting voicerag-web under systemd"
sudo systemctl start voicerag-web
for i in $(seq 1 60); do
  curl -sf -m 3 http://127.0.0.1:3000/api/health >/dev/null 2>&1 && { echo "  web healthy after ${i}s"; break; }
  sleep 1
done

say "state"
printf '  commit : %s\n' "$(git rev-parse --short HEAD)"
for u in voicerag-api voicerag-web voicerag-tunnel voicerag-web-v2 voicerag-tunnel-v2; do
  printf '  %-20s %s\n' "$u" "$(systemctl is-active "$u" 2>/dev/null)"
done
