# Remove o Gateway do ERP desta maquina. Execute como Administrador.
$ErrorActionPreference = 'Stop'

$principalAtual = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principalAtual.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'ERRO: execute este script como Administrador (botao direito no PowerShell > Executar como administrador).' -ForegroundColor Red
    exit 1
}

$nomeTarefa = 'BrindeGateway'
$installDir = Join-Path $env:ProgramFiles 'BrindeGateway'
$dataDir = Join-Path $env:ProgramData 'BrindeGateway'

if (Get-ScheduledTask -TaskName $nomeTarefa -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $nomeTarefa -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $nomeTarefa -Confirm:$false
    Write-Host "Tarefa '$nomeTarefa' removida."
} else {
    Write-Host "Tarefa '$nomeTarefa' nao existe."
}

if (Test-Path $installDir) {
    Remove-Item -Recurse -Force $installDir
    Write-Host "Programa removido de $installDir."
}

if (Test-Path $dataDir) {
    $resp = Read-Host "Apagar tambem a configuracao, os segredos e os logs em $dataDir ? (s/N)"
    if ($resp -match '^(s|sim|y|yes)$') {
        Remove-Item -Recurse -Force $dataDir
        Write-Host "Pasta $dataDir apagada."
    } else {
        Write-Host "Pasta $dataDir mantida."
    }
}
Write-Host 'Concluido.'
