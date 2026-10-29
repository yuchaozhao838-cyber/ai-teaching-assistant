$ErrorActionPreference = 'Continue'
$version = "33.4.11"
$zipName = "electron-v" + $version + "-win32-x64.zip"
$zip = Join-Path $env:TEMP $zipName
$expected = 115028145
$dest = "C:\Users\Lenovo\Desktop\ai\ai-teaching-assistant\node_modules\electron\dist"

# 1. official checksum list (mirrored by npmmirror)
$shaFile = Join-Path $env:TEMP "electron-SHASUMS256.txt"
& curl.exe -sL --max-time 60 -o $shaFile ("https://registry.npmmirror.com/-/binary/electron/v" + $version + "/SHASUMS256.txt")
$expectedHash = $null
if (Test-Path $shaFile) {
  foreach ($line in Get-Content $shaFile) {
    $parts = $line.Trim() -split '\s+'
    if ($parts.Count -ge 2 -and $parts[1].TrimStart('*') -eq $zipName) { $expectedHash = $parts[0] }
  }
}
Write-Host "expected hash: $expectedHash"

$mirrors = @(
  ("https://mirrors.huaweicloud.com/electron/v" + $version + "/" + $zipName),
  ("https://registry.npmmirror.com/-/binary/electron/v" + $version + "/" + $zipName)
)

if ((Test-Path $zip) -and ((Get-Item $zip).Length -ne $expected)) { Remove-Item $zip -Force }

if ((-not (Test-Path $zip)) -or ((Get-Item $zip).Length -ne $expected)) {
  foreach ($mirror in $mirrors) {
    Write-Host "=== downloading from $mirror ==="
    & curl.exe -L --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 1800 -o $zip $mirror
    if (Test-Path $zip) {
      $len = (Get-Item $zip).Length
      Write-Host "downloaded size: $len (expected $expected)"
      if ($len -eq $expected) { break }
    }
  }
}

$len = 0
if (Test-Path $zip) { $len = (Get-Item $zip).Length }
if ($len -ne $expected) { Write-Host "DOWNLOAD INCOMPLETE ($len)"; exit 1 }

if ($expectedHash) {
  $actual = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLower()
  Write-Host "actual hash:   $actual"
  if ($actual -ne $expectedHash.ToLower()) { Write-Host "HASH MISMATCH"; exit 2 }
  Write-Host "hash OK"
}

if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $dest)
Set-Content -Path "C:\Users\Lenovo\Desktop\ai\ai-teaching-assistant\node_modules\electron\path.txt" -Value "electron.exe" -NoNewline
Write-Host ("electron.exe exists: " + (Test-Path (Join-Path $dest "electron.exe")))
& (Join-Path $dest "electron.exe") --version
