# Publica a branch seguranca-2026-11-16 (bibliotecas atualizadas, IP confiavel na API,
# HSTS e limite da busca no site) no Servidor_BI.
#
# Por que um script: a atualizacao troca a biblioteca de imagens (sharp), cujo arquivo fica
# preso pela API enquanto ela roda. Por isso a API e o site PARAM durante a instalacao
# (app, site e retaguarda ficam fora do ar por alguns minutos).
#
# RODAR NO SERVIDOR, EM POWERSHELL COMO ADMINISTRADOR:
#   powershell -ExecutionPolicy Bypass -File C:\cahudelivery-seg\infra\scripts\publicar-seguranca-2026-11-16.ps1
#
# Se algum passo falhar, o script para e mostra como voltar ao que estava.

$ErrorActionPreference = 'Stop'
$raiz   = 'C:\cahudelivery'
$branch = 'seguranca-2026-11-16'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Abra o PowerShell como Administrador (precisa parar e iniciar os servicos).' }

function Passo($texto) { Write-Host "`n== $texto" -ForegroundColor Cyan }
function Rodar($descricao, [scriptblock]$comando) {
    & $comando
    if ($LASTEXITCODE -ne 0) { throw "$descricao falhou (codigo $LASTEXITCODE)" }
}
function Esperar($nome, $url, $cabecalhos) {
    foreach ($i in 1..40) {
        try {
            $r = Invoke-WebRequest -Uri $url -Headers $cabecalhos -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -eq 200) { Write-Host "$nome respondeu 200" -ForegroundColor Green; return }
        } catch { }
        Start-Sleep -Seconds 3
    }
    throw "$nome nao respondeu em 2 minutos"
}

Set-Location $raiz
$antes = (git rev-parse HEAD).Trim()
$parou = $false

try {
    Passo "Trazendo a branch $branch para a main (estava em $antes)"
    if ((git status --porcelain --untracked-files=no)) { throw 'Ha arquivos versionados alterados em C:\cahudelivery. Resolva antes de publicar.' }
    Rodar 'git merge' { git merge --ff-only $branch }

    Passo 'Parando o site e a API'
    Stop-Service FluxoSite
    Stop-Service FluxoAPI
    $parou = $true

    Passo 'Instalando as bibliotecas (1 a 3 minutos)'
    Rodar 'npm ci' { npm.cmd ci }

    Passo 'Compilando a API'
    Rodar 'build da API' { npm.cmd run build --workspace apps/api }

    Passo 'Iniciando a API'
    Start-Service FluxoAPI
    Esperar 'API' 'http://127.0.0.1:3000/v1/config' @{ 'X-Tenant' = 'cahu' }

    Passo 'Compilando o site (precisa da API no ar)'
    Rodar 'build do site' { npm.cmd run build --workspace apps/site }

    Passo 'Iniciando o site'
    Start-Service FluxoSite
    Esperar 'Site' 'http://127.0.0.1:3020/robots.txt' @{}

    Passo 'Compilando a retaguarda'
    Rodar 'build da retaguarda' { npm.cmd run build --workspace apps/admin }

    Passo 'Conferencia final'
    Esperar 'Site pelo endereco publico' 'https://cahuloja.duckdns.org/robots.txt' @{}
    Esperar 'API pelo endereco publico' 'https://cahudelivery.duckdns.org/v1/config' @{ 'X-Tenant' = 'cahu' }
    Write-Host "`nPUBLICADO. Avise o Claude para conferir o resto." -ForegroundColor Green
}
catch {
    Write-Host "`nFALHOU: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Para voltar ao que estava, rode nesta mesma janela, nesta ordem:' -ForegroundColor Yellow
    Write-Host "  git -C $raiz reset --hard $antes"
    Write-Host "  cd $raiz; npm.cmd ci"
    Write-Host '  npm.cmd run build --workspace apps/api; Start-Service FluxoAPI'
    Write-Host '  npm.cmd run build --workspace apps/site; Start-Service FluxoSite'
    Write-Host '  npm.cmd run build --workspace apps/admin'
    if ($parou) { Write-Host 'ATENCAO: o site e a API podem estar PARADOS agora.' -ForegroundColor Red }
    exit 1
}
