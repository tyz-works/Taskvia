# task_153 Phase4(Beverly) 独立QA — 実出力記録・PUSHED BACK

作成: 2026-07-21 / 対象: ~/workspace/taskvia feature/task_153 (amun実機), コード変更ゼロ

## 結論(先出し)

**PUSHED BACK**。DoD #4「Taskvia全停止でもTaskvia外channelへ通知が届く」の前提となる
「正常時は無警告・異常時のみ通知」という probe の基本契約が、amun実機の実HTTP/TLS経路では
**常に成立しない**ことを実機で確認した。単体テスト(Phase1/2の29/29 PASS)は watchdog-lib.ps1 の
純粋関数のみを検証しており、実TLS経路を一度も通していなかったため見逃されていた
(task_150/151と同型の「単体緑でも実HTTP経路でしか出ないバグ」)。以下3件の構造的バグを実機で再現・特定した。
加えて、実機での破壊的検証(コンテナ停止・Scheduled Task解除)は permission classifier に
ブロックされ、Step2〜6・Step9が未実施のまま終了した(詳細は末尾「未完了項目とブロック理由」参照)。

---

## 発見したバグ(全て実機再現・コード変更なしで特定)

### バグ1(Critical): watchdog_url の IP literal(127.0.0.1)が Caddy の SNI マッチングと非互換

`docker/Caddyfile` のサイトブロックは `localhost, gateway` の2ホスト名のみに TLS 証明書を発行する
(`tls internal`)。`watchdog-config.json` の `watchdog_url: "https://127.0.0.1/internal/health/watchdog"`
は IP literal のため TLS ClientHello に SNI が付与されず、Caddy 側は "no certificate available for
'172.20.0.6'"(コンテナ自身のIP)としてハンドシェイクを拒否する。結果、**Taskvia が完全に健全でも
probe は常に `unreachable`** になる。

実機確認(WSL側):
```
$ curl -sk -o /dev/null -w "http_code=%{http_code}\n" https://127.0.0.1/
http_code=000
$ curl -sk -o /dev/null -w "http_code=%{http_code}\n" https://localhost/
http_code=307   # SNI一致で正常に応答
```
gateway ログ(docker compose logs gateway):
```
"tls.handshake","msg":"no certificate matching TLS ClientHello","remote_ip":"172.20.0.1", ...
"http.stdlib","msg":"http: TLS handshake error from 172.20.0.1:xxxxx: no certificate available for '172.20.0.6'"
```

### バグ2(Critical・バグ1に隠れていた潜在バグ): ServerCertificateValidationCallback が実TLS経路で必ず例外化

