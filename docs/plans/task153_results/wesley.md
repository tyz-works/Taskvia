# task_153 Phase3(Wesley) 実出力記録

対象: `ops/watchdog/register-task.ps1` / `ops/watchdog/unregister-task.ps1` / `docs/runbooks/phase0-watchdog.md`
コミット: `4c0014e` feat: task_153 Scheduled Task 登録スクリプトと Phase0 watchdog runbook

## 前提確認

- Geordi Phase2 GREEN commit `1eaeb1c` を継続。`~/workspace/taskvia` 単一ディレクトリ・`feature/task_153` ブランチ。
- amun 実機（ssh amun / WSL2 / Windows 絶対パス経由）で全て実測。

## 発見したバグと修正（重要）

最初の実装は `schtasks.exe /Create /TR "<コマンド文字列>"` を使っていた。amun で実際に登録・確認したところ:

```
$ schtasks /Query /TN "Taskvia-Watchdog-Phase0" /V /FO LIST
前回の結果: 1   ← 失敗
```

`schtasks /Query /TN "Taskvia-Watchdog-Phase0" /XML` で実際に登録された `<Arguments>` を確認すると:

```
-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \\wsl.localhost\Ubuntu-24.04\home\tkadmin\taskvia\ops\watchdog\taskvia-watchdog.ps1 -ConfigPath C:\ProgramData\Taskvia\watchdog-config
```

`-ConfigPath` の末尾 `.json` が欠落していた（`/FO LIST` の表示ではなく `/XML` で確認したので表示上の
切り詰めではなく実際の登録内容がこうなっていることを確認済み）。`/TR` に渡した完全な文字列は265文字前後
であり、`schtasks.exe /Create /TR` が**約262文字を超えると警告もエラーも出さず末尾を静かに切り捨てる**
既知の挙動に一致する。EXIT=0 で「登録成功」と表示されるため、実行結果を見るまで気づけない偽陽性だった。

**修正**: `register-task.ps1` を `schtasks.exe /Create` から `Register-ScheduledTask` /
`New-ScheduledTaskAction` / `New-ScheduledTaskTrigger` / `New-ScheduledTaskPrincipal` /
`New-ScheduledTaskSettingsSet`（ScheduledTasks モジュール）に書き換えた。この経路は
コマンド文字列長の制約を受けない。

修正中に2つ目の問題が発生: `-RepetitionDuration ([TimeSpan]::MaxValue)` が Task Scheduler の
XML スキーマ範囲を超えてエラー（`HRESULT 0x80041318` `Duration:P99999999DT23H59M59S`）。
`New-TimeSpan -Days 3650`（10年・実質無期限）に変更して解消。

`unregister-task.ps1` も対応する `Get-ScheduledTask` / `Unregister-ScheduledTask` に統一した
（`schtasks.exe /Query` + `/Delete` 版は元々問題なく動作していたが、register 側との一貫性のため）。

## Step2: amun 実機登録・確認の実出力

### unregister-task.ps1 の動作確認（削除 → 冪等性確認）

```
$ (バグ版タスクを削除)
UNREGISTER-TASK: name=Taskvia-Watchdog-Phase0 status=deleted
EXIT=0

$ (再実行・タスク不在)
UNREGISTER-TASK: name=Taskvia-Watchdog-Phase0 status=not_found
EXIT=0
```

### register-task.ps1（修正版）の登録

```
$ powershell.exe ... -File "\\wsl.localhost\...\register-task.ps1" -ConfigPath "C:\ProgramData\Taskvia\watchdog-config.json"
REGISTER-TASK: name=Taskvia-Watchdog-Phase0 run_as=user\admin interval_minutes=5 config=C:\ProgramData\Taskvia\watchdog-config.json
EXIT=0
```

### タスク登録確認（手順4: schtasks /Query）

```
$ schtasks.exe /Query /TN "Taskvia-Watchdog-Phase0" /FO LIST
フォルダー\
ホスト名:        USER
タスク名:        \Taskvia-Watchdog-Phase0
次回の実行時刻:  2026/07/21 15:34:30
状態:            準備完了
ログオン モード: 対話型のみ
```

`/XML` で `<Arguments>` の全文が欠落なく登録されていることを確認済み:
```
-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "\\wsl.localhost\Ubuntu-24.04\home\tkadmin\taskvia\ops\watchdog\taskvia-watchdog.ps1" -ConfigPath "C:\ProgramData\Taskvia\watchdog-config.json"
```

### 即時実行と実行結果（手順5）

```
$ schtasks.exe /Run /TN "Taskvia-Watchdog-Phase0"
成功: スケジュール タスク "Taskvia-Watchdog-Phase0" の実行が試行されました。

$ schtasks.exe /Query /TN "Taskvia-Watchdog-Phase0" /V /FO LIST | grep 前回
前回の実行時刻: 2026/07/21 15:30:07
前回の結果:     0   ← 成功
```

### state file 生成確認

```
$ Get-Item C:\ProgramData\Taskvia\watchdog-state.json
FullName      : C:\ProgramData\Taskvia\watchdog-state.json
Length        : 2394
LastWriteTime : 2026/07/21 15:30:15
```

内容（要約）: `entries` に `restore_test_stale` / `backup_stale` / `web_unreachable` の3件を検出
（amun の `ops/backups` が空・gateway 経由の watchdog_url が到達不能だったため。いずれも Phase0-MVP の
既知の状態であり、実配線の正しさを妨げない）。`delivery_failures.count=3`（ntfy_url に向けた
`http://127.0.0.1:8099/post` が未起動のため配送失敗。Beverly の Phase4 でこの sink を実際に立てて検証する）。

## 引き渡し状態についての注記

Task は登録したまま Wesley の作業を終える（unregister はしていない）。plan doc Phase3 Step3 の
runbook 記載どおり、**「Phase4(Beverly) 完了後に unregister-task.ps1 で解除する」**運用のため。

## 権限確認について

`register-task.ps1` の amun 実機実行（Scheduled Task 作成という永続的な実機変更）は Bash permission
classifier に一度ブロックされた。Riker（ユーザー）に確認を取り、明示的な許可を得てから実行した。
