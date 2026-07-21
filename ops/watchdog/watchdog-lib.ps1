# ops/watchdog/watchdog-lib.ps1
#
# task_153 Phase2(Geordi) GREEN: 独立 watchdog の純粋判定ロジック。
# I/O を一切行わない(Invoke-WebRequest / Get-Content / Get-Date は使わない)。
# 時刻は必ず -NowUtc 引数で注入する。呼び出し元(taskvia-watchdog.ps1)が
# probe/backup 収集・ntfy送信・state永続化などの I/O を担当する。
#
# Set-StrictMode は使わない — ConvertFrom-Json 由来の PSCustomObject で
# 存在しないプロパティを参照すると StrictMode 下では例外化し判定が壊れるため。
# プロパティ存在確認は $obj.PSObject.Properties.Name -contains 'x' で行う。
# 配列比較は -contains / -notcontains を使う(.Contains() は PSCustomObject 由来の
# Object[] で挙動が安定しないため)。

function Get-WatchdogPropertyNames {
    # $obj.PSObject.Properties.Name は Properties が0件のとき $null を返す(空配列ではない)。
    # @($null) は要素1件(null)の配列になってしまうため、foreach 手動列挙で安全に空配列を得る。
    param($Obj)
    $names = @()
    foreach ($p in $Obj.PSObject.Properties) { $names += $p.Name }
    return $names
}

function ConvertTo-WatchdogUtcTime {
    # task_153 rework バグ4/5 の修正: [datetime]::Parse / ParseExact(書式 'Z' を UTC offset
    # 指示子として解釈)はロケールのタイムゾーン(JST)へ +9h 変換したうえで Kind=Local を
    # 返すため、その後の SpecifyKind(...,'Utc') は値を補正せずラベルのみ書き換えてしまい、
    # 実際には +9h ずれた時刻が Utc として扱われる。
    # ★実測で判明: ParseExact の書式文字列に無引用の 'Z' を置くと、DateTimeStyles.None
    # であっても .NET が UTC 指示子として特別扱いし、ローカルタイムゾーン(JST)へ +9h
    # 変換したうえで Kind=Local を返す(amun実機で実証・単なる推測ではない)。
    # 'Z' を単一引用符で囲んでリテラル文字として明示することで初めて値が変換されず
    # Kind=Unspecified のまま返る。そこへ SpecifyKind(...,'Utc') でラベルを付与する
    # (書き込み側 ConvertFrom-WatchdogUtc の ToString('...Z') と対になる不動点実装)。
    # 対応形式: compact(ops/backup.sh 等) "yyyyMMddTHHmmssZ" / extended(state file) "yyyy-MM-ddTHH:mm:ssZ"。
    param([string]$Value)
    if ([string]::IsNullOrEmpty($Value)) { return $null }

    $formats = @("yyyyMMddTHHmmss'Z'", "yyyy-MM-ddTHH:mm:ss'Z'")
    foreach ($fmt in $formats) {
        try {
            $parsed = [datetime]::ParseExact(
                $Value, $fmt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None)
            return [datetime]::SpecifyKind($parsed, 'Utc')
        } catch {
            continue
        }
    }
    throw "ConvertTo-WatchdogUtcTime: unsupported date format: $Value"
}

function New-WatchdogFinding {
    param([string]$DedupKey, [string]$Severity, [string]$Title, [string]$Message)
    return [pscustomobject]@{
        dedup_key = $DedupKey
        severity  = $Severity
        title     = $Title
        message   = $Message
    }
}

