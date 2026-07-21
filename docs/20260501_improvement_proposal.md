# Taskvia リファクタリング改善提案レポート

**作成日**: 2026-05-01  
**作成者**: Jiwon (docs/research Worker)  
**調査担当**: Yuki (フロントエンド t001)、Lin (バックエンド t002)、Jiwon (統合)  
**ミッション**: 20260501-taskvia-refactor-research

---

## エグゼクティブサマリー

Taskvia の全ソースコード（フロントエンド 1 ファイル + バックエンド 27 ルート + ライブラリ 4 ファイル）を調査した結果、**P0 バグ 1 件（通知不達）、P1 セキュリティ/可用性 3 件、P2 コード品質 4 件、P3 アーキテクチャ 3 件** の計 11 件の改善点を特定した。

---

## 優先度別 改善提案一覧

| ID | 優先度 | 分類 | 概要 | 影響範囲 |
|----|--------|------|------|----------|
| I-01 | **P0** | Bug | ntfy URL ハードコードによる self-host 通知不達 | actions.ts, requests/route.ts |
| I-02 | **P1** | Security | /api/logs 認証なし | logs/route.ts |
| I-03 | **P1** | Reliability | req.json() try-catch 欠如 | 複数ルート |
| I-04 | **P1** | Consistency | エラーレスポンス形式不統一 | 全 API ルート |
| I-05 | **P2** | Code Quality | page.tsx 1268行 God Component | page.tsx |
| I-06 | **P2** | Code Quality | VerificationBadge 系の完全重複 | page.tsx, verification-queue/page.tsx |
| I-07 | **P2** | Code Quality | JSON.parse パターン 33 箇所重複 | 全ファイル |
| I-08 | **P2** | Code Quality | LogEntry 型が route.ts ローカルに閉じている | logs/route.ts, actions.ts |
| I-09 | **P3** | Architecture | KanbanPage の useState 14 本 | page.tsx |
| I-10 | **P3** | Architecture | setInterval 3 本独立管理 | page.tsx |
| I-11 | **P3** | DX | layout.tsx metadata が "Create Next App" | layout.tsx |

---

## 詳細

### I-01 【P0 Bug】ntfy URL ハードコードによる self-host 通知不達

**場所**: `src/app/actions.ts:49`, `src/app/api/requests/route.ts:103`

**問題**:

```typescript
// actions.ts:49 — NTFY_URL 環境変数を無視して ntfy.sh をハードコード
await fetch(`https://ntfy.sh/${topic}`, { ... });

// requests/route.ts:103 — 同様
await fetch(`https://ntfy.sh/${topic}`, { ... });
```

`src/lib/ntfy.ts` は正しく `NTFY_URL` を参照しているが、`actions.ts` と `requests/route.ts` はライブラリを使わず直接 fetch している。NTFY_URL に self-hosted インスタンスを設定しても、この 2 箇所は常に `ntfy.sh` に送信する。

**修正方針**:

```typescript
// lib/ntfy.ts の publishApprovalRequest / ntfyPublish を使うか、
// または URL を環境変数から取得するよう修正
const ntfyBase = (process.env.NTFY_URL ?? "https://ntfy.sh").replace(/\/$/, "");
await fetch(`${ntfyBase}/${topic}`, { ... });
```

**工数見積**: 30分（2ファイル各1行修正）

---

### I-02 【P1 Security】/api/logs 認証なし

**場所**: `src/app/api/logs/route.ts`

**問題**: `GET /api/logs` は `isAuthorized()` チェックなしで全ナレッジログを返す。`/api/cards` と同じ「UI からの同一オリジン前提」パターンだが、`agent:logs` には `knowledge` / `improvement` タイプの機密性の高い内容が含まれる可能性がある。

**修正方針**: `isAuthorized(req)` を追加。ただし `page.tsx` の `fetchLogs()` も `Authorization` ヘッダを付与する修正が必要。

**工数見積**: 1時間（route + page.tsx の fetch 修正）

---

### I-03 【P1 Reliability】req.json() try-catch 欠如

**場所**: `src/app/api/request/route.ts`, `src/app/api/log/route.ts`, `src/app/api/agents/route.ts` など複数ルート

**問題**: リクエストボディが不正な JSON の場合、`await req.json()` が例外を投げ、Next.js が 500 エラーを返す。エージェント側 hook は 500 を denied 扱いにするためツールが意図せず拒否される。

**修正方針**:

```typescript
let body: Record<string, unknown>;
try {
  body = await req.json();
} catch {
  return Response.json({ error: "invalid_json" }, { status: 400 });
}
```

**工数見積**: 1時間（対象ルートに一括適用）

---

### I-04 【P1 Consistency】エラーレスポンス形式不統一

**問題**: ルートごとにエラーレスポンスの形式が異なる。

| ルート | レスポンス例 |
|--------|-------------|
| agents/route.ts | `{ error: "name is required" }` |
| status/[id]/route.ts | `{ status: "not_found" }` |
| approval-handler.ts | `{ error: "invalid_or_expired_token" }` |
| approve/[id]/route.ts | `{ error: "not_found" }` |

**修正方針**: `src/lib/responses.ts` に共通ヘルパーを定義:

```typescript
export const notFound = (msg = "not_found") =>
  Response.json({ error: msg }, { status: 404 });
