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
| `GET /api/cards` | なし | Read (UI 用一覧) |
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

## 関連ファイル

- `src/lib/auth.ts` — 現状の認証ヘルパー
- `src/app/api/cards/[id]/route.ts` — 単体削除
- `src/app/api/cards/bulk-delete/route.ts` — 一括削除
- `src/app/api/flush-logs/route.ts` — vault push + Redis del
