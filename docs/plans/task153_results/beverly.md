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
