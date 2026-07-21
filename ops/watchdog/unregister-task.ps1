# ops/watchdog/unregister-task.ps1
#
# task_153 Phase3(Wesley): Taskvia-Watchdog-Phase0 Scheduled Task を削除する。
# 冪等: タスクが存在しない場合もエラーにしない。
#
# 実行: powershell.exe -NoProfile -ExecutionPolicy Bypass -File unregister-task.ps1

param()

$ErrorActionPreference = 'Stop'

$TaskName = 'Taskvia-Watchdog-Phase0'

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Output ("UNREGISTER-TASK: name={0} status=deleted" -f $TaskName)
} else {
    Write-Output ("UNREGISTER-TASK: name={0} status=not_found" -f $TaskName)
}
