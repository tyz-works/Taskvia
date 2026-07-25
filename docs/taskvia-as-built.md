# Taskvia as-built ドキュメント

> 対象: main = `65c69af`。読み手が「今動いているものは何か」を知るためのドキュメント。
> `architecture.md` が描く目標構成とは独立に、**現時点でコードが実際にしていること**だけを記述する。
> 全ての事実記述はコードの `path:line` またはamun実機/Vercel本番での実測に基づく（既存ドキュメントの書き写しではない）。
> 「動く」と書いた箇所は実機検証済み、「未検証」と書いた箇所はそう明記する（丸めない）。

---

## 1. この文書は何か / 既存文書との地図

Taskviaには複数のドキュメントが存在し、それぞれ異なる問いに答える。読者が「知りたいことがどこに書いてあるか」で迷わないよう、まず地図を示す。

| 文書 | 何に答えるか | 何に答えないか |
|---|---|---|
| `README.md` | プロジェクトの概要・クイックスタート | 現在の実装の細部（README図には実装とのずれがある。§3・§10参照） |
| `docs/taskvia-local-agent-hub-architecture.md`（architecture.md） | **目標アーキテクチャ**（Phase 0〜Phase Nの段階導入計画・将来のあるべき姿） | **現在の状態**。architecture.mdに書かれた設計の多くはまだ実装されていない（§9参照） |
| `docs/permissions-design.md` | 権限設計の**将来案**（role-based token scoping等） / 2026-04時点の認証状況スナップショット | 現在（2026-07時点）の認証の全体像。追加された機構・エンドポイントを反映していない（§7参照） |
| `docs/runbooks/phase0-watchdog.md` | 独立watchdogの運用手順（Windows Scheduled Task） | watchdog以外の運用（health endpoint確認・backup・ログ運用等。§8で補完） |
| **本文書（taskvia-as-built.md）** | **今この瞬間、コードが実際に何をするか**。使い方・データの実体・認証の実態・運用時に見るべき場所・未実装領域 | 将来の設計判断（architecture.md・permissions-design.mdの役割）。この文書はコードを変更しない・修正提案も行わない（発見した欠陥はTroiが直接直さず、後続ミッション候補として§10に記載するのみ） |

**この文書が重複して答えない領域**: 目標アーキテクチャの設計思想（→ architecture.md）、権限スコープの将来設計（→ permissions-design.md）、watchdogの詳細な設定手順（→ runbooks/phase0-watchdog.md）。本文書はこれらへのポインタを§8・§9・§10に置く。

---

## 2. Taskvia とは何か

**Taskvia は、AI エージェントが危険な操作を実行する直前に人間の承認を挟む「門番」であり、同時にミッション / タスク / 検証結果を記録するボードである。**

Claude Code のようなエージェントは、ファイル書き換えやシェル実行を自律的に行う。Taskvia はその手前に **PreToolUse hook** を差し込み、**人間が承認するまでツール実行を止める**。

| 主張 | 根拠 |
|---|---|
| ツール実行前に割り込む hook として動く | `hooks/pre-tool-use.sh:2-8`（`~/.claude/settings.json` の `PreToolUse` に登録する前提がコメントで明示） |
| 承認されるまで**待つ**（最大 600 秒・1 秒間隔ポーリング） | `hooks/pre-tool-use.sh:24`（`TIMEOUT=600`）、`:69-70`（ポーリングループ） |
| 承認されたらツール実行を許可、拒否されたら止める | `hooks/pre-tool-use.sh:76-79`（`approved` → `exit 0`）、`:80-83`（`denied` → `exit 1`） |
| **失敗時は既定で拒否**（fail-closed） | `hooks/pre-tool-use.sh:61-64`（リクエスト投入失敗 → `exit 1`）、`:84-87`（TTL切れ → `exit 1`）、`:91-92`（タイムアウト → `exit 1`） |

**運用者にとっての要点**: 「承認しない」という選択をしなくても、通信断・サーバ障害・放置はすべて**拒否**に倒れる。エージェントが人間の不在に乗じて実行を継続することはない。

承認の門番機能に加え、Taskviaはミッション管理（`src/app/api/missions/route.ts`）・タスク管理（`src/app/api/missions/[slug]/tasks/route.ts`）・検証結果記録（`src/app/api/verification/route.ts`）・エージェント/ワーカー状態（`src/app/api/agents/route.ts`, `workers/route.ts`）・ログ収集（`src/app/api/log/route.ts`, `logs/route.ts`）の機能を持つ。永続化はすべて Upstash Redis 経由（詳細は§5）。**RDBは使っていない**（Phase 0時点。`src/`配下にPostgreSQLクライアントのimportは存在しない。詳細は§5）。

### 中心概念5つ

