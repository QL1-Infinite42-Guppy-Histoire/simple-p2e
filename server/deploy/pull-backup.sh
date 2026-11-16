#!/usr/bin/env bash
# 簡素版P2E — pull DB snapshots OFF the VPS. Run this on ANOTHER machine
# (the operator's PC / the assistant VM), never rely on the copies that
# live only on the VPS: the VPS is on a short plan and may expire.
#
# Usage:
#   bash deploy/pull-backup.sh <ssh-host> [local-dir]
#     <ssh-host>   e.g. p2e-vps  (an ~/.ssh/config alias) or user@203.0.113.10
#     [local-dir]  default: ~/simple-p2e-backups
#
# Pulls /opt/simple-p2e/backups/*.db via rsync over SSH (only new files).
set -euo pipefail

HOST="${1:?usage: pull-backup.sh <ssh-host> [local-dir]}"
LOCAL_DIR="${2:-$HOME/simple-p2e-backups}"
mkdir -p "$LOCAL_DIR"

rsync -az --include='simple-p2e-*.db' --exclude='*' \
  "$HOST:/opt/simple-p2e/backups/" "$LOCAL_DIR/"

echo "Local snapshots in $LOCAL_DIR:"
ls -lt "$LOCAL_DIR" | head -8
