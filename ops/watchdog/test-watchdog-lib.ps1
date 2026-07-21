# ops/watchdog/test-watchdog-lib.ps1
#
# task_153 Phase1(Worf) RED: 独立 watchdog の純粋判定ロジック契約を検証する。
# Pester に依存しない(Windows PowerShell 5.1 同梱の Pester 3.4 は構文互換性がないため)。
# ネットワーク・Docker・ファイル I/O を一切行わない — Get-* / Update-* / Confirm-* は
# すべて純粋関数であり、時刻は -NowUtc 引数で注入される。
#
# 実行: powershell.exe -NoProfile -ExecutionPolicy Bypass -File ops\watchdog\test-watchdog-lib.ps1
# 成否: exit code 0 = 全 PASS / 1 = FAIL あり。最終行に "TEST-RESULT: PASS n/n" を ASCII で出力する
#       (WSL2 ssh 経由では CP932 出力が文字化けするため、判定はこの行と exit code で行う)。

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\watchdog-lib.ps1"

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

function New-TestConfig {
    return [pscustomobject]@{
        dependency_signals        = @('postgres', 'redis', 'n8n')
        backup_stale_hours        = 26
        restore_test_stale_days   = 35
        alert_backoff_base_minutes = 15
        alert_max_notifications   = 5
    }
}

function New-TestState {
    return [pscustomobject]@{
        entries           = [pscustomobject]@{}
        delivery_failures = [pscustomobject]@{ count = 0; last_failed_at = $null }
    }
}

function New-OkProbe {
    param([string]$Postgres = 'healthy', [string]$Redis = 'healthy', [string]$N8n = 'healthy')
    return [pscustomobject]@{
        status      = 'ok'
        http_status = 200
        body        = [pscustomobject]@{ web = 'healthy'; postgres = $Postgres; redis = $Redis; n8n = $N8n }
        detail      = ''
    }
}

function New-FreshBackup {
    param([datetime]$NowUtc)
    return [pscustomobject]@{
        manifest_available     = $true
        latest_completed_at    = $NowUtc.AddHours(-1)
        restore_test_available = $true
        latest_restore_test_at = $NowUtc.AddDays(-1)
        detail                 = ''
    }
}

$now = [datetime]::SpecifyKind([datetime]::Parse('2026-07-21T04:00:00'), 'Utc')
$config = New-TestConfig

# --- Get-WatchdogFindings ---

# 1. 全て正常なら finding は 0 件
$f = @(Get-WatchdogFindings -Probe (New-OkProbe) -Backup (New-FreshBackup -NowUtc $now) -Config $config -NowUtc $now)
Assert-Equal 0 $f.Count 'healthy な probe + 新鮮な backup では finding 0 件'

# 2. 到達不能は web_unreachable / critical
$probe = [pscustomobject]@{ status = 'unreachable'; http_status = 0; body = $null; detail = 'connection refused' }
$f = @(Get-WatchdogFindings -Probe $probe -Backup (New-FreshBackup -NowUtc $now) -Config $config -NowUtc $now)
Assert-Equal 1 $f.Count '到達不能で finding 1 件'
Assert-Equal 'web_unreachable' $f[0].dedup_key '到達不能の dedup_key'
Assert-Equal 'critical' $f[0].severity '到達不能の severity'

# 3. 401 は watchdog_auth_failed / critical
$probe = [pscustomobject]@{ status = 'unauthorized'; http_status = 401; body = $null; detail = '' }
$f = @(Get-WatchdogFindings -Probe $probe -Backup (New-FreshBackup -NowUtc $now) -Config $config -NowUtc $now)
Assert-Equal 'watchdog_auth_failed' $f[0].dedup_key '401 の dedup_key'
Assert-Equal 'critical' $f[0].severity '401 の severity'

