# Taskvia - CLAUDE.md

マルチエージェント向け承認カンバン + ナレッジログ収集システム。
Claude Code の PreToolUse hook からツール実行の承認リクエストを受け取り、
スマホの WebUI で Approve / Deny する。加えてエージェントの気づき・改善案を
Redis にバッファし、Obsidian vault に日次で flush する。

## プロジェクト概要

- **リポジトリ**: `tyz-works/taskvia` (public)
- **Vercel URL**: `taskvia.vercel.app`
- **スタック**: Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4 + Upstash Redis
- **通知**: ntfy.sh
- **Vault 連携**: GitHub Contents API (`tyz-works/tkworks-vault`)

## システム構成

```
エージェント (Claude Code)
   ↓ PreToolUse hook (hooks/pre-tool-use.sh)
   ↓ stdin から {tool_name, tool_input} を受け取る
   ↓
POST /api/request  ──→  Upstash Redis (approval:${id} + approval:index)
                   ──→  ntfy.sh にプッシュ通知
                                         ↓
                                    [スマホ]
                                         ↓
                                    WebUI (/)
                                         ↓ 承認/拒否タップ
                                    POST /api/approve/[id]
                                    POST /api/deny/[id]
                                         ↓
hook が /api/status/[id] を 1秒間隔でポーリング (最大 600 秒)
   ↓
status === "approved"  →  exit 0 (ツール実行)
status === "denied"    →  exit 1 (ツール拒否)
not_found / timeout    →  exit 1
```

別フロー: ナレッジログ

```
エージェント → POST /api/log → Redis (agent:logs list)
                                         ↓ (任意タイミングで flush)
                                    POST /api/flush-logs
                                         ↓ GitHub Contents API
                                    tkworks-vault/agent-logs/YYYY-MM-DD-knowledge.md
```

## ディレクトリ構成

```
src/
  app/
    api/
      health/route.ts          Redis 疎通確認 (認証なし)
      request/route.ts         承認リクエスト投入 + ntfy 通知
      status/[id]/route.ts     ステータスポーリング
      approve/[id]/route.ts    承認エンドポイント
      deny/[id]/route.ts       拒否エンドポイント
      log/route.ts             ナレッジログ投入
      flush-logs/route.ts      agent:logs → Obsidian vault へ push
      cards/route.ts           カード一覧取得 (カンバン UI 用・認証なし)
    layout.tsx                 ルートレイアウト (Geist フォント)
    page.tsx                   カンバン WebUI (3 列 + 承認モーダル)
  lib/
    auth.ts                    Bearer トークン認証ヘルパー
hooks/
  pre-tool-use.sh              Claude Code PreToolUse hook 本体
```

## Upstash Redis のデータ構造

```
approval:{id}           承認リクエスト 1 件 (JSON 文字列)
                        { id, tool, agent, task_title, task_id, priority,
                          status, created_at }
                        TTL: 600 秒
                        status: "pending" | "approved" | "denied"

approval:index          承認リクエスト id の List (lpush される)
                        /api/cards が先頭 100 件を取得して UI に表示

agent:logs              ナレッジ・改善案・作業ログの List (lpush される)
                        { type, content, task_title, task_id, agent, timestamp }
                        type: "knowledge" | "improvement" | "work"
                        flush 時に knowledge / improvement のみ push、
                        push 成功後に list 全体を del
```

## 認証

`src/lib/auth.ts` の `isAuthorized()` ヘルパーが全エンドポイントで使われる
(`/api/health` と `/api/cards` を除く)。

- 環境変数 `TASKVIA_TOKEN` **が未設定なら全リクエスト通過** (オープンモード)
- 設定済みなら `Authorization: Bearer ${TASKVIA_TOKEN}` ヘッダが必須
- 不一致は `401 { error: "Unauthorized" }`

