# Liga o servidor da turma neste PC: banco, API e túnel da Cloudflare.
# Se o endereço do túnel mudou, atualiza a Vercel e republica o site sozinho.
# Uso: clique duas vezes em "Ligar servidor.cmd" (ou rode: powershell -ExecutionPolicy Bypass -File scripts\servidor.ps1)

$ErrorActionPreference = "Stop"
$Backend = Split-Path -Parent $PSScriptRoot
$Project = Split-Path -Parent $Backend
$Logs = Join-Path $Backend "logs"
$PgBin = "C:\Program Files\PostgreSQL\15\bin"
$PgData = Join-Path $Backend ".pgdata"
$Port = 8765
New-Item -ItemType Directory -Force $Logs | Out-Null

function Say($msg) { Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] " + $msg) }

function Stop-Saved($name) {
    $pidFile = Join-Path $Logs "$name.pid"
    if (Test-Path $pidFile) {
        $old = Get-Content $pidFile -ErrorAction SilentlyContinue
        if ($old) {
            try { Stop-Process -Id ([int]$old) -Force -ErrorAction Stop; Say "parei o $name antigo" } catch {}
        }
        Remove-Item $pidFile -Force
    }
}

# ---------------------------------------------------------------- 1. banco
& "$PgBin\pg_ctl.exe" status -D $PgData *> $null
if ($LASTEXITCODE -ne 0) {
    Say "ligando o Postgres (porta 5433)..."
    & "$PgBin\pg_ctl.exe" start -D $PgData -l (Join-Path $Logs "postgres.log") -o "-p 5433 -c listen_addresses=127.0.0.1" -w | Out-Null
}
Say "Postgres ok"

# ---------------------------------------------------------------- 2. túnel
Stop-Saved "tunel"
Stop-Saved "api"
$tunnelLog = Join-Path $Logs "tunel.log"
Remove-Item $tunnelLog -Force -ErrorAction SilentlyContinue
$tunnel = Start-Process -FilePath (Join-Path $Backend "tools\cloudflared.exe") `
    -ArgumentList @("tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:$Port", "--logfile", $tunnelLog) `
    -WindowStyle Hidden -PassThru
$tunnel.Id | Set-Content (Join-Path $Logs "tunel.pid")
Say "abrindo o túnel..."
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $tunnelLog) {
        $m = Select-String -Path $tunnelLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) { $url = $m.Matches[0].Value }
    }
}
if (-not $url) { throw "O túnel não respondeu. Veja $tunnelLog" }
Say "túnel: $url"

# ---------------------------------------------------------------- 3. API
$env:CDG_ENV_FILE = ".env.prod"
$env:PUBLIC_URL = $url
$api = Start-Process -FilePath (Join-Path $Backend ".venv\Scripts\python.exe") `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$Port", "--workers", "1", "--proxy-headers") `
    -WorkingDirectory $Backend -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $Logs "api.log") -RedirectStandardError (Join-Path $Logs "api.err.log")
$api.Id | Set-Content (Join-Path $Logs "api.pid")

$ok = $false
for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
    Start-Sleep -Seconds 1
    try { $ok = (Invoke-RestMethod "$url/health" -TimeoutSec 5).ok } catch {}
}
if (-not $ok) { throw "A API não respondeu pelo túnel. Veja $Logs\api.err.log" }
Say "API respondendo pela internet"

# ---------------------------------------------------------------- 4. Vercel
$lastFile = Join-Path $Logs "ultimo-endereco.txt"
$last = if (Test-Path $lastFile) { (Get-Content $lastFile -Raw).Trim() } else { "" }
if ($last -ne $url) {
    Say "endereço novo: atualizando a Vercel e republicando o site (uns 2 minutos)..."
    $deployLog = Join-Path $Logs "deploy.log"
    Push-Location $Project
    $ErrorActionPreference = "Continue"
    try {
        cmd /c "npx vercel env add NEXT_PUBLIC_API_URL --environment production --value $url --force --no-sensitive >nul 2>&1"
        if ($LASTEXITCODE -ne 0) { throw "Não consegui gravar o endereço na Vercel (rode 'npx vercel login')." }
        cmd /c "npx vercel --prod --yes > ""$deployLog"" 2>&1"
        if ($LASTEXITCODE -ne 0) { throw "O deploy falhou. Veja $deployLog" }
    } finally {
        Pop-Location
        $ErrorActionPreference = "Stop"
    }
    $url | Set-Content $lastFile
    Say "site republicado"
}

Write-Host ""
Say "Tudo no ar: https://call-dos-games.vercel.app"
Say "Deixe o PC ligado enquanto a turma estiver usando. Para desligar: 'Desligar servidor.cmd'."
