# Registra una tarea diaria en el Programador de Tareas de Windows que ejecuta
# el scheduler del content-bot (genera el reel del día y lo deja en la cola).
#
# Uso:   powershell -ExecutionPolicy Bypass -File scripts\install-schedule.ps1 -Time "09:00"
# Quitar: Unregister-ScheduledTask -TaskName "ContentBot" -Confirm:$false

param(
  [string]$Time = "09:00",
  [string]$TaskName = "ContentBot"
)

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $projectDir "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# Comando: ir al proyecto y correr el scheduler, guardando log.
$cmd = "Set-Location '$projectDir'; npm run schedule *>> '$logDir\schedule.log'"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -Command `"$cmd`""
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description "Genera la pieza diaria de contenido (content-bot)" -Force | Out-Null

Write-Host "OK Tarea '$TaskName' registrada: corre todos los dias a las $Time."
Write-Host "   Log: $logDir\schedule.log"
Write-Host "   Probar ahora: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "   Quitar:       Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
