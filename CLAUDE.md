# Taskvia - CLAUDE.md

マルチエージェント向けカンバン + Web承認システム。
エージェントのツール実行をスマホのWebUIで承認・拒否できる。

## プロジェクト概要

- **リポジトリ**: `tyz-works/taskvia` (public)
- **Vercel URL**: `taskvia.vercel.app`
- **スタック**: Next.js 15 (App Router) + TypeScript + Upstash Redis
- **通知**: ntfy.sh

## システム構成

```
エージェント（Claude Code）
   ↓ PreToolUse hook → POST /api/request
[Vercel Functions]
   ↓ ntfy.sh に通知
[スマホ] → 通知タップ → WebUI
   ↓ POST /api/approve or /api/deny
エージェント側 hookが polling → exit 0 or exit 1
```

## ディレクトリ構成

```
src/
  app/
    api/
      health/route.ts        疎通確認
      request/route.ts       承認リクエスト投入 ✅
      status/[id]/route.ts   ステータスpolling ✅
      approve/[id]/route.ts  承認 ✅
      deny/[id]/route.ts     拒否 ✅
      log/route.ts           ナレッジログ投入 🚧 未実装
      flush-logs/route.ts    KV→Obsidian push 🚧 未実装
    page.tsx                 カンバンUI 🚧 未実装
```

## Upstash Redis のデータ構造

```
approval:{id}   承認リクエスト1件
                { id, tool, agent, task_title, task_id, priority, status, created_at }
                TTL: 600秒
                status: "pending" | "approved" | "denied"

agent:logs      List型。ナレッジ・改善案のバッファ
                { type, content, task_title, task_id, agent, timestamp }
                type: "knowledge" | "improvement" | "work"
                flush後に削除する（pushしてから削除の順番を守ること）
```

## 実装済みAPIの仕様

### POST /api/request
エージェントから承認リクエストを投入する。

**リクエスト**
```json
{
  "tool": "Bash(ls -la)",
  "agent": "Worker-A",
  "task_title": "Run OL9 compatibility check",
  "task_id": "card-005",
  "priority": "high"
}
```

**レスポンス**
```json
{ "id": "pOdAAna-gKzdO2i8KnYZO" }
```

### GET /api/status/[id]
hookスクリプトがpollingで叩く。

**レスポンス**
```json
{ "status": "pending", "card": { ... } }
```

### POST /api/approve/[id] / POST /api/deny/[id]
WebUIから叩く。statusを更新する。

**レスポンス**
```json
{ "ok": true }
```

## 未実装: POST /api/log

ナレッジ・改善案をKVに保存する。

**リクエスト**
```json
{
  "type": "knowledge",
  "content": "OL9ではmod_jkが非推奨、mod_proxyへ移行推奨",
  "task_title": "Run OL9 compatibility check",
  "task_id": "card-005",
  "agent": "Worker-A"
}
```

実装方針: `redis.lpush("agent:logs", JSON.stringify(entry))`

## 未実装: POST /api/flush-logs

KVのナレッジ・改善案をObsidian vault（tyz-works/tkworks-vault）にpushする。

実装方針:
1. `redis.lrange("agent:logs", 0, -1)` で全件取得
2. typeが `knowledge` / `improvement` のみ抽出（`work` は捨てる）
3. 日付ごとのMarkdownに整形（フォーマットは下記参照）
4. GitHub API（`GITHUB_TOKEN`環境変数）でtkworks-vaultにpush
5. push成功を確認してから `redis.del("agent:logs")`

**Obsidianの出力フォーマット**
```markdown
# Agent Knowledge Log - 2026-04-09

## 💡 Run OL9 compatibility check (card-005)
> Worker-A · 09:48

OL9ではmod_jkが非推奨、mod_proxyへ移行推奨。

---

## 🔧 Clone Autonomous DB staging (card-004)
> Worker-B · 09:52

ECPUモデルではcomputeCountの明示指定が必須。

---
```

vault内パス: `agent-logs/YYYY-MM-DD-knowledge.md`

## 未実装: カンバンWebUI

`src/app/page.tsx` にカンバンボードを実装する。

参照実装: `kanban-approver.jsx`（Claude.aiとの会話で作成済みのプロトタイプ）

**必要な機能**
- 4列カンバン（Backlog / In Progress / Awaiting Approval / Done）
- Awaiting Approvalのカードをタップ → 承認モーダル
- 承認モーダルにカウントダウンタイマー
- Approve → `/api/approve/[id]` POST → Done列へ
- Deny → `/api/deny/[id]` POST → Backlog列へ
- ログパネル（作業ログ / ナレッジ / 改善案 タブ切り替え）
- SSEでリアルタイムストリーミング表示

## 未実装: hookスクリプト（エージェント側）

`hooks/pre-tool-use.sh` として作成する。

```bash
#!/bin/bash
# PreToolUse hook
# Claude Codeの settings.json に登録して使う

TASKVIA_URL="https://taskvia.vercel.app"
TASKVIA_TOKEN="${TASKVIA_TOKEN}"  # 環境変数から取得

CARD_ID=$(curl -s -X POST "$TASKVIA_URL/api/request" \
  -H "Authorization: Bearer $TASKVIA_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"tool\": \"$TOOL_NAME\", \"agent\": \"$AGENT_NAME\"}" \
  | jq -r .id)

for i in $(seq 600); do
  STATUS=$(curl -s \
    -H "Authorization: Bearer $TASKVIA_TOKEN" \
    "$TASKVIA_URL/api/status/$CARD_ID" | jq -r .status)
  [ "$STATUS" = "approved" ] && exit 0
  [ "$STATUS" = "denied" ]   && exit 1
  sleep 1
done
exit 1
```

## 未実装: ntfy通知

`/api/request` のPOST処理内でntfyに通知を送る。

```typescript
await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
  method: "POST",
  body: `承認待ち: ${card.tool}`,
  headers: {
    "Title": "Agent Approval Required",
    "Priority": "high",
    "Click": `https://taskvia.vercel.app/approve/${card.id}`,
  },
});
```

環境変数: `NTFY_TOPIC`（Vercelの環境変数に追加すること）

## 環境変数

| 変数名 | 用途 | 設定場所 |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Redis接続URL | Vercel（自動注入済み） |
| `UPSTASH_REDIS_REST_TOKEN` | Redis認証トークン | Vercel（自動注入済み） |
| `NTFY_TOPIC` | ntfyトピック名 | Vercel環境変数に追加が必要 |
| `TASKVIA_TOKEN` | API認証トークン | Vercel環境変数に追加が必要 |
| `GITHUB_TOKEN` | vault push用 | Vercel環境変数に追加が必要 |

## 注意事項

- Next.js 15ではparamsが非同期。`{ params }: { params: Promise<{ id: string }> }` で受け取り `await params` すること
- flush-logsはpushしてから削除の順番を守ること（逆にするとログ消失）
- TASKVIA_TOKENの認証は未実装。実装する際はすべてのAPIルートに追加すること

## 次にやること

1. `NTFY_TOPIC` を Vercel 環境変数に追加
2. `/api/request` にntfy通知を組み込む
3. カンバンWebUIを実装（`src/app/page.tsx`）
4. `/api/log` を実装
5. `/api/flush-logs` を実装（GitHub Token取得が必要）
6. hookスクリプトを実装・テスト
7. TASKVIA_TOKEN認証を全APIに追加
