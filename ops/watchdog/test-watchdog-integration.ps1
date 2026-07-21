# ops/watchdog/test-watchdog-integration.ps1
#
# task_153 Phase1R(Worf, rework) RED: 実TLS経路統合テスト。
#
# ★実行前提: amun で taskvia の5コンテナ(taskvia/gateway/postgres/redis/redis-http)が
#   Up していること。gateway(Caddy)経由の実 HTTPS 到達を検証するため、Mac / CI では
#   実行できない(amunにnode/npmは無く、このテストもamun上のpowershell.exeでのみ動く)。
#
# 目的: test-watchdog-lib.ps1(純粋関数・29+2アサーション)では原理的に検出できない層
# ――TLS ハンドシェイク・SNI・証明書検証 callback の呼び出しスレッド・state file の
# ラウンドトリップ――を、稼働中の実スタックに対する実 HTTP 経由で検証する。
# 既存 test-watchdog-lib.ps1 は変更しない。本テストはその補完であり置換ではない。
#
# 隔離(必須): 提督が amun にデプロイ済みの C:\ProgramData\Taskvia\watchdog-config.json /
# watchdog-state.json(実エントリを保持)には読み書きとも一切触れない。本テストは
# $env:TEMP 配下に自前の一時 config / 一時 state file を生成し、それのみを使い、
# 終了時(異常終了時も含む)に削除する。ntfy_url は到達不能なダミーとし実配送は
# 発生させない。正しい token は compose.yaml の TASKVIA_WATCHDOG_TOKEN(task_150以来
# リポジトリに平文で入っているローカル dev fixture 値)を実行時に読み込む
# ――committed なこのファイル自体にはハードコードしない。
#
# 出力契約: 既存テストと同一。最終行に ASCII で "TEST-RESULT: PASS n/n"、
# exit code 0=全PASS / 1=FAILあり。CP932 文字化けのため判定は exit code とこの行のみで行う。
#
# 現行コード(960555f)に対する RED 期待値: 項目1・2・4・5・6が FAIL し、項目3のみ PASS する。
# (項目2 も含め FAIL する理由: バグ2 により TLS ハンドシェイク段階で
#  PSInvalidOperationException → SendFailure となりサーバへ到達しないため、誤 token でも
#  401 は返らない。項目3(IP literal 到達不能)は現行コードでも成立するため RED でも PASS する)

$ErrorActionPreference = 'Stop'

$script:Total = 0
$script:Failed = 0

function Assert-Equal {
    param($Expected, $Actual, [string]$Name)
    $script:Total++
    if ("$Expected" -ne "$Actual") {
        $script:Failed++
        Write-Output ("FAIL: {0} | expected=<{1}> actual=<{2}>" -f $Name, $Expected, $Actual)
    } else {
        Write-Output ("ok: {0}" -f $Name)
    }
}

function Assert-True {
    param([bool]$Condition, [string]$Name)
    $script:Total++
    if (-not $Condition) {
        $script:Failed++
        Write-Output ("FAIL: {0}" -f $Name)
    } else {
        Write-Output ("ok: {0}" -f $Name)
    }
}

# --- token取得: compose.yaml から読む(コミットするテストファイルにハードコードしない) ---
$composePath = Join-Path $PSScriptRoot '..\..\compose.yaml'
if (-not (Test-Path -LiteralPath $composePath)) {
    throw "compose.yaml not found at $composePath"
}
$composeText = Get-Content -LiteralPath $composePath -Raw -Encoding UTF8
if ($composeText -notmatch 'TASKVIA_WATCHDOG_TOKEN:\s*(\S+)') {
    throw "TASKVIA_WATCHDOG_TOKEN not found in compose.yaml"
}
$validToken = $Matches[1]
$wrongToken = "$validToken-red-test-invalid"

# --- 一時ディレクトリ(隔離) ---
$tmpDir = Join-Path $env:TEMP ("taskvia_watchdog_it_{0}" -f ([guid]::NewGuid().ToString('N')))
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