# 4. 想定外ステータスは web_bad_status / critical
$probe = [pscustomobject]@{ status = 'bad_status'; http_status = 502; body = $null; detail = 'HTTP 502' }
$f = @(Get-WatchdogFindings -Probe $probe -Backup (New-FreshBackup -NowUtc $now) -Config $config -NowUtc $now)
Assert-Equal 'web_bad_status' $f[0].dedup_key '502 の dedup_key'

# 5. dependency が healthy 以外なら dependency_<dep> / warning
$f = @(Get-WatchdogFindings -Probe (New-OkProbe -Redis 'unreachable') -Backup (New-FreshBackup -NowUtc $now) -Config $config -NowUtc $now)
Assert-Equal 1 $f.Count 'redis 異常で finding 1 件'
Assert-Equal 'dependency_redis' $f[0].dedup_key 'dependency の dedup_key'
Assert-Equal 'warning' $f[0].severity 'dependency の severity'

# 6. dependency_signals に含まれない依存先は無視する
#    (postgres/n8n は Phase0 では構造上の placeholder として常に unreachable を返すため、
#     Phase0 の既定 config では監視対象から外せる必要がある — §17.1 の閾値設定可能要件)
$narrow = [pscustomobject]@{
    dependency_signals = @('redis'); backup_stale_hours = 26; restore_test_stale_days = 35
    alert_backoff_base_minutes = 15; alert_max_notifications = 5
}
$f = @(Get-WatchdogFindings -Probe (New-OkProbe -Postgres 'unreachable' -N8n 'unreachable') -Backup (New-FreshBackup -NowUtc $now) -Config $narrow -NowUtc $now)
Assert-Equal 0 $f.Count 'dependency_signals 外の依存先異常は finding にしない'

# 7. backup が古い(26h 超)なら backup_stale
$stale = [pscustomobject]@{
    manifest_available = $true; latest_completed_at = $now.AddHours(-27)
    restore_test_available = $true; latest_restore_test_at = $now.AddDays(-1); detail = ''
}
$f = @(Get-WatchdogFindings -Probe (New-OkProbe) -Backup $stale -Config $config -NowUtc $now)
Assert-Equal 'backup_stale' $f[0].dedup_key 'backup 27h 経過で backup_stale'

# 8. backup が 25h なら発報しない(境界)
$edge = [pscustomobject]@{
    manifest_available = $true; latest_completed_at = $now.AddHours(-25)
    restore_test_available = $true; latest_restore_test_at = $now.AddDays(-1); detail = ''
}
$f = @(Get-WatchdogFindings -Probe (New-OkProbe) -Backup $edge -Config $config -NowUtc $now)
Assert-Equal 0 $f.Count 'backup 25h は閾値内で finding 0 件'

# 9. backup が一度も無い(=null)なら backup_stale
$never = [pscustomobject]@{
    manifest_available = $true; latest_completed_at = $null
    restore_test_available = $true; latest_restore_test_at = $now.AddDays(-1); detail = ''
}
$f = @(Get-WatchdogFindings -Probe (New-OkProbe) -Backup $never -Config $config -NowUtc $now)
Assert-Equal 'backup_stale' $f[0].dedup_key 'backup が一度も無い場合も backup_stale'

# 10. manifest ディレクトリが読めない(=WSL2 停止など)なら backup_marker_unreadable
$unreadable = [pscustomobject]@{
    manifest_available = $false; latest_completed_at = $null
    restore_test_available = $false; latest_restore_test_at = $null; detail = 'path not found'
}
$f = @(Get-WatchdogFindings -Probe (New-OkProbe) -Backup $unreadable -Config $config -NowUtc $now)
Assert-Equal 1 $f.Count 'manifest 読取不能では finding は 1 件のみ(backup_stale と重複発報しない)'
Assert-Equal 'backup_marker_unreadable' $f[0].dedup_key 'manifest 読取不能で backup_marker_unreadable'