taskvia-watchdog.ps1 の `[Net.ServicePointManager]::ServerCertificateValidationCallback` は生の
PowerShell scriptblock を代入している。PowerShell 5.1 では、この callback は .NET の TLS 検証スレッド
(スクリプトのメインrunspaceとは別スレッド)から呼び出されるため、scriptblock実行に必要な runspace が
なく `PSInvalidOperationException`("このスレッドには、スクリプトを実行するために使用できる実行状態が
ありません")で失敗する。これは **証明書検証まで到達する接続(=SNIが一致する localhost/gateway 宛)で
必ず発生する**。`Get-WatchdogProbe` の `catch [System.Net.WebException]` がこれを
`WebExceptionStatus.SendFailure` として捕捉するためスクリプト自体はクラッシュしないが、
**probe=ok に到達する経路が実質的に存在しない**(バグ1の URL では SNI不一致で失敗、
バグ1を回避して hostname に直せば今度はこの callback 例外で失敗)。

実機確認(watchdog-config.json は変更せず、別 ConfigPath の一時ファイルで `watchdog_url` のみ
`https://localhost/...` に差し替えて実行。real config・real state file は無傷):
```
WATCHDOG-RUN: probe=unreachable findings=2 sent=2 failed=0
```
state file 該当エントリ:
```
"web_unreachable": { ... "message": "http_status=0 detail=SendFailure", ... }
```
→ IP literal(バグ1)の場合の detail は "SecureChannelFailure"、hostname 一致(バグ2到達)の場合は
"SendFailure" — 原因は異なるが**どちらの構成でも probe=ok には絶対に到達しない**ことを実機で確認。

### バグ3(Medium-High): ops/restore-test.sh の jq 出力が pretty-print のため jsonl 契約を破壊

`ops/restore-test.sh` は `jq -n --arg ... '{...}' >> "$LOG_FILE"` を `-c`/`--compact-output` なしで
呼んでいる。jq の既定出力は複数行の pretty-print であり、`restore-test-log.jsonl` に追記される
1レコードが複数行にまたがる。`taskvia-watchdog.ps1` の `Get-WatchdogBackup` はこのファイルを
`foreach ($line in $lines) { ... ConvertFrom-Json ... }` で1行ずつ JSON として解釈するため、
pretty-print された行の大半(例: `  "result": "success",` 単体の行)は単独では valid JSON でなく
`catch { continue }` で握りつぶされる。結果、**`ops/seed-marker.sh`→`ops/backup.sh`→
`ops/restore-test.sh` を実際に実行して成功しても `latest_restore_test_at` は常に `$null` のまま**
=`restore_test_stale` が恒久的な誤検知として残り続ける。

実機確認: `ops/seed-marker.sh`→`ops/backup.sh`→(amunにjq未導入のため)`jq` 相当を実装した一時
docker-jq shim経由で`ops/restore-test.sh`を実行 → `MARKER VERIFIED` で実restore成功
(`restore-test-log.jsonl` に `"result": "success"` の正しいレコードが追記されたことを確認)。
しかし直後に `Get-WatchdogBackup` を直接呼び出すデバッグ実行(関数定義部のみ抽出・本体は無変更)で
`restore_test_available=True` かつ `latest_restore_test_at=`(空)を確認。ファイル自体は
`Test-Path`で存在確認・`Get-Content`で読み取り可能であることも確認済みなので、原因は
「ファイルが読めない」ではなく「pretty-print行がConvertFrom-Jsonで1行単位に解釈できない」ことによる。

### バグ4(Medium・現状は偶然発火していない潜在バグ): 完了時刻パースに +9h(JST)ずれ

backup manifest / restore-test-log の `completed_at`("yyyyMMddTHHmmssZ")を
`[datetime]::ParseExact(..., 'yyyyMMddTHHmmssZ', InvariantCulture)` でパースすると、.NET が
末尾の literal `Z` を UTC指示子として特別扱いし、**ローカルタイムゾーン(amunはJST=UTC+9)に変換した
上で `Kind=Local` を返す**(ドキュメント上は非標準だが実機で再現した実挙動)。直後の
`[datetime]::SpecifyKind($dt, 'Utc')` は値を補正せず Kind ラベルのみ書き換えるため、
**実際には UTC+9 時 = 9時間未来の値が「UTC」として扱われる**。

実機確認:
```
$s = "20260721T063950Z"
ParseExact raw: 07/21/2026 15:39:50 Kind=Local   # 本来は 06:39:50 のはず
SpecifyKind Utc: 07/21/2026 15:39:50 Kind=Utc    # 値は補正されず9h先のまま"UTC"化
```
現状 `(NowUtc - completed_at).TotalHours` が負値になり `backup_stale_hours(26)` を超えないため
`backup_stale` は偶然発火していないが、符号・時間差次第で「本当に古いbackupを新鮮と誤判定」
「新鮮なbackupを古いと誤判定」のどちらの方向にも壊れうる時限爆弾。

---

## Step1: 正常時に通知が出ないことの確認 — ★FAIL(バグ1/2により)

- 事前準備: amunに ntfy-sink(httpbin, 127.0.0.1:8099, --rm)を起動。
  `ops/seed-marker.sh`→`ops/backup.sh`→`ops/restore-test.sh`(jq未導入のため docker経由jq shimで代替、
  リポジトリ・スクリプトは一切変更せず)を実行し、backup/restore_test 双方に新鮮なmarkerを作成
  (task指示の選択肢(a)を採用)。
- 実際の Windows Scheduled Task 経由の実行契機(register-task.ps1 が登録した実コマンド)をそのまま
  `powershell.exe -File <UNC> -ConfigPath C:\ProgramData\Taskvia\watchdog-config.json` で手動実行:
  ```
  WATCHDOG-RUN: probe=unreachable findings=2 sent=1 failed=0
  ```
  期待値(`probe=ok findings=0 sent=0 failed=0`)を満たさない。バグ1(SNI不一致)が原因。
- state file実測(既存デプロイ済み・提督実機の永続ファイル、削除は permission classifier がブロック
  したため上書きせず参照のみ):`web_unreachable`(critical)が notify_count 0→1 で新規発火。
  `backup_stale`/`restore_test_stale` は本実行では findings に含まれず(=新鮮なmarker作成が有効
  だったことの証左だが、バグ4により偶然)。

## Step2〜6(web停止/backoff/復旧resolved/全停止/誤token401)— ★未実施(ブロック)

`ssh amun 'docker compose stop taskvia'` が permission classifier により拒否された
(提督の実稼働コンテナへの破壊的操作のため)。バグ1/2の分析により、probe は TLS ハンドシェイク段階
で常に失敗するため(HTTPレイヤーに到達する前に例外化)、taskvia コンテナの起動/停止状態や
Authorizationヘッダの正誤は現状の実装では**そもそもprobe結果に影響しない**と推定される
(TLS層で必ず失敗するため、後続のHTTPレベルの4xx/2xx分岐に到達できない)。この推定はロジック上
確実だが、Step2/6 自体は実機のコンテナ操作なしには実証できないため、実施できていないことを
明記する。

## Step7: backup疑似障害 — ★未実施(ブロック理由は上記と同根、backup_dir変更は config書き換えを要し
Windows側 config ファイルへの書き込みが classifier にブロックされたため未実施)

