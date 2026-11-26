# 批量渲染静帧用于检查布局,每张带超时与重试(本机浏览器启动不稳定)。
#   .\render-stills.ps1 -Comp Drpo -Frames 443,1320 -Prefix chk
param(
  [string]$Comp = "Drpo",
  [string]$Frames,   # 逗号分隔,如 "443,1320"
  [string]$Prefix = "chk",
  [int]$MaxTries = 3,
  [int]$PerTryMinutes = 5
)

$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force out | Out-Null

foreach ($f in ($Frames -split ',' | ForEach-Object { [int]$_.Trim() })) {
  $out = "out/${Prefix}_$f.png"
  if (Test-Path $out) { Remove-Item $out -Force }
  $ok = $false
  for ($i = 1; $i -le $MaxTries -and -not $ok; $i++) {
    $argLine = "/c npx remotion still src/index.ts $Comp $out --frame=$f --browser-executable=`"$edge`""
    $p = Start-Process -FilePath "cmd.exe" -ArgumentList $argLine -PassThru -WindowStyle Hidden `
          -RedirectStandardOutput "out/still.out.log" -RedirectStandardError "out/still.err.log"
    if (-not $p.WaitForExit($PerTryMinutes * 60 * 1000)) { taskkill /PID $p.Id /T /F | Out-Null }
    $ok = Test-Path $out
    Get-Process chrome-headless-shell -ErrorAction SilentlyContinue | Stop-Process -Force
  }
  Write-Host "frame $f : $(if ($ok) { 'ok' } else { 'FAILED' })"
}
Write-Host "ALL DONE"
