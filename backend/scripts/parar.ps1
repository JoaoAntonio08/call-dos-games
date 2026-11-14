# Desliga a API e o túnel (o Postgres fica, ele é leve).
$Logs = Join-Path (Split-Path -Parent $PSScriptRoot) "logs"
foreach ($name in @("api", "tunel")) {
    $pidFile = Join-Path $Logs "$name.pid"
    if (Test-Path $pidFile) {
        try { Stop-Process -Id ([int](Get-Content $pidFile)) -Force -ErrorAction Stop; Write-Host "parei: $name" } catch { Write-Host "$name já estava desligado" }
        Remove-Item $pidFile -Force
    }
}