**注意**: `/api/cards` は UI (同一オリジン) から呼ばれる前提で認証されていない。
公開ドメインで動かす場合、UI 側に認証レイヤーを追加するか、`/api/cards` にも
`isAuthorized` を追加することを検討する。

## API 仕様

### GET /api/health
Redis 接続確認 (認証なし)。`{ "status": "ok" }` を返す。

### POST /api/request
エージェントから承認リクエストを投入する。

**リクエスト**
```json
{
  "tool": "Bash(oci db ...)",
  "agent": "Kai",
  "task_title": "Run OL9 compatibility check",
  "task_id": "card-005",
  "priority": "high"
}
```

**レスポンス**
```json
{ "id": "pOdAAna-gKzdO2i8KnYZO" }
```

副作用:
- `approval:{id}` を Redis にセット (TTL 600 秒)
- `approval:index` に id を lpush
- `NTFY_TOPIC` が設定されていれば ntfy.sh にプッシュ通知
  - `Priority: high` 固定
  - `Tags`: `priority === "high"` なら `rotating_light`、それ以外は `bell`
  - `Click` はトップページ (`https://taskvia.vercel.app`) にハードコード

### GET /api/status/[id]
hook がポーリングで叩く。

**レスポンス**
```json
{ "status": "pending", "card": { ... } }
```

TTL 切れは `404 { "status": "not_found" }` を返す (hook は拒否扱い)。

### POST /api/approve/[id] / POST /api/deny/[id]
WebUI から叩く。対応する status に更新する。

**レスポンス**
```json
{ "ok": true }
```

### POST /api/log
エージェントのナレッジ・改善案・作業ログを投入する。

**リクエスト**
```json
{
  "type": "knowledge",
  "content": "OL9 では mod_jk が非推奨、mod_proxy へ移行推奨",
  "task_title": "Run OL9 compatibility check",
  "task_id": "card-005",
  "agent": "Kai"
}
```

`type` を省略すると `"work"` として保存される。

### POST /api/flush-logs
`agent:logs` を読み出して Obsidian vault (`tkworks-vault`) に push する。
`GITHUB_TOKEN` 必須 (未設定時は 503)。

処理フロー:
1. `agent:logs` の全件を `lrange`
2. `type` が `knowledge` / `improvement` のみ抽出 (`work` は破棄)
3. `task_id | task_title` でグループ化して日次 Markdown を整形
4. GitHub Contents API で `agent-logs/YYYY-MM-DD-knowledge.md` に PUT
   - 既存ファイルがあれば `sha` を付けて更新
5. **push 成功を確認してから** `redis.del("agent:logs")`

**Obsidian 出力フォーマット**
```markdown
# Agent Knowledge Log - 2026-04-09

## 💡 Run OL9 compatibility check (card-005)
> Kai · 09:48

OL9 では mod_jk が非推奨、mod_proxy へ移行推奨。

---

## 🔧 Clone Autonomous DB staging (card-004)
> Luca · 09:52

ECPU モデルでは computeCount の明示指定が必須。

---
```

アイコン: `knowledge` → 💡, `improvement` → 🔧

### GET /api/cards
カンバン UI から呼ばれる。`approval:index` の先頭 100 件を `mget` で取得して
カード配列を返す。認証なし。

**レスポンス**
```json
{ "cards": [ { "id": "...", "tool": "...", "status": "pending", ... } ] }
```

## カンバン WebUI (`src/app/page.tsx`)

スマホ優先の Tailwind v4 UI。

- **3 列構成** (旧設計の 4 列ではなく 3 列に収束):
  - `Backlog` (`status === "denied"`)
  - `Awaiting Approval` (`status === "pending"`)
  - `Done` (`status === "approved"`)
- `/api/cards` を **3 秒間隔でポーリング** (SSE は未採用)
- pending カードをタップ → 承認モーダルが開く
- 承認モーダル: TTL カウントダウン進捗バー + Deny / Approve ボタン
- ヘッダーに pending 件数のバッジ (パルスアニメ付き)

