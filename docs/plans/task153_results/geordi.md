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

---

# task_153 Phase2R(Geordi, rework) GREEN — バグ1-5修正 実出力記録

Beverly の独立QA(Phase4)が amun 実機で「probe=ok に到達する経路が構造的に存在しない」ことを検出し
PUSHED BACK。Picard が amun 実機で独立検証・裁定した5件のバグ(`docs/plans/20260721_task153_rework.md`)
を Worf の新RED(commit dee4446/ea06cfc)を受けて修正した。

commit: `953c229` — "fix: task_153 rework GREEN — バグ1-5修正(TLS SNI/証明書callback/jsonl/日付パース,Picard裁定)"
push: `feature/task_153` へ push 済み(ea06cfc..953c229)

## 修正内容

### バグ1: watchdog_url の IP literal
`ops/watchdog/watchdog-config.example.json` の `watchdog_url` を `https://127.0.0.1/...` から
`https://localhost/...` に変更。`_note` に「IP literalはSNI不在でCaddyがハンドシェイク拒否・証明書検証
無効化しても到達不能・必ずホスト名localhostを使うこと」を追記。`docker/Caddyfile` は変更していない。

### バグ2: 証明書検証callbackのruntime依存
`taskvia-watchdog.ps1` の `ServerCertificateValidationCallback` への生scriptblock代入を、`Add-Type` の
C#静的クラス `Taskvia.Watchdog.CertValidation.Validate` + `[Delegate]::CreateDelegate` に置換。
型定義は `PSTypeName` で存在チェックしてから1回だけ `Add-Type`(プロセス内二重定義エラー防止)。
loopback限定緩和ロジック(`127.0.0.1`/`localhost`のみ検証bypass、それ以外は`SslPolicyErrors.None`要求)は
C#側にそのまま移植。`-SkipCertificateCheck`は使用せず、PowerShell 7への移行も行っていない
(Picardがamun実機でPS5.1のままTLSハンドシェイク成功・401到達を実証済みのため)。

### バグ3: restore-test.sh の jsonl契約
`ops/restore-test.sh` の62行目・95行目、2箇所の `jq -n` を `jq -nc` に変更(compact JSON出力化)。
既存の pretty-print混入行の扱いは変更していない(読み側catch{continue}で読み飛ばす)。

### バグ4/5: 日付パースのUTC統一
`watchdog-lib.ps1`(I/Oゼロの純粋関数集合という既存の性質を維持)に `ConvertTo-WatchdogUtcTime`
(引数=文字列1つ、戻り値=`[datetime]` Kind=Utc)を新設。`taskvia-watchdog.ps1` の3箇所
(旧`ConvertTo-WatchdogUtc`関数本体・`Get-WatchdogBackup`内の`ParseExact`呼び出し2箇所)をこの関数の
呼び出しに置き換え、旧`ConvertTo-WatchdogUtc`関数定義自体を削除した。

★★実装で1回FAILを踏んだ実測知見(rework docの想定を超える追加発見):
ParseExactの書式文字列に**無引用の`Z`**を置くと、`DateTimeStyles.None`であっても.NETがUTC指示子として
特別扱いし、ローカルタイムゾーン(JST)へ+9h変換した上でKind=Localを返す。「`Z`は書式指定子表に無いので
リテラル扱いされる」という当初の想定は誤りだった。amun実機での確認用プローブ(`/tmp/probe_parseexact.ps1`
に一時作成・検証後delete、リポジトリ非変更):
```
None:                 2026/07/21 15:39:50 Kind=Local   (+9h、rework docの指摘したバグと同型の再発)
NoCurrentDateDefault:  2026/07/21 15:39:50 Kind=Local   (styleを変えても同じ)
QuotedZ('Z'を単一引用符で囲む):  2026/07/21 6:39:50 Kind=Unspecified  (値が変換されない=正しい)
```
`Z`を単一引用符(`'Z'`)で囲んでリテラル文字と明示することで初めて値が変換されなくなる。最終実装は
`"yyyyMMddTHHmmss'Z'"` / `"yyyy-MM-ddTHH:mm:ss'Z'"` を使い、`SpecifyKind(...,'Utc')`でラベル付与。
書き込み側 `ConvertFrom-WatchdogUtc`(`.ToString('yyyy-MM-ddTHH:mm:ssZ')`、`Z`はToString側では最初から
リテラル扱いなので無変更)との不動点性はWorfの統合テスト項目5(state fileラウンドトリップ完全一致)で確認。

