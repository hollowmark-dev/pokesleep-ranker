<#
.SYNOPSIS
  tesseract.js / tesseract.js-core を取得して docs/vendor/ に配置する。

.DESCRIPTION
  CDN不使用の方針のため、OCRライブラリ本体をリポジトリに同梱する。
  バージョンはピン留め（tesseract.js@6.0.1, tesseract.js-core@6.1.2）。
  npm が使える環境では `npm pack` で取得し、使えない環境では npm レジストリから
  直接 .tgz を Invoke-WebRequest でダウンロードする（同じ内容が手に入る）。

  配置先:
    docs/vendor/tesseract.esm.min.js
    docs/vendor/worker.min.js (+ worker.min.js.LICENSE.txt があれば)
    docs/vendor/core/tesseract-core-simd-lstm.wasm.js
    docs/vendor/core/tesseract-core-lstm.wasm.js
    docs/vendor/lang/jpn.traineddata.gz  (tessdata_fast から取得しgzip)
    docs/vendor/LICENSES/                (両パッケージ + tessdata の LICENSE)

.NOTES
  PowerShell 5.1 想定。&& / ?? は使わない。
#>

$ErrorActionPreference = 'Stop'

$ROOT = Split-Path -Parent $PSScriptRoot
$TMP = Join-Path $ROOT 'tools\tmp'
$VENDOR = Join-Path $ROOT 'docs\vendor'
$VENDOR_CORE = Join-Path $VENDOR 'core'
$VENDOR_LANG = Join-Path $VENDOR 'lang'
$VENDOR_LIC = Join-Path $VENDOR 'LICENSES'

$TESSERACT_VERSION = '6.0.1'
$CORE_VERSION = '6.1.2'

foreach ($dir in @($TMP, $VENDOR, $VENDOR_CORE, $VENDOR_LANG, $VENDOR_LIC)) {
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
}

