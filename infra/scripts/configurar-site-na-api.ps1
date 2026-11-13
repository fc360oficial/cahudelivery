﻿<#
.SYNOPSIS
  Grava no serviço FluxoAPI o endereço do site de vendas do tenant (SITE_URL_<TENANT>).
.DESCRIPTION
  A API usa essa variável para devolver o cliente ao site depois da confirmação do cartão no banco (3DS).
  Rodar como Administrador. O script LÊ as variáveis que o serviço já tem (direto do registro do
  Windows, onde o NSSM as guarda), acrescenta (ou atualiza) só a SITE_URL_<TENANT> e grava a lista de
  volta: nenhuma outra variável é alterada nem mostrada na tela.
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

$chave = "HKLM:\SYSTEM\CurrentControlSet\Services\$Servico\Parameters"
$campo = 'AppEnvironmentExtra'
if (-not (Test-Path $chave)) { throw "Não achei a configuração do serviço $Servico em $chave." }

$nome = 'SITE_URL_' + $Tenant.ToUpper()
$ler = { @((Get-ItemProperty -Path $chave -Name $campo -ErrorAction Stop).$campo | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' }) }

$linhas = & $ler
if ($linhas.Count -lt 3) { throw "Li só $($linhas.Count) variáveis do $Servico; esperava as de banco e JWT. Não alterei nada." }

# Cópia de segurança das variáveis atuais, só na pasta do Administrador (tem senhas: não copiar para outro lugar).
$copia = Join-Path $env:USERPROFILE ("fluxoapi-variaveis-antes-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".txt")
[IO.File]::WriteAllLines($copia, [string[]]$linhas)
Write-Host ">> Cópia de segurança das variáveis atuais em $copia"
Write-Host ">> $Servico tem $($linhas.Count) variáveis: $(($linhas | ForEach-Object { $_.Split('=')[0] }) -join ', ')"

$outras = @($linhas | Where-Object { $_ -notmatch ("^" + [regex]::Escape($nome) + "=") })
$novas = [string[]]($outras + "$nome=$Url")
Set-ItemProperty -Path $chave -Name $campo -Value $novas -Type MultiString

# Conferência: cada variável que existia tem que continuar idêntica. Se alguma mudou, desfaz na hora.
$depois = & $ler
$perdidas = @($outras | Where-Object { $depois -cnotcontains $_ })
if ($depois.Count -ne $novas.Count -or $perdidas.Count -gt 0 -or ($depois -cnotcontains "$nome=$Url")) {
  Set-ItemProperty -Path $chave -Name $campo -Value ([string[]]$linhas) -Type MultiString
  throw "Conferência falhou depois da gravação. Voltei as variáveis ao que eram; a cópia está em $copia. NÃO reinicie a API e avise."
}

Write-Host ''
Write-Host "PRONTO: $nome=$Url gravada no $Servico ($($depois.Count) variáveis no total)." -ForegroundColor Green
Write-Host 'A API só passa a usar depois do reinício (arquivo restart-api.flag).'
