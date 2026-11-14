# Roda escondido quando o Windows inicia (atalho na pasta Inicialização).
# Espera a internet, liga o servidor e tenta de novo se algo falhar. Log: backend\logs\inicio.log
$Logs = Join-Path (Split-Path -Parent $PSScriptRoot) "logs"
New-Item -ItemType Directory -Force $Logs | Out-Null
Start-Transcript -Path (Join-Path $Logs "inicio.log") -Force | Out-Null

function Online {
    try { Resolve-DnsName "api.trycloudflare.com" -ErrorAction Stop | Out-Null; return $true } catch { return $false }
}

for ($i = 0; $i -lt 60 -and -not (Online); $i++) { Start-Sleep -Seconds 5 }

$ok = $false
for ($try = 1; $try -le 3 -and -not $ok; $try++) {
    Write-Host "tentativa $try"
    try {
        & (Join-Path $PSScriptRoot "servidor.ps1")
        $ok = $true
    } catch {
        Write-Host "falhou: $($_.Exception.Message)"
        Start-Sleep -Seconds 30
    }
}

if (-not $ok) {
    # avisa na tela se não conseguiu
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("O servidor do Call dos Games não ligou. Veja backend\logs\inicio.log ou clique em 'Ligar servidor.cmd'.", "Call dos Games") | Out-Null
}
Stop-Transcript | Out-Null
