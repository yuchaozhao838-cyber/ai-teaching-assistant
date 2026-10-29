<#
.SYNOPSIS
  一键把本项目发布到 GitHub（建仓库 + 推代码 + 建 Release + 上传安装包）

.EXAMPLE
  # 第一次（会引导你登录 GitHub）
  powershell -ExecutionPolicy Bypass -File scripts\publish-github.ps1

.EXAMPLE
  # 指定仓库名、私有仓库、只推代码不传安装包
  powershell -ExecutionPolicy Bypass -File scripts\publish-github.ps1 -RepoName ai-tutor -Visibility private -SkipRelease
#>
param(
  [string]$RepoName = 'ai-teaching-assistant',
  [ValidateSet('public', 'private')][string]$Visibility = 'public',
  [string]$Version = 'v1.0.0',
  [switch]$SkipRelease
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Info($msg) { Write-Host "[发布] $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "[注意] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[失败] $msg" -ForegroundColor Red; exit 1 }

# ---------- 1. 检查 gh ----------
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
  Fail @"
没有找到 GitHub CLI（gh）。先装一下（任选其一）：
  1) winget install --id GitHub.cli -e
  2) scoop install gh
  3) 打开 https://cli.github.com/ 下载安装
装完重开一个窗口，再运行本脚本。
"@
}
Info "已找到 gh：$((& gh --version | Select-Object -First 1))"

# ---------- 2. 检查登录 ----------
& gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Warn '还没有登录 GitHub，接下来会打开浏览器让你授权（复制 8 位验证码输入即可）'
  & gh auth login --hostname github.com --git-protocol https --web
  if ($LASTEXITCODE -ne 0) { Fail 'GitHub 登录没有完成，请重试' }
}
$me = (& gh api user --jq '.login').Trim()
$email = (& gh api user --jq '.email // empty').Trim()
if (-not $email) { $email = "$me@users.noreply.github.com" }
if ([string]::IsNullOrWhiteSpace($me)) { Fail '拿不到 GitHub 账号信息' }
Info "当前账号：$me <$email>"

# ---------- 3. 本地 git 身份 ----------
$gitName = (& git config user.name)
$gitEmail = (& git config user.email)
if ([string]::IsNullOrWhiteSpace($gitName)) { & git config user.name $me }
if ([string]::IsNullOrWhiteSpace($gitEmail)) { & git config user.email $email }

# ---------- 4. 初始化仓库并提交 ----------
if (-not (Test-Path (Join-Path $root '.git'))) {
  Info '初始化 git 仓库'
  & git init -b main | Out-Null
}
& git add -A
$staged = (& git diff --cached --name-only | Measure-Object).Count
if ($staged -gt 0) {
  Info "提交 $staged 个文件"
  & git commit -m "chore: 发布 v1.0.0（讲解闭环 + 习题练习 + 手机版 PWA）" | Out-Null
} else {
  Info '没有新的改动需要提交'
}

# ---------- 5. 建仓库并推送 ----------
$remote = (& git remote get-url origin 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($remote)) {
  Info "在 GitHub 上创建仓库 $me/$RepoName（$Visibility）并推送"
  & gh repo create $RepoName "--$Visibility" --source . --remote origin --push --description "把课件变成知识点详解 + 重点划分 + 习题练习（Electron + Vue，含手机版 PWA）"
  if ($LASTEXITCODE -ne 0) { Fail '创建仓库或推送失败（可能是同名仓库已存在）' }
} else {
  Info "推送到已有远程：$remote"
  & git push -u origin main
}

if ($SkipRelease) {
  Info '已跳过 Release 上传（-SkipRelease）'
  exit 0
}

# ---------- 6. 建 Release 并上传安装包 ----------
$assets = @(
  'release-e44\AI-Tutor-Assistant-1.0.0-portable.exe',
  'release-e44\AI-Tutor-Assistant-1.0.0-setup.exe',
  'release-e44\AI-Tutor-Assistant-1.0.0-win64.zip'
)

$mobileZip = 'release-mobile\AI课堂助手-手机版.zip'
if (Test-Path $mobileZip) {
  $asciiDir = Join-Path $root 'tmp\release-assets'
  New-Item -ItemType Directory -Force -Path $asciiDir | Out-Null
  $asciiMobile = Join-Path $asciiDir 'AI-Tutor-Assistant-mobile-web.zip'
  Copy-Item $mobileZip $asciiMobile -Force
  $assets += $asciiMobile
}

$existing = @()
foreach ($asset in $assets) {
  if (Test-Path $asset) { $existing += (Resolve-Path $asset).Path }
  else { Warn "缺少产物，跳过：$asset" }
}
if (-not $existing.Count) { Fail '没有找到任何安装包，请先构建（见 README 第 5 节）' }

Info "上传 $($existing.Count) 个文件到 Release $Version（合计约 $([math]::Round((($existing | ForEach-Object { (Get-Item $_).Length } | Measure-Object -Sum).Sum/1MB)) MB，视网速需要几分钟）"
$notes = 'docs\release-notes-v1.0.0.md'

& gh release view $Version 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  & gh release upload $Version @existing --clobber
} else {
  & gh release create $Version @existing --title "AI 课堂助手 $Version" --notes-file $notes
}
if ($LASTEXITCODE -ne 0) { Fail 'Release 上传失败，可重跑本脚本（会覆盖同名资源）' }

$url = (& gh release view $Version --json url --jq '.url').Trim()
Info "完成！Release 地址：$url"
Info "仓库地址：https://github.com/$me/$RepoName"
