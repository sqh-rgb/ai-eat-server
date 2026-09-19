param(
    [string]$EnvironmentFile = (Join-Path (Split-Path -Parent $PSScriptRoot) '.env.auth.local')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$publishablePointer = [IntPtr]::Zero
$secretPointer = [IntPtr]::Zero

try {
    $publishableSecure = Read-Host 'Paste the Supabase publishable key (input is hidden)' -AsSecureString
    $secretSecure = Read-Host 'Paste the Supabase secret key (input is hidden)' -AsSecureString
    $publishablePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($publishableSecure)
    $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretSecure)

    $env:AI_EAT_SUPABASE_PUBLISHABLE_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($publishablePointer)
    $env:AI_EAT_SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    $env:AI_EAT_AUTH_ENV_FILE = $EnvironmentFile

    & node (Join-Path $PSScriptRoot 'configure-local-auth.js')
    if ($LASTEXITCODE -ne 0) {
        throw 'Local authentication configuration failed.'
    }
}
finally {
    Remove-Item Env:AI_EAT_SUPABASE_PUBLISHABLE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:AI_EAT_SUPABASE_SECRET_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:AI_EAT_AUTH_ENV_FILE -ErrorAction SilentlyContinue
    if ($publishablePointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($publishablePointer)
    }
    if ($secretPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    }
}
