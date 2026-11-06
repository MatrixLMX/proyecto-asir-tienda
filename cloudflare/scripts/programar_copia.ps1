# Programa una copia diaria (npm run copia) a las 22:00 para el usuario actual.
# Si el PC está apagado a esa hora, se hace al encenderlo. Para quitarla:
#   Unregister-ScheduledTask -TaskName "Copia tienda"
$dir = Split-Path -Parent $PSScriptRoot
$accion = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c npm run copia >> backups\copia.log 2>&1" -WorkingDirectory $dir
$cuando = New-ScheduledTaskTrigger -Daily -At 22:00
$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
$quien = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "Copia tienda" -Action $accion -Trigger $cuando -Settings $ajustes -Principal $quien -Description "Copia diaria de la base de datos de la tienda" -Force | Out-Null
Write-Output "Copia programada cada día a las 22:00. Se guarda en $dir\backups"
