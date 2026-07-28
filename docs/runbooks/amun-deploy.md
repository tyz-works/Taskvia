# amun 実機デプロイ手順（stale image 再デプロイ・git 管理化）

task_164 Task5（Wesley）で `/home/tkadmin/taskvia` を git 管理下に置き、stale image と
`origin/main` の乖離（freshness gap）を閉じた際の手順。次回以降の amun デプロイはこの手順書を正とする。
背景・裁定の経緯は `docs/plans/20260728_task164.md` Task 5 節、実測記録は
`docs/plans/task164_results/`（multi-agent リポジトリ側）を参照。

---

## 1. ★★最重要: `docker compose build` / `up` は提督の直接操作が必要

**クルー（Claude Code）の harness classifier は、amun 上での `docker compose build` /
`docker compose up` を拒否する。** 本番ホストへのビルド・再起動操作を伴うため、Riker の中継承認・
Picard の再試行でも解除できず、**提督（Admiral）本人が直接実行するしかない**（task_164 実測・
task_141 で記録した二重ブロックと同型）。

→ 次にこの手順でデプロイする担当者は、Step 4（本書 §3）に到達した時点で自分では実行できないと
判明することを前提に、**あらかじめ提督に実行を依頼しておくこと。** 同じ壁に毎回当たって初めて
気づく、という形を避けるためにこの節を独立させている。

---

## 2. デプロイ前の確認

```bash
ssh -p 2222 tkadmin@100.100.101.66 'cd /home/tkadmin/taskvia && git rev-parse HEAD'
```

- 稼働中の commit を必ず確認すること。`origin/main` の最新 commit と一致しなければ stale。
- `docker compose build` を省略して `up -d` だけ実行すると、**チェックアウトした commit のソースを
  反映しないまま古いイメージのコンテナが起動する。** 必ず `build` → `up -d` の順で実行すること。

---

## 3. デプロイ手順（提督が実行）

```bash
ssh -p 2222 tkadmin@100.100.101.66 'bash -s' <<'EOF'
set -e
cd /home/tkadmin/taskvia
git fetch origin main
git checkout main && git pull --ff-only origin main
echo "=== デプロイ対象commit ==="; git rev-parse HEAD
docker compose build
docker compose up -d
sleep 15
docker compose ps
EOF
```

実行後、5 コンテナ（gateway / taskvia / redis-http / postgres / redis）**全ての `State` が `Up`**
であることを目視確認すること。コマンドを実行しただけで「デプロイ完了」と報告しないこと
（起動確認まで含めて完了、task_164 の教訓）。

---

## 4. デプロイ後の成否判定 — `/api/health` = 200 で判定しないこと

★★**`/api/health` は 3 owner（`TASKVIA_OPERATOR_*` / `TASKVIA_BACKUP_OWNER_*` /
`TASKVIA_SECURITY_OWNER_*`）が未設定のため、amun では正常時でも常に `503` を返す。**
これは Phase 0 DoD 項目6（3 owner 未設定なら deployment validation が失敗する）が
**設計どおり作動している状態**であり、デプロイ失敗ではない。

実測した応答本文（token・secret は含まれない）:
```json
{"status":"fail-fast","reason":"deployment owners are not configured","missing":[...]}
```
`reason` が `TASKVIA_TOKEN is not configured` でなく `deployment owners are not configured` で
あることを確認すれば、token チェック自体は通過していると判断できる。

→ **再デプロイの成否は `/api/health` のステータスコードでなく、以下の2点で判定すること**:
1. `docker compose ps` で 5 コンテナ全てが `Up`（postgres/redis は `(healthy)`）
2. `git rev-parse HEAD` がデプロイ対象 commit と一致

3 owner env を設定するかどうかは提督判断事項（本ミッションのスコープ外）。

---

## 5. 退避ディレクトリについて

