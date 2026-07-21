# ops/watchdog/taskvia-watchdog.ps1
#
# task_153 Phase2(Geordi) GREEN: 独立 watchdog(Windows Scheduled Task から起動)の
# entry point。責務は「probe → watchdog-lib.ps1 へ判定を委譲 → ntfy送信 → state永続化」
# のみ。判定ロジックはここには書かない(すべて watchdog-lib.ps1 の純粋関数に委譲する)。
#
# 独立性の核心: Taskvia の src/lib/ntfy.ts を一切呼ばない。ntfy への送信はこのスクリプト
# が直接 POST する。Taskvia アプリ本体が全断していても watchdog は動く必要があるため。
#
# 実行: powershell.exe -NoProfile -ExecutionPolicy Bypass -File taskvia-watchdog.ps1 -ConfigPath <path>

param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'watchdog-config.json')
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\watchdog-lib.ps1"

# 1. TLS 1.2 を明示的に有効化する(5.1 の既定は TLS 1.0 のことがあり、ntfy への HTTPS が失敗する)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# 2. gateway は Caddy の self-signed 証明書(docker/Caddyfile の `tls internal`)を使う。
#    5.1 の Invoke-WebRequest には -SkipCertificateCheck が無いため、
#    ServerCertificateValidationCallback を「loopback 宛てに限り」緩める。
#    loopback 以外(= ntfy への送信)では通常の証明書検証を維持すること。
[Net.ServicePointManager]::ServerCertificateValidationCallback = {
    param($senderObj, $cert, $chain, $sslErrors)
    $uri = $null
    if ($senderObj -is [System.Net.HttpWebRequest]) { $uri = $senderObj.RequestUri }
    if ($null -ne $uri -and ($uri.Host -eq '127.0.0.1' -or $uri.Host -eq 'localhost')) { return $true }
    return ($sslErrors -eq [System.Net.Security.SslPolicyErrors]::None)
}

function Read-WatchdogConfig {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "watchdog config not found: $Path"
    }
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function ConvertTo-WatchdogUtc {
    param([string]$Value)
    if ([string]::IsNullOrEmpty($Value)) { return $null }
    return [datetime]::SpecifyKind([datetime]::Parse($Value), 'Utc')
}

function ConvertFrom-WatchdogUtc {
    param($Value)
    if ($null -eq $Value) { return $null }
    return $Value.ToString('yyyy-MM-ddTHH:mm:ssZ')
}

function Read-WatchdogState {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return [pscustomobject]@{
            entries           = [pscustomobject]@{}
            delivery_failures = [pscustomobject]@{ count = 0; last_failed_at = $null }
        }
    }

    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    $entries = [ordered]@{}
    foreach ($name in (Get-WatchdogPropertyNames $raw.entries)) {
        $e = $raw.entries.$name
        $entries[$name] = [pscustomobject]@{
            severity          = $e.severity
            title             = $e.title
            message           = $e.message
            first_seen        = ConvertTo-WatchdogUtc $e.first_seen
            last_seen         = ConvertTo-WatchdogUtc $e.last_seen
            notify_count      = $e.notify_count
            last_notified_at  = ConvertTo-WatchdogUtc $e.last_notified_at
            pending_resolved  = [bool]$e.pending_resolved
        }
    }

    $deliveryFailures = [pscustomobject]@{
        count          = $(if ($raw.delivery_failures.PSObject.Properties.Name -contains 'count') { $raw.delivery_failures.count } else { 0 })
        last_failed_at = ConvertTo-WatchdogUtc $raw.delivery_failures.last_failed_at
    }

    return [pscustomobject]@{
        entries           = [pscustomobject]$entries
        delivery_failures = $deliveryFailures
    }
}