| 概念 | Redis キー | TTL | 型定義 | 主な API |
|---|---|---|---|---|
| Approval Card | `approval:{id}` / 索引 `approval:index` | **600秒** | ★専用の型定義なし（インライン object literal） | 作成 `POST /api/request`、読取 `GET /api/status/[id]`、一覧 `GET /api/cards` |
| Mission | `mission:{slug}` / 索引 `mission:index` | なし（無期限） | ★型定義なし | `GET/POST /api/missions` |
| Task | `mission:{slug}:tasks:{id}` / 索引 `mission:{slug}:tasks:index` | なし（無期限） | ★型定義なし | `GET/POST /api/missions/[slug]/tasks` |
| Verification | `verification:{task_id}` / 履歴 `verification:history:{task_id}` / 索引 `verification:index:{mission_slug}` | **7日** | ✅ `VerificationPayload`（`src/lib/verification.ts:10-19`） | `POST /api/verification` |
| Action Token | `approval_token:{token}` | **900秒**（既定） | ★型定義なし | 発行 `publishApprovalRequest`、消費 `POST /api/approve-token/[token]` / `deny-token/[token]` |

★**特筆**: 5概念のうち**明示的なTypeScript型を持つのはVerificationのみ**。他4概念は各ルート内のobject literalとして定義されており、**単一の正本となる型定義が存在しない**。

★**Mission/TaskはTTL無期限**である一方、Approval Card（600秒）・Verification（7日）は保持方針が異なる。運用者はこの非対称性を把握しておくべきである。

★**`verification:index:{mission_slug}` だけexpireされない**（`src/app/api/verification/route.ts:41-45`）。本体は7日で消えるため、索引が実体のないtask_idを指し続ける。

---

## 3. 中心的な流れ

### 全体の経路（★実装どおり。README図とは異なる。詳細は本章末尾参照）

```
[エージェント: Claude Code]
  │ ツール実行の直前
  ▼
hooks/pre-tool-use.sh
  │ ① stdinからhook JSONを読む            :27-29
  │ ② tool名から要約と優先度を作る        :32-40
  │ ③ POST /api/request                    :54-57
  ▼
src/app/api/request/route.ts
  │ ④ Bearer認証                          :10
  │ ⑤ カード生成 (status="pending")        :12-25
  │ ⑥ Redis保存 (TTL 600s) + 索引          :27-28
  │ ⑦ if (notify) のときだけntfy通知       :30-32
  │    ★hookはnotifyを送らない → 通常は通らない（下記参照）
  ▼ (idを返す :34)
hooks/pre-tool-use.sh
  │ ⑧ 1秒間隔でGET /api/status/{id}        :69-73
  ▼
src/app/api/status/[id]/route.ts
  │ ⑨ approval:{id}をGET → statusを返す    :14-18
  ▼
  approved → exit 0 / denied → exit 1 / not_found → exit 1
```

### 決定を下す2経路（副作用が異なる）

| | A. WebUI経路 | B. ntfyトークン経路 |
|---|---|---|
| エンドポイント | `POST /api/approve/[id]` / `deny/[id]` | `POST /api/approve-token/[token]` / `deny-token/[token]` |
| 実装 | `src/app/api/approve/[id]/route.ts:7-22` | `src/lib/approval-handler.ts:30-73` |
| 認証 | ✅ `isAuthorized`（`:11`） | ❌ 無し。URL内のトークンが資格情報 |
| 原子性 | GET→SETの2手順（`:14`,`:19`）。★原子化されていない | ✅ Luaで原子化（`approval-handler.ts:12-26`） |
| 二重実行防止 | ★無し（何度でも上書き可能） | ✅ `consumed_at`で409（`:46-49`） |
| ntfy結果通知 | ❌ しない | ✅ `publishResultNotification`（`:67`） |
| 監査ログ | ❌ しない | ✅ `logApprovalOperation` → `agent:logs`（`:68`, `:75-92`） |

★**これはas-builtの重要な事実である。同じ「承認」でも、どちらの経路を通ったかで通知とログの有無が変わる。WebUIで承認した操作は`agent:logs`に残らない。**（自分で`src/app/api/approve/[id]/route.ts`と`src/lib/approval-handler.ts`を開いて確認済み — 上記コード確認は本ミッションで実施したものであり伝聞ではない。）

### ★README図と実装のずれ（発見1・最重要）— ntfy通知経路は実質到達不能

`README.md:13-14`の図は、`POST /api/request`から2本の矢印（Redis保存とntfy通知）が並列に描かれており、常に両方が起きるように読める。

実際のコードは`src/app/api/request/route.ts:30`で`if (notify)`——**既定では通知しない**。さらに重要な点として、**リポジトリ全体（同梱hookを含む）で`notify`をtruthyな値として渡す呼び出し元が1つも存在しない**ことを自分で確認した:

```
$ grep -rn "notify" src/ hooks/ scripts/ --include='*.ts' --include='*.tsx' --include='*.sh'
src/app/api/request/route.ts:12:  const { tool, agent, task_title, task_id, priority, notify, project } = await req.json();
src/app/api/request/route.ts:30:  if (notify) {
```

