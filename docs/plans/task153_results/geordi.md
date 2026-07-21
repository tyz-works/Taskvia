# task_153 Phase2(Geordi) GREEN — 実出力記録

## 実装物
- `ops/watchdog/watchdog-lib.ps1`(5純粋関数 + `Get-WatchdogPropertyNames` ヘルパー、UTF-8 BOM付き)
- `ops/watchdog/taskvia-watchdog.ps1`(entry point、UTF-8 BOM付き)
- `ops/watchdog/watchdog-config.example.json`(ダミー値のみ)
- `src/lib/deployment-validation.ts`(`validateDeploymentOwners`)
- `src/app/api/health/route.ts`(owner validation 合流)
- `tests/health-fail-fast.test.ts`(既存非回帰テストに owner env stub を追加・下記「設計判断」参照)

コミット: `d3a8599` — "feat: task_153 GREEN — 独立watchdog(Windows Scheduled Task)と3 owner deployment validation"

## amun 実機 PowerShell テスト(TEST-RESULT全文)

初回転送・実行時、UNC パス `\\wsl.localhost\Ubuntu-24.04\...` が amun の Windows 環境で解決できず
(`Test-Path` / `Get-ChildItem \\wsl.localhost\` いずれも失敗)、`\\wsl$\Ubuntu-24.04\...` に読み替えて解決した
(`wsl.exe -l -v` でディストロ名 `Ubuntu-24.04` を確認)。以降このマシンでは `\\wsl$\` 形式を使うこと。

### 1回目実行(BUG発見)
`Update-WatchdogSightings` 呼び出し(テスト12)で例外:
```
Update-WatchdogSightings : "1" の引数を指定して "ContainsKey" を呼び出し中に例外が発生しました:
"キーを Null にすることはできません。パラメーター名:key"
PWSH_EXIT=1
```
OBSERVE: テスト1-11(`Get-WatchdogFindings`のみ)は全PASS。`Update-WatchdogSightings`を初めて呼ぶテスト12でNull key例外。
HYPOTHESIZE: PowerShellの既知の罠 — `$obj.PSObject.Properties.Name` はプロパティ0件のとき **`$null`を返す**(空配列ではない)。
`@($null)` は要素1件(null)の配列になるため、`New-TestState`(entries=空PSCustomObject)を渡した直後の
`foreach ($name in @($State.entries.PSObject.Properties.Name))` が `$name = $null` で1回ループし、
`$findingsByKey.ContainsKey($null)` がNull key例外を投げる。
TEST: `Get-WatchdogPropertyNames`ヘルパー(`foreach ($p in $Obj.PSObject.Properties) { $names += $p.Name }`)に
置換した後、amun再転送・再実行。
FIX結果: 全29件PASS(下記)。

### 2回目実行(FIX後・最終)
```
ok: healthy な probe + 新鮮な backup では finding 0 件
ok: 到達不能で finding 1 件
ok: 到達不能の dedup_key
ok: 到達不能の severity
ok: 401 の dedup_key
ok: 401 の severity
ok: 502 の dedup_key
ok: redis 異常で finding 1 件
ok: dependency の dedup_key
ok: dependency の severity
ok: dependency_signals 外の依存先異常は finding にしない
ok: backup 27h 経過で backup_stale
ok: backup 25h は閾値内で finding 0 件
ok: backup が一度も無い場合も backup_stale
ok: manifest 読取不能では finding は 1 件のみ(backup_stale と重複発報しない)
ok: manifest 読取不能で backup_marker_unreadable
ok: restore test 36 日で restore_test_stale
ok: 新規 finding で通知 1 件
ok: 新規 finding の kind は alert
ok: 新規 finding の dedup_key
ok: backoff(15分) 未経過の 5 分後は再通知しない
ok: backoff(15分) 経過後は再通知する
ok: 2 回目通知後は 30 分必要(20 分では再通知しない)
ok: alert_max_notifications=5 到達後は通知しない
ok: 復旧時に通知 1 件
ok: 復旧時の kind は resolved
ok: resolved 送信後は二度と通知しない
ok: 配送失敗が別 signal として記録される
ok: 配送失敗後は backoff を待たず次回再送する
TEST-RESULT: PASS 29/29
PWSH_EXIT=0
```
(実機出力はamun側システムANSI(CP932)で表示されており、ssh経由でmojibake表示になるがTEST-RESULT行とEXIT=0で判定。文字化けした行も上記は元テストの日本語アサーション名に対応、意味は`test-watchdog-lib.ps1`のコメント参照)

## npm test(vitest)

初回実行で1件FAIL:
```
FAIL tests/health-fail-fast.test.ts > ... > 非回帰: TASKVIA_TOKEN が正しく設定されていれば200のまま
AssertionError: expected 503 to be 200
```
原因: task_150由来の既存非回帰テストが `TASKVIA_TOKEN` のみをstubし、新設した owner validation
(DoD#6)の6項目をstubしていなかったため、正しく503(owner未設定)を返した。これは実装バグではなく、
新しい正しい契約(token単独では200にならない)に既存テストの前提が追いついていなかったもの。
`stubValidOwners()`相当のenv stubを追加してテストを是正(仕様変更ではなく、既存テストの意図=
「TASKVIA_TOKENのfail-fast挙動を検証する」を壊さない形でowner側は有効値固定)。

修正後、最終実行:
```
Test Files  8 passed (8)
     Tests  55 passed (55)
```
既存32件 + Worf新規23件(deployment-validation.test.ts) = 55件、全PASS。関数名・引数名・戻り値の形は一切変更していない。

## npm run lint

新規エラー0件。既存エラー2件+警告1件(cards/bulk-delete未使用変数, verification-queueの`<a>`, MissionTimelineのuseEffect内setState)は
`git stash`でtask_153変更を退避しWorfのRED commit(91e22f9)時点でも同じ3件が出ることを確認済み — task_153由来ではない既存の技術的負債。

## npm run build

`next build` 成功。全22ルート生成、`/api/health` `/internal/health/watchdog` とも正常にビルドされる。

## 設計判断メモ
- lib(`watchdog-lib.ps1`)は5関数ともI/Oゼロを厳守。probe/backup収集・config/state読み書き・ntfy送信は
  すべて `taskvia-watchdog.ps1`(entry point)側に実装し、判定ロジックを一切書かない(plan doc Step3の指示通り)。
- `watchdog-config.example.json`はJSONのためファイル内コメント不可 → `_note`キーに
  dependency_signals既定理由(postgres/n8nがPhase0ではplaceholder常時unreachable)を記載。
- amunのUNCパスは`\\wsl.localhost\`ではなく`\\wsl$\`が正だった(plan doc記載のコマンド例をそのまま
  使うと-Fileパラメータでファイルが見つからないエラーになる) — Phase3(Wesley)のScheduled Task登録でも
  同様の読み替えが必要になる可能性が高いため申し送り。
