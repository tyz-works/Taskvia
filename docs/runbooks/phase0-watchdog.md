# Phase 0 独立 watchdog runbook（Taskvia-Watchdog-Phase0）

task_153 Phase3(Wesley) で登録した Windows Scheduled Task「独立 watchdog」の運用手順。
判定ロジック・実装の詳細は `docs/plans/20260721_task153.md`（Phase0-Phase4）を参照。

---

## 1. 前提

- amun（提督の Windows 機）上で WSL2 が稼働していること
- WSL2 内で Docker（Taskvia スタック一式）が稼働していること
- gateway（Caddy）が `443` で listen していること（`https://127.0.0.1/` に到達できること）

watchdog 自体は Taskvia アプリ本体（Next.js プロセス）に依存せずに動く設計だが、
`watchdog_url`（`/internal/health/watchdog`）への到達には gateway 443 が必要。

---

## 2. config ファイルの作成手順

1. `ops/watchdog/watchdog-config.example.json` を Windows 側のリポジトリ外の場所へコピーする
   （例: `C:\ProgramData\Taskvia\watchdog-config.json`）。**このファイルをリポジトリに追加しないこと。**
2. 以下のプレースホルダを実値に置き換える:
   - `watchdog_token` — Taskvia の **`TASKVIA_WATCHDOG_TOKEN` と同じ値**を使うこと
     （`compose.yaml` の `taskvia` サービス environment に定義されている）
   - `ntfy_url` / `ntfy_topic` — 提督の実 ntfy サーバ・topic
   - `backup_dir` / `state_file` — 環境に合わせて調整（既定値はそのままで動作する）
3. token 値は決してログ・コミット・チャットに残さないこと。
4. **`watchdog_url` は必ずホスト名（`https://localhost/internal/health/watchdog`）を使うこと。
   IP literal（`https://127.0.0.1/...`）を指定してはならない。**
   TLS ClientHello の SNI（Server Name Indication）は IP literal では送出されないため、
   `docker/Caddyfile` の `localhost, gateway` サイトブロックにマッチせず Caddy がハンドシェイク自体を
   拒否する。証明書検証を無効化しても到達できない、TLS 層の構造的な問題である
   （詳細は §8「TLS エラーが出る場合」参照）。

---

## 3. 登録 / 解除コマンド

登録:
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "ops\watchdog\register-task.ps1" -ConfigPath "C:\ProgramData\Taskvia\watchdog-config.json"
```

解除（冪等・タスクが無くてもエラーにならない）:
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "ops\watchdog\unregister-task.ps1"
```

> **引き渡し時の状態について**: 本ミッション(task_153)の実機検証(Phase4/Beverly)完了後、
> `Taskvia-Watchdog-Phase0` は `unregister-task.ps1` で解除済みの状態で提督に引き渡される。
> 常時監視を継続したい場合は §7 の手順で提督自身が再登録すること。

---

## 4. 動作確認方法

タスクの登録確認:
```bash
schtasks.exe /Query /TN "Taskvia-Watchdog-Phase0" /FO LIST
```

即時手動実行:
```bash
schtasks.exe /Run /TN "Taskvia-Watchdog-Phase0"
```

直接実行（デバッグ・Phase4 の疑似障害検証時に使う）:
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "ops\watchdog\taskvia-watchdog.ps1" -ConfigPath "C:\ProgramData\Taskvia\watchdog-config.json"
```

いずれの実行方法でも、標準出力の最後に必ず以下の契約行が1行出力される（token・secret は含まれない）:
```
WATCHDOG-RUN: probe=<status> findings=<n> sent=<n> failed=<n>
```

- `probe`: `ok` / `unauthorized` / `unreachable` / `bad_status` のいずれか
- `findings`: 検出した異常の件数（0 なら正常）
- `sent`: ntfy への通知送信に成功した件数
- `failed`: ntfy への通知送信に失敗した件数（次回実行時に再送される）

### 統合テスト（実 TLS 経路）: `test-watchdog-integration.ps1`

`test-watchdog-lib.ps1`（純粋関数のみ・29 アサーション）では検出できない層
（TLS・SNI・証明書 callback・state file ラウンドトリップ）を、稼働中の実スタックに対して
実際に TLS 経路を通して検証する統合テスト。

**前提**: amun 上で Taskvia スタックの 5 コンテナが Up していること（`docker compose ps` で確認）。
Mac / CI では実行できない（amun の稼働スタックに依存するため）。

**実行**（自前の一時 config / state file のみを使い、`C:\ProgramData\Taskvia\` 配下は一切変更しない）:
```bash
cd ~/workspace/taskvia && tar cf - ops/watchdog | ssh amun 'cd /home/tkadmin/taskvia && tar xf -'
ssh amun '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -ExecutionPolicy Bypass -File "\\\\wsl.localhost\\Ubuntu-24.04\\home\\tkadmin\\taskvia\\ops\\watchdog\\test-watchdog-integration.ps1" 2>&1 | grep -a "TEST-RESULT"; echo "EXIT=${PIPESTATUS[0]}"'
```
期待値: `TEST-RESULT: PASS 7/7`、`EXIT=0`。判定は CP932 文字化けの影響を受けない
`TEST-RESULT:` 行と exit code のみで行うこと。

---

## 5. state file の場所と、誤検知時のリセット方法

- 既定の場所: `C:\ProgramData\Taskvia\watchdog-state.json`（config の `state_file` で変更可能）
- 内容: 検出した異常ごとの `entries`（初回検知時刻・最終検知時刻・通知回数・backoff 用の最終通知時刻）と
  `delivery_failures`（ntfy 配送失敗の累積カウント）
- **誤検知後にリセットしたい場合**は、watchdog を停止した状態で `watchdog-state.json` を削除するだけでよい
  （次回実行時に空の state から再構築される。誤って直近の異常を再度即時通知してしまう可能性があるため、
  リセット直後の1回目の実行結果は確認すること）。

---

## 6. 3 owner の env をどこに設定するか

`compose.yaml` の `taskvia` サービスの `environment` に、3 owner × 2 項目 = 6 個の環境変数を設定する
（`src/lib/deployment-validation.ts` の `validateDeploymentOwners` が要求する契約）。
未設定または空文字・プレースホルダのままだと `/api/health` が 503 を返す。
Vercel 等の別環境にデプロイする場合は、同名の環境変数をその環境の設定画面で個別に設定すること
（`compose.yaml` の設定は amun ローカルにしか反映されない）。

---

## 7. 提督の最終確認項目（本ミッションでは閉じない）

> 常時監視を開始するには、**提督が実 ntfy topic を `watchdog-config.json` に設定した上で
> `register-task.ps1` を実行する必要がある**（検証用 config や Beverly の受信 sink をそのまま
> 本番設定として使い回さないこと）。

Phase 0 DoD review（decision doc §3 step5）で提督が実施する残項目:

1. Windows の実ブラウザ/PowerShell から `https://127.0.0.1/` で Taskvia UI に到達できる
2. **別 LAN 端末**から `443` にのみ到達でき、`5432` / `6379` / `5678` / `3000` に到達できない
3. Windows のネットワークプロファイルが **Public** のとき gateway にも到達できない
4. **Windows 再起動後**に gateway / localhost forwarding / Scheduled Task が自動復旧する
5. 実 ntfy topic への通知が提督の端末に**実際に届く**（Phase 4 は受信 sink での実測に留まる）
6. Vercel 環境に 3 owner env を設定するか、Vercel では validation をスキップするかの判断

