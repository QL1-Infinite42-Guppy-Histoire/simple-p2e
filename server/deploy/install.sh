#!/usr/bin/env bash
# 簡素版P2E points/game server — installer for the shared XServer VPS.
#
# What it does:
#   1. Creates the unprivileged user "p2e" and /opt/simple-p2e
#      (data/ + backups/ live there; code is a git clone in repo/).
#   2. Clones (or pulls) this repository into /opt/simple-p2e/repo.
#   3. Creates /opt/simple-p2e/.env if absent (chmod 600). YOU must fill
#      in ADMIN_SECRET afterwards — the service is not started while it
#      is empty. DISTRIBUTION_PRIVATE_KEY stays empty (payout disabled).
#   4. Installs the systemd unit (Node 24 side-install at /opt/node-v24;
#      the system Node belongs to the CAW node and is never touched)
#      and the daily on-box backup cron.
#
# It does NOT touch any other service on the box (M2E Walk on 8787 and
# the CAW node share this box; this server uses its own user, directory,
# DB and port 8788).
#
# Usage:  sudo bash deploy/install.sh
# Re-running is safe: code is refreshed, .env and data/ are preserved.
set -euo pipefail

APP_HOME="/opt/simple-p2e"
REPO_URL="https://github.com/QL1-Infinite42-Guppy-Histoire/simple-p2e.git"

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/install.sh" >&2
  exit 1
fi

echo "==> Node 24 side-install (must already exist; system Node is NOT touched)"
/opt/node-v24/bin/node --version

echo "==> User and directories"
id p2e >/dev/null 2>&1 || useradd --system --home-dir "$APP_HOME" --shell /usr/sbin/nologin p2e
mkdir -p "$APP_HOME/data" "$APP_HOME/backups"

echo "==> Code (git clone/pull into $APP_HOME/repo)"
if [[ -d "$APP_HOME/repo/.git" ]]; then
  git -C "$APP_HOME/repo" pull --ff-only
else
  git clone "$REPO_URL" "$APP_HOME/repo"
fi

if [[ ! -f "$APP_HOME/.env" ]]; then
  cat > "$APP_HOME/.env" <<'EOF'
PORT=8788
HOST=127.0.0.1
DB_PATH=/opt/simple-p2e/data/simple-p2e.db
ADMIN_SECRET=
<redacted>
  chmod 600 "$APP_HOME/.env"
  echo "    Created $APP_HOME/.env — ADMIN_SECRET is empty; fill it in, then start the service."
fi
chown -R p2e:p2e "$APP_HOME"
chmod 600 "$APP_HOME/.env"

echo "==> systemd"
cp "$APP_HOME/repo/server/deploy/simple-p2e.service" /etc/systemd/system/simple-p2e.service
systemctl daemon-reload
systemctl enable simple-p2e

echo "==> On-box daily backup cron"
cp "$APP_HOME/repo/server/deploy/simple-p2e-backup.cron" /etc/cron.d/simple-p2e-backup

if grep -q '^ADMIN_SECRET=<redacted> "$APP_HOME/.env"; then
  systemctl restart simple-p2e
  echo "    Service started. Check: systemctl status simple-p2e"
  echo "    Health:  curl http://127.0.0.1:8788/health"
else
  echo "    Service enabled but NOT started: fill in ADMIN_SECRET in $APP_HOME/.env first, then:"
  echo "      sudo systemctl start simple-p2e"
fi

echo "Done."
