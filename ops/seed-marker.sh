#!/usr/bin/env bash
# task_150 Phase0-MVP ⑤: restore test 用のマーカーデータを稼働中の postgres に投入する。
# 実データ移行(Phase1 スコープ)ではなく、backup/restore の内容整合性を検証するための
# 最小フィクスチャ。.env* は使用しない(全て compose.yaml のローカル dev fixture 値)。
set -euo pipefail

CONTAINER="${POSTGRES_CONTAINER:-taskvia-task150-postgres-1}"
DB_USER="${POSTGRES_USER:-taskvia}"
DB_NAME="${POSTGRES_DB:-taskvia}"

CONTENT="restore-test-marker-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
CONTENT_HASH=$(printf '%s' "$CONTENT" | shasum -a 256 | awk '{print $1}')

docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
CREATE TABLE IF NOT EXISTS restore_test_marker (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO restore_test_marker (content, content_hash) VALUES ('$CONTENT', '$CONTENT_HASH');
SQL

echo "seeded marker: content_hash=$CONTENT_HASH"
