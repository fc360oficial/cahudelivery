# Publica o site de vendas (apps/site, servico FluxoSite) com o codigo da main.
# RODAR NO SERVIDOR, EM POWERSHELL COMO ADMINISTRADOR:
#   powershell -ExecutionPolicy Bypass -File C:\cahudelivery\infra\scripts\publicar-site.ps1
#
# 1. atualiza C:\cahudelivery com a main
# 2. guarda a versao atual compilada (.next) e compila a nova
# 3. se a compilacao falhar, devolve a versao antiga e o site continua como estava
# 4. reinicia o FluxoSite e confere se responde

$ErrorActionPreference = 'Stop'
$raiz = 'C:\cahudelivery'
$site = "$raiz\apps\site"
$copia = "$site\.next-anterior"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Abra o PowerShell como Administrador (precisa reiniciar o FluxoSite).' }
function Passo($texto) { Write-Host "`n== $texto" -ForegroundColor Cyan }

Set-Location $raiz
try {
    Passo 'Atualizando o codigo'
    if ((git status --porcelain --untracked-files=no)) { throw 'Ha arquivos versionados alterados em C:\cahudelivery. Resolva antes de publicar.' }
    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { throw 'git pull falhou' }

    Passo 'Guardando a versao atual do site'
    if (Test-Path $copia) { Remove-Item $copia -Recurse -Force }
    if (Test-Path "$site\.next") { Copy-Item "$site\.next" $copia -Recurse }

    Passo 'Compilando o site'
    npm.cmd run build --workspace apps/site
    if ($LASTEXITCODE -ne 0) {
        if (Test-Path $copia) {
            Remove-Item "$site\.next" -Recurse -Force -ErrorAction SilentlyContinue
            Rename-Item $copia '.next'
        }
        throw 'A compilacao falhou; a versao anterior foi devolvida e o site continua no ar como estava.'
    }

    Passo 'Reiniciando o FluxoSite'
    Restart-Service FluxoSite
    $ok = $false
    foreach ($i in 1..30) {
        try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3020/' -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch {}
        Start-Sleep -Seconds 2
    }
    if (-not $ok) { throw 'O site nao respondeu em 1 minuto. Veja o log do servico FluxoSite.' }
    if (Test-Path $copia) { Remove-Item $copia -Recurse -Force }
    Write-Host "`nSITE PUBLICADO." -ForegroundColor Green
}
catch {
    Write-Host "`nFALHOU: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Mande o print desta janela para o Claude.' -ForegroundColor Yellow
    exit 1
}