function Get-NpmAvailable {
  try {
    $null = Get-Command npm -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

function Get-PackageTarball {
  param(
    [string]$Name,
    [string]$Version,
    [string]$DestDir
  )
  $tgzPath = Join-Path $DestDir (($Name -replace '/', '-') + "-$Version.tgz")
  # 既にある場合は再取得しない（再実行時の時間短縮）
  if (Test-Path $tgzPath) {
    Write-Host "  既に取得済み: $tgzPath"
    return $tgzPath
  }

  if (Get-NpmAvailable) {
    Write-Host "  npm pack $Name@$Version ..."
    Push-Location $DestDir
    try {
      npm pack "$Name@$Version" --silent 2>$null | Out-Null
    } finally {
      Pop-Location
    }
    # npm pack のファイル名規則: <name>-<version>.tgz （スコープなし前提）
    $produced = Join-Path $DestDir ("$($Name)-$Version.tgz")
    if (Test-Path $produced) { return $produced }
    # 稀に命名が違うことがあるので探す
    $found = Get-ChildItem $DestDir -Filter "*$Version.tgz" | Select-Object -First 1
    if ($found) { return $found.FullName }
    throw "npm pack の出力が見つかりません: $Name@$Version"
  } else {
    Write-Host "  npm が見つからないため registry から直接ダウンロード: $Name@$Version"
    $url = "https://registry.npmjs.org/$Name/-/$Name-$Version.tgz"
    Invoke-WebRequest -Uri $url -OutFile $tgzPath -UseBasicParsing
    return $tgzPath
  }
}

function Expand-Tarball {
  param([string]$TarballPath, [string]$DestDir)
  if (Test-Path $DestDir) { Remove-Item $DestDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
  tar -xzf $TarballPath -C $DestDir
}

Write-Host "== tesseract.js $TESSERACT_VERSION =="
$tessTgz = Get-PackageTarball -Name 'tesseract.js' -Version $TESSERACT_VERSION -DestDir $TMP
$tessDir = Join-Path $TMP 'tesseract.js-extracted'
Expand-Tarball -TarballPath $tessTgz -DestDir $tessDir
$tessPkg = Join-Path $tessDir 'package'

Write-Host "== tesseract.js-core $CORE_VERSION =="
$coreTgz = Get-PackageTarball -Name 'tesseract.js-core' -Version $CORE_VERSION -DestDir $TMP
$coreDir = Join-Path $TMP 'tesseract.js-core-extracted'
Expand-Tarball -TarballPath $coreTgz -DestDir $coreDir
$corePkg = Join-Path $coreDir 'package'

Write-Host "== ファイル配置 =="

# --- tesseract.js dist ---
$esm = Join-Path $tessPkg 'dist\tesseract.esm.min.js'
$worker = Join-Path $tessPkg 'dist\worker.min.js'
$workerLicense = Join-Path $tessPkg 'dist\worker.min.js.LICENSE.txt'

if (-not (Test-Path $esm)) { throw "見つかりません: $esm" }
if (-not (Test-Path $worker)) { throw "見つかりません: $worker" }

Copy-Item $esm (Join-Path $VENDOR 'tesseract.esm.min.js') -Force
Copy-Item $worker (Join-Path $VENDOR 'worker.min.js') -Force
if (Test-Path $workerLicense) {
  Copy-Item $workerLicense (Join-Path $VENDOR 'worker.min.js.LICENSE.txt') -Force
}

# --- tesseract.js-core dist ---
$coreSimdLstm = Join-Path $corePkg 'tesseract-core-simd-lstm.wasm.js'
$coreLstm = Join-Path $corePkg 'tesseract-core-lstm.wasm.js'

if (-not (Test-Path $coreSimdLstm)) { throw "見つかりません: $coreSimdLstm" }
if (-not (Test-Path $coreLstm)) { throw "見つかりません: $coreLstm" }

Copy-Item $coreSimdLstm (Join-Path $VENDOR_CORE 'tesseract-core-simd-lstm.wasm.js') -Force
Copy-Item $coreLstm (Join-Path $VENDOR_CORE 'tesseract-core-lstm.wasm.js') -Force

# --- 言語データ（日本語）---
Write-Host "== jpn.traineddata (tessdata_fast) =="
$trainedDataUrl = 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/jpn.traineddata'
$trainedDataPath = Join-Path $TMP 'jpn.traineddata'
if (-not (Test-Path $trainedDataPath)) {
  Invoke-WebRequest -Uri $trainedDataUrl -OutFile $trainedDataPath -UseBasicParsing
}

$gzOut = Join-Path $VENDOR_LANG 'jpn.traineddata.gz'
Write-Host "  gzip -> $gzOut"
$inBytes = [System.IO.File]::ReadAllBytes($trainedDataPath)
$fsOut = [System.IO.File]::Create($gzOut)
try {
  $gz = New-Object System.IO.Compression.GZipStream($fsOut, [System.IO.Compression.CompressionMode]::Compress)
  try {
    $gz.Write($inBytes, 0, $inBytes.Length)
  } finally {
    $gz.Dispose()
  }
} finally {
  $fsOut.Dispose()
}

# --- ライセンス ---
Write-Host "== LICENSES =="
$tessLicenseSrc = Join-Path $tessPkg 'LICENSE.md'
if (-not (Test-Path $tessLicenseSrc)) { $tessLicenseSrc = Join-Path $tessPkg 'LICENSE' }
$coreLicenseSrc = Join-Path $corePkg 'LICENSE'
if (-not (Test-Path $coreLicenseSrc)) { $coreLicenseSrc = Join-Path $corePkg 'LICENSE.md' }
if (Test-Path $tessLicenseSrc) {
  Copy-Item $tessLicenseSrc (Join-Path $VENDOR_LIC 'tesseract.js.LICENSE') -Force
} else {
  Write-Host "  警告: tesseract.js の LICENSE が見つかりません"
}
if (Test-Path $coreLicenseSrc) {
  Copy-Item $coreLicenseSrc (Join-Path $VENDOR_LIC 'tesseract.js-core.LICENSE') -Force
} else {
  Write-Host "  警告: tesseract.js-core の LICENSE が見つかりません"
}

# tessdata_fast (jpn.traineddata) は Apache License 2.0。
# バイナリ本体にライセンス表記は入っていないため、ここに明記して同梱する。
$tessdataLicenseText = @'
tessdata_fast (jpn.traineddata)
Source: https://github.com/tesseract-ocr/tessdata_fast
License: Apache License 2.0
https://github.com/tesseract-ocr/tessdata_fast/blob/main/LICENSE

Copyright 2016 Google Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
'@
Set-Content -Path (Join-Path $VENDOR_LIC 'tessdata_fast.LICENSE') -Value $tessdataLicenseText -Encoding utf8

Write-Host ""
Write-Host "== 検証 =="
$checkFiles = @(
  (Join-Path $VENDOR 'tesseract.esm.min.js'),
  (Join-Path $VENDOR 'worker.min.js'),
  (Join-Path $VENDOR_CORE 'tesseract-core-simd-lstm.wasm.js'),
  (Join-Path $VENDOR_CORE 'tesseract-core-lstm.wasm.js'),
  (Join-Path $VENDOR_LANG 'jpn.traineddata.gz')
)
foreach ($f in $checkFiles) {
  if (Test-Path $f) {
    $size = (Get-Item $f).Length
    Write-Host ("  OK  {0,10:N0} bytes  {1}" -f $size, $f)
  } else {
    Write-Host "  NG  見つかりません: $f"
  }
}

Write-Host ""
Write-Host "完了。docs/vendor/ を確認してください。"