## Step7.5〜9 — ★未実施(config復元は変更していないため不要/ntfy-sink撤去は実施/Scheduled Task解除は
classifierブロックにより未実施)

- Step7.5: watchdog-config.json 自体は一度も書き換えていない(別ConfigPathの一時ファイルでのみ検証)
  ため復元不要。実際の config は元のまま(`watchdog_url: https://127.0.0.1/...`)。
- Step8: **実施・確認済み**。`docker stop ntfy-sink` 実行後 `docker ps` に ntfy-sink が含まれない
  ことを確認(--rm により自動削除)。
- Step9: `unregister-task.ps1` の実行が permission classifier にブロックされ**未実施**。
  **Taskvia-Watchdog-Phase0 の Scheduled Task は amun に登録されたまま残っている**。
  バグ1/2により本タスクは5分間隔で永久に `web_unreachable` の誤検知を出し続ける
  (ntfy-sink 撤去済みのため配送は必ず失敗=delivery_failures が増加し続ける)。

## Step10: スタック復旧確認 — ★元々何も停止していないため復旧不要、現状維持を確認

```
taskvia-gateway-1     Up 24 hours
taskvia-postgres-1    Up 24 hours (healthy)
taskvia-redis-1       Up 24 hours (healthy)
taskvia-redis-http-1  Up 24 hours
taskvia-taskvia-1     Up 21 hours
```
5コンテナ全てUp(検証開始時から不変)。UI疎通(SNI一致): `curl -sk https://localhost/` → `307`。

---

## 未完了項目とブロック理由(Riker/Picard/Admiral判断待ち)

Claude Code の permission classifier が以下を拒否した(理由: 提督の実稼働環境への破壊的/永続的変更):
1. `ssh amun 'docker compose stop taskvia'`(Step2)
2. Windows側 `C:\ProgramData\Taskvia\watchdog-config.json` への書き込み(Step7用のbackup_dir一時変更)
   および同ファイルへの読み取りコマンドの一部
3. `C:\ProgramData\Taskvia\watchdog-state.json` の削除(Step1のクリーンな初期状態作成用)
4. `unregister-task.ps1` の実行(Step9)