# 11. restore test が 36 日前なら restore_test_stale
$rt = [pscustomobject]@{
    manifest_available = $true; latest_completed_at = $now.AddHours(-1)
    restore_test_available = $true; latest_restore_test_at = $now.AddDays(-36); detail = ''
}
$f = @(Get-WatchdogFindings -Probe (New-OkProbe) -Backup $rt -Config $config -NowUtc $now)
Assert-Equal 'restore_test_stale' $f[0].dedup_key 'restore test 36 日で restore_test_stale'

# --- Update-WatchdogSightings / Get-WatchdogNotifications / Confirm-WatchdogDelivery ---

# 12. 新規 finding は即 alert される
$state = New-TestState
$probe = [pscustomobject]@{ status = 'unreachable'; http_status = 0; body = $null; detail = 'refused' }
$findings = @(Get-WatchdogFindings -Probe $probe -Backup (New-FreshBackup -NowUtc $now) -Config $config -NowUtc $now)
$state = Update-WatchdogSightings -State $state -Findings $findings -NowUtc $now
$n = @(Get-WatchdogNotifications -State $state -Config $config -NowUtc $now)
Assert-Equal 1 $n.Count '新規 finding で通知 1 件'
Assert-Equal 'alert' $n[0].kind '新規 finding の kind は alert'
Assert-Equal 'web_unreachable' $n[0].dedup_key '新規 finding の dedup_key'

# 13. 送信確定後、backoff 未経過なら再通知しない(dedup)
$state = Confirm-WatchdogDelivery -State $state -DedupKey 'web_unreachable' -Kind 'alert' -NowUtc $now
$t5 = $now.AddMinutes(5)
$state = Update-WatchdogSightings -State $state -Findings $findings -NowUtc $t5
$n = @(Get-WatchdogNotifications -State $state -Config $config -NowUtc $t5)
Assert-Equal 0 $n.Count 'backoff(15分) 未経過の 5 分後は再通知しない'

# 14. backoff 経過後は再通知する
$t16 = $now.AddMinutes(16)
$state = Update-WatchdogSightings -State $state -Findings $findings -NowUtc $t16
$n = @(Get-WatchdogNotifications -State $state -Config $config -NowUtc $t16)
Assert-Equal 1 $n.Count 'backoff(15分) 経過後は再通知する'

# 15. backoff は指数的に伸びる(2回目通知後は 30 分必要)
$state = Confirm-WatchdogDelivery -State $state -DedupKey 'web_unreachable' -Kind 'alert' -NowUtc $t16
$t36 = $now.AddMinutes(36)   # 2 回目通知から 20 分後 < 30 分
$state = Update-WatchdogSightings -State $state -Findings $findings -NowUtc $t36
$n = @(Get-WatchdogNotifications -State $state -Config $config -NowUtc $t36)
Assert-Equal 0 $n.Count '2 回目通知後は 30 分必要(20 分では再通知しない)'

# 16. 繰り返し上限に達したら通知を止める
$state = New-TestState
$state = Update-WatchdogSightings -State $state -Findings $findings -NowUtc $now
$t = $now
for ($i = 1; $i -le 5; $i++) {
    $state = Confirm-WatchdogDelivery -State $state -DedupKey 'web_unreachable' -Kind 'alert' -NowUtc $t
    $t = $t.AddDays(1)   # backoff を確実に超える間隔
    $state = Update-WatchdogSightings -State $state -Findings $findings -NowUtc $t
}
$n = @(Get-WatchdogNotifications -State $state -Config $config -NowUtc $t)
Assert-Equal 0 $n.Count 'alert_max_notifications=5 到達後は通知しない'