`git 管理化` の際、既存の非 git 管理ディレクトリは `taskvia.pre-task164-YYYYMMDDHHMMSS`
という名前で退避される（`rm` は使わず `mv` のみ）。**このディレクトリは提督の判断があるまで
削除しないこと。** 過去の稼働証拠・引き継ぎ漏れの確認先として保持する。

---

## 6. ★freshness gap の成因 — なぜ git 管理外だったのか

再デプロイ前の `/home/tkadmin/taskvia` は git リポジトリではなかった
（`git rev-parse HEAD` が `NOT_A_GIT_REPO`）。旧ディレクトリを調査した結果、原因は
**単なる設定漏れではなく、そもそも git を経由しない配置手順で作られていたこと**だと判明した。

**根拠（mtime 実測・task_164 Wesley）**: 旧ディレクトリの初回デプロイ由来ファイル群
（`CLAUDE.md`, `ops/README.md`, `ops/backup.sh` 等）は全て単一時刻（2026-07-20 18:36:10）に
揃っている一方、`ops/watchdog/*.ps1` 全6本・`ops/restore-test.sh`・`ops/backups/` 配下の
成果物一式は 2026-07-21 15:26〜20:03 の間、ファイルごとに個別の mtime を持ち、各実ファイルの
直後（数百ミリ秒差）に同名の `._` ファイル（AppleDouble・macOS のリソースフォークメタデータ）が
生成されている。`._` ファイルは Finder / macOS の `cp` がファイルをコピーする際に自動生成する
副産物であり、`git clone` / `rsync --exclude` / `scp` の通常運用では発生しない。

→ **watchdog 機能一式と restore test の成果物は、初回デプロイ後に Mac から手作業（Finder/cp）で
1 ファイルずつ追加されており、この手順自体が git を経由していなかった。** これが `/home/tkadmin/taskvia`
が git 管理外のまま運用され続けていた直接の成因である。今後同じ手順（手作業コピー）で
ファイルを追加すると、同じ freshness gap が再発する。**新機能・設定ファイルの追加は必ず
git 経由（コミット→ push → `git pull` on amun）で行うこと。**

詳細は `docs/plans/task164_results/amun_carryover_files.txt`（multi-agent リポジトリ側）を参照。

---

## 7. ★マージ後の再デプロイが必須（本ミッションでは未実施）

**本デプロイ（task_164 Task5）には fail-closed 化（`src/lib/auth.ts` / `src/proxy.ts` の変更）は
含まれていない。** デプロイ対象は `origin/main` であり、fail-closed 化は
`feat/task_164_failclosed` ブランチ上にあって、Beverly の QA・提督の PR 承認・マージを経るまで
`main` には入らない。

→ **task_164 の PR がマージされた時点で、amun は再び stale になる。** マージ後、必ず本手順
（§3）で再デプロイすること。怠ると、本ミッションが閉じたはずの freshness gap をその場で
作り直すことになる。マージ後の再デプロイは Picard が引き取る（本ミッションでは未実施）。

---

## 8. 参考: デプロイ直後の watchdog 応答について（既知の問題・本ミッションでは是正しない）

デプロイ直後に `/internal/health/watchdog`（要 `TASKVIA_WATCHDOG_TOKEN` Bearer 認証）を叩くと、
`docker compose ps` 上は `postgres: Up (healthy)` であっても応答は `postgres: "unreachable"` を
返すことが確認されている（task_164 提督実測・task_164 Wesley 独立確認）。これはコード上の固定値
placeholder（`postgresStatus: DependencyStatus = "unreachable"`）であり、実際の postgres 障害では
ない。postgres 配線の是正は Phase 1 のスコープ（Troi が固定した解除条件6）であり、本ミッションの
対象外。**デプロイ直後に watchdog の postgres unreachable を見ても、それだけでロールバックしないこと**
——`docker compose ps` の実コンテナ状態を正とする。

`n8n: "unreachable"` も同時に報告されるが、これが同種の placeholder か実際に到達不能かは
**未確認**。postgres と同列に扱わないこと（要調査項目）。
