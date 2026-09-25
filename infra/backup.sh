#!/usr/bin/env bash
set -euo pipefail

# docs/PLAN-PUBLIC.md §11: nightly encrypted pg_dump, shipped off the VM
# to storage under a DIFFERENT account/provider than wherever this runs.
# That's deliberate, not incidental — see §3a's account-suspension risk:
# Oracle holding both the live app and its backups would be a correlated
# single point of failure. See docs/RUNBOOK.md for setting up the rclone
# remote and where the encryption passphrase actually lives.
#
# Required env vars (set in infra/.env, sourced by whatever schedules this
# — see docs/RUNBOOK.md for the systemd timer):
#   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB   (same as the app stack)
#   BACKUP_ENCRYPTION_PASSPHRASE   (long random value, stored OUTSIDE this
#                                   VM too — a passphrase that only lives
#                                   on the machine it protects isn't one)
#   BACKUP_RCLONE_REMOTE           (e.g. "b2:my-bucket/splitty-backups";
#                                   left unset, this just backs up locally
#                                   — useful for testing, not for production)
#
# Usage: infra/backup.sh [output-dir]   (output-dir defaults to infra/backups)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

: "${POSTGRES_USER:?}"
: "${POSTGRES_PASSWORD:?}"
: "${POSTGRES_DB:?}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?}"

OUT_DIR="${1:-$SCRIPT_DIR/backups}"
mkdir -p "$OUT_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="$OUT_DIR/splitty-$TIMESTAMP.sql"
ENCRYPTED_FILE="$DUMP_FILE.enc"

echo "Dumping database $POSTGRES_DB..."
docker compose -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "$DUMP_FILE"

echo "Encrypting dump..."
openssl enc -aes-256-cbc -pbkdf2 -salt \
  -pass "pass:$BACKUP_ENCRYPTION_PASSPHRASE" \
  -in "$DUMP_FILE" -out "$ENCRYPTED_FILE"
rm -f "$DUMP_FILE" # never leave the unencrypted dump on disk

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  echo "Uploading to $BACKUP_RCLONE_REMOTE..."
  rclone copy "$ENCRYPTED_FILE" "$BACKUP_RCLONE_REMOTE"
else
  echo "BACKUP_RCLONE_REMOTE is not set — $ENCRYPTED_FILE was only written locally."
  echo "That's fine for testing; production needs it shipped off this VM (see docs/RUNBOOK.md)."
fi

# Local retention: keep the last 3 encrypted dumps on the VM as a
# fast-restore convenience. The off-box copy (above) is the actual
# durability guarantee — this local copy doesn't survive the risks §3a
# describes (SD-card-equivalent failure, account suspension).
find "$OUT_DIR" -maxdepth 1 -name '*.sql.enc' -print0 | xargs -0 ls -t | tail -n +4 | xargs -r rm -f

echo "Backup complete: $ENCRYPTED_FILE"