## PreToolUse hook (`hooks/pre-tool-use.sh`)

Claude Code の PreToolUse hook として動く bash スクリプト。

### 動作
1. stdin から hook ペイロード `{tool_name, tool_input}` を読む (jq で parse)
2. Bash/Write/Edit は `priority=high`、それ以外は `medium`
3. `POST /api/request` でカードを作成
4. `GET /api/status/{id}` を 1 秒間隔で最大 600 秒ポーリング
5. `approved` → `exit 0` (ツール実行許可)
   `denied` / `not_found` / timeout → `exit 1` (ツール拒否)

### Claude Code 側の設定例

`~/.claude/settings.json`:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "/absolute/path/to/taskvia/hooks/pre-tool-use.sh" }
        ]
      }
    ]
  }
}
```

### 環境変数 (hook 側)

| 変数名 | 用途 | デフォルト |
|---|---|---|
| `TASKVIA_URL` | Taskvia ベース URL | `https://taskvia.vercel.app` |
| `TASKVIA_TOKEN` | Bearer トークン (未設定なら無認証) | (空) |
| `AGENT_NAME` | エージェント識別子 | `hostname -s` |
| `TASK_TITLE` | 現在のタスク名 | `Untitled` |
| `TASK_ID` | 現在のタスク ID | `null` |

## 環境変数 (Vercel 側)

| 変数名 | 用途 | 必須 |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Redis 接続 URL | ✅ (Upstash 統合で自動注入) |
| `UPSTASH_REDIS_REST_TOKEN` | Redis 認証トークン | ✅ (同上) |
| `NTFY_TOPIC` | ntfy プッシュ通知トピック | 任意 (未設定なら通知スキップ) |
| `TASKVIA_TOKEN` | API Bearer 認証 | 任意 (未設定なら無認証) |
| `GITHUB_TOKEN` | vault push 用 PAT (contents:write) | `/api/flush-logs` を使うなら必須 |

## 注意事項

- **Next.js 16 では params が非同期**。
  `{ params }: { params: Promise<{ id: string }> }` で受け取り `await params` する
- `/api/flush-logs` は **push 成功後に redis.del** の順番を厳守する
  (逆にするとログ消失)
- `/api/cards` は認証がないので、公開ドメインでは UI 前段に認証を入れること
- `TASKVIA_TOKEN` 未設定時はオープンモード (全リクエスト通過)。
  本番では必ず設定する

## 既知の積み残し (未実装)

CLAUDE.md の古い版で "次にやること" として挙げていた項目のうち、
**まだ実装されていないもの**:

- **SSE ストリーミング**: 現在は 3 秒ポーリング。SSE / WebSocket 未採用
- **ログ閲覧 UI**: `agent:logs` を閲覧するタブ (作業ログ / ナレッジ / 改善案) は未実装
- **`/api/flush-logs` の自動実行**: 現状は手動 POST のみ。cron / Vercel Cron で日次実行は未設定
- **`/api/cards` の認証**: UI からの同一オリジン呼び出し前提で無認証
- **`layout.tsx` の metadata**: デフォルトの `"Create Next App"` のまま

## 権限設計

現状はシングルトークン方式。将来的に `agent` / `approver` / `admin` の
3 スコープに分離し、削除操作を admin トークンのみに絞る設計案がある。

詳細は [`docs/permissions-design.md`](docs/permissions-design.md) を参照。

## 次にやること (候補)

1. Vercel Cron で `/api/flush-logs` を日次実行
2. `/api/cards` に Bearer 認証 or Session Cookie を追加
3. ログ閲覧タブを UI に追加 (`agent:logs` を lrange で表示)
4. `layout.tsx` の metadata を "Taskvia — Agent Approval Board" 等に更新
5. role-based token scoping の実装 (`docs/permissions-design.md` 参照)