function Save-WatchdogState {
    param($State, [string]$Path)

    $entriesOut = [ordered]@{}
    foreach ($name in (Get-WatchdogPropertyNames $State.entries)) {
        $e = $State.entries.$name
        $entriesOut[$name] = [pscustomobject]@{
            severity          = $e.severity
            title             = $e.title
            message           = $e.message
            first_seen        = ConvertFrom-WatchdogUtc $e.first_seen
            last_seen         = ConvertFrom-WatchdogUtc $e.last_seen
            notify_count      = $e.notify_count
            last_notified_at  = ConvertFrom-WatchdogUtc $e.last_notified_at
            pending_resolved  = [bool]$e.pending_resolved
        }
    }

    $out = [pscustomobject]@{
        entries           = [pscustomobject]$entriesOut
        delivery_failures = [pscustomobject]@{
            count          = $State.delivery_failures.count
            last_failed_at = ConvertFrom-WatchdogUtc $State.delivery_failures.last_failed_at
        }
    }

    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    ($out | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Get-WatchdogProbe {
    param($Config)

    try {
        # 3. Invoke-WebRequest は 4xx/5xx で例外を投げる。401 と到達不能を必ず区別すること。
        $resp = Invoke-WebRequest -Uri $Config.watchdog_url -Headers @{ Authorization = "Bearer $($Config.watchdog_token)" } `
                                  -TimeoutSec 10 -UseBasicParsing
        return [pscustomobject]@{
            status      = 'ok'
            http_status = [int]$resp.StatusCode
            body        = ($resp.Content | ConvertFrom-Json)
            detail      = ''
        }
    } catch [System.Net.WebException] {
        $status = 0
        if ($null -ne $_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        if ($status -eq 401) {
            return [pscustomobject]@{ status = 'unauthorized'; http_status = 401; body = $null; detail = '' }
        } elseif ($status -eq 0) {
            # detail に token を含めないこと(例外メッセージは URL のみを含む)
            return [pscustomobject]@{ status = 'unreachable'; http_status = 0; body = $null; detail = $_.Exception.Status.ToString() }
        } else {
            return [pscustomobject]@{ status = 'bad_status'; http_status = $status; body = $null; detail = "HTTP $status" }
        }
    }
}

function Get-WatchdogBackup {
    param($Config)

    # manifest: ops/backup.sh が `date -u +%Y%m%dT%H%M%SZ` で生成する completed_at を読む。
    $manifestAvailable = $true
    $latestCompletedAt = $null
    try {
        $pattern = Join-Path $Config.backup_dir '*.manifest.json'
        $files = @(Get-ChildItem -Path $pattern -ErrorAction Stop)
        foreach ($file in $files) {
            try {
                $m = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
                if (($m.PSObject.Properties.Name -contains 'completed_at') -and $m.completed_at) {
                    $dt = [datetime]::SpecifyKind(
                        [datetime]::ParseExact($m.completed_at, 'yyyyMMddTHHmmssZ', [Globalization.CultureInfo]::InvariantCulture),
                        'Utc')
                    if ($null -eq $latestCompletedAt -or $dt -gt $latestCompletedAt) { $latestCompletedAt = $dt }
                }
            } catch {
                continue
            }
        }
    } catch {
        $manifestAvailable = $false
    }

    # restore test: result="success" の行の completed_at のみを「実施済み」として数える。
    $restoreTestAvailable = $true
    $latestRestoreTestAt = $null
    try {
        $restoreLogPath = Join-Path $Config.backup_dir 'restore-test-log.jsonl'
        if (-not (Test-Path -LiteralPath $restoreLogPath)) { throw "restore-test-log.jsonl not found" }
        $lines = @(Get-Content -LiteralPath $restoreLogPath -Encoding UTF8 -ErrorAction Stop)
        foreach ($line in $lines) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            try {
                $entry = $line | ConvertFrom-Json
                $hasResult = $entry.PSObject.Properties.Name -contains 'result'
                $hasCompletedAt = $entry.PSObject.Properties.Name -contains 'completed_at'
                if ($hasResult -and $entry.result -eq 'success' -and $hasCompletedAt -and $entry.completed_at) {
                    $dt = [datetime]::SpecifyKind(
                        [datetime]::ParseExact($entry.completed_at, 'yyyyMMddTHHmmssZ', [Globalization.CultureInfo]::InvariantCulture),
                        'Utc')
                    if ($null -eq $latestRestoreTestAt -or $dt -gt $latestRestoreTestAt) { $latestRestoreTestAt = $dt }
                }
            } catch {
                continue
            }
        }
    } catch {
        $restoreTestAvailable = $false
    }

    return [pscustomobject]@{
        manifest_available     = $manifestAvailable
        latest_completed_at    = $latestCompletedAt
        restore_test_available = $restoreTestAvailable
        latest_restore_test_at = $latestRestoreTestAt
        detail                 = ''
    }
}

function Send-WatchdogNtfy {
    param($Config, $Notification)
    $isResolved = ($Notification.kind -eq 'resolved')
    $body = @{
        topic    = $Config.ntfy_topic
        title    = $(if ($isResolved) { "OK Taskvia 復旧: $($Notification.title)" } else { "[!] $($Notification.title)" })
        message  = $Notification.message
        priority = $(if ($isResolved) { 3 } elseif ($Notification.severity -eq 'critical') { 5 } else { 4 })
        tags     = @($(if ($isResolved) { 'white_check_mark' } else { 'warning' }))
    } | ConvertTo-Json -Depth 4 -Compress

    $headers = @{ 'Content-Type' = 'application/json' }
    if ($Config.ntfy_user -and $Config.ntfy_pass) {
        $pair = "$($Config.ntfy_user):$($Config.ntfy_pass)"
        $headers['Authorization'] = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
    }
    try {
        # 5.1 の Invoke-WebRequest は日本語 body を既定で正しく送れないため UTF8 バイト列で渡す
        $bytes = [Text.Encoding]::UTF8.GetBytes($body)
        Invoke-WebRequest -Uri $Config.ntfy_url -Method Post -Headers $headers -Body $bytes `
                          -TimeoutSec 15 -UseBasicParsing | Out-Null
        return $true
    } catch {
        return $false
    }
}

# --- メインループ ---

$config = Read-WatchdogConfig -Path $ConfigPath
$state  = Read-WatchdogState -Path $config.state_file
$now    = [datetime]::UtcNow

$probe  = Get-WatchdogProbe -Config $config
$backup = Get-WatchdogBackup -Config $config

$findings = @(Get-WatchdogFindings -Probe $probe -Backup $backup -Config $config -NowUtc $now)
$state = Update-WatchdogSightings -State $state -Findings $findings -NowUtc $now

$sentCount = 0
$failedCount = 0
foreach ($n in @(Get-WatchdogNotifications -State $state -Config $config -NowUtc $now)) {
    if (Send-WatchdogNtfy -Config $config -Notification $n) {
        $state = Confirm-WatchdogDelivery -State $state -DedupKey $n.dedup_key -Kind $n.kind -NowUtc $now
        $sentCount++
    } else {
        $state = Add-WatchdogDeliveryFailure -State $state -NowUtc $now
        $failedCount++
    }
}

Save-WatchdogState -State $state -Path $config.state_file

# stdout契約: 実行の最後に必ずASCII1行を出力する(Scheduled Taskのログと実機検証がこれを読む)。
# token・secretを含めないこと。
Write-Output ("WATCHDOG-RUN: probe={0} findings={1} sent={2} failed={3}" -f $probe.status, $findings.Count, $sentCount, $failedCount)