定義と分岐の2行のみがヒットする。同梱の`hooks/pre-tool-use.sh:46-52`が組み立てるJSONペイロードにも`notify`キーは含まれない。**帰結**: 同梱のhookをそのまま使う限り、ntfy通知は飛ばず、Action Tokenも作られず、ntfyボタン経由の承認経路（経路B）は到達不能である。実際に動くのは**経路A（WebUI）のみ**。README風のcurl例をそのまま本番へ送っても、`notify: true`を明示しない限り既定では実プッシュは発生しない。

★なお`README.md:61`本文は`"notify": true`を渡した場合のみ通知される旨を正しく記載しており、図（`:13-14`）・API表（`:176`）とREADME内部で記述が矛盾している。正しいのは`:61`側である。

---

## 4. 構成要素

Taskviaは Phase 0 時点で本番（Vercel）とローカル（amun上のDocker Compose）という**2つの独立したデプロイ形態**を持つ。

| 観点 | 本番（Vercel） | ローカル（amun） |
|---|---|---|
| 何が動くか | Vercelのサーバレス関数（Next.js route handlerがVercel基盤上でオンデマンド実行。常駐プロセスではない） | Docker Compose 5コンテナが常駐。gatewayがTLS終端しtaskvia:3000へreverse_proxy（`docker/Caddyfile:25,29`） |
| データストア | Upstash Redis（実クラウドサービス）。PostgreSQLコンテナは存在しない | ローカル`redis`コンテナを`redis-http`(SRH)がREST API互換にラップ。**`postgres`コンテナは起動しているがアプリからは未使用**（§5参照） |
| 到達範囲 | インターネットから到達可能（Vercel標準のパブリックデプロイ） | task_154で確定: **localhostからのみ到達可能**。LANからもtailnet(Tailscale)からも到達不可（gateway 443がamun機のloopback限定であることをtask_154で実測確認済み） |
| 用途 | 本番運用（実ユーザー・実ミッション向け） | ローカル開発・検証専用（`compose.yaml`冒頭コメント「データの正本化(Phase1以降)には一切踏み込まない」） |

### ★同一エンドポイントが2つのデプロイで正反対の結果を返す — `GET /api/health`

`GET /api/health`は、本番（Vercel）とローカル（amun）で**正反対の応答**を返す。

| デプロイ先 | 応答 | 原因 |
|---|---|---|
| **Vercel本番** | `HTTP 503` `{"status":"fail-fast","reason":"deployment owners are not configured", "missing":[...6キー...]}` | `src/lib/deployment-validation.ts`が実装するowner検証（3 owner ×id/alert計6環境変数）が未設定であることを検知し、意図的にfail-fastしている（`src/app/api/health/route.ts:23-29`） |
| **amunローカル** | `HTTP 200` `{"status":"ok"}` | **owner検証を実装したコミット`65c69af`より古いDockerイメージがamunで稼働中**であるため（stale image問題。実測: `docker inspect`のイメージ作成日時=2026-07-20T09:37:23Z UTC、owner検証を追加したコミット=2026-07-21T11:49:39Z UTC。`git show 65c69af --stat`でこのコミットが変更した唯一のコンテナ内ファイルが`src/app/api/health/route.ts`と`src/lib/deployment-validation.ts`であることを確認済み） |

★★**この差は設定の違いではなく、コードバージョンの違いによって生じている**。owner 6環境変数はVercel・amun双方とも未設定である点は共通しているが、amunで稼働中のバイナリにはowner検証ロジックそのものが存在しない（実装される前のイメージ）。

★★**直感的な読み方は逆であることに注意**: 「200=正常、503=異常」と読むと、amunの方が健全なデプロイであるかのように見える。**これは誤りである**。amunが200を返すのは、まさにVercelを503にしている安全装置（owner検証）がamunには実装されていない（古いイメージのため）からに過ぎない。amunの200は「健全さ」の証拠ではなく、「安全装置が存在しないこと」の証拠である。この記述だけを根拠に、amunをVercelより信頼できるデプロイだと判断してはならない。

★amunのDockerイメージは意図的に再ビルドしていない。stale であること自体が、後述§9・§10の「deployment freshness gap」を観測可能にする証拠であり、破壊すると失われるため。

### amunの5コンテナの役割

```
$ docker ps -a --format "{{.Names}}\t{{.Status}}\t{{.Image}}"
taskvia-gateway-1       Up   caddy:2-alpine
taskvia-taskvia-1       Up   taskvia-taskvia
taskvia-redis-http-1    Up   hiett/serverless-redis-http:latest
taskvia-postgres-1      Up (healthy)   postgres:16-alpine
taskvia-redis-1         Up (healthy)   redis:7-alpine
```

