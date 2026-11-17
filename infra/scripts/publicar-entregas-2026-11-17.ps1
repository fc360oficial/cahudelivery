# Publica o Fluxo Entregas (fase 1) no Servidor_BI: migracoes 041 a 044, API e retaguarda.
# O codigo ja esta na main (commit af094fa). O app e o site do cliente NAO mudam.
#
# RODAR NO SERVIDOR, EM POWERSHELL COMO ADMINISTRADOR:
#   powershell -ExecutionPolicy Bypass -File C:\cahudelivery\infra\scripts\publicar-entregas-2026-11-17.ps1
#
# O que faz, nesta ordem:
#   1. copia de seguranca do banco de cada distribuidora (C:\cahudelivery\antes-044-<banco>.dump)
#   2. aplica as migracoes 041, 042, 043 e 044 (todas podem rodar de novo sem estragar nada)
#   3. compila e reinicia a API (fica fora do ar uns 20 segundos)
#   4. compila a retaguarda (entra no ar sozinha)
#   5. confere se a API e as rotas novas respondem
# Se algum passo falhar, o script para e mostra como voltar ao que estava.

$ErrorActionPreference = 'Stop'
$raiz = 'C:\cahudelivery'
$pgBin = 'C:\PostgreSQL\16\bin'
$migracoes = '041_notas_entrega.sql', '042_entregas_cadastros.sql', '043_entregas_cargas.sql', '044_entregas_motorista.sql'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Abra o PowerShell como Administrador (precisa reiniciar a API).' }

function Passo($texto) { Write-Host "`n== $texto" -ForegroundColor Cyan }
function Rodar($descricao, [scriptblock]$comando) {
    & $comando
    if ($LASTEXITCODE -ne 0) { throw "$descricao falhou (codigo $LASTEXITCODE)" }
}
function Esperar($nome, $url, $cabecalhos, $statusEsperado = 200) {
    foreach ($i in 1..40) {
        try {
            $r = Invoke-WebRequest -Uri $url -Headers $cabecalhos -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -eq $statusEsperado) { Write-Host "$nome respondeu $statusEsperado" -ForegroundColor Green; return }
        } catch {
            $codigo = $_.Exception.Response.StatusCode.value__
            if ($codigo -eq $statusEsperado) { Write-Host "$nome respondeu $statusEsperado" -ForegroundColor Green; return }
        }
        Start-Sleep -Seconds 3
    }
    throw "$nome nao respondeu $statusEsperado em 2 minutos"
}

# Senha e usuario do banco: os mesmos que a API usa (parametros do servico FluxoAPI no NSSM).
$param = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\FluxoAPI\Parameters'
$amb = @{}
foreach ($kv in $param.AppEnvironmentExtra) { $i = $kv.IndexOf('='); if ($i -gt 0) { $amb[$kv.Substring(0, $i)] = $kv.Substring($i + 1) } }
if (-not $amb['DB_PASSWORD']) { throw 'DB_PASSWORD nao encontrado no servico FluxoAPI.' }
$env:PGPASSWORD = $amb['DB_PASSWORD']
$hostDb = if ($amb['DB_HOST']) { $amb['DB_HOST'] } else { '127.0.0.1' }
$portaDb = if ($amb['DB_PORT']) { $amb['DB_PORT'] } else { '5432' }
$usuarioDb = if ($amb['DB_USER']) { $amb['DB_USER'] } else { 'postgres' }
$con = @('-h', $hostDb, '-p', $portaDb, '-U', $usuarioDb)

Set-Location $raiz
$dumps = @()
$reiniciou = $false

try {
    Passo 'Conferindo o codigo'
    if ((git status --porcelain --untracked-files=no)) { throw 'Ha arquivos versionados alterados em C:\cahudelivery. Resolva antes de publicar.' }
    foreach ($m in $migracoes) { if (-not (Test-Path "$raiz\infra\sql\tenant\$m")) { throw "Migracao $m nao encontrada (a main esta atualizada?)" } }

    Passo 'Bancos das distribuidoras'
    $bancos = & "$pgBin\psql.exe" @con -d fluxo_control -At -c 'select distinct banco from tenant_bancos order by banco'
    if ($LASTEXITCODE -ne 0 -or -not $bancos) { throw 'Nao consegui listar os bancos em fluxo_control.tenant_bancos' }
    $bancos = @($bancos | Where-Object { $_ })
    Write-Host ($bancos -join ', ')

    foreach ($banco in $bancos) {
        Passo "Copia de seguranca de $banco"
        $arquivo = "$raiz\antes-044-$banco.dump"
        Rodar "pg_dump $banco" { & "$pgBin\pg_dump.exe" @con -Fc -f $arquivo $banco }
        $dumps += $arquivo
        Write-Host "$arquivo ($([math]::Round((Get-Item $arquivo).Length / 1MB, 1)) MB)"

        foreach ($m in $migracoes) {
            Passo "$banco : $m"
            Rodar "$m em $banco" { & "$pgBin\psql.exe" @con -d $banco -v ON_ERROR_STOP=1 -q --single-transaction -f "$raiz\infra\sql\tenant\$m" }
        }
        $feitas = & "$pgBin\psql.exe" @con -d $banco -At -c "select string_agg(versao, ',' order by versao) from schema_migrations where versao in ('041','042','043','044')"
        if ($feitas -ne '041,042,043,044') { throw "Em $banco as migracoes registradas sao: $feitas" }
        Write-Host "$banco com as migracoes 041 a 044" -ForegroundColor Green
    }

    Passo 'Compilando a API'
    Rodar 'build da API' { npm.cmd run build --workspace apps/api }

    Passo 'Reiniciando a API'
    $reiniciou = $true
    Restart-Service FluxoAPI
    Esperar 'API' 'http://127.0.0.1:3000/v1/config' @{ 'X-Tenant' = 'cahu' }
    # Rotas novas: sem login tem de responder 401 (se responder 404 a API nao subiu com o codigo novo).
    Esperar 'Rota do motorista' 'http://127.0.0.1:3000/v1/motorista/carga' @{ 'X-Tenant' = 'cahu' } 401
    Esperar 'Rota das cargas' 'http://127.0.0.1:3000/v1/admin/entregas/cargas' @{ 'X-Tenant' = 'cahu' } 401

    Passo 'Compilando a retaguarda'
    Rodar 'build da retaguarda' { npm.cmd run build --workspace apps/admin }

    Passo 'Conferencia final'
    Esperar 'API pelo endereco publico' 'https://cahudelivery.duckdns.org/v1/config' @{ 'X-Tenant' = 'cahu' }
    Write-Host "`nPUBLICADO. Abra https://cahudelivery.duckdns.org/solucoes (Ctrl+F5) e avise o Claude." -ForegroundColor Green
}
catch {
    Write-Host "`nFALHOU: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Nada foi apagado. As migracoes so acrescentam tabelas e colunas; a API e a retaguarda antigas continuam funcionando com elas.' -ForegroundColor Yellow
    if ($dumps.Count) { Write-Host "Copias de seguranca: $($dumps -join ', ')" -ForegroundColor Yellow }
    if ($reiniciou) {
        Write-Host 'Se a API nao voltou, rode: Get-Content C:\cahudelivery\logs\api-*.log -Tail 50' -ForegroundColor Yellow
    }
    Write-Host 'Mande o print desta janela para o Claude.' -ForegroundColor Yellow
    exit 1
}
finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
