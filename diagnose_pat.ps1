# PAT Diagnose Script (ASCII-safe)
Write-Host "=== PAT Diagnose Tool ===" -ForegroundColor Cyan
Write-Host "Paste PAT below (characters hidden, like password input)"
Write-Host ""

$securePat = Read-Host "Paste your new PAT" -AsSecureString

$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePat)
try {
    $pat = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
} finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($pat)) {
    Write-Host "No PAT input, exit" -ForegroundColor Yellow
    exit 0
}

$pat = $pat.Trim()
Write-Host ""
Write-Host "=== PAT Basic Info ===" -ForegroundColor Cyan
Write-Host ("Length: {0}  (normal fine-grained PAT is 80-93 chars)" -f $pat.Length)
Write-Host ("Prefix: {0}" -f $pat.Substring(0, [Math]::Min(12, $pat.Length)))
Write-Host ("Suffix: ...{0}" -f $pat.Substring([Math]::Max(0, $pat.Length - 6)))
Write-Host ("Has whitespace: {0}" -f [bool]($pat -match '\s'))
Write-Host ("Prefix valid (github_pat_ or ghp_): {0}" -f ($pat.StartsWith('github_pat_') -or $pat.StartsWith('ghp_')))
Write-Host ""

$headers = @{
    'Authorization' = 'Bearer ' + $pat
    'Accept'        = 'application/vnd.github+json'
    'User-Agent'    = 'pat-diagnose-script'
}

Write-Host "=== Test 1: GET /user (PAT validity) ===" -ForegroundColor Cyan
try {
    $r1 = Invoke-WebRequest -Uri 'https://api.github.com/user' -Headers $headers -TimeoutSec 15 -UseBasicParsing
    Write-Host ("Status: {0}  (200=valid)" -f $r1.StatusCode) -ForegroundColor Green
    $u = $r1.Content | ConvertFrom-Json
    Write-Host ("Login: {0}" -f $u.login)
    Write-Host ("Type:  {0}" -f $u.type)
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host ("Status: {0}" -f $code) -ForegroundColor Red
    if ($code -eq 401) {
        Write-Host "  -> 401: PAT incomplete / revoked / expired" -ForegroundColor Yellow
    } elseif ($code -eq 403) {
        Write-Host "  -> 403: classic PAT scope not enough, or rate limit" -ForegroundColor Yellow
    }
    try {
        $body = $_.ErrorDetails.Message | ConvertFrom-Json
        Write-Host ("Message: {0}" -f $body.message)
    } catch {}
}

Write-Host ""

Write-Host "=== Test 2: GET /repos/ioo353418-byte/user3055WEB (repo access) ===" -ForegroundColor Cyan
try {
    $r2 = Invoke-WebRequest -Uri 'https://api.github.com/repos/ioo353418-byte/user3055WEB' -Headers $headers -TimeoutSec 15 -UseBasicParsing
    Write-Host ("Status: {0}  (200=has access)" -f $r2.StatusCode) -ForegroundColor Green
    $repo = $r2.Content | ConvertFrom-Json
    Write-Host ("Repo: {0}" -f $repo.full_name)
    Write-Host ("Perms: admin={0} push={1} pull={2}" -f $repo.permissions.admin, $repo.permissions.push, $repo.permissions.pull)
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host ("Status: {0}" -f $code) -ForegroundColor Red
    if ($code -eq 404) {
        Write-Host "  -> 404: PAT did NOT select this repo (fine-grained needs explicit repo grant)" -ForegroundColor Yellow
    } elseif ($code -eq 401) {
        Write-Host "  -> 401: PAT invalid" -ForegroundColor Yellow
    } elseif ($code -eq 403) {
        Write-Host "  -> 403: PAT valid but no read access to repo" -ForegroundColor Yellow
    }
    try {
        $body = $_.ErrorDetails.Message | ConvertFrom-Json
        Write-Host ("Message: {0}" -f $body.message)
    } catch {}
}

Write-Host ""

Write-Host "=== Test 3: GET /repos/.../contents/data/projects.json (Contents read) ===" -ForegroundColor Cyan
try {
    $r3 = Invoke-WebRequest -Uri 'https://api.github.com/repos/ioo353418-byte/user3055WEB/contents/data/projects.json?ref=main' -Headers $headers -TimeoutSec 15 -UseBasicParsing
    Write-Host ("Status: {0}  (200=admin page can read)" -f $r3.StatusCode) -ForegroundColor Green
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host ("Status: {0}" -f $code) -ForegroundColor Red
    try {
        $body = $_.ErrorDetails.Message | ConvertFrom-Json
        Write-Host ("Message: {0}" -f $body.message)
    } catch {}
}

Write-Host ""
Write-Host "=== Diagnose Done ===" -ForegroundColor Cyan

Remove-Variable pat, securePat, headers -ErrorAction SilentlyContinue
Write-Host "(PAT cleared from memory)"