# 17. 復旧時に resolved 通知が 1 回だけ出る
$state = New-TestState
$state = Update-WatchdogSightings -State $state -Findings $findings -NowUtc $now
$state = Confirm-WatchdogDelivery -State $state -DedupKey 'web_unreachable' -Kind 'alert' -NowUtc $now
$state = Update-WatchdogSightings -State $state -Findings @() -NowUtc $t5
$n = @(Get-WatchdogNotifications -State $state -Config $config -NowUtc $t5)
Assert-Equal 1 $n.Count '復旧時に通知 1 件'
Assert-Equal 'resolved' $n[0].kind '復旧時の kind は resolved'
$state = Confirm-WatchdogDelivery -State $state -DedupKey 'web_unreachable' -Kind 'resolved' -NowUtc $t5
$state = Update-WatchdogSightings -State $state -Findings @() -NowUtc $t16
$n = @(Get-WatchdogNotifications -State $state -Config $config -NowUtc $t16)
Assert-Equal 0 $n.Count 'resolved 送信後は二度と通知しない'

# 18. 送信失敗は state を進めない(次回再送される)
$state = New-TestState
$state = Update-WatchdogSightings -State $state -Findings $findings -NowUtc $now
$state = Add-WatchdogDeliveryFailure -State $state -NowUtc $now
Assert-Equal 1 $state.delivery_failures.count '配送失敗が別 signal として記録される'
$state = Update-WatchdogSightings -State $state -Findings $findings -NowUtc $t5
$n = @(Get-WatchdogNotifications -State $state -Config $config -NowUtc $t5)
Assert-Equal 1 $n.Count '配送失敗後は backoff を待たず次回再送する'

# --- ConvertTo-WatchdogUtcTime 契約(task_153 rework Phase1R・バグ4/5 の回帰 pin) ---
#
# rework doc §4.2: watchdog-lib.ps1(純粋関数・I/O なし)へ日付パースを移設する契約。
# 引数=文字列1つ、戻り値=[datetime](Kind=Utc)。現時点では watchdog-lib.ps1 に
# この関数は存在しないため、呼び出しは「コマンドが見つからない」で必ず FAIL する(RED)。
# 未定義関数呼び出しは terminating error になるため、Assert-Equal と違い個別に
# try/catch で捕捉し、最終行の TEST-RESULT 出力に確実に到達できるようにする。

function Assert-UtcTimeParse {
    param([string]$Raw, [string]$Name)
    $script:Total++
    try {
        $r = ConvertTo-WatchdogUtcTime $Raw
        $expected = [datetime]::Parse('2026-07-21T06:39:50')
        if ($r -eq $expected -and $r.Kind -eq [System.DateTimeKind]::Utc) {
            Write-Output ("ok: {0}" -f $Name)
        } else {
            $script:Failed++
            Write-Output ("FAIL: {0} | expected=<2026-07-21 06:39:50 Kind=Utc> actual=<{1} Kind={2}>" -f $Name, $r, $r.Kind)
        }
    } catch {
        $script:Failed++
        Write-Output ("FAIL: {0} | error=<{1}>" -f $Name, $_.Exception.Message)
    }
}

# 19. compact(basic) 形式 "20260721T063950Z"(ops/backup.sh の manifest completed_at と同形式)
#     → 2026-07-21 06:39:50 Kind=Utc であること(バグ4 pin: ParseExact が +9h ずれていた)
Assert-UtcTimeParse '20260721T063950Z' 'ConvertTo-WatchdogUtcTime: compact形式(20260721T063950Z)が2026-07-21 06:39:50 Kind=Utc(バグ4 pin)'

# 20. extended(ISO 8601) 形式 "2026-07-21T06:39:50Z"(state file の first_seen 等と同形式)
#     → 2026-07-21 06:39:50 Kind=Utc であること(バグ5 pin: [datetime]::Parse が +9h ずれていた)
Assert-UtcTimeParse '2026-07-21T06:39:50Z' 'ConvertTo-WatchdogUtcTime: extended形式(2026-07-21T06:39:50Z)が2026-07-21 06:39:50 Kind=Utc(バグ5 pin)'

# --- 結果出力 ---
$passed = $script:Total - $script:Failed
Write-Output ("TEST-RESULT: {0} {1}/{2}" -f $(if ($script:Failed -eq 0) { 'PASS' } else { 'FAIL' }), $passed, $script:Total)
if ($script:Failed -ne 0) { exit 1 }
exit 0
