Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $projectRoot '.env.database.local'
$secureValue = Read-Host 'Paste the Supabase Session pooler URI (input is hidden)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)

try {
    $connectionString = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($connectionString)) {
        throw 'The connection string cannot be empty.'
    }
    if ($connectionString.Contains('[YOUR-PASSWORD]') -or $connectionString.Contains('[SENSITIVE]')) {
        throw 'The connection string still contains a password placeholder. Replace it before continuing.'
    }
    if ($connectionString.Contains('"') -or $connectionString.Contains("`r") -or $connectionString.Contains("`n")) {
        throw 'The connection string contains unsupported characters.'
    }
    $uri = [Uri]$connectionString
    if ($uri.Scheme -notin @('postgres', 'postgresql')) {
        throw 'The connection string must start with postgres:// or postgresql://.'
    }
    if (-not $uri.Host.EndsWith('.pooler.supabase.com')) {
        throw 'Use the Session pooler connection string, not an API URL or another link.'
    }

    $preserved = @()
    if (Test-Path -LiteralPath $environmentFile) {
        $preserved = Get-Content -LiteralPath $environmentFile | Where-Object {
            $_ -notmatch '^\s*(DATABASE_URL|DATABASE_SSL|DATABASE_POOL_SIZE)\s*=' -and
            $_ -notmatch '^\s*(VERCEL|NX_|TURBO_)' -and
            $_ -notmatch '^\s*AMAP_KEY\s*=.*\[SENSITIVE\]'
        }
    }
    $lines = @($preserved | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $lines += 'DATABASE_URL="' + $connectionString + '"'
    $lines += 'DATABASE_SSL=true'
    $lines += 'DATABASE_POOL_SIZE=5'
    [IO.File]::WriteAllLines($environmentFile, $lines, [Text.UTF8Encoding]::new($false))
    Write-Host "Local database configuration saved: $($uri.Host):$($uri.Port)"
    Write-Host 'The connection string was not displayed. .env.database.local is ignored by Git.'
}
finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    $connectionString = $null
}
