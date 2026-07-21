# Taskvia Phase 0 — 認証境界・WSL2 Gateway・次工程の設計判断

> Date: 2026-07-20  
> Status: Decision accepted for Phase 0  
> Scope: NextAuth Proxy と API 認証の分離、WSL2 実機検証、Phase 0 / Phase 1 の着手順

## 結論

1. NextAuth Proxy は UI page の session 認証だけを担当し、`/api/**` は matcher から除外する。
2. `/api/cards` は Bearer / scope token で利用する通常の一覧 API として維持し、agent の通常取得を `/api/cards/export` へ寄せない。
3. WSL2 gateway、Firewall、独立 watchdog の実機確認を Phase 0 blocker とする。
4. Phase 1 の PostgreSQL 正本化には進まず、認証境界と Phase 0 の残作業を完了させる。

## 1. NextAuth Proxy と API 認証の境界

### 採用する責務分担

```text
UI page
  -> NextAuth session
  -> Proxy は未ログインユーザーを /login へ redirect

/api/**
  -> Proxy の matcher 対象外
  -> 各 Route Handler が Bearer / scoped token を検証
  -> 未認証時は JSON 401 を返す
```

Next.js Proxy は filesystem route より前に実行される。現在の `matcher: ["/", "/api/cards"]` では、Bearer token が正しくても NextAuth session がなければ Route Handler 到達前に 401 となる。Route Handler の単体テストだけでは、この競合を検出できない。

また、現在の UI は `/api/cards` を直接 polling せず、Server Action の `fetchApprovalCards()` からデータを取得している。このため `/api/cards` を Proxy から外しても、UI の取得経路を壊さない。

### `/api/cards/export` を通常取得へ転用しない理由

- export は全件出力と `exported_at` / `count` を返す用途であり、通常の一覧取得や polling と意味が異なる。
- export を agent の正式取得経路にすると、不要な全件取得とAPI責務の混同が起きる。
- `/api/cards` と `/api/cards/**` には既に Route Handler の `isAuthorized()` があるため、認証層の競合を解消すればよい。

### Proxy matcher の方針

Proxy は `/api`、`/login`、Next.js static asset、metadata file を除外し、それ以外の UI page を保護する。現在 matcher 対象外の `/missions/**` や `/verification-queue` も保護対象に含める。

Proxy は補助的な page gate とし、Server Action や mutation の最終的な認可を Proxy だけに依存させない。

### 必須テスト

matcher test:

- `/api/cards`、`/api/cards/export`、`/api/cards/{id}/verification` は Proxy 非該当
- `/`、`/missions/{slug}`、`/verification-queue` は Proxy 該当
- `/login`、`/api/auth/**`、`/_next/**` は Proxy 非該当

実 Next.js HTTP test:

- Bearer token 付き `GET /api/cards` は 200
- Bearer token なし `GET /api/cards` は 401
- NextAuth session だけで Bearer token のない API request は 401
- 未ログインの UI page は `/login` へ redirect
- login 済みの UI page は正常表示

## 2. WSL2 Gateway の実機確認

macOS + colima の検証結果は構成作成の参考にはなるが、WSL2 NAT、Windows localhost forwarding、Windows Firewall の到達境界を保証しない。次を提督の WSL2 環境で確認する。

### Phase 0 acceptance criteria

- Windows watchdog から `https://127.0.0.1/internal/health/watchdog` へ到達できる。
- watchdog token が正しければ health response、未設定または不正なら 401 を返す。
- LAN から Taskvia gateway の許可済み `443` へだけ到達できる。
- PostgreSQL `5432`、Redis `6379`、n8n内部 `5678`、Taskvia内部 `3000`へLANから到達できない。
- WindowsがPublic networkの場合はgatewayにも到達できない。
- WSL2、Docker、Windowsの再起動後にgatewayとlocalhost forwardingが自動復旧する。
- Web、job runner、PostgreSQLを意図的に停止すると、独立watchdogがTaskvia外のchannelへ通知する。

この確認が終わるまで、Phase 0のnetwork / observability DoDは未達とする。

## 3. 次の着手順

次の順序でPhase 0を完了させる。

1. Proxy matcherとRoute Handler認証の境界を修正する。
2. matcher testと実HTTP認証testを追加する。
3. WSL2 gateway、localhost forwarding、Firewallを実機検証する。
4. §17のsignal、独立watchdog、out-of-band alertを実装・検証する。
5. Phase 0 DoD reviewを行う。
6. DoD通過後にPhase 1のPostgreSQL正本化へ進む。

Phase 1のschema検討やmigration調査は読み取り・設計作業として先行可能だが、本番cutoverや正本変更はPhase 0 DoD通過まで開始しない。

## 関連文書

- [Taskvia Local Agent Hub Architecture](./taskvia-local-agent-hub-architecture.md)
- [permissions-design.md（line 18）](/Users/tyz/workspace/taskvia/docs/permissions-design.md:18) — 現行API権限表。`GET /api/cards`を「認証なし」としている記述は今回の判断と不一致のため、認証実装時に更新する。
- [proxy.ts](/Users/tyz/workspace/taskvia/src/proxy.ts:21) — 現在のNextAuth matcher
- [cards Route Handler](/Users/tyz/workspace/taskvia/src/app/api/cards/route.ts:55) — Bearer token検証
- [cards export Route Handler](/Users/tyz/workspace/taskvia/src/app/api/cards/export/route.ts:9) — export用途