| サービス | 役割 |
|---|---|
| `postgres` | **起動しているが、アプリケーションコードは一切使用していない**。Docker healthcheck(`pg_isready`)で「動作可能」であることのみ確認されている。将来のPhase1「PostgreSQL正本化」に備えたプレースホルダ的な存在（`compose.yaml:9-17`） |
| `redis` | 実データストア本体。`redis-http`(SRH)から参照される裏側のRedisサーバ |
| `redis-http` | `serverless-redis-http`（SRH）。`redis`をUpstash REST API互換のHTTPインターフェースとして公開するアダプタ。アプリが使う`@upstash/redis`クライアントはRESTベースであり生の`redis://`を話せないため必要 |
| `taskvia` | Next.jsアプリ本体（Web/API）。`redis-http`をUpstash REST互換エンドポイントとして参照 |
| `gateway` | Caddy。443でTLS終端し、`taskvia:3000`へreverse_proxy。自己署名証明書(`tls internal`)を使用。サイトブロックは`localhost, gateway`の2ホスト名にのみマッチし、IP literal接続はSNI非送出のためハンドシェイクを拒否される（task_154所見Cで再現確認済み） |

★**「動いている」≠「使われている」の具体例**: `taskvia-postgres-1`は`docker ps`上で`Up ... (healthy)`と表示されるが、これはPostgreSQLプロセス自体が起動していることを示すだけであり、アプリケーションコードが一度でも接続を試みたかとは無関係である（§5参照）。

---

## 5. データはどこにあるか

taskviaのデータ正本は本番・ローカルいずれも`@upstash/redis`クライアント経由のUpstash Redis（REST API）である。

- 本番は実Upstashクラウドサービスに接続
- ローカルはSRH(serverless-redis-http)がローカルRedisコンテナをUpstash REST互換のHTTPインターフェースとしてラップしたものに接続

**コードは本番・ローカルで完全に同一のクライアント実装（`Redis.fromEnv()`）を使うが、接続先バックエンドの実体が異なる**という関係にある。

`Redis.fromEnv()`の呼び出し箇所は自分で確認したところ29件あった:
```
$ grep -rn "Redis.fromEnv" src/ --include="*.ts" | grep -v node_modules | grep -v "\.test\."
```
`src/lib/`配下2件（`approval-handler.ts:5`, `ntfy.ts:4`）、`src/app/`配下27件（`actions.ts:7`、`api/health/route.ts:4`、`api/internal/health/watchdog/route.ts:13`、Mission/Card/Approval/Verification系の主要APIルート全て）。

**PostgreSQLクライアントは存在しない**（自分で確認済み）:
```
$ grep -rln "require('pg')\|from 'pg'\|from \"pg\"" src/ --include="*.ts" | grep -v node_modules
（出力なし）
$ grep -n "\"pg\"\|postgres\|drizzle\|prisma\|typeorm" package.json
（出力なし）
```

`package.json`の依存関係一覧にもPostgreSQL接続用パッケージは一切存在しない。**PostgreSQLは将来のPhase1「PostgreSQL正本化」に向けて容器としては既に用意されているが、現時点のデータ正本には一切含まれない**（`compose.yaml:1-6`のコメントと整合）。

本番の到達性についても運用者が把握すべき事実がある: Vercel本番URLはインターネットから到達可能だが`/api/health`はowner検証のfail-fastで503を返し続けている（§4参照・意図的な安全装置であり障害ではない）。一方ローカル（amun）はtask_154で確定した事実として、localhostからのみ到達可能でLAN・tailnetいずれからも到達できない——運用のためにはこの非対称性（本番=到達可能だが機能面でfail-fast／ローカル=機能するが到達範囲が極めて限定的）を理解しておく必要がある。

---

## 6. 使い方

### 6.1 PreToolUse hook を有効にする

`~/.claude/settings.json`に以下を追加する（`hooks/pre-tool-use.sh:5-8`のコメントに実際に書かれている登録例そのもの）:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "/path/to/hooks/pre-tool-use.sh" }] }
    ]
  }
}
```

`/path/to/hooks/pre-tool-use.sh`はtaskviaリポジトリをcloneした実パスに置き換える。

| 環境変数 | 必須 | 既定値 | 備考 |
|---|---|---|---|
| `TASKVIA_URL` | 任意 | `https://taskvia.vercel.app`（`pre-tool-use.sh:19`） | ★未設定だと自動的に**本番**へ向く。ローカル検証時は明示的に上書きすること |
| `TASKVIA_TOKEN` | 任意 | 空 | 空の場合`Authorization`ヘッダを付けない。サーバ側は token未設定ならopen modeで全許可するため動作はするが無防備（§7参照） |
| `AGENT_NAME` | 任意 | `hostname -s` | 承認カードに表示されるエージェント名 |
| `TASK_TITLE` / `TASK_ID` | 任意 | 空 | 承認カードのタイトル・タスクID |

