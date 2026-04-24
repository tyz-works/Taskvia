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
| `NTFY_TOPIC` | 通知を送るトピック名（例: `taskvia-approval-xxxxxxxx`） | (空) — 未設定なら通知スキップ |
| `NTFY_USER` | ntfy Basic 認証のユーザー名 | (空) — 未設定なら認証なし |
| `NTFY_PASS` | ntfy Basic 認証のパスワード | (空) — 未設定なら認証なし |

`NTFY_URL` と `NTFY_TOPIC` の両方が設定されている場合のみ通知が送信される。どちらかが空の場合 `publishApprovalRequest()` は**即時 return（ログなし）**する。

`POST /api/request` に `"notify": true` を渡した場合のみ ntfy 通知が送出される。省略時は通知なし（既存動作を維持）。

> **トピック名の命名規則**: self-host ntfy サーバーで ACL（`taskvia-approval-*` パターンのみ subscribe 許可）を運用している場合、`NTFY_TOPIC` は `taskvia-approval-` プレフィックスで始める必要がある。

> **⚠️ Vercel 本番環境での注意**
>
> Vercel の本番環境変数は `.env.local` と**完全に独立**している。ローカルで動作確認済みでも、Vercel ダッシュボードの **Settings > Environment Variables** に別途 `NTFY_TOPIC` 等を投入しなければ通知は届かない。
>
> `vercel env ls` で変数名が表示されていても、値が空の場合がある（Encrypted 表示では空値を区別できない）。デプロイ後は必ず本番 URL に対してテスト通知を送り、iPhone への着信を目視確認すること。

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

#### Verification UI

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `CREWVIA_VERIFICATION_UI` | Verification バッジ・タブの表示制御。`disabled` にすると全 verification UI が非表示になり、`/verification-queue` は `/` にリダイレクト。ロールバック時に使用。 | (空) — 未設定なら表示 |

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
| `POST` | `/api/verification` | crewvia → Taskvia verification 結果 push（Bearer 必須） |
| `GET` | `/api/verification-queue` | mission 別 verification キュー取得（`?mission=<slug>` 必須） |
| `GET` | `/api/cards/[id]/verification` | タスク別 verification 最新結果取得 |
| `GET` | `/api/cards/[id]/rework-history` | タスク別 rework cycle 履歴取得（最大 15 件） |

## Verification UI

crewvia QA レイヤーの検証結果を Taskvia Board 上で可視化する機能です。

### バッジ 5 状態

Task カードの右下に verification バッジが表示されます（`CREWVIA_VERIFICATION_UI` 未設定時）。

| バッジ | 色 | アイコン | 意味 |
|--------|-----|--------|------|
| `pending` | グレー | `○` | 未検証 |
| `verifying` | 青 | `⟳` | 検証進行中 |
| `verified` | 緑 | `✓` | 検証通過 |
| `failed` | 赤 | `✗` | 検証失敗 |
| `rework: N/3` | オレンジ | `↩` | rework 中（N 回実施済み / 最大 M 回） |

すべての状態でアイコンと色を併用しています（色覚バリア対応）。

### Verification Queue タブ

Header nav の「Verification」リンクから `/verification-queue` ページに遷移します。

- mission 別にグルーピングされた verification 待ちタスク一覧を表示
- `verifying → failed → rework → verified` の優先順で並び替え
- 5 秒 polling で自動更新（タブを開いたままにしておくと自動反映）

### Card 展開時の rework 履歴

タスクカードをクリックして詳細ダイアログを開くと、rework 履歴が cycle 順に表示されます。

- 各 cycle: verdict（✓/✗）+ 失敗 check 一覧 + 実施日時
- 最大 15 cycle まで表示

### Feature flag によるロールバック

```bash
# Vercel 環境変数に追加して再デプロイすることで UI を無効化
CREWVIA_VERIFICATION_UI=disabled
```

設定時の挙動:
- verification バッジが非表示
- Header nav の「Verification」リンクが非表示
- `/verification-queue` は `/` にリダイレクト（307）
- Board / Logs タブ・承認フローは通常通り動作

> **⚠️ Vercel 本番環境での注意（教訓 L1 継承）**
>
> 環境変数の追加・変更は `.env.local` と**完全に独立**している。Vercel ダッシュボードの
> **Settings > Environment Variables** で設定後、必ず再デプロイすること。
> `vercel env ls` で名前が表示されていても値が空の場合がある。

### E2E テスト方法

```bash
# pnpm dev + localhost 推奨（Preview SSO は自動テストの障壁になる — 教訓 L4）
cd ~/workspace/Taskvia && pnpm dev

# 別ターミナル: harness で verification データを投入
cd ~/workspace/crewvia && bash scripts/e2e_harness_task090.sh
```

> **E2E の前提**: Board にカードを表示するには `POST /api/request` による `approval:*` カード作成が必要です。
> `POST /api/verification` だけ投入しても Board に表示されません（教訓 L6）。
> ハーネスは 2 段階フロー（`create_card → post_verification`）で実装済みです。

---

## トラブルシュート

### 通知が iPhone に届かない

**手順 1 — ntfy サーバー直接確認**