export const badRequest = (msg: string) =>
  Response.json({ error: msg }, { status: 400 });
export const serverError = (msg = "internal_error") =>
  Response.json({ error: msg }, { status: 500 });
```

**工数見積**: 2時間（全ルートへの一括置換）

---

### I-05 【P2 Code Quality】page.tsx 1268行 God Component

**場所**: `src/app/page.tsx`

**問題**: 1 ファイルに 8 コンポーネント + メインページが同居。可読性・テスト容易性・差分レビューの困難さが顕在化。

**分離候補コンポーネント**:

| コンポーネント | 行数目安 | 切り出し先 |
|----------------|----------|-----------|
| ApprovalModal | ~130行 | components/ApprovalModal.tsx |
| TaskDetailDialog | ~170行 | components/TaskDetailDialog.tsx |
| TaskCard | ~95行 | components/TaskCard.tsx |
| MissionSelector | ~27行 | components/MissionSelector.tsx |
| RequestFormModal | ~120行 | components/RequestFormModal.tsx |
| Toast | ~17行 | components/Toast.tsx |
| AgentStatusBar | ~85行 | components/AgentStatusBar.tsx |
| LogsView | ~50行 | components/LogsView.tsx |

**工数見積**: 4時間（抽出 + import 修正 + 動作確認）

---

### I-06 【P2 Code Quality】VerificationBadge 系の完全重複

**場所**: `src/app/page.tsx:52-76`, `src/app/verification-queue/page.tsx:10-47`

**問題**: 以下が 2 ファイルに完全重複:
- `type VerificationBadgeStatus`
- `const VERIFICATION_BADGE`
- `function verificationIcon()`

**修正方針**: `src/lib/verification-ui.ts` に切り出し、両ファイルから import:

```typescript
// src/lib/verification-ui.ts
export type VerificationBadgeStatus = "pending" | "verifying" | "verified" | "failed" | "rework";
export const VERIFICATION_BADGE: Record<VerificationBadgeStatus, string> = { ... };
export function verificationIcon(s: VerificationBadgeStatus): string { ... }
```

**工数見積**: 30分

---

### I-07 【P2 Code Quality】JSON.parse パターン 33 箇所重複

**問題**: Upstash Redis の `mget` は文字列または既解析オブジェクトを返すため、全ルートで以下パターンが繰り返されている:

```typescript
typeof raw === "string" ? JSON.parse(raw) : raw
```

**集計**: `src/` 全体で **33 箇所** （actions.ts 13箇所、API routes 20箇所）

**修正方針**: `src/lib/redis-parse.ts` にヘルパーを定義:

```typescript
export function parseRedisValue<T>(raw: string | object | null): T | null {
  if (raw === null) return null;
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
}

