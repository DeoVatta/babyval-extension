# TEVI CS BOT - AUTO VERSION UPDATE SCRIPT
# Reads version from version.js and updates ALL files automatically
# Usage: .\update-version.ps1
# Commits and pushes automatically

$Dir = $PSScriptRoot
if (-not $Dir) { $Dir = "C:\Users\Devata\Documents\GitHub\babyval-extension\tevi-cs" }
Set-Location $Dir

# Read version from version.js
$VFile = "$Dir\version.js"
$VContent = Get-Content $VFile -Raw
if ($VContent -match "VERSION\s*=\s*['""](\d+\.\d+\.\d+)['""]") {
    $Version = $Matches[1]
} else {
    Write-Host "ERROR: Cannot read VERSION from version.js" -ForegroundColor Red
    exit 1
}

Write-Host "Detected version: v$Version" -ForegroundColor Cyan
Write-Host ""

$Updated = 0

# manifest.json
$mf = "$Dir\manifest.json"
$m = Get-Content $mf -Raw
$OriginalM = $m
$m = $m -replace '"version": "\d+\.\d+\.\d+"', """version"": ""$Version"""
$m = $m -replace '"Tevi CS Bot v\d+\.\d+\.\d+[^"]*"', """Tevi CS Bot v$Version —"""
if ($m -ne $OriginalM) {
    Set-Content $mf -Value $m -NoNewline -Encoding UTF8
    Write-Host "[OK] manifest.json" -ForegroundColor Green
    $Updated++
}

# background.js
$bg = "$Dir\background.js"
$b = Get-Content $bg -Raw
$OriginalB = $b
$b = $b -replace 'Tevi CS v\d+\.\d+\.\d+', "Tevi CS v$Version"
$b = $b -replace 'SW v\d+\.\d+\.\d+ starting', "SW v$Version starting"
$b = $b -replace 'SW v\d+\.\d+\.\d+ ready', "SW v$Version ready"
if ($b -ne $OriginalB) {
    Set-Content $bg -Value $b -NoNewline -Encoding UTF8
    Write-Host "[OK] background.js" -ForegroundColor Green
    $Updated++
}

# content-script.js
$cs = "$Dir\content-script.js"
$c = Get-Content $cs -Raw
$OriginalC = $c
$c = $c -replace 'Tevi CS Bot v\d+\.\d+\.\d+', "Tevi CS Bot v$Version"
$c = $c -replace 'v\d+\.\d+\.\d+ active', "v$Version active"
if ($c -ne $OriginalC) {
    Set-Content $cs -Value $c -NoNewline -Encoding UTF8
    Write-Host "[OK] content-script.js" -ForegroundColor Green
    $Updated++
}

Write-Host ""
if ($Updated -eq 0) {
    Write-Host "All files already at v$Version" -ForegroundColor Yellow
} else {
    Write-Host "$Updated file(s) updated to v$Version" -ForegroundColor Green

    # Git commit + push
    Write-Host ""
    git add manifest.json background.js content-script.js version.js
    $Msg = "chore(tevi-cs): bump to v$Version"
    git commit -m $Msg
    Write-Host "Committed: $Msg" -ForegroundColor Green

    git push origin main
    Write-Host "Pushed to GitHub!" -ForegroundColor Green
}

Write-Host ""
Write-Host "DONE. Reload extension to test." -ForegroundColor Cyan