```bash
curl -u <NTFY_USER>:<NTFY_PASS> \
  -H "Title: test" -d "hello" \
  https://<NTFY_URL>/<NTFY_TOPIC>
# → 200 なら ntfy サーバーは正常
# → 401/403 なら認証情報を確認（NTFY_USER / NTFY_PASS の設定ミス）
```

**手順 2 — Taskvia → ntfy 区間の確認**

```bash
curl -X POST https://taskvia.vercel.app/api/request \
  -H "Authorization: Bearer <TASKVIA_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"tool":"test","agent":"debug","task_title":"test","notify":true}'
# → レスポンスの id を使って /api/status/<id> をポーリングし、pending のまま動かなければ ntfy 送信に失敗している
```

**手順 3 — Vercel 本番 env の確認（最重要）**

`NTFY_URL` / `NTFY_TOPIC` / `NTFY_USER` / `NTFY_PASS` が Vercel の **production** 環境に設定されているか確認する。

```bash
vercel env ls
# 変数名が表示されていても値が空の場合がある。
# 確認するには vercel env pull .env.verify --environment=production で値を取得し、空でないことを確認する。
```

> **よくある罠（教訓 L1）**: `.env.local` で動作確認済みでも、Vercel 本番の環境変数は独立している。`NTFY_TOPIC` が空値のまま本番にデプロイされると、`publishApprovalRequest()` は**ログなしで即時 return** する（`if (!ntfyUrl || !topic) return;`）。エラーも出ないため原因特定が難しい。

### ntfy 通知は来るが approve-token/deny-token が 404

- トークンの TTL (`APPROVAL_TOKEN_TTL_SECONDS`、デフォルト 900 秒) が切れている可能性がある
- Upstash Redis で `SCAN 0 MATCH approval_token:*` を実行し、対象トークンが残存しているか確認する
- `approval_token:<token>` の `request_id` フィールドで `approval:<id>` カードとの紐付けを確認できる（教訓 L3）

### ntfy 送信のデバッグ方法

`publishApprovalRequest()` は失敗をログに残さない（教訓 L2）。Silent fail を検出するには:

- Upstash コンソールまたは `SCAN 0 MATCH approval_token:*` でトークンが生成されているか確認する
  - トークンが存在すれば `publishApprovalRequest()` は実行されている（ntfy.ts L22〜L33 のトークン生成が通った証拠）
  - トークンがなければ `if (!ntfyUrl || !topic) return;`（L19）で early return している → env var を確認
- Vercel Observability → Functions ログで `/api/request` の実行ログを確認する

### Verification バッジが Board に表示されない（教訓 L6）

Board は `approval:index` → `approval:{id}` を読み、カードの `task_id` で `verification:{task_id}` を紐付けます。
`POST /api/verification` だけ投入しても Board にカードが表示されません。

**対策**:
1. まず `POST /api/request` でカードを作成し、`task_id` を確認する
2. その `task_id` で `POST /api/verification` を投入する
3. crewvia 側 `taskvia-verification-sync.sh` が `POST /api/request` → task_id 発行の流れを経由しているか確認する

### approval card が消えて verification データが孤立する（教訓 L7）

`approval:{id}` の TTL は 600 秒です。カード作成から verification 投入まで時間が空くと、カードが消滅して orphan index が残ります。

**対策**:
- verification データは `POST /api/request` 直後に連続投入する（5 秒間隔が目安）
- TTL を延長する場合は `APPROVAL_TOKEN_TTL_SECONDS` の調整を検討する
- `SCAN 0 MATCH approval:*` で残存カードを確認できる

### Preview URL への POST が 403 / SSO blocked（教訓 L4）

Vercel Preview は Team SSO 保護下にある場合、外部 POST リクエストがブロックされます。

**対策**:
- E2E テストは `pnpm dev` ローカル + 共有 Upstash Redis で実施する（推奨）
- Preview SSO をバイパスするには `VERCEL_AUTOMATION_BYPASS_SECRET` 環境変数の設定が必要（Vercel ドキュメント参照）

### `vercel curl` で POST ができない（教訓 L5）

`vercel curl` コマンド（v50.37.3 以前）は `-X POST` / `--request` フラグを受け付けません。

**対策**:
- 通常の `curl` に `Authorization: Bearer <TASKVIA_TOKEN>` を付けて使用する
- `vercel@52.0.0` 以降では改善されている可能性がある

### `CREWVIA_VERIFICATION_UI` が効かない（教訓 L8）

この変数は `NEXT_PUBLIC_` プレフィックスが**不要**です。Server Component / Server Action でサーバーサイドで読み取ります。

```bash
# ✅ 正しい
CREWVIA_VERIFICATION_UI=disabled

# ❌ 誤り（クライアントサイドに公開する必要はない）
NEXT_PUBLIC_CREWVIA_VERIFICATION_UI=disabled
```

---

## スタック

- [Next.js 16](https://nextjs.org) (App Router)
- [React 19](https://react.dev)
- [TypeScript](https://www.typescriptlang.org)
- [Tailwind CSS v4](https://tailwindcss.com)
- [Upstash Redis](https://upstash.com)
- [ntfy](https://ntfy.sh) (self-host 対応)