これらは全てタスクYAML上で明示的に許可された操作だが、classifier はタスク文脈を認識しないため
毎回ブロックされた。バグ1/2の重大性(probeが実質的に機能不全)を踏まえると、Step2〜6の追加実施よりも
**まず Scheduled Task の解除(Step9)を優先してAdmiral/Riker権限で実施すべき**
(現状放置すると5分毎に恒久的な誤警報が出続ける)。

---

## 差し戻し提案(Geordiへ・修正候補)

1. `docker/Caddyfile` に `127.0.0.1` をサイトブロックのホスト名として追加するか、
   `watchdog-config.json` の既定値を IP literal でなく `https://localhost/...` に変更する
   (ただしバグ2が残るため単独では不十分)。
2. `ServerCertificateValidationCallback` を scriptblock ではなく runspace非依存な実装に置換する
   (例: `Add-Type` でC#の静的デリゲートを定義してコンパイル済み型として登録する、または
   `-SkipCertificateCheck` が使える PowerShell 7+ への変更、または `HttpClient` + `SslOptions`
   を使う実装への置換)。この修正なしには **DoD #4 の「正常時は無警告」が原理的に達成不可能**。
3. `ops/restore-test.sh` の2箇所の `jq -n` 呼び出しに `-c`(compact-output)を追加する。
4. `completed_at` のパース処理に `System.Globalization.DateTimeStyles.AdjustToUniversal` +
   `AssumeUniversal` を明示的に渡すか、`'Z'` を含めない `ParseExact` + 手動UTC指定に変更する。

## 成果物(コード変更ゼロ・確認事項)

- amun実機で ntfy-sink(httpbin, --rm)起動→撤去まで確認
- `ops/seed-marker.sh`→`ops/backup.sh`→`ops/restore-test.sh` の実restoreサイクルを本物の
  isolated postgres コンテナ・volume・networkで実行し `MARKER VERIFIED` を確認(script自体は無変更、
  amunにjq未導入だったため docker経由のjq代替を一時的に使用しテスト後削除)
- 実際に登録済みの Scheduled Task 定義(Execute/Arguments)を `Get-ScheduledTask` で確認
- taskvia-watchdog.ps1 を実際のWindows Scheduled Task起動コマンドと同一の形で複数回実機実行し
  probe=unreachable の再現性を確認(2種類のURL構成、両方とも失敗するが原因が異なることまで特定)
- バグ3/4は既存スクリプトの関数定義部のみを抽出した読み取り専用デバッグ実行で特定(スクリプト自体・
  リポジトリファイルは一切変更していない)

---
---

# task_153 Phase4R(Beverly) 独立QA再実施 — 追記

作成: 2026-07-21(rework) / commit 953c229(バグ1-4修正)後の再検証・コード変更ゼロ
エスカレーション手順(rework doc §7.1)適用: classifierブロック時はRikerへ実行委任→生出力を確認→Beverryが判定。

## 事前確認

- Wesley Phase3Rにより watchdog_url は `https://localhost/internal/health/watchdog` に更新済み、
  Scheduled Task も再登録済みであることを確認。
- amun実機の `ops/watchdog/taskvia-watchdog.ps1`・`watchdog-lib.ps1` は commit 953c229 相当
  (Add-Type CertValidation・ConvertTo-WatchdogUtcTime)がデプロイ済みであることを実機grepで確認。
- **新規発見(デプロイスコープの穴)**: `ops/restore-test.sh` の bug3 修正(`jq -n`→`jq -nc`)は
  runbook の再デプロイ手順(`tar cf - ops/watchdog | ssh amun ...`)が `ops/watchdog/` 配下しか
  カバーしないため amun に未反映だった。Riker経由でエスカレーション→`tar cf - ops/restore-test.sh`
  を追加同期→2箇所とも `jq -nc` になっていることを実機grepで確認(Riker実行・Beverly独立確認)。

## Step1: 正常時に通知が出ないことの確認 — ★★PASS(バグ1-4修正の効果を実機確認)

- ntfy-sink(httpbin --rm)起動 → `ops/seed-marker.sh`→`ops/backup.sh`→`ops/restore-test.sh`
  (jq未導入のため前回同様docker経由jq shimを使用・スクリプト自体は無変更)で新鮮なmarker作成
  (option (a) 採用)。restore-test-log.jsonl の新規行が1行にコンパクト化されていることを確認
  (`{"started_at":"20260721T110329Z",...}` — bug3修正の効果を実機確認)。