★**運用上の注意（★Beverly実機検証で挙動を確認済み）**: `pre-tool-use.sh:71`の`curl -sf`の`-f`はHTTP 4xx/5xxでレスポンスボディを捨てて非ゼロ終了する。`GET /api/status/[id]`が期限切れカードに対して`404 {"status":"not_found"}`を返すため、この404はcurlの`-f`に握りつぶされjqに何も渡らず`"error"`扱いになる。結果として**`not_found`分岐は事実上到達しにくく、TTL切れは実際には最終タイムアウト(600秒後)まで待ってから拒否になる**。「即時拒否」ではなく「最大600秒後に拒否」が実際の挙動である。

### 6.2 API を直接叩く

**★どの実例も「amunローカル向け」か「Vercel本番向け」かを必ず区別すること。** README.mdの既存curl例はトラブルシューティング章のものであり、意図的に本番URLへ実送信してntfy到達を検証するデバッグ手順（`notify:true`込み）である。そのまま本番へ流用すると実カード・実プッシュが発生しうる。

**POST /api/request（amunローカル向け・安全な例）** — ★実機検証済み(PASS)。以下と等価なリクエストを実際にamun上で実行し、応答形式が一致することを確認した:

```bash
curl -X POST https://YOUR-AMUN-HOST.example/api/request \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "Bash(rm -rf /tmp/scratch)",
    "agent": "example-agent",
    "task_title": "sample task",
    "priority": "medium",
    "notify": false
  }'
# → {"id":"SAMPLE_CARD_ID"}
```

amun向けにこのリクエストを送っても実カード・実プッシュ以外の副作用はない（`UPSTASH_REDIS_REST_URL`がローカルredis-httpコンテナを指しており、`NTFY_*`もamunに一切未設定のため`src/lib/ntfy.ts`の`if (!ntfyUrl || !topic) return;`でno-opになる。★これは`notify:true`を明示的に渡した場合も同様であることを実機で確認済み——`docker logs`にntfy関連のfetch試行の形跡は一切残らない）。

**★Vercel本番へ向ける場合の警告**: `NTFY_*`が本番に設定済みかつ`"notify": true`を渡した場合、実ntfyトピックへ実プッシュ通知が飛ぶ（iPhone等の実機に着信する）。★リポジトリ全体（同梱hookを含む）に`notify:true`を渡す呼び出し元は1つも存在しないため、README風にnotifyを省略したcurlを本番へそのまま叩いてもデフォルトでは実プッシュは発生しない。実プッシュが起きるのは`notify:true`を明示指定した場合のみである。事前に`"notify": false`を明示するか、動作確認目的では本番を叩かないこと。

**GET /api/status/[id]（承認状態のポーリング）** — ★実機検証済み(PASS)。存在するカードで`{status, card}`、存在しないIDで`HTTP 404 {status:"not_found"}`を確認済み。Vercel本番向けのGETは読取専用で副作用がないため安全に実行できる。

**認証なしリクエストは401** — ★実機検証済み(PASS)。amunはtoken設定済み（open modeでない）ため、Authorizationヘッダ無しのリクエストは401になることを確認済み。

### 6.3 スマホから承認する

ntfy通知の「✓承認」「✗却下」ボタンは`approve-token`/`deny-token`の使い捨てURLに紐づいており、タップするとその場で承認/却下が確定する（二重タップは自動的に無視される — Lua scriptによる原子的処理）。

★**未検証（amun環境では検証不能）**: この経路全体（Action Token発行 → ntfy通知 → ボタンタップ → 消費）のライブ検証は、amunに`NTFY_URL`/`NTFY_TOPIC`が未設定のためトークンが1つも発行されず、実施できなかった。個々のAPI(`approve-token`/`deny-token`)のコード自体は読解済みで、コードは動作するはずだが、エンドツーエンドの実地検証はできていない。設定変更・実ntfy送信はいずれも本ミッションで禁止されているため、意図的にこの範囲へは踏み込んでいない。

### 6.4 Web UI

- **トップの承認ボード**（`src/app/page.tsx`）: 4カラムのKanban(Blocked/Backlog/In Progress/Done)でタスクを表示。ヘッダーの「承認N件」バッジから`ApprovalModal`を開き承認/却下できる（★これは`POST /api/approve/[id]`のREST経路とは別系統——Server Action経由でNext.jsセッション内部を通り、Bearer token認証を経由しない）。「Logs」タブは`GET /api/logs`を叩く。
- **`missions/[slug]`（ミッション詳細）**: 該当ミッション配下のタスク一覧・ワーカー一覧をタブ切替UIで表示。存在しなければ404。
- **`verification-queue`**: 検証中/やり直し中のタスクを横断確認できる（`CREWVIA_VERIFICATION_UI`機能フラグで無効化可能）。