function Get-WatchdogFindings {
    param(
        [Parameter(Mandatory = $true)] $Probe,
        [Parameter(Mandatory = $true)] $Backup,
        [Parameter(Mandatory = $true)] $Config,
        [Parameter(Mandatory = $true)] [datetime]$NowUtc
    )

    $findings = @()

    if ($Probe.status -ne 'ok') {
        $key = switch ($Probe.status) {
            'unreachable'  { 'web_unreachable' }
            'unauthorized' { 'watchdog_auth_failed' }
            default        { 'web_bad_status' }
        }
        $findings += New-WatchdogFinding -DedupKey $key -Severity 'critical' `
            -Title "Taskvia watchdog probe failed: $($Probe.status)" `
            -Message "http_status=$($Probe.http_status) detail=$($Probe.detail)"
    } else {
        foreach ($dep in @($Config.dependency_signals)) {
            $depValue = $null
            if ($null -ne $Probe.body -and ($Probe.body.PSObject.Properties.Name -contains $dep)) {
                $depValue = $Probe.body.$dep
            }
            if ($depValue -ne 'healthy') {
                $findings += New-WatchdogFinding -DedupKey "dependency_$dep" -Severity 'warning' `
                    -Title "Taskvia dependency degraded: $dep" `
                    -Message "$dep status=$depValue"
            }
        }
    }

    if (-not $Backup.manifest_available) {
        # manifest ディレクトリ自体が読めない(WSL2 停止など)場合と、単に古い場合は
        # 原因が異なる。1 つの障害で複数通知しないため backup_marker_unreadable のみ出し、
        # backup_stale / restore_test_stale は評価しない(§17.2 の dedup key 集約要件)。
        $findings += New-WatchdogFinding -DedupKey 'backup_marker_unreadable' -Severity 'warning' `
            -Title 'Taskvia backup manifest unreadable' `
            -Message "detail=$($Backup.detail)"
    } else {
        $isBackupStale = ($null -eq $Backup.latest_completed_at) -or
                          (($NowUtc - $Backup.latest_completed_at).TotalHours -gt $Config.backup_stale_hours)
        if ($isBackupStale) {
            $findings += New-WatchdogFinding -DedupKey 'backup_stale' -Severity 'warning' `
                -Title 'Taskvia backup is stale' `
                -Message "latest_completed_at=$($Backup.latest_completed_at) threshold_hours=$($Config.backup_stale_hours)"
        }

        $isRestoreTestStale = ($null -eq $Backup.latest_restore_test_at) -or
                               (($NowUtc - $Backup.latest_restore_test_at).TotalDays -gt $Config.restore_test_stale_days)
        if ($isRestoreTestStale) {
            $findings += New-WatchdogFinding -DedupKey 'restore_test_stale' -Severity 'warning' `
                -Title 'Taskvia restore test is stale' `
                -Message "latest_restore_test_at=$($Backup.latest_restore_test_at) threshold_days=$($Config.restore_test_stale_days)"
        }
    }

    return $findings
}

function New-WatchdogEntry {
    param($Finding, [datetime]$FirstSeen, [datetime]$LastSeen, [int]$NotifyCount, $LastNotifiedAt, [bool]$PendingResolved)
    return [pscustomobject]@{
        severity          = $Finding.severity
        title             = $Finding.title
        message           = $Finding.message
        first_seen        = $FirstSeen
        last_seen         = $LastSeen
        notify_count      = $NotifyCount
        last_notified_at  = $LastNotifiedAt
        pending_resolved  = $PendingResolved
    }
}