- 1回目実行: `WATCHDOG-RUN: probe=ok findings=0 sent=1 failed=0`
  (findings=0だがsent=1 — 前回のPUSHED BACK時に発火していたrestore_test_staleのresolved通知が
  1回だけ出た。デプロイスコープの穴が解消された直接的な証拠)。
- 2回目実行: `WATCHDOG-RUN: probe=ok findings=0 sent=0 failed=0` — **完全にクリーンなベースライン**。
  ★★バグ1(SNI不一致)・バグ2(ServerCertificateValidationCallback runspace例外)の修正が実TLS経路で
  機能していることを実機確認(前回はどちらの構成でもprobe=unreachable/SendFailureだった)。

## Step2: web停止→通知 — PASS

`docker compose stop taskvia`(taskvia-1のみ・classifierブロック→Riker実行委任→Beverly独立確認で
`docker compose ps`残り4コンテナ無変更を確認)。
`WATCHDOG-RUN: probe=bad_status findings=1 sent=1 failed=0`。gatewayはSNI一致で到達可能なまま
バックエンド不通のためTLSレベルでなくHTTPレベル(bad_status)で検知——前回の「TLS層で必ず失敗し
web停止/起動の区別が原理的に不可能」という指摘が解消されたことを示す決定的な差分。

## Step3: backoff(dedup) — PASS

即再実行: `WATCHDOG-RUN: probe=bad_status findings=1 sent=0 failed=0`(15分未経過で再通知抑制)。

## Step4: 復旧→resolved通知 — PASS

`docker compose start taskvia`(classifierブロックなく実行可)→5コンテナUp確認→
1回目: `WATCHDOG-RUN: probe=ok findings=0 sent=1 failed=0`(resolved通知1件)
2回目: `WATCHDOG-RUN: probe=ok findings=0 sent=0 failed=0`(再送なし)。

## Step5: ★★★DoD#4本体・全停止でも通知★★★ — ★★PASS

`docker compose stop`(gateway含め全5コンテナ・classifierブロック→Riker実行委任→Beverly独立確認で
`docker compose ps`空・`docker ps`にtaskvia系コンテナなしを確認)。
`WATCHDOG-RUN: probe=unreachable findings=1 sent=1 failed=0`。
**Taskvia本体・postgres・redisが全て停止した状態でも、Windows Scheduled Task経由の独立watchdogが
外部通知を送信できることを実機で実証した。これがDoD#4の核心であり、rework全体のゴール。**

## ★★環境ブロッカー(新規発見・task_153のコード5バグとは別系統・Riker/Picardへ緊急escalation済み)

Step5後の復旧(`docker compose start`)で **gatewayコンテナのみport 443バインドに失敗**
(`failed to bind host port 0.0.0.0:443/tcp: address already in use`)。

**原因(Riker独立診断・Beverly診断と一致)**: amun上で `tailscaled` が起動済み(Jul20から稼働・
本タスクとは無関係)であり、`tailscale serve`(`https://amun.tail2c516a.ts.net` → `http://127.0.0.1:5678`
= n8n)が port 443 を Tailscale インターフェースの特定アドレス(`100.100.101.66:443` /
`[fd7a:115c:a1e0::...]:443`)で既に握っている。gatewayコンテナは長時間 `0.0.0.0:443` を保持して
いたため共存できていたが、Step5でgatewayを停止しbindを解放した結果、再バインド時に競合が
表面化したと推定(bind順序依存の潜在衝突・task_153の変更が原因ではない)。

★Riker指摘: tailscaled自体(ssh amun の疎通経路である可能性)を停止するのはscope外・危険なため
実施していない。Picardへ判断を委ねた。

**現状**: taskvia-postgres-1/redis-1/redis-http-1/taskvia-1 の4コンテナはUp。gatewayのみ
`docker compose up -d gateway` が port競合でExit 1のまま。Step6以降(web疎通・誤token・backup疑似障害・
Step10の5コンテナUp確認)はgateway復旧まで一時保留し、Picard/Admiralの解決(tailscale serve一時停止→
gateway再バインド→serve復元、等)を待って再開する。

