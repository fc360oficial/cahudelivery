<#
.SYNOPSIS
  Cria a tarefa agendada FluxoSite-RestartWatch: reinicia o serviço FluxoSite quando existir o arquivo
  C:\cahudelivery\restart-site.flag (mesmo esquema do restart-api.flag da API).
.DESCRIPTION
  Rodar UMA vez como Administrador. A tarefa roda como SYSTEM a cada minuto; se o arquivo de sinal
  existir, apaga o sinal e reinicia só o FluxoSite. Com isso o deploy do site (git pull, build, sinal)
  não precisa mais de alguém entrar no servidor. Não mexe em nenhum outro serviço.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\cahudelivery\infra\scripts\instalar-reinicio-site.ps1
#>
$ErrorActionPreference = 'Stop'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Abra o PowerShell como Administrador e rode de novo.' }

$nssm = 'C:\ProgramData\nssm\nssm.exe'
$sinal = 'C:\cahudelivery\restart-site.flag'
$log = 'C:\cahudelivery\logs\site-restart.log'
if (-not (Test-Path $nssm)) { throw "nssm não encontrado em $nssm" }

$comando = "if (Test-Path '$sinal') { Remove-Item '$sinal' -Force; & '$nssm' restart FluxoSite | Out-Null; Add-Content '$log' ((Get-Date -Format s) + ' FluxoSite reiniciado pelo sinal') }"
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "' + $comando + '"')
$gatilho = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$opcoes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'FluxoSite-RestartWatch' -Action $acao -Trigger $gatilho -Settings $opcoes -User 'SYSTEM' -RunLevel Highest -Force | Out-Null

Write-Host 'PRONTO: tarefa FluxoSite-RestartWatch criada.' -ForegroundColor Green
Write-Host "Para reiniciar o site: criar o arquivo $sinal (a tarefa reinicia em até 1 minuto)."