## amun実機 TEST-RESULT(修正後・最終)

### test-watchdog-lib.ps1(既存29+追加2=31件)
```
(...既存29件は前回と同一のため省略。以下は新規2件)
ok: ConvertTo-WatchdogUtcTime: compact形式(20260721T063950Z)が2026-07-21 06:39:50 Kind=Utc(バグ4 pin)
ok: ConvertTo-WatchdogUtcTime: extended形式(2026-07-21T06:39:50Z)が2026-07-21 06:39:50 Kind=Utc(バグ5 pin)
TEST-RESULT: PASS 31/31
PWSH_EXIT=0
```
(1回目実行はバグ4/5修正前の`Z`無引用実装でFAIL 29/31だった。上記QuotedZ修正後の2回目実行で31/31 GREEN)

### test-watchdog-integration.ps1(実TLS経路統合テスト・新設)
```
ok: 項目1: 正しいtokenで実TLS経路(https://localhost/...)がHTTP200(probe=ok)に到達する(バグ2 回帰pin)
ok: 項目4: 証明書検証callbackが別スレッド呼び出しで例外化しない(PSInvalidOperationExceptionが発生しない, バグ2 回帰pin — 項目1のprobe=ok到達で確認)
ok: 項目5: state fileのUTCラウンドトリップが不動点(書込んだfirst_seenと読み戻し後の値が完全一致, バグ5 回帰pin)
ok: 項目6: watchdog本体を1回実行しWATCHDOG-RUN: probe=okに到達する(E2E到達性)
ok: 項目2a: 誤tokenで実TLS経路がHTTP401(probe=unauthorized)に到達する
ok: 項目2b: 誤token失敗時の出力にtoken値・接続文字列・内部hostnameを含まない(§14.2)
ok: 項目3: IP literal(https://127.0.0.1/...)は到達できない(バグ1・既知の制約の回帰pin)
TEST-RESULT: PASS 7/7
PWSH_EXIT=0
```
実行前提の5コンテナ(taskvia/gateway/postgres/redis/redis-http)はamunで稼働中確認済み(全てUp)。
このテストは自前の一時config/一時state file(`$env:TEMP`配下)のみを使い、提督デプロイ済みの
`C:\ProgramData\Taskvia\`配下は一切参照していない(rework doc §4.1の隔離要件どおり)。

## npm test / lint / build(Mac側・修正後)
```
Test Files  8 passed (8)
     Tests  55 passed (55)
```
既存契約(vitest 55件)に回帰なし(`ops/restore-test.sh`変更はシェルスクリプトでvitest対象外だが、
念のため全件再実行し非回帰を確認)。

```
npm run lint: 新規エラー0件(既存2エラー1警告は前回Phase2記録と同一・task_153由来でない)
npm run build: 成功(全22ルート生成)
```

## 申し送り(Phase3R Wesleyへ)

- amunのデプロイ済み `C:\ProgramData\Taskvia\watchdog-config.json` はまだ `watchdog_url=127.0.0.1` の
  ままで残っている(rework doc §6の指摘通り、これを`localhost`へ直すのはPhase3Rのスコープ)。
  今回のPhase2Rの変更は `ops/watchdog/watchdog-config.example.json`(テンプレート)のみで、
  デプロイ済み実ファイルには一切触れていない。
- `register-task.ps1`/`unregister-task.ps1` は今回変更していない(証明書callback等の変更は
  `taskvia-watchdog.ps1`/`watchdog-lib.ps1`内で閉じており、Scheduled Task登録スクリプト自体への
  影響はない)。
- runbook(`docs/runbooks/phase0-watchdog.md`)には、ParseExactの無引用`Z`が+9h変換される.NETの挙動
  (今回の実測知見)も一言残しておくと将来の類似修正で再発を防げる可能性がある(必須ではないが申し送り)。
