# Taskvia — Agent Approval Board

マルチエージェント向け承認カンバン + ナレッジログ収集システム。

Claude Code の `PreToolUse` hook からツール実行の承認リクエストを受け取り、スマホの WebUI または ntfy アクションボタンで Approve / Deny する。

## 概要

```
エージェント (Claude Code)
   ↓ PreToolUse hook (hooks/pre-tool-use.sh)
   ↓
POST /api/request ──→ Upstash Redis
                  ──→ ntfy (self-host) にプッシュ通知
                                        ↓
                               [スマホ: ntfy app]
                               アクションボタンをタップ
                               POST /api/approve-token/[token]
                               POST /api/deny-token/[token]
                                        ↓ または
                               [ブラウザ WebUI]
                               POST /api/approve/[id]
                               POST /api/deny/[id]
                                        ↓
hook が /api/status/[id] を 1 秒間隔でポーリング (最大 600 秒)
   ↓
approved → exit 0 (ツール実行許可)
denied   → exit 1 (ツール拒否)
```

## セットアップ

### 1. 依存インストール

```bash
pnpm install
```

### 2. 環境変数の設定

`.env.local` を作成するか、Vercel ダッシュボードの **Settings > Environment Variables** で設定する。

#### 必須

| 変数名 | 説明 |
|--------|------|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis の REST URL（Vercel 統合で自動注入） |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis の認証トークン（同上） |

#### ntfy 通知（self-host ntfy サーバーへの接続）

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `NTFY_URL` | ntfy サーバーのベース URL（例: `https://ntfy.example.com`） | (空) — 未設定なら通知スキップ |
| `NTFY_TOPIC` | 通知を送るトピック名 | (空) — 未設定なら通知スキップ |
| `NTFY_USER` | ntfy Basic 認証のユーザー名 | (空) — 未設定なら認証なし |
| `NTFY_PASS` | ntfy Basic 認証のパスワード | (空) — 未設定なら認証なし |

`NTFY_URL` と `NTFY_TOPIC` の両方が設定されている場合のみ通知が送信される。

`POST /api/request` に `"notify": true` を渡した場合のみ ntfy 通知が送出される。省略時は通知なし（既存動作を維持）。

通知には iOS Shortcut / ntfy アプリで直接タップできるアクションボタンが含まれる:
- **✓承認** → `POST /api/approve-token/[token]`
- **✗却下** → `POST /api/deny-token/[token]`

アクションボタンの URL 生成に `TASKVIA_BASE_URL` を使用する。

#### 承認トークン

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `APPROVAL_TOKEN_TTL_SECONDS` | ntfy アクションボタン用ワンタイムトークンの有効期限（秒） | `900`（15 分） |
| `TASKVIA_BASE_URL` | 承認 URL の生成に使うベース URL | `https://taskvia.vercel.app` |

`TASKVIA_BASE_URL` は自己ホストする場合に設定する。Vercel にデプロイして `taskvia.vercel.app` を使う場合は省略可。

#### その他

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `TASKVIA_TOKEN` | API の Bearer 認証トークン | (空) — 未設定なら無認証（オープンモード） |
| `GITHUB_TOKEN` | Obsidian vault への flush に使う PAT（`contents:write` 権限必須） | (空) — `/api/flush-logs` を使うなら必須 |

#### `.env.local` の例

```env
# Upstash Redis（必須）
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# ntfy self-host 通知
NTFY_URL=https://ntfy.example.com
NTFY_TOPIC=my-approval-topic
NTFY_USER=alice
NTFY_PASS=secret

# 承認トークン設定
APPROVAL_TOKEN_TTL_SECONDS=900
TASKVIA_BASE_URL=https://taskvia.vercel.app

# API 認証（本番では必ず設定）
TASKVIA_TOKEN=your-api-token

# ナレッジログ vault 連携
GITHUB_TOKEN=ghp_xxxx
```

### 3. 開発サーバー起動

```bash
pnpm dev
```

[http://localhost:3000](http://localhost:3000) でカンバン UI が開く。

### 4. PreToolUse hook の設定

`~/.claude/settings.json` に以下を追加:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/taskvia/hooks/pre-tool-use.sh"
          }
        ]
      }
    ]
  }
}
```

hook 側で使う環境変数:

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `TASKVIA_URL` | Taskvia のベース URL | `https://taskvia.vercel.app` |
| `TASKVIA_TOKEN` | Bearer トークン | (空) — 未設定なら無認証 |
| `AGENT_NAME` | エージェント識別子 | `hostname -s` |
| `TASK_TITLE` | 現在のタスク名 | `Untitled` |
| `TASK_ID` | 現在のタスク ID | `null` |

## Vercel へのデプロイ

```bash
vercel deploy --prod
```

Upstash Redis 統合を Vercel ダッシュボードで追加すると `UPSTASH_REDIS_REST_URL` と `UPSTASH_REDIS_REST_TOKEN` が自動注入される。その他の環境変数は **Settings > Environment Variables** で手動設定する。

## API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/health` | Redis 疎通確認（認証なし） |
| `POST` | `/api/request` | 承認リクエスト投入 + ntfy 通知 |
| `GET` | `/api/status/[id]` | ステータスポーリング |
| `POST` | `/api/approve/[id]` | WebUI からの承認 |
| `POST` | `/api/deny/[id]` | WebUI からの拒否 |
| `POST` | `/api/approve-token/[token]` | ntfy アクションボタンからの承認（認証不要） |
| `POST` | `/api/deny-token/[token]` | ntfy アクションボタンからの拒否（認証不要） |
| `GET` | `/api/cards` | カンバン UI 用カード一覧（認証なし） |
| `POST` | `/api/log` | ナレッジ・改善案ログ投入 |
| `POST` | `/api/flush-logs` | `agent:logs` を Obsidian vault に push |

## スタック

- [Next.js 16](https://nextjs.org) (App Router)
- [React 19](https://react.dev)
- [TypeScript](https://www.typescriptlang.org)
- [Tailwind CSS v4](https://tailwindcss.com)
- [Upstash Redis](https://upstash.com)
- [ntfy](https://ntfy.sh) (self-host 対応)