★**未検証**: 上記3画面はいずれも`/login`への307リダイレクトが実機で発生することは確認済み（NextAuth session matcherが効いていることの裏付け）だが、**Google OAuthの実セッションが必要なため、ログイン後の画面内容（Kanban表示・ミッション詳細・検証キュー一覧）そのものは未検証**である。提督の実アカウントでのログイン確認が別途必要。

---

## 7. 認証と権限の実際

Taskviaには目的の異なる**6種類**の認証/ゲート機構が並存している。

| # | 機構 | 何を守るか | 特記事項 |
|---|---|---|---|
| 1 | Bearer token（`TASKVIA_TOKEN`）— `isAuthorized()`（`src/lib/auth.ts:2-7`） | `src/app/api`配下23ファイル・**31**個のHTTPメソッドハンドラ | ★**`TASKVIA_TOKEN`未設定時は`isAuthorized()`が常に`true`を返す（open mode）**。この場合、`/api/health`を除く31エンドポイント全てが無認証で全許可になる |
| 2 | Action Token（承認URL埋め込み型・使い捨て） | 承認/拒否の一回性実行 | 発行=`src/lib/ntfy.ts:46-60`（TTL既定900秒）。消費=Lua原子化(`approval-handler.ts:12-26`)。Bearer認証なし——トークン文字列そのものが認証情報 |
| 3 | NextAuth session（Google OAuth）（`src/proxy.ts:9-18`） | UIページ（`/`, `missions/[slug]`等）のみ | ★`config.matcher`（`proxy.ts:20-22`）は`/api/**`と`/internal/**`を明示的に対象外としている。**NextAuth sessionはAPI呼び出しには一切関与しない** |
| 4 | `CRON_SECRET`（Vercel Cron専用） | `GET /api/flush-logs`（`flush-logs/route.ts:107-121`） | `isAuthorized()`を一切経由しない独立機構。未設定なら503でfail-closed（`TASKVIA_TOKEN`のfail-open=open modeとは対照的）。同一ファイルの`POST`ハンドラは機構1（Bearer）経由——**同一ファイルに2つの異なる認証機構が共存** |
| 5 | watchdog scope token（`TASKVIA_WATCHDOG_TOKEN`） | `/internal/health/watchdog` | SHA-256 digest + `timingSafeEqual`によるtiming-safe比較。`TASKVIA_TOKEN`/`isAuthorized()`とは完全に独立 |
| 6 | ★認証なし（No-Auth）— `GET /api/logs` | — | `src/app/api/logs/route.ts`は`isAuthorized()`を一切呼ばず、他のいかなる認証機構も経由しない。コード自身のコメントが「現時点では無認証」と自認（`logs/route.ts:6-9`）。`agent:logs`全件が、gatewayに到達できる全員に無条件で読める |

### `docs/permissions-design.md`との乖離（2026-04時点のスナップショットのまま未更新）

| エンドポイント | permissions-design.md の記載 | 実装（コード確認） | 判定 |
|---|---|---|---|
| `GET /api/health` | 「なし」（認証なし） | `TASKVIA_TOKEN`未設定なら503、3 owner環境変数未設定なら503（task_153で追加）。認証そのものではないが能動的なゲートが存在する | 乖離（docは2026-04時点で正しかったが、task_153のDoD#6実装で状況が変わり未更新） |
| `GET /api/logs` | 「あり」（Bearer/scope token） | 完全に無認証 | **★重大な乖離**。★ここで誤っているのは実装であり、docの想定（「あり」）の方が本来あるべき姿を正しく反映していた。本番で無認証状態が現に公開されていることを確認済み——詳細と最優先の是正候補は§10 項目1参照 |

未記載のエンドポイント/機構: `POST /api/approve-token/[token]`・`deny-token/[token]`（Action Token全体）、`GET /api/flush-logs`（CRON_SECRET）、NextAuth sessionによるUIページ保護、`missions/*`・`requests/*`・`verification/*`・`verification-queue`・`workers`・`agents`の各エンドポイント。

### ★承認/拒否の二重経路とその非対称性（発見3）

`/api/approve/[id]`（Bearerゲート）と`/api/approve-token/[token]`（Action Token）は、同じ「承認」という操作に対する2つの独立した実装である。

| | `/api/approve/[id]` | `/api/approve-token/[token]` |
|---|---|---|
| 認証 | `isAuthorized()`（`TASKVIA_TOKEN`） | トークン文字列そのもの（使い捨て） |
| 一回性保証 | ★**なし**（何度POSTしても200を返し続ける。`route.ts:14,19`はGET→SETの2手順で原子化されていない） | ✅ あり（Luaスクリプトで原子的にconsumed_atをチェック、2回目は409） |
| ntfy結果通知・監査ログ | ❌ しない | ✅ する（`agent:logs`へ記録） |

同じ承認でも経路によって監査証跡の有無・一回性保証の有無が変わる、という事実を運用者は把握しておくべきである。`docs/permissions-design.md`はこの非対称性に一切触れていない。

