# Gera gateway\dist\BrindeGateway.exe (um unico arquivo, com console).
# Uso (PowerShell, na pasta gateway):  .\build.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$venv = Join-Path $here '.venv'
$py = Join-Path $venv 'Scripts\python.exe'
if (-not (Test-Path $py)) {
    Write-Host 'Criando ambiente Python (.venv)...'
    python -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel criar o ambiente. Instale o Python 3.12 ou mais novo.' }
}

Write-Host 'Instalando dependencias e PyInstaller (somente dentro de gateway\.venv)...'
& $py -m pip install --quiet --upgrade pip
& $py -m pip install --quiet "psycopg[binary]>=3.2" "pyodbc>=5" pyinstaller
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar as dependencias.' }

# O __main__.py usa imports relativos; o PyInstaller precisa de um script de entrada simples.
$buildDir = Join-Path $here 'build'
New-Item -ItemType Directory -Force $buildDir | Out-Null
$launcher = Join-Path $buildDir 'entrada.py'
Set-Content -Path $launcher -Encoding ascii -Value "import sys`nfrom brinde_gateway.cli import main`nsys.exit(main())`n"

Write-Host 'Gerando BrindeGateway.exe...'
& $py -m PyInstaller --noconfirm --clean --onefile --console `
    --name BrindeGateway `
    --paths (Join-Path $here 'src') `
    --distpath (Join-Path $here 'dist') `
    --workpath (Join-Path $buildDir 'work') `
    --specpath $buildDir `
    $launcher
if ($LASTEXITCODE -ne 0) { throw 'Falha ao gerar o executavel.' }

Write-Host ''
Write-Host "Pronto: $(Join-Path $here 'dist\BrindeGateway.exe')"