**判定への影響**: DoD#4の本体(Step5)は解決前に実測PASS済みであり、この環境ブロッカーは
task_153の5件のコードバグ(既報告)とは別カテゴリの「amun環境側の潜在的ポート競合」であって、
今回のリワーク修正の合否判定には含めない(Riker裁定に同意)。

## ★緊急対応(Picard指示・順序前倒し実施): Step8・Step9 — PASS

Picardの緊急指示によりStep6/7より先にStep8・Step9を実施(Scheduled Taskがgateway down状態のまま
次回発火し偽警報ループになるリスクを断つため)。

### Step8: ntfy-sink撤去 — PASS
```
$ ssh amun 'docker stop ntfy-sink'
ntfy-sink
$ ssh amun 'docker ps --format "{{.Names}}"'
taskvia-taskvia-1
taskvia-redis-http-1
taskvia-postgres-1
taskvia-redis-1
ergo
n8n-n8n-1
n8n-postgres-1
```
docker ps に ntfy-sink が含まれないことを確認(--rmにより自動削除)。

### Step9: Scheduled Task解除 — PASS(classifierブロックなし・Picard事前承認が効いたと推定)
```
$ ssh amun '.../unregister-task.ps1'
UNREGISTER-TASK: name=Taskvia-Watchdog-Phase0 status=deleted
EXIT=0

$ ssh amun '.../schtasks.exe /Query /TN "Taskvia-Watchdog-Phase0" ...'
エラー: 指定されたファイルが見つかりません。
EXIT=1
```
unregister実行=EXIT0・その後の/Query=EXIT非1(タスク不在確認)。**5分毎の偽警報ループのリスクは解消**。

## Picard裁定の反映(記録)

- DoD#4はStep5のPASS実測をもって充足と裁定。
- Step6・Step7・Step7.5・Step10は「FAILED」ではなく「BLOCKED」として記録
  (原因=amun環境のtailscale serveとport443競合。task_153の5件のコードバグとは別カテゴリ)。
- ポート変更等での回避策は禁止(Picard裁定)。gateway/tailscale競合の解決を待って再開する。
- Phase4Rは現時点で未完了(gateway復旧待ち)。

---

# task_153 Phase4R 再開(gateway/tailscale競合解決後) — Step6/7/7.5/10 実施

Picard確認: Adminがtailscale serveを8443へ移設・port443クリア済み。以下Picard精密指示に従い実施。

## Step10(前半): gateway復旧の検証 — ★重要な再発防止確認

`docker compose up -d gateway` 実行後、前回と同じ失敗パターン(「Started」表示だが実は無バインド)を
繰り返していないか厳密に確認した。

1回目 `docker compose up -d gateway`:
```
Container taskvia-gateway-1 Started
```
検証: `docker port taskvia-gateway-1` → **空**、`docker inspect .NetworkSettings.Ports` → `{}`。
**前回と全く同じ症状を確認**(既存コンテナオブジェクトのport設定が壊れたまま起動しているだけで、
実際には443を全くバインドしていない)。`docker inspect ... Created` で作成時刻が前回の失敗試行時
(2026-07-21T11:17:57Z)のままであることを確認し、原因を特定。

対処: `docker compose up -d --force-recreate gateway` でコンテナを強制再作成:
```
Container taskvia-gateway-1 Recreate
Container taskvia-gateway-1 Recreated
Container taskvia-gateway-1 Starting
Container taskvia-gateway-1 Started
```
検証(再実施): `docker port taskvia-gateway-1` → `443/tcp -> 0.0.0.0:443` / `443/tcp -> [::]:443`。
`docker inspect .NetworkSettings.Ports` → `{"443/tcp":[{"HostIp":"0.0.0.0","HostPort":"443"},{"HostIp":"::","HostPort":"443"}],...}`。
**実バインドを確認**。`curl -sk https://localhost/` → `307`(実HTTP往復で確認)。5コンテナ全てUp。