### 運用上の含意

> `TASKVIA_TOKEN`を設定し忘れる、または空文字列/空白のみで設定してしまうと、`isAuthorized()`は無条件に`true`を返す「open mode」に入る。この状態では`/api/health`を除く**31個のAPIエンドポイント全て**（mission/card/request/agent/worker管理を含む読み書き操作）が無認証で誰でも実行可能になる。`/api/health`自体は503を返すが、この503はDocker Composeのヘルスチェックにもgateway(Caddy)のルーティングにも接続されておらず、トラフィックを実際に止める効果は無い。**本番運用では`TASKVIA_TOKEN`を必ず設定し、かつ起動後に`/api/health`が200を返すことを確認すること。** さらに`/api/logs`は`TASKVIA_TOKEN`の設定有無に関わらず常時無認証であることも運用者は認識しておくべきである。

---

## 8. 運用（壊れたときどこを見るか）

### 8.1 health endpoint

`GET /api/health`は運用状態の第一の確認点だが、**応答の意味はデプロイ先によって異なる**（§4参照）。

★★**Vercel本番の`/api/health`は現在503を返している**（owner 6環境変数が未設定・`{"status":"fail-fast","reason":"deployment owners are not configured"}`）。**これは「壊れている」のではなく「fail-fast検証が設計どおり働いている」結果である**という区別を短絡させてはならない（根拠: `src/lib/deployment-validation.ts:8-19`, `src/app/api/health/route.ts:23-29`）。解消にはowner 6環境変数のVercel環境変数設定が必要（提督の設定作業。§10参照）。

一方**amunローカルの`/api/health`は200を返す**が、これは§4で説明したとおりstale image問題によるものであり、code-levelの意図（owner未設定なら503）どおりには動作していない。運用者がamun側の200を見て「正常」と判断してはならない。

### 8.2 独立watchdog

Windows Scheduled Task（Taskvia-Watchdog-Phase0）による監視の設定・運用手順は`docs/runbooks/phase0-watchdog.md`に詳細がある。本文書では重複記載しない。要点のみ: watchdogは`/internal/health/watchdog`（機構5・専用token）への到達性とbackup/restore testの鮮度を監視し、異常時にTaskvia外のchannel（ntfy）へ通知する設計。

### 8.3 backup

`ops/backup.sh` / `ops/restore-test.sh` / `ops/seed-marker.sh`によるPostgreSQL論理バックアップ（現状PostgreSQLは§5のとおり未使用のためbackup対象データは限定的）。詳細な検証結果はtask_154の成果物を参照（本文書はas-built記述に専念し重複しない）。

### 8.4 ログ

`agent:logs`（Redis list）に、承認操作（`approval-handler.ts:75-92`）・knowledge/improvement/work種別のエージェントログが蓄積される。`GET /api/logs`で閲覧可能（★§7のとおり無認証）。Vercel Cronによる`GET /api/flush-logs`が定期的にvaultへpushしRedisから削除する（`CRON_SECRET`必須）。

★**運用上の注意（§3・§7参照）**: WebUI経由の承認（`/api/approve/[id]`）は`agent:logs`に記録されない。監査ログを頼りに「何が承認されたか」を追う場合、WebUI経由の承認はこのログに現れないことを踏まえる必要がある。

---

## 9. 実装されていないもの

architecture.mdは目標アーキテクチャを描いており、その多くはまだ実装されていない。読者がarchitecture.mdを読んで「もう実装済み」と誤解しないよう、現状と将来を具体的に区別する。

| architecture.mdの記述 | 現状 |
|---|---|
| PostgreSQLへのデータ正本化（Phase1） | ★**未実装**。`postgres`コンテナは起動しているがアプリコードからの接続経路が皆無（§5）。データ正本は現在もUpstash Redisのみ |
| n8n連携（Phase4） | ★**未実装**。本文書のスコープでは接続コードを確認していない |
| job runner・Outbox dispatcher（Phase1のMVP-A項目4・Phase3強化） | ★**未実装**。`src/`配下に`job-runner`相当のファイルは存在しない（task_154 Geordi実測と整合） |
| scoped token移行（`TASKVIA_TOKEN`の役割別分割） | ★**未実装**。現行は`TASKVIA_TOKEN`（汎用）と`TASKVIA_WATCHDOG_TOKEN`（watchdog専用）の2種のみ。`docs/permissions-design.md`が描くrole-based token scopingは設計のみで実装なし |
| rate limit（gateway/application両方） | ★**未実装**。`docker/Caddyfile`にもアプリ層にもrate limitディレクティブなし |
| 悪意あるURL・Markdown・oversized payloadのsanitization | ★**未実装**。`src/app/api/request/route.ts`は入力を無検証でそのままRedis保存・ntfyへ渡す |
| backup暗号化 | ★**未実装**。manifest実測`encrypted:false`（task_154確認済み） |
| deployment freshness検証機構（稼働中インスタンスがmainより古いことの検知） | ★**未実装**。§4の`/api/health`200 vs 503がまさにこの欠如を観測可能な形で示した具体例である（§10参照） |

