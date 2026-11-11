# Instala (ou atualiza) o Gateway do ERP nesta maquina. Execute como Administrador.
# Uso:  .\install.ps1            (usa dist\BrindeGateway.exe, gerado por build.ps1)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$principalAtual = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principalAtual.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'ERRO: execute este script como Administrador (botao direito no PowerShell > Executar como administrador).' -ForegroundColor Red
    exit 1
}

$exeOrigem = Join-Path $here 'dist\BrindeGateway.exe'
if (-not (Test-Path $exeOrigem)) {
    $exeOrigem = Join-Path $here 'BrindeGateway.exe'
}
if (-not (Test-Path $exeOrigem)) {
    Write-Host 'ERRO: BrindeGateway.exe nao encontrado. Rode primeiro .\build.ps1 (ou coloque o .exe ao lado deste script).' -ForegroundColor Red
    exit 1
}

$nomeTarefa = 'BrindeGateway'
$installDir = Join-Path $env:ProgramFiles 'BrindeGateway'
$dataDir = Join-Path $env:ProgramData 'BrindeGateway'
$exeDestino = Join-Path $installDir 'BrindeGateway.exe'

# Se a tarefa estiver rodando, para antes de trocar o exe.
$existente = Get-ScheduledTask -TaskName $nomeTarefa -ErrorAction SilentlyContinue
if ($existente) {
    Stop-ScheduledTask -TaskName $nomeTarefa -ErrorAction SilentlyContinue
}

Write-Host "Copiando o programa para $installDir ..."
New-Item -ItemType Directory -Force $installDir | Out-Null
Copy-Item -Path $exeOrigem -Destination $exeDestino -Force

Write-Host "Preparando a pasta de dados $dataDir ..."
New-Item -ItemType Directory -Force $dataDir | Out-Null
New-Item -ItemType Directory -Force (Join-Path $dataDir 'logs') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $dataDir 'consultas') | Out-Null

# Permissoes: somente SYSTEM (S-1-5-18) e Administradores (S-1-5-32-544), sem heranca.
$acl = Get-Acl $dataDir
$acl.SetAccessRuleProtection($true, $false)
foreach ($regra in @($acl.Access)) { [void]$acl.RemoveAccessRule($regra) }
foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
    $conta = New-Object Security.Principal.SecurityIdentifier($sid)
    $regra = New-Object Security.AccessControl.FileSystemAccessRule(
        $conta, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($regra)
}
Set-Acl -Path $dataDir -AclObject $acl

# Config de exemplo (nao sobrescreve a existente) e consulta de exemplo.
$configDestino = Join-Path $dataDir 'config.toml'
if (-not (Test-Path $configDestino)) {
    Copy-Item (Join-Path $here 'config.exemplo.toml') $configDestino
    Write-Host 'Criado config.toml de exemplo (precisa ser editado).'
} else {
    Write-Host 'config.toml ja existe: mantido sem alteracoes.'
}
$sqlExemplo = Join-Path $here 'consultas\faixas_custo.exemplo.sql'
$sqlDestino = Join-Path $dataDir 'consultas\faixas_custo.exemplo.sql'
if (Test-Path $sqlExemplo) { Copy-Item $sqlExemplo $sqlDestino -Force }

# Tarefa agendada (substitui a existente).
Write-Host "Registrando a tarefa agendada '$nomeTarefa' (07:45, 12:45 e 16:45)..."
$acao = New-ScheduledTaskAction -Execute $exeDestino -Argument 'run' -WorkingDirectory $installDir
$gatilhos = @(
    (New-ScheduledTaskTrigger -Daily -At '07:45'),
    (New-ScheduledTaskTrigger -Daily -At '12:45'),
    (New-ScheduledTaskTrigger -Daily -At '16:45')
)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $nomeTarefa -Action $acao -Trigger $gatilhos `
    -Principal $principal -Settings $config `
    -Description 'Envia dados do ERP para o painel (Supabase) tres vezes ao dia.' -Force | Out-Null

Write-Host ''
Write-Host 'Instalacao concluida.' -ForegroundColor Green
Write-Host ''
Write-Host 'Proximos passos (em um PowerShell como Administrador):'
Write-Host "  1. & '$exeDestino' set-secret sqlserver     (senha do usuario gateway_leitura)"
Write-Host "  2. & '$exeDestino' set-secret supabase      (senha do gateway_writer)"
Write-Host "  3. Edite $configDestino (servidor, banco, projeto Supabase, consulta)"
Write-Host "  4. & '$exeDestino' test"
Write-Host "  5. Opcional: Start-ScheduledTask -TaskName $nomeTarefa   (executa agora)"
