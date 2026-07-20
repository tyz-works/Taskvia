# Operations scripts (task_150 Phase0-MVP ⑤)

`§16` backup/restore の最小 MVP 実装。`.env*` は使用しない — 全て `compose.yaml` のローカル dev fixture 値または実行時引数。暗号化は MVP では非対応(`§20 U-16` 未決事項のため任意)。

```bash
# 1. compose の postgres を起動
docker compose up -d postgres

# 2. restore test 用マーカーを投入(実運用では実データが対象)
bash ops/seed-marker.sh

# 3. backup(pg_dump -Fc, §16.1)+ 成功 manifest 記録
bash ops/backup.sh
# → ops/backups/taskvia_<timestamp>.dump / .manifest.json

# 4. 空(隔離)環境への restore test(新規 volume/container/network を都度作成・検証後に破棄)
bash ops/restore-test.sh ops/backups/taskvia_<timestamp>.dump ops/backups/taskvia_<timestamp>.manifest.json
# → ops/backups/restore-test-log.jsonl に owner_id 付きで結果を追記
```

`TASKVIA_BACKUP_OWNER_ID` 環境変数で実施 owner ID を指定できる(`§20 line864` の最小形。未指定時は `backup_owner`)。

**スコープ**: `§16.4` のうち「backup → marker → restore → marker確認」の最小部分のみ。n8n / `N8N_ENCRYPTION_KEY` / 署名付き webhook / Outbox 再開の確認は対象外(task_150 計画書スコープ外)。