function New-TempWatchdogConfig {
    param([string]$Url, [string]$Token, [string]$StatePath, [string]$ConfigOutPath)
    $exampleConfigPath = Join-Path $PSScriptRoot 'watchdog-config.example.json'
    $cfg = Get-Content -LiteralPath $exampleConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $cfg.watchdog_url = $Url
    $cfg.watchdog_token = $Token
    $cfg.ntfy_url = 'https://ntfy.example.invalid'
    $cfg.state_file = $StatePath
    # backup_dir は実リポジトリの ops/backups を読みに行かせない(隔離を徹底する。
    # このテストは probe の値のみを判定対象とし backup/restore findings は無視する)。
    $cfg.backup_dir = Join-Path $tmpDir 'nonexistent-backups'
    ($cfg | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $ConfigOutPath -Encoding UTF8
}

function Invoke-WatchdogRun {
    param([string]$ConfigPath)
    $result = [pscustomobject]@{
        probe_status = ''
        raw_output   = ''
        error        = ''
    }
    try {
        $out = & "$PSScriptRoot\taskvia-watchdog.ps1" -ConfigPath $ConfigPath
        $joined = ($out | Out-String)
        $result.raw_output = $joined
        if ($joined -match 'WATCHDOG-RUN:\s*probe=(\S+)') {
            $result.probe_status = $Matches[1]
        }
    } catch {
        $result.error = $_.Exception.Message
    }
    return $result
}

try {
    # ============================================================
    # Run A: 正しい token・localhost(項目1・4・5・6 の材料)
    # 事前に「不動点性ラウンドトリップ」マーカーentryを一時 state file に仕込む(項目5)。
    # ============================================================
    $stateAPath  = Join-Path $tmpDir 'state-a.json'
    $configAPath = Join-Path $tmpDir 'config-a.json'

    $markerKey       = 'test_roundtrip_marker'
    $markerFirstSeen = '2026-07-20T06:39:50Z'
    $seedStateJson = @"
{
  "entries": {
    "$markerKey": {
      "severity": "warning",
      "title": "task_153 rework Phase1R item5 roundtrip marker",
      "message": "seeded by test-watchdog-integration.ps1 (not a real finding)",
      "first_seen": "$markerFirstSeen",
      "last_seen": "$markerFirstSeen",
      "notify_count": 0,
      "last_notified_at": null,
      "pending_resolved": false
    }
  },
  "delivery_failures": { "count": 0, "last_failed_at": null }
}
"@
    Set-Content -LiteralPath $stateAPath -Value $seedStateJson -Encoding UTF8

    New-TempWatchdogConfig -Url 'https://localhost/internal/health/watchdog' -Token $validToken `
        -StatePath $stateAPath -ConfigOutPath $configAPath
    $runA = Invoke-WatchdogRun -ConfigPath $configAPath

    # 項目1: 正常系 — 正しい token で実TLS経路(localhost)に到達し HTTP 200(probe=ok)を得る。
    # SendFailure(=バグ2でTLSハンドシェイクが落ちる)になった時点でこの Assert は FAIL する。
    Assert-Equal 'ok' $runA.probe_status '項目1: 正しいtokenで実TLS経路(https://localhost/...)がHTTP200(probe=ok)に到達する(バグ2 回帰pin)'

    # 項目4: 証明書検証callbackが別スレッドから呼ばれても例外化しないこと。
    # taskvia-watchdog.ps1 の Get-WatchdogProbe はあらゆる例外(callback内の
    # PSInvalidOperationException を含む)を WebException 経由で捕捉し 'unreachable' 等へ
    # 畳み込むため、この関数の外からは個別の例外型を直接観測できない。
    # ゆえに項目1の probe=ok 到達をもって「callback が例外化しなかった」ことの
    # 確認とする(rework doc §4.1 の記載通り)。項目1と同じ値を使うが、
    # 検証したい契約が異なるため独立したアサーションとして明示する。
    Assert-True ($runA.probe_status -eq 'ok') '項目4: 証明書検証callbackが別スレッド呼び出しで例外化しない(PSInvalidOperationExceptionが発生しない, バグ2 回帰pin — 項目1のprobe=ok到達で確認)'

    # 項目5: state file の UTC ラウンドトリップが不動点であること(バグ5 回帰pin)。
    # 書き込んだ first_seen の文字列と、1回の watchdog 実行(読み→処理→書き)を経て
    # 読み戻した文字列が完全一致することを要求する(1分未満のずれではなく完全一致)。
    if (Test-Path -LiteralPath $stateAPath) {
        $stateAfter = Get-Content -LiteralPath $stateAPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $actualFirstSeen = $stateAfter.entries.$markerKey.first_seen
    } else {
        $actualFirstSeen = '<state file missing after run>'
    }
    Assert-Equal $markerFirstSeen $actualFirstSeen '項目5: state fileのUTCラウンドトリップが不動点(書込んだfirst_seenと読み戻し後の値が完全一致, バグ5 回帰pin)'

    # 項目6: 上記が満たされた状態で watchdog 本体を1回実行し
    # WATCHDOG-RUN: probe=ok に到達できること(backup/restore鮮度findingは別軸のため対象外)。
    Assert-Equal 'ok' $runA.probe_status '項目6: watchdog本体を1回実行しWATCHDOG-RUN: probe=okに到達する(E2E到達性)'

    # ============================================================
    # Run B: 誤 token・localhost(項目2 の材料)
    # ============================================================
    $stateBPath  = Join-Path $tmpDir 'state-b.json'
    $configBPath = Join-Path $tmpDir 'config-b.json'
    New-TempWatchdogConfig -Url 'https://localhost/internal/health/watchdog' -Token $wrongToken `
        -StatePath $stateBPath -ConfigOutPath $configBPath
    $runB = Invoke-WatchdogRun -ConfigPath $configBPath

    # 項目2a: 認証失敗 — 誤 token で HTTP 401(probe=unauthorized)を得る。
    # RED では現行コードがバグ2 によりハンドシェイク自体に失敗するため 401 まで到達できず、
    # このアサーションは FAIL する(rework doc の明記通り)。
    Assert-Equal 'unauthorized' $runB.probe_status '項目2a: 誤tokenで実TLS経路がHTTP401(probe=unauthorized)に到達する'

    # 項目2b: 応答本文・例外メッセージに token 値・接続文字列・内部hostnameが含まれないこと。
    # taskvia-watchdog.ps1 は WATCHDOG-RUN の1行以外を標準出力に書かない設計であり、
    # この不変条件が破られていないことを実出力に対して確認する。
    $leakNeedles = @($validToken, $wrongToken, 'taskvia:3000', 'redis:6379', 'redis-http', 'postgres:5432')
    $leakedIn = @($leakNeedles | Where-Object { $runB.raw_output.Contains($_) -or $runB.error.Contains($_) })
    Assert-True ($leakedIn.Count -eq 0) '項目2b: 誤token失敗時の出力にtoken値・接続文字列・内部hostnameを含まない(§14.2)'

    # ============================================================
    # Run C: 正しい token・IP literal(127.0.0.1)(項目3 の材料)
    # ============================================================
    $stateCPath  = Join-Path $tmpDir 'state-c.json'
    $configCPath = Join-Path $tmpDir 'config-c.json'
    New-TempWatchdogConfig -Url 'https://127.0.0.1/internal/health/watchdog' -Token $validToken `
        -StatePath $stateCPath -ConfigOutPath $configCPath
    $runC = Invoke-WatchdogRun -ConfigPath $configCPath

    # 項目3(★バグ1の回帰pin・既知の制約): IP literal は SNI が付かず docker/Caddyfile の
    # `localhost, gateway` サイトブロックにマッチしないため、Caddy がハンドシェイクを
    # 拒否し到達できない。これは Phase2R 以降も(Caddyfile を変えない限り)変わらない
    # 既知の制約であり、意図的に "到達できないこと" を pin する。
    # 将来 Caddyfile が変更され IP literal からも到達できるようになった場合は
    # このアサーションが FAIL するため、設計変更に気づける形になっている。
    Assert-True ($runC.probe_status -ne 'ok') '項目3: IP literal(https://127.0.0.1/...)は到達できない(バグ1・既知の制約の回帰pin)'
}
finally {
    # テスト終了時(異常終了時も含む)に一時ファイルを削除する。
    # C:\ProgramData\Taskvia\ 配下は本テストでは一度も参照していない。
    if (Test-Path -LiteralPath $tmpDir) {
        Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# --- 結果出力 ---
$passed = $script:Total - $script:Failed
Write-Output ("TEST-RESULT: {0} {1}/{2}" -f $(if ($script:Failed -eq 0) { 'PASS' } else { 'FAIL' }), $passed, $script:Total)
if ($script:Failed -ne 0) { exit 1 }
exit 0
