#!/usr/bin/env bash
# task_150 Phase0-MVP ⑤: PostgreSQL backup(§16.1 `pg_dump -Fc taskvia`)+ 成功 marker 記録。
# §20 U-16(暗号化方針)は未決事項のため、本 MVP は non-encrypted backup とする(明示)。
# .env* は使用しない(全て compose.yaml のローカル dev fixture 値 / 実行時引数)。
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/backups}"
OWNER_ID="${TASKVIA_BACKUP_OWNER_ID:-backup_owner}"
CONTAINER="${POSTGRES_CONTAINER:-taskvia-task150-postgres-1}"
DB_USER="${POSTGRES_USER:-taskvia}"
DB_NAME="${POSTGRES_DB:-taskvia}"

mkdir -p "$BACKUP_DIR"
STARTED_AT=$(date -u +%Y%m%dT%H%M%SZ)
DUMP_FILE="$BACKUP_DIR/taskvia_${STARTED_AT}.dump"
MANIFEST_FILE="$BACKUP_DIR/taskvia_${STARTED_AT}.manifest.json"

docker exec "$CONTAINER" pg_dump -Fc -U "$DB_USER" "$DB_NAME" > "$DUMP_FILE"
COMPLETED_AT=$(date -u +%Y%m%dT%H%M%SZ)

CHECKSUM=$(shasum -a 256 "$DUMP_FILE" | awk '{print $1}')
SIZE=$(wc -c < "$DUMP_FILE" | tr -d ' ')

# §9.4/§16.4 の restore test 検証用に、直近マーカーの content_hash も manifest に残す
# (ops/seed-marker.sh で投入済みの想定。無ければ null)。
MARKER_HASH=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "SELECT content_hash FROM restore_test_marker ORDER BY created_at DESC LIMIT 1;" 2>/dev/null | tr -d '[:space:]' || true)
if [ -z "$MARKER_HASH" ]; then
  MARKER_HASH_JSON="null"
else
  MARKER_HASH_JSON="\"$MARKER_HASH\""
fi

cat > "$MANIFEST_FILE" <<EOF
{
  "backup_file": "$(basename "$DUMP_FILE")",
  "sha256": "$CHECKSUM",
  "size_bytes": $SIZE,
  "started_at": "$STARTED_AT",
  "completed_at": "$COMPLETED_AT",
  "owner_id": "$OWNER_ID",
  "db_name": "$DB_NAME",
  "encrypted": false,
  "encryption_note": "MVP: non-encrypted backup. §20 U-16(backup暗号化方針)は未決事項のため任意とした(task150計画書 Phase3 Wesley 項目6に明記)。",
  "marker_content_hash": $MARKER_HASH_JSON
}
EOF

echo "backup OK: $DUMP_FILE"
echo "manifest: $MANIFEST_FILE"
echo "sha256: $CHECKSUM"
echo "marker_content_hash: $MARKER_HASH_JSON"