export function parseRedisValues<T>(raws: (string | object | null)[]): T[] {
  return raws
    .filter((r): r is string | object => r !== null)
    .map((r) => parseRedisValue<T>(r)!);
}
```

**工数見積**: 2時間（ヘルパー定義 + 全ファイル一括置換）

---

### I-08 【P2 Code Quality】LogEntry 型が route.ts ローカルに閉じている

**場所**: `src/app/api/logs/route.ts:28-35`

**問題**: `LogEntry` インターフェースが route.ts にローカル定義されており、`actions.ts` の `fetchLogs()` や `page.tsx` の型と一致しているか保証されていない。

**修正方針**: `src/app/actions.ts` に `export interface LogEntry` を追加し、logs/route.ts は import:

```typescript
// actions.ts
export interface LogEntry {
  type: "knowledge" | "improvement" | "work";
  content: string;
  task_title: string;
  task_id: string | null;
  agent: string;
  timestamp: string;
}
```

**工数見積**: 30分

---

### I-09 【P3 Architecture】KanbanPage の useState 14 本

**場所**: `src/app/page.tsx:811-829`

**問題**: `KanbanPage` が useState を 14 本保持。関連する状態が分散しており、副作用 (useEffect) との依存追跡が困難。

**修正方針（段階的）**:
1. 近い将来: ドメイン別にカスタムフック分離 (`useApprovalCards`, `useMissions`, `useTasks`, `useAgentStatus`)
2. 長期: `useReducer` に統合し状態遷移を明示化

**工数見積**: 4〜8時間（動作検証含む）

---

### I-10 【P3 Architecture】setInterval 3 本独立管理

**場所**: `src/app/page.tsx:988, 1011, 1023`

**問題**: fetchApprovals / fetchAgentsData / fetchMissions/Requests がそれぞれ独立した setInterval を管理。タブ切り替えやアンマウント時のクリーンアップ漏れが発生しやすい。

**修正方針**: `usePolling(fn, interval)` カスタムフックに統合し、visibility API と連携してバックグラウンドタブでのポーリングを停止。

**工数見積**: 2時間

---

### I-11 【P3 DX】layout.tsx metadata が "Create Next App"

**場所**: `src/app/layout.tsx`

**問題**: `metadata.title` と `metadata.description` がデフォルト値のまま。

**修正方針**:

```typescript
export const metadata: Metadata = {
  title: "Taskvia — Agent Approval Board",
  description: "Multi-agent workflow approval and knowledge log system",
};
```

**工数見積**: 5分

---

## 実装ロードマップ

### Sprint 1（今すぐ）
- I-01: ntfy URL バグ修正（30分）
- I-11: layout.tsx metadata 更新（5分）

### Sprint 2（今週中）
- I-02: /api/logs 認証追加（1時間）
- I-03: req.json() try-catch 追加（1時間）
- I-06: VerificationBadge 切り出し（30分）
- I-08: LogEntry 型 export（30分）

### Sprint 3（来週）
- I-04: エラーレスポンス統一（2時間）
- I-07: JSON.parse ヘルパー化（2時間）

### Sprint 4（中期）
- I-05: page.tsx コンポーネント分割（4時間）
- I-10: usePolling フック（2時間）

### Sprint 5（長期）
- I-09: KanbanPage 状態管理リファクタリング（4〜8時間）

---

## 総工数見積

| Sprint | 内容 | 工数 |
|--------|------|------|
| 1 | バグ修正 + DX | 35分 |
| 2 | セキュリティ + 重複排除 | 3時間 |
| 3 | 一貫性 + ヘルパー化 | 4時間 |
| 4 | コンポーネント分割 + Polling | 6時間 |
| 5 | 状態管理 | 4〜8時間 |
| **合計** | | **約 18〜22時間** |

---

## 参考: 調査ソース

- t001 調査担当: Yuki（フロントエンド）
- t002 調査担当: Lin（バックエンド）  
- コード確認: `src/app/page.tsx`, `src/app/actions.ts`, `src/app/api/**`, `src/lib/**`
- 確認日: 2026-05-01