---

## 10. 既知の未解決事項

1. **★★★最優先: `GET /api/logs`の無認証は実装上の欠陥であり、本番で現に公開状態にある（§7参照）**。`src/proxy.ts`のmatcherは`/api/**`をNextAuth session保護の対象外としており、`src/app/api/logs/route.ts`は`isAuthorized()`を含むいかなる認証機構も呼ばない——これはコードの実装そのものが無認証であるという事実である。★これはドキュメントの記載が古いという文書上の問題ではない。**Picardが本番URLに対し直接検証し、`GET /api/logs`がHTTP 200で実際のエージェントログ内容（実行済みの操作内容やエージェント識別情報を含む）を無認証のまま返すことを確認済みである**（★具体的に取得された内容そのものは、二次的な露出を避けるため本文書には転記しない。脆弱性の性質のみを記述する）。旧`docs/permissions-design.md`が本エンドポイントを「あり」（認証あり）と記載していたのは、むしろ実装がそうあるべきだという想定を正しく反映していた側であり、**誤っているのは実装であって、当時のドキュメントの想定ではない**。
   - **後続ミッション候補（fix・本ミッションでは実装しない）**: `GET /api/logs`に認証（`isAuthorized()`呼び出し、または相当のBearer検証）を追加する。規模感は小（1エンドポイントへの認証チェック追加+回帰テスト）だが、**本番で現在進行形の露出があるため優先度は本文書中の他のどの項目よりも高い**。★本ミッション(task_155)はドキュメント化のみを目的としており、taskviaのコードは一切変更していない（コード変更ゼロの原則を維持）。是正は別ミッションとして起票し、Admiralの認可のもとPicardが直接対応を報告中である。

2. **Vercel本番`/api/health`の503**: owner 6環境変数未設定によるfail-fast（§8参照）。恒久的にこの状態で運用してよいか、owner変数を設定して200に戻すかは、**task_154で既に提督判断事項として起票済み**（レビューノート`~/obsidian/research/20260725_taskvia_phase0_dod_review.md`参照）。本文書はこの既知事項へのポインタを置くのみで、決定はしない。

3. **★deployment freshness gapの具体例（§4・§9参照）**: amunで動く`/api/health`が200を返す事実は、抽象的なリスクではなく、**deployment freshness検証機構が存在しないことが観測可能な形で現れた実例**である。稼働中のインスタンスがmainより古いバージョンを実行していることを検知する仕組みは、Phase0のどこにも存在しない。amunの200という応答は「たまたま気づけた」だけであり、系統的な検知手段ではない。

4. **★★Action Token / Approval Card の TTL不整合による correctness 欠陥（後続ミッション候補）**: hookのタイムアウト(`TIMEOUT=600`秒)・Approval CardのRedis TTL(600秒)に対し、Action TokenのTTLは既定900秒であり、**カードより長い**。600〜900秒の間にAction Token経由で承認/却下すると、トークンは正しく消費されるが、`src/lib/approval-handler.ts:56-63`の`if (cardRaw)`ガードは対応する`approval:{id}`カードが既にTTL失効(null)しているため**静かにスキップ**され、カード状態は更新されない。にもかかわらずエンドポイントは`ok:true`を返し、`publishResultNotification`で結果通知、`agent:logs`に監査ログが記録される。**★人間には「承認が成功した」ように見えるが、待機中のhookが読む`approval:{id}`には何も反映されず**、hookは最終的に600秒タイムアウトで拒否として扱う。「承認した」という記録・通知と、実際にツール実行が拒否された、という結果が食い違う——**これは正真正銘のcorrectness欠陥である**（コード読解で確定的に証明できる。タイミングを待ってのライブ再現は本質的に不要）。**★本文書はこの欠陥を修正しない**（as-built記述に専念するミッションであり、実装修正はテスト・レビューを伴う別ミッションとして起票する）。規模感: TTL値を揃える（カード600秒をトークンTTL以上に延長するか、トークンTTLを600秒未満に短縮する）、または`cardRaw`が偽の場合のハンドリング改善（例: 404/410相当の応答に変える）のいずれかで解消できる、小〜中規模の修正候補。

5. **README.mdの図と実装の3件の不一致**（§3参照）。特にntfy通知が既定で発生しないにもかかわらず図が無条件発生のように描いている点は、README自身の内部矛盾でもある。

6. **task_154由来の乖離・freshness gap全般へのポインタ**: 本文書の§4・§8・§9・§10で扱った内容の多くはtask_154のPhase0 DoDレビューで独立に検証済みであり、詳細な実測記録は`~/obsidian/research/20260725_taskvia_phase0_dod_review.md`を参照。
