<#
.SYNOPSIS
  Grava no serviço FluxoAPI o endereço do site de vendas do tenant (SITE_URL_<TENANT>).
.DESCRIPTION
  A API usa essa variável para devolver o cliente ao site depois da confirmação do cartão no banco (3DS).
  Rodar como Administrador. O script LÊ as variáveis que o serviço já tem, acrescenta (ou atualiza) só
  a SITE_URL_<TENANT> e grava a lista inteira de volta: nenhuma outra variável é alterada nem mostrada.
  Não reinicia a API: o reinício é feito depois pelo arquivo de sinal (restart-api.flag).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\cahudelivery\infra\scripts\configurar-site-na-api.ps1 -Url https://cahuloja.duckdns.org
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^https://[a-z0-9.-]+$')][string]$Url,
  [ValidatePattern('^[a-z][a-z0-9_]{1,20}$')][string]$Tenant = 'cahu',
  [string]$Servico = 'FluxoAPI'
)

$ErrorActionPreference = 'Stop'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Abra o PowerShell como Administrador e rode de novo.' }

$nssm = 'C:\ProgramData\nssm\nssm.exe'
if (-not (Test-Path $nssm)) { throw "nssm não encontrado em $nssm" }

$nome = 'SITE_URL_' + $Tenant.ToUpper()

# O nssm escreve em UTF-16; ler assim evita lixo entre os caracteres.
$anterior = [Console]::OutputEncoding
[Console]::OutputEncoding = [Text.Encoding]::Unicode
try { $atuais = @(& $nssm get $Servico AppEnvironmentExtra) } finally { [Console]::OutputEncoding = $anterior }
if ($LASTEXITCODE -ne 0) { throw "Não consegui ler as variáveis do serviço $Servico." }

$linhas = @($atuais | ForEach-Object { "$_".Trim() } | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' })
if ($linhas.Count -lt 3) { throw "Li só $($linhas.Count) variáveis do $Servico; esperava as de banco e JWT. Não alterei nada." }

$outras = @($linhas | Where-Object { $_ -notmatch ("^" + [regex]::Escape($nome) + "=") })
$novas = $outras + "$nome=$Url"

Write-Host ">> $Servico tem $($linhas.Count) variáveis: $(($linhas | ForEach-Object { $_.Split('=')[0] }) -join ', ')"
& $nssm set $Servico AppEnvironmentExtra @novas | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'O nssm recusou a gravação. Nada foi alterado.' }

[Console]::OutputEncoding = [Text.Encoding]::Unicode
try { $depois = @(& $nssm get $Servico AppEnvironmentExtra | ForEach-Object { "$_".Trim() } | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' }) } finally { [Console]::OutputEncoding = $anterior }
if ($depois.Count -ne $novas.Count) { throw "Conferência falhou: gravei $($novas.Count) variáveis e li $($depois.Count). Confira com: nssm get $Servico AppEnvironmentExtra" }

Write-Host ''
Write-Host "PRONTO: $nome=$Url gravada no $Servico ($($depois.Count) variáveis no total)." -ForegroundColor Green
Write-Host 'A API só passa a usar depois do reinício (arquivo restart-api.flag).'
