# Cria (ou recria) a tarefa agendada que mantém o banco do Call dos Games ligado.
# Roda como o seu usuário, sem precisar de administrador:
#   - liga o Postgres (porta 5433) quando você entra no Windows
#   - se o banco cair, o Windows religa sozinho (tenta a cada minuto)
# Para tirar:  Unregister-ScheduledTask -TaskName "Call dos Games - banco" -Confirm:$false
$ErrorActionPreference = "Stop"
$Backend = Split-Path -Parent $PSScriptRoot
$PgBin = "C:\Program Files\PostgreSQL\15\bin"
$PgData = Join-Path $Backend ".pgdata"
$Logs = Join-Path $Backend "logs"
New-Item -ItemType Directory -Force $Logs | Out-Null
$Name = "Call dos Games - banco"

# o banco roda numa janela oculta (banco.vbs): não aparece e não tem como ser fechada sem querer.
# O wscript espera o banco: enquanto ele vive, a tarefa está "em execução"; se cair, o Windows religa.
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "//B //Nologo `"$PSScriptRoot\banco.vbs`"" -WorkingDirectory $Backend
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -Hidden
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "tarefa '$Name' criada"