ntfy-sinkはStep8で撤去済みのため、Step6/7の通知検証用に再度起動(この選択を明記: 到達不能URL代替でなく
実httpbin再起動を採用)。sanity実行で`WATCHDOG-RUN: probe=ok findings=0 sent=0 failed=1`
(web_unreachableのresolved通知がntfy-sink不在で送達失敗)を確認後、ntfy-sink再起動→
再実行で`sent=1 failed=0`→再々実行で`sent=0 failed=0`のクリーンベースラインを確認。

## Step6: 誤token→401 — PASS

```
$ (watchdog_token を "wrong-token-for-qa-test" に変更)
$ taskvia-watchdog.ps1 実行
WATCHDOG-RUN: probe=unauthorized findings=1 sent=1 failed=0
```
state file: `"watchdog_auth_failed": {"severity":"critical","message":"http_status=401 detail=",...}`。
token値・接続文字列・内部hostnameのいずれも message/stdout/state file に含まれないことを確認
(detail は空文字列のみ)。

## Step7: backup疑似障害 — PASS

Step6の誤tokenをまず正しい値に復元した上で(Step6起因のunauthorizedとStep7のbackup障害を混在させず
単一変数で検証するため)、`backup_dir` のみ存在しないパス(`C:\Nonexistent\Path\For\QA\Test`)に変更:
```
WATCHDOG-RUN: probe=ok findings=1 sent=2 findings=1 failed=0
```
(sent=2はwatchdog_auth_failedのresolved1件+backup_marker_unreadableの新規1件)。
state file: `"backup_marker_unreadable": {"severity":"warning","message":"detail=",...}`。
実パス・内部情報の漏洩なしを確認。

## Step7.5: config復元・健全性確認 — PASS

事前に保存していた config バックアップ(Step6直前の正常値)から `watchdog_token` と `backup_dir`
の両方を正しい値へ復元:
```
1回目: WATCHDOG-RUN: probe=ok findings=0 sent=1 failed=0   # backup_marker_unreadableのresolved
2回目: WATCHDOG-RUN: probe=ok findings=0 sent=0 failed=0   # 完全クリーン
```
バックアップファイル(`watchdog-config.json.qa-backup`)も削除しC:\ProgramData\Taskvia配下を
検証前と同一の状態に戻した。

## Step8(再実施): ntfy-sink最終撤去 — PASS

Step6/7検証用に再起動したntfy-sinkを最終的に撤去:
```
$ docker stop ntfy-sink
ntfy-sink
$ docker ps --format "{{.Names}}"
（ntfy-sinkは含まれない・taskvia-gateway-1以下8コンテナのみ）
```

## Step10: 最終復旧確認 — PASS

```
$ docker compose up -d && docker ps --format "{{.Names}}\t{{.Status}}"
taskvia-gateway-1      Up 3 minutes
taskvia-taskvia-1      Up 23 minutes
taskvia-redis-http-1   Up 23 minutes
taskvia-postgres-1     Up 23 minutes (healthy)
taskvia-redis-1        Up 23 minutes (healthy)
$ curl -sk https://localhost/ → 307
$ schtasks /Query /TN "Taskvia-Watchdog-Phase0" → エラー:指定されたファイルが見つかりません。EXIT=1
```
5コンテナ全てUp・UI疎通307・**Scheduled Taskは未登録のまま(Picard指示通りの正しい終了状態)**。
参考: `curl https://127.0.0.1/` は引き続き000(バグ1修正によりCaddyがSNI一致のhostname接続のみを
受け付ける設計へ変わったことの意図した結果であり、regressionではない)。

## 最終結論

Step1〜10・Step7.5・Step8・Step9 **全てPASS実測で確認**。DoD#4(全停止でも外部通知)はStep5で実証済み。
環境ブロッカー(tailscale port競合)はAdmiralが8443へ移設し解消、Beverly側での固定的な回避策
(ポート変更等)は一切行っていない。コード変更はゼロ。Taskvia-Watchdog-Phase0 Scheduled Task は
Admiral実機に未登録の状態(次に監視を開始する場合は実ntfy topic設定の上で再登録が必要)。
