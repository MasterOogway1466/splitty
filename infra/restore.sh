#!/usr/bin/env bash
set -euo pipefail

# Restores an encrypted backup (infra/backup.sh) into a SCRATCH database
# for verification. docs/PLAN-PUBLIC.md §11/§15: an untested backup is a
# guess, not a backup — this is what Phase 0's exit criterion actually
# runs. Never touches the live database.
#
# Usage: infra/restore.sh <path-to-encrypted-dump> [scratch-db-name]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

: "${POSTGRES_USER:?}"
: "${POSTGRES_PASSWORD:?}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?}"

ENCRYPTED_FILE="${1:?Usage: restore.sh <encrypted-dump> [scratch-db-name]}"
SCRATCH_DB="${2:-splitty_restore_test}"
DECRYPTED_FILE="$(mktemp)"
trap 'rm -f "$DECRYPTED_FILE"' EXIT

echo "Decrypting $ENCRYPTED_FILE..."
openssl enc -d -aes-256-cbc -pbkdf2 \
  -pass "pass:$BACKUP_ENCRYPTION_PASSPHRASE" \
  -in "$ENCRYPTED_FILE" -out "$DECRYPTED_FILE"

echo "Recreating scratch database $SCRATCH_DB..."
docker compose -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH_DB;"
docker compose -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE $SCRATCH_DB;"

echo "Restoring into $SCRATCH_DB..."
docker compose -f "$COMPOSE_FILE" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$SCRATCH_DB" < "$DECRYPTED_FILE"

echo
echo "Restore complete into database: $SCRATCH_DB"
echo "Compare row counts / balances against the live database, then drop it:"
echo "  docker compose exec postgres psql -U $POSTGRES_USER -d postgres -c 'DROP DATABASE $SCRATCH_DB;'"
