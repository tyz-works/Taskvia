# 権限設計メモ

## 現状 (as of 2026-04)

`src/lib/auth.ts` はシングルトークンによる認証のみ実装している。

```
TASKVIA_TOKEN (環境変数)
  未設定  → オープンモード（全リクエスト通過）
  設定済み → Authorization: Bearer <token> が一致すれば通過
```

### エンドポイント別の現状認証

| エンドポイント | 認証 | 操作種別 |
|---|---|---|
| `GET /api/health` | なし | Read (疎通確認) |
| `GET /api/cards` | あり (Bearer/scope token) | Read (UI 用一覧) |
| `GET /api/status/[id]` | あり | Read (hook ポーリング) |
| `GET /api/cards/export` | あり | Read (CSV/JSON エクスポート) |
| `GET /api/logs` | あり | Read (ログ閲覧) |
| `POST /api/request` | あり | Write (承認リクエスト投入) |
| `POST /api/log` | あり | Write (ナレッジログ投入) |
| `POST /api/approve/[id]` | あり | Write (承認) |
| `POST /api/deny/[id]` | あり | Write (拒否) |
| `DELETE /api/cards/[id]` | あり | **Delete** (単体削除) |
| `POST /api/cards/bulk-delete` | あり | **Delete** (一括削除) |
| `POST /api/flush-logs` | あり | **Admin** (vault push + Redis del) |

### 課題

現状はすべての操作が同一トークンで実行できる。  
`DELETE /api/cards/[id]` や `POST /api/cards/bulk-delete` などの破壊的操作も、  
`POST /api/request` でカードを投入するエージェント用トークンと区別されていない。

---

## 将来の設計案 — Role-Based Token Scoping

### トークンスコープ

| スコープ | 用途 | 想定利用者 |
|---|---|---|
| `agent` | リクエスト投入・ログ投入・ステータスポーリング | Claude Code hook / Worker |
| `approver` | 承認・拒否 | スマホ UI オーナー |
| `admin` | 削除・一括削除・flush-logs・エクスポート | 管理者のみ |

### 環境変数案

```bash
TASKVIA_TOKEN_AGENT=<agent-token>     # エージェント用
TASKVIA_TOKEN_APPROVER=<ui-token>     # 承認 UI 用 (現状の TASKVIA_TOKEN に相当)
TASKVIA_TOKEN_ADMIN=<admin-token>     # 破壊的操作のみ
```

後方互換: `TASKVIA_TOKEN` が設定されており、新しいスコープ付きトークンが  
未設定の場合は `TASKVIA_TOKEN` を全スコープにフォールバックする。

### 実装イメージ

```typescript
// src/lib/auth.ts (将来案)
type Scope = "agent" | "approver" | "admin";

export function isAuthorized(req: Request, required: Scope): boolean {
  // TASKVIA_TOKEN は全スコープの fallback
  const fallback = (process.env.TASKVIA_TOKEN ?? "").trim();
  const scopeToken = (process.env[`TASKVIA_TOKEN_${required.toUpperCase()}`] ?? "").trim();
  const effectiveToken = scopeToken || fallback;

  if (!effectiveToken) return true; // オープンモード

  const auth = req.headers.get("Authorization");
  return auth === `Bearer ${effectiveToken}`;
}
```

### エンドポイント別のスコープ割り当て案

| エンドポイント | 必要スコープ |
|---|---|
| `POST /api/request` | `agent` |
| `POST /api/log` | `agent` |
| `GET /api/status/[id]` | `agent` |
| `POST /api/approve/[id]` | `approver` |
| `POST /api/deny/[id]` | `approver` |
| `GET /api/cards/export` | `approver` |
| `GET /api/logs` | `approver` |
| `DELETE /api/cards/[id]` | `admin` |
| `POST /api/cards/bulk-delete` | `admin` |
| `POST /api/flush-logs` | `admin` |

---

## 実装優先度

現状のシングルトークン方式でも運用上の大きな問題はないが、  
以下の状況が発生したら role-based token への移行を検討する:

1. エージェント用トークンを複数人・複数環境で共有する必要が出てきた場合
2. 削除操作を特定の人間 (管理者) のみに絞りたい要件が発生した場合
3. 将来的に `/api/cards` (GET) にも認証を追加する場合

---

## Owner Deployment Validation (task_153 / Phase 0 DoD #6)

`GET /api/health` は 3 owner の identity / alert destination を表す 6 環境変数の設定を必須とする
(`src/lib/deployment-validation.ts` / §17.2 line943 が規定する Taskvia Operator / Backup Owner /
Security Owner の 3 役割に対応)。

| 環境変数 | 役割 |
|---|---|
| `TASKVIA_OPERATOR_ID` | Taskvia Operator の identity |
| `TASKVIA_OPERATOR_ALERT` | Taskvia Operator の alert destination |
| `TASKVIA_BACKUP_OWNER_ID` | Backup Owner の identity |
| `TASKVIA_BACKUP_OWNER_ALERT` | Backup Owner の alert destination |
| `TASKVIA_SECURITY_OWNER_ID` | Security Owner の identity |
| `TASKVIA_SECURITY_OWNER_ALERT` | Security Owner の alert destination |

**未設定時の挙動**: 6 変数のいずれかが未設定、または `todo` / `changeme` / `unset` / `backup_owner`
(`ops/backup.sh` の既定値) のようなプレースホルダー値の場合、`validateDeploymentOwners()` が
`ok: false` を返し、`GET /api/health` は **503** を返す(欠落キーのみを応答に含め、値そのものは
含めない)。★本番影響: `src/app/api/health/route.ts` は Vercel でも同一コードで動作するため、
Vercel 環境で 3 owner の 6 変数を設定しない限り `/api/health` は 503 のままになる。

### `/internal/health/watchdog` の認証方式

`src/app/internal/health/watchdog/route.ts` は上記の owner validation とは別の専用トークン
`TASKVIA_WATCHDOG_TOKEN` で認証する(scope token・Bearer 形式)。SHA-256 digest 化した固定長値同士を
`timingSafeEqual` で比較する timing-safe 実装で、依存先(Redis 等)のチェックより認証判定を必ず先に
確定させる — 未認証リクエストへ依存先の障害詳細を漏らさないため。認証失敗時は接続文字列・内部
hostname・error stack のいずれも含めない 401 のみを返す。

## 関連ファイル

- `src/lib/auth.ts` — 現状の認証ヘルパー
- `src/lib/deployment-validation.ts` — owner deployment validation (task_153)
- `src/app/api/health/route.ts` — owner validation 統合先
- `src/app/internal/health/watchdog/route.ts` — watchdog 集約 endpoint
- `src/app/api/cards/[id]/route.ts` — 単体削除
- `src/app/api/cards/bulk-delete/route.ts` — 一括削除
- `src/app/api/flush-logs/route.ts` — vault push + Redis del