function Update-WatchdogSightings {
    param(
        [Parameter(Mandatory = $true)] $State,
        [Parameter(Mandatory = $true)] $Findings,
        [Parameter(Mandatory = $true)] [datetime]$NowUtc
    )

    $findingsByKey = @{}
    foreach ($f in @($Findings)) { $findingsByKey[$f.dedup_key] = $f }

    $newEntries = [ordered]@{}

    foreach ($name in (Get-WatchdogPropertyNames $State.entries)) {
        $entry = $State.entries.$name
        if ($findingsByKey.ContainsKey($name)) {
            $finding = $findingsByKey[$name]
            $newEntries[$name] = [pscustomobject]@{
                severity          = $finding.severity
                title             = $finding.title
                message           = $finding.message
                first_seen        = $entry.first_seen
                last_seen         = $NowUtc
                notify_count      = $entry.notify_count
                last_notified_at  = $entry.last_notified_at
                pending_resolved  = $false
            }
            $findingsByKey.Remove($name)
        } else {
            # state にあって findings に無い = 復旧した。resolved 通知が 1 回だけ出るよう
            # pending_resolved を立てる(Confirm-WatchdogDelivery が entry ごと削除する)。
            $newEntries[$name] = [pscustomobject]@{
                severity          = $entry.severity
                title             = $entry.title
                message           = $entry.message
                first_seen        = $entry.first_seen
                last_seen         = $entry.last_seen
                notify_count      = $entry.notify_count
                last_notified_at  = $entry.last_notified_at
                pending_resolved  = $true
            }
        }
    }

    foreach ($key in $findingsByKey.Keys) {
        $finding = $findingsByKey[$key]
        $newEntries[$key] = New-WatchdogEntry -Finding $finding -FirstSeen $NowUtc -LastSeen $NowUtc `
            -NotifyCount 0 -LastNotifiedAt $null -PendingResolved $false
    }

    return [pscustomobject]@{
        entries           = [pscustomobject]$newEntries
        delivery_failures = $State.delivery_failures
    }
}

function Get-WatchdogNotifications {
    param(
        [Parameter(Mandatory = $true)] $State,
        [Parameter(Mandatory = $true)] $Config,
        [Parameter(Mandatory = $true)] [datetime]$NowUtc
    )

    $notifications = @()

    foreach ($name in (Get-WatchdogPropertyNames $State.entries)) {
        $entry = $State.entries.$name

        if ($entry.pending_resolved) {
            $notifications += [pscustomobject]@{
                kind      = 'resolved'
                dedup_key = $name
                severity  = $entry.severity
                title     = $entry.title
                message   = $entry.message
            }
            continue
        }

        $shouldNotify = $false
        if ($entry.notify_count -eq 0) {
            $shouldNotify = $true
        } elseif ($entry.notify_count -lt $Config.alert_max_notifications) {
            $requiredMinutes = $Config.alert_backoff_base_minutes * [math]::Pow(2, $entry.notify_count - 1)
            $elapsed = ($NowUtc - $entry.last_notified_at).TotalMinutes
            $shouldNotify = $elapsed -ge $requiredMinutes
        }

        if ($shouldNotify) {
            $notifications += [pscustomobject]@{
                kind      = 'alert'
                dedup_key = $name
                severity  = $entry.severity
                title     = $entry.title
                message   = $entry.message
            }
        }
    }

    return $notifications
}

function Confirm-WatchdogDelivery {
    param(
        [Parameter(Mandatory = $true)] $State,
        [Parameter(Mandatory = $true)] [string]$DedupKey,
        [Parameter(Mandatory = $true)] [string]$Kind,
        [Parameter(Mandatory = $true)] [datetime]$NowUtc
    )

    $newEntries = [ordered]@{}
    foreach ($name in (Get-WatchdogPropertyNames $State.entries)) {
        if ($name -eq $DedupKey -and $Kind -eq 'resolved') {
            continue
        }
        $entry = $State.entries.$name
        if ($name -eq $DedupKey -and $Kind -eq 'alert') {
            $newEntries[$name] = [pscustomobject]@{
                severity          = $entry.severity
                title             = $entry.title
                message           = $entry.message
                first_seen        = $entry.first_seen
                last_seen         = $entry.last_seen
                notify_count      = $entry.notify_count + 1
                last_notified_at  = $NowUtc
                pending_resolved  = $entry.pending_resolved
            }
        } else {
            $newEntries[$name] = $entry
        }
    }

    return [pscustomobject]@{
        entries           = [pscustomobject]$newEntries
        delivery_failures = $State.delivery_failures
    }
}

function Add-WatchdogDeliveryFailure {
    param(
        [Parameter(Mandatory = $true)] $State,
        [Parameter(Mandatory = $true)] [datetime]$NowUtc
    )

    return [pscustomobject]@{
        entries           = $State.entries
        delivery_failures = [pscustomobject]@{
            count          = $State.delivery_failures.count + 1
            last_failed_at = $NowUtc
        }
    }
}
