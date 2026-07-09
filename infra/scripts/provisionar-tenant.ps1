<#
.SYNOPSIS
  Provisiona um novo tenant (distribuidora) do Fluxo Commerce.
.DESCRIPTION
  1. Garante o banco de controle (fluxo_control) e aplica migrações de 11 - SQL/control
  2. Cria o banco do tenant (fluxo_t_<slug>) e aplica migrações de 11 - SQL/tenant
  3. Registra o tenant no banco de controle
.EXAMPLE
  .\provisionar-tenant.ps1 -Slug cahu -Nome "CAHU Distribuidora" -AppNome "CAHU Delivery"
#>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z][a-z0-9_]{1,20}$')][string]$Slug,
  [Parameter(Mandatory = $true)][string]$Nome,
  [Parameter(Mandatory = $true)][string]$AppNome,
  [string]$PgHost = 'localhost',
  [int]$PgPorta = 5432,
  [string]$PgUsuario = 'postgres'
)

$ErrorActionPreference = 'Stop'
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
if (-not (Test-Path $psql)) { throw "psql não encontrado em $psql — instale o PostgreSQL 16." }
if (-not $env:PGPASSWORD) { throw 'Defina $env:PGPASSWORD antes de executar.' }

$raizSql = Join-Path $PSScriptRoot '..\..\..\11 - SQL'
$bancoTenant = "fluxo_t_$Slug"
$conexao = @('-h', $PgHost, '-p', $PgPorta, '-U', $PgUsuario, '-v', 'ON_ERROR_STOP=1', '-q')

function Invoke-Psql([string]$Banco, [string[]]$Args) {
  & $psql @conexao -d $Banco @Args
  if ($LASTEXITCODE -ne 0) { throw "psql falhou (banco: $Banco)" }
}

# 1. Banco de controle
$existe = & $psql @conexao -d postgres -tAc "select 1 from pg_database where datname='fluxo_control'"
if ($existe -ne '1') {
  Write-Host '>> Criando banco fluxo_control'
  Invoke-Psql 'postgres' @('-c', 'create database fluxo_control')
}
Get-ChildItem (Join-Path $raizSql 'control') -Filter '*.sql' | Sort-Object Name | ForEach-Object {
  Write-Host ">> control: $($_.Name)"
  Invoke-Psql 'fluxo_control' @('-f', $_.FullName)
}

# 2. Banco do tenant
$existe = & $psql @conexao -d postgres -tAc "select 1 from pg_database where datname='$bancoTenant'"
if ($existe -ne '1') {
  Write-Host ">> Criando banco $bancoTenant"
  Invoke-Psql 'postgres' @('-c', "create database $bancoTenant")
}
Get-ChildItem (Join-Path $raizSql 'tenant') -Filter '*.sql' | Sort-Object Name | ForEach-Object {
  Write-Host ">> tenant($Slug): $($_.Name)"
  Invoke-Psql $bancoTenant @('-f', $_.FullName)
}

# 3. Registro no controle (idempotente)
$versao = (Get-ChildItem (Join-Path $raizSql 'tenant') -Filter '*.sql' | Sort-Object Name | Select-Object -Last 1).BaseName.Split('_')[0]
$sql = @"
insert into tenants (slug, nome_fantasia, app_nome)
values ('$Slug', '$($Nome -replace "'","''")', '$($AppNome -replace "'","''")')
on conflict (slug) do nothing;
insert into tenant_bancos (tenant_id, host, porta, banco, usuario, senha_cifrada, versao_schema)
select id, '$PgHost', $PgPorta, '$bancoTenant', '$PgUsuario', 'DEV-SEM-CIFRA', '$versao'
from tenants where slug = '$Slug'
on conflict (tenant_id) do update set versao_schema = '$versao', atualizado_em = now();
insert into tenant_temas (tenant_id) select id from tenants where slug = '$Slug' on conflict do nothing;
"@
Invoke-Psql 'fluxo_control' @('-c', $sql)

Write-Host ">> Tenant '$Slug' provisionado com sucesso (banco: $bancoTenant, schema v$versao)"
