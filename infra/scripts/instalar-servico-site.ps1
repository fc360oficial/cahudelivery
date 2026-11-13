<#
.SYNOPSIS
  Cria (ou atualiza) o serviço Windows FluxoSite: o site de vendas (apps/site, Next.js) no Servidor_BI.
.DESCRIPTION
  Rodar UMA vez, como Administrador, depois de `npm install` e `npx next build` em apps\site.
  - Serviço NSSM "FluxoSite": node next start, porta 3020, só em 127.0.0.1 (quem atende de fora é o Caddy).
  - As variáveis do site ficam em apps\site\.env.production (lidas pelo próprio Next); o serviço não
    carrega nenhuma credencial.
  - Não mexe no FluxoAPI, no Caddy nem em nenhum outro serviço.
  Rodar de novo é seguro: reaplica a configuração e reinicia só o FluxoSite.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\cahudelivery\infra\scripts\instalar-servico-site.ps1
#>
param(
  [string]$Raiz = 'C:\cahudelivery',
  [int]$Porta = 3020,
  [string]$Servico = 'FluxoSite'
)

$ErrorActionPreference = 'Stop'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Abra o PowerShell como Administrador e rode de novo.' }

$nssm = 'C:\ProgramData\nssm\nssm.exe'
$node = (Get-Command node -ErrorAction Stop).Source
$site = Join-Path $Raiz 'apps\site'
$next = Join-Path $Raiz 'node_modules\next\dist\bin\next'
$logs = Join-Path $Raiz 'logs'

if (-not (Test-Path $nssm)) { throw "nssm não encontrado em $nssm" }
if (-not (Test-Path $next)) { throw "Next não instalado em $next (rode npm install em $Raiz)" }
if (-not (Test-Path (Join-Path $site '.next\BUILD_ID'))) { throw "Site sem build em $site\.next (rode npx next build em $site)" }
if (-not (Test-Path (Join-Path $site '.env.production'))) { throw "Falta $site\.env.production" }
New-Item -ItemType Directory -Force -Path $logs | Out-Null

# Porta ocupada por outro programa? (o próprio FluxoSite já instalado pode estar nela)
$existe = (Get-Service -Name $Servico -ErrorAction SilentlyContinue) -ne $null
$ocupada = Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction SilentlyContinue
if ($ocupada -and -not $existe) { throw "A porta $Porta já está em uso (PID $($ocupada[0].OwningProcess)). Escolha outra com -Porta." }

if ($existe) {
  Write-Host ">> Serviço $Servico já existe: parando para reaplicar a configuração"
  & $nssm stop $Servico | Out-Null
} else {
  Write-Host ">> Criando o serviço $Servico"
  & $nssm install $Servico $node | Out-Null
}

& $nssm set $Servico Application $node | Out-Null
& $nssm set $Servico AppParameters "`"$next`" start --port $Porta --hostname 127.0.0.1" | Out-Null
& $nssm set $Servico AppDirectory $site | Out-Null
& $nssm set $Servico AppEnvironmentExtra 'NODE_ENV=production' | Out-Null
& $nssm set $Servico DisplayName 'Fluxo Commerce - Site de vendas' | Out-Null
& $nssm set $Servico Description 'Site de vendas (Next.js) do Fluxo Commerce. Atende em 127.0.0.1; o Caddy publica.' | Out-Null
& $nssm set $Servico Start SERVICE_AUTO_START | Out-Null
& $nssm set $Servico AppStdout (Join-Path $logs 'site-out.log') | Out-Null
& $nssm set $Servico AppStderr (Join-Path $logs 'site-err.log') | Out-Null
& $nssm set $Servico AppRotateFiles 1 | Out-Null
& $nssm set $Servico AppRotateBytes 10485760 | Out-Null
& $nssm set $Servico AppExit Default Restart | Out-Null
& $nssm set $Servico AppRestartDelay 5000 | Out-Null

Write-Host ">> Iniciando $Servico"
& $nssm start $Servico | Out-Null

$ok = $false
foreach ($i in 1..30) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Porta/robots.txt" -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { }
}
if (-not $ok) { throw "O serviço subiu mas o site não respondeu em http://127.0.0.1:$Porta. Veja $logs\site-err.log" }

Write-Host ''
Write-Host "PRONTO: $Servico rodando em http://127.0.0.1:$Porta" -ForegroundColor Green
Write-Host "Logs: $logs\site-out.log e site-err.log"
Write-Host "Depois de um deploy novo do site (git pull + npx next build): nssm restart $Servico"
