# 带超时与重试的渲染脚本。
# 本机上 Remotion 启动浏览器时偶发连接超时或卡住,这里每次最多等 $PerTryMinutes 分钟,卡住就杀掉重来。
param(
  [string]$Comp = "Sample",          # 合成 id:Sample(银行行不行)或 Drpo(论文解说)
  [string]$Out = "out/sample.mp4",
  [int]$MaxTries = 3,
  [int]$PerTryMinutes = 25,
  [int]$Concurrency = 2,
  [string]$Scale = "1",              # 输出缩放,如 0.66666667 → 1280x720
  [string]$Props = ""                # 传给合成的 props 文件(通用 Paper 合成用)
)

$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force out | Out-Null
$ok = $false

for ($i = 1; $i -le $MaxTries -and -not $ok; $i++) {
  Write-Host "[try $i/$MaxTries] $(Get-Date -Format HH:mm:ss)"
  if (Test-Path $Out) { Remove-Item $Out -Force }
  $stdout = "out/render.$i.out.log"
  $stderr = "out/render.$i.err.log"
  $argLine = "/c npx remotion render src/index.ts $Comp $Out --browser-executable=`"$edge`" --concurrency=$Concurrency --scale=$Scale" + $(if ($Props) { " --props=`"$Props`"" } else { "" })
  $p = Start-Process -FilePath "cmd.exe" -ArgumentList $argLine -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $done = $p.WaitForExit($PerTryMinutes * 60 * 1000)
  if (-not $done) {
    Write-Host "  timeout, killing process tree"
    taskkill /PID $p.Id /T /F | Out-Null
  }
  if ((Test-Path $Out) -and ((Get-Item $Out).Length -gt 100KB)) {
    $ok = $true
    Write-Host "  done: $((Get-Item $Out).Length) bytes"
  } else {
    Write-Host "  failed"
  }
  Get-Process chrome-headless-shell -ErrorAction SilentlyContinue | Stop-Process -Force
}

if (-not $ok) { Write-Host "ALL TRIES FAILED"; exit 1 }
