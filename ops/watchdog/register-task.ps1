# ops/watchdog/register-task.ps1
#
# task_153 Phase3(Wesley): Taskvia-Watchdog-Phase0 という名前で Windows Scheduled Task を
# 登録する。実行間隔は5分・実行アカウントは現在のユーザー(管理者権限不要)。
# SYSTEM アカウントでは \\wsl.localhost UNC パスへ到達できないため、必ず現在のユーザーで
# 実行すること(/RU を明示指定する)。
#
# 実行: powershell.exe -NoProfile -ExecutionPolicy Bypass -File register-task.ps1 -ConfigPath <config path>
# config ファイルの実体はこのリポジトリの外(例: C:\ProgramData\Taskvia\watchdog-config.json)に置くこと。

param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'

$TaskName = 'Taskvia-Watchdog-Phase0'
$PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$EntryScript = Join-Path $PSScriptRoot 'taskvia-watchdog.ps1'
$CurrentUser = "$env:USERDOMAIN\$env:USERNAME"

if (-not (Test-Path -LiteralPath $EntryScript)) {
    throw "entry point script not found: $EntryScript"
}

# 注意: schtasks.exe /TR は実測で約262文字を超えると警告もエラーも出さず末尾を切り捨てる
# 既知のバグがある(UNCパス+ConfigPathを含む本タスクのコマンド文字列は265文字前後になり実際に
# 発症した。".json" が欠落し前回の結果=1で失敗した)。そのため ScheduledTasks モジュールの
# Register-ScheduledTask を使う(文字列長の制約を受けない)。
$argumentList = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -ConfigPath "{1}"' -f `
    $EntryScript, $ConfigPath

$action = New-ScheduledTaskAction -Execute $PowerShellExe -Argument $argumentList
# [TimeSpan]::MaxValue はTask SchedulerのXMLスキーマが許容するDuration範囲を超えてエラーになる
# (実測: HRESULT 0x80041318 "Duration:P99999999DT23H59M59S")。実質無期限として10年を使う。
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null

Write-Output ("REGISTER-TASK: name={0} run_as={1} interval_minutes=5 config={2}" -f $TaskName, $CurrentUser, $ConfigPath)
