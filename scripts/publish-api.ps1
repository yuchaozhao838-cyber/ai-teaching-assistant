# 输入 GitHub Token（不回显）后，用纯 API 方式发布
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ''
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host '  发布到 GitHub（纯 API 方式）' -ForegroundColor Cyan
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '需要一个 Personal Access Token（classic，勾选 repo 即可）：' -ForegroundColor Yellow
Write-Host '  https://github.com/settings/tokens/new?scopes=repo&description=AI%E8%AF%BE%E5%A0%82%E5%8A%A9%E6%89%8B' -ForegroundColor Gray
Write-Host ''
Write-Host 'Token 只在本机使用，不会上传到别处；发布完成后可到上面页面删除。' -ForegroundColor Gray
Write-Host ''

$secure = Read-Host -AsSecureString '粘贴 Token（输入时不显示）'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($token)) {
  Write-Host '没有输入 Token，已取消。' -ForegroundColor Red
  exit 1
}

$env:GH_TOKEN = $token.Trim()
$repoName = Read-Host '仓库名（直接回车用 ai-teaching-assistant）'
if ([string]::IsNullOrWhiteSpace($repoName)) { $repoName = 'ai-teaching-assistant' }

Write-Host ''
Write-Host "开始发布到 $repoName ..." -ForegroundColor Cyan
node scripts/publish-github-api.mjs --repo $repoName
$code = $LASTEXITCODE
$env:GH_TOKEN = $null

if ($code -eq 0) {
  Write-Host ''
  Write-Host '发布完成，去 GitHub 看你的仓库和 Release 吧。' -ForegroundColor Green
} else {
  Write-Host ''
  Write-Host '发布失败，看上面的错误信息。常见原因：Token 没勾 repo、Token 过期、仓库名已被占用。' -ForegroundColor Red
}
