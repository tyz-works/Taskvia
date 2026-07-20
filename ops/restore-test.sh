#!/usr/bin/env bash
# task_150 Phase0-MVP ⑤: 空(隔離)環境への restore test(§16.4 の最小 Operations 検証)。
# 既存 compose スタックとは完全に別の新規コンテナ・新規 volume・新規 network を
# その場で作成し、既存データを一切再利用せずに backup から復元できることを確認する。
# 検証後、成功可否を owner ID 付きで restore-test-log.jsonl に追記し、隔離環境は破棄する。
#
# 使用範囲: 本 MVP は §16.4 のうち「backup→marker→restore→marker確認」の最小部分のみを
# 対象とする。n8n / N8N_ENCRYPTION_KEY / 署名付き webhook / Outbox 再開の確認は
# task_150 計画書のスコープ外(Phase0 残り or Phase1 以降)。
set -euo pipefail

DUMP_FILE="${1:?usage: restore-test.sh <dump_file> <manifest_file>}"
MANIFEST_FILE="${2:?usage: restore-test.sh <dump_file> <manifest_file>}"
BACKUP_DIR="$(cd "$(dirname "$MANIFEST_FILE")" && pwd)"
OWNER_ID="${TASKVIA_BACKUP_OWNER_ID:-backup_owner}"
LOG_FILE="$BACKUP_DIR/restore-test-log.jsonl"

EXPECTED_HASH=$(jq -r '.marker_content_hash' "$MANIFEST_FILE")
if [ "$EXPECTED_HASH" = "null" ] || [ -z "$EXPECTED_HASH" ]; then
  echo "FATAL: manifest に marker_content_hash がない(ops/seed-marker.sh を先に実行して backup すること)" >&2
  exit 1
fi

SUFFIX=$$
ISOLATED_CONTAINER="taskvia-restore-test-${SUFFIX}"
ISOLATED_VOLUME="taskvia-restore-test-vol-${SUFFIX}"
ISOLATED_NETWORK="taskvia-restore-test-net-${SUFFIX}"

RESULT="fail"
ACTUAL_HASH=""
STARTED_AT=$(date -u +%Y%m%dT%H%M%SZ)

cleanup() {
  docker rm -f "$ISOLATED_CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$ISOLATED_VOLUME" >/dev/null 2>&1 || true
  docker network rm "$ISOLATED_NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== creating isolated (empty) environment: $ISOLATED_VOLUME / $ISOLATED_CONTAINER =="
docker network create "$ISOLATED_NETWORK" >/dev/null
docker volume create "$ISOLATED_VOLUME" >/dev/null

docker run -d --name "$ISOLATED_CONTAINER" \
  --network "$ISOLATED_NETWORK" \
  -v "$ISOLATED_VOLUME":/var/lib/postgresql/data \
  -e POSTGRES_USER=taskvia -e POSTGRES_PASSWORD=taskvia-dev-fixture -e POSTGRES_DB=taskvia \
  postgres:16-alpine >/dev/null

echo "== waiting for isolated postgres readiness =="
READY=0
for _ in $(seq 1 30); do
  if docker exec "$ISOLATED_CONTAINER" pg_isready -U taskvia >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "FATAL: isolated postgres did not become ready in time" >&2
  COMPLETED_AT=$(date -u +%Y%m%dT%H%M%SZ)
  jq -n --arg started_at "$STARTED_AT" --arg completed_at "$COMPLETED_AT" \
    --arg owner_id "$OWNER_ID" --arg backup_file "$(basename "$DUMP_FILE")" \
    --arg result "fail" --arg reason "isolated_postgres_not_ready" \
    '{started_at:$started_at, completed_at:$completed_at, owner_id:$owner_id, backup_file:$backup_file, result:$result, reason:$reason}' \
    >> "$LOG_FILE"
  exit 1
fi

# 復元前に、隔離環境が本当に空(既存データを引き継いでいない)ことを自己点検する。
PRE_EXISTS=$(docker exec "$ISOLATED_CONTAINER" psql -U taskvia -d taskvia -tAc \
  "SELECT to_regclass('public.restore_test_marker');" | tr -d '[:space:]')
if [ "$PRE_EXISTS" != "" ]; then
  echo "FATAL: 隔離環境に復元前から restore_test_marker が存在する(空環境になっていない)" >&2
  exit 1
fi
echo "pre-restore check OK: restore_test_marker はまだ存在しない(空環境確認)"

echo "== pg_restore =="
docker exec -i "$ISOLATED_CONTAINER" pg_restore -U taskvia -d taskvia --no-owner < "$DUMP_FILE"

ACTUAL_HASH=$(docker exec "$ISOLATED_CONTAINER" psql -U taskvia -d taskvia -tAc \
  "SELECT content_hash FROM restore_test_marker ORDER BY created_at DESC LIMIT 1;" | tr -d '[:space:]')

COMPLETED_AT=$(date -u +%Y%m%dT%H%M%SZ)

if [ "$ACTUAL_HASH" = "$EXPECTED_HASH" ]; then
  RESULT="success"
  echo "MARKER VERIFIED: $ACTUAL_HASH == $EXPECTED_HASH"
else
  RESULT="fail"
  echo "MARKER MISMATCH: actual=$ACTUAL_HASH expected=$EXPECTED_HASH" >&2
fi

jq -n --arg started_at "$STARTED_AT" --arg completed_at "$COMPLETED_AT" \
  --arg owner_id "$OWNER_ID" --arg backup_file "$(basename "$DUMP_FILE")" \
  --arg result "$RESULT" --arg expected_hash "$EXPECTED_HASH" --arg actual_hash "$ACTUAL_HASH" \
  --arg isolated_volume "$ISOLATED_VOLUME" \
  '{started_at:$started_at, completed_at:$completed_at, owner_id:$owner_id, backup_file:$backup_file, result:$result, expected_marker_hash:$expected_hash, actual_marker_hash:$actual_hash, isolated_volume:$isolated_volume}' \
  >> "$LOG_FILE"

echo "restore-test log appended: $LOG_FILE"

if [ "$RESULT" != "success" ]; then
  exit 1
fi