---

## 8. トラブルシュート

### 401 が出る場合（`probe=unauthorized`）
`watchdog_token` が Taskvia の `TASKVIA_WATCHDOG_TOKEN`（`compose.yaml` の `taskvia` サービス）と
一致しているか確認する。値をコピーする際に前後の空白・改行が混入していないか特に注意すること。

### `\\wsl.localhost` が読めない場合
- WSL2 のディストリビューション名が config・スクリプト中のパスと一致しているか確認する
  （`wsl -l -v` で確認できる。既定は `Ubuntu-24.04`）。
- WSL2 が起動直後（冷起動）だと Docker デーモンや `\\wsl.localhost` マウントの準備に数秒かかることがある。
  数秒待ってから再実行する。
- `register-task.ps1` / `taskvia-watchdog.ps1` を **SSH 経由で `-File` に UNC パスを渡す**際は
  バックスラッシュを4重（`\\\\`）・区切りを2重（`\\`）にエスケープする必要がある
  （ローカル bash 単一引用 → ssh 転送 → リモート bash 二重引用、の2段 folding のため）。
  エスケープ不足だと `-File` の引数解決に失敗し、**しかも `powershell.exe` が EXIT=0 を返す偽陽性になる**
  ため、`EXIT=` の値だけでなく実際の標準出力を必ず確認すること。

### TLS エラーが出る場合
gateway（Caddy）は自己署名証明書（`tls internal`）を使うため、`watchdog_url`
（loopback = `127.0.0.1`/`localhost`）宛てに限り証明書検証を緩めている。
`ntfy_url` を含むそれ以外の宛先では通常の証明書検証を維持するため、
ntfy サーバの証明書が正しく発行されているか確認すること。
また PowerShell 5.1 既定の TLS 1.0 では HTTPS 接続が失敗することがあるため、
`taskvia-watchdog.ps1` は起動時に TLS 1.2 を明示的に有効化している。

**証明書検証 callback が C# 静的デリゲート方式である理由**: この loopback 限定の緩和ロジックは
生の PowerShell scriptblock ではなく、`Add-Type` で定義した C# の静的メソッドを
`[Delegate]::CreateDelegate` で `ServerCertificateValidationCallback` に割り当てる方式で実装している
（`Taskvia.Watchdog.CertValidation.Validate`）。理由: `ServicePointManager` の証明書検証 callback は
TLS ハンドシェイクを処理する別スレッドから呼び出されるが、PowerShell 5.1 の scriptblock はその生成元の
runspace に紐づいており、別スレッドから呼び出すと `PSInvalidOperationException` を送出して失敗する
（`WebException: SendFailure` として握りつぶされ、一見 TLS エラーとしか見えない非クラッシュの静かな失敗になる）。
コンパイル済みの C# 静的メソッドは runspace に依存しないため、どのスレッドから呼ばれても正しく動作する。
`-SkipCertificateCheck`（PowerShell 5.1 に存在しない）は使わず、PowerShell 7 へも移行しない。

### schtasks.exe の既知の落とし穴（Wesley 実測）
`schtasks.exe /Create /TR "<コマンド文字列>"` は、コマンド文字列が約262文字を超えると
**警告もエラーも出さず末尾を静かに切り捨てる**。本タスクの `-File <UNCパス> -ConfigPath <パス>`
を含むコマンド文字列は265文字前後になり実際に発症し、`.json` が欠落して `ConfigPath` が
存在しないファイルを指し、watchdog がタスク実行のたびに失敗していた（`schtasks /Query /V`
の「前回の結果」が `1`）。このため `register-task.ps1` は `schtasks.exe /Create` ではなく
`Register-ScheduledTask` cmdlet（文字列長の制約を受けない）を使っている。切り分け方法:
`schtasks /Query /TN "Taskvia-Watchdog-Phase0" /XML` で実際に登録された `<Arguments>` の全文を確認し、
`/FO LIST` の表示（こちらも表示上 261 文字前後で打ち切られる）だけで判断しないこと。
