Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $projectRoot '.env.database.local'
$secureValue = Read-Host '请粘贴 Supabase Session pooler URI（输入不会显示）' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)

try {
    $connectionString = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ([string]::IsNullOrWhiteSpace($connectionString)) {
        throw '连接串不能为空。'
    }
    if ($connectionString.Contains('[YOUR-PASSWORD]') -or $connectionString.Contains('[SENSITIVE]')) {
        throw '连接串仍包含密码占位符，请先在 Supabase Connect 面板填入数据库密码再复制。'
    }
    if ($connectionString.Contains('"') -or $connectionString.Contains("`r") -or $connectionString.Contains("`n")) {
        throw '连接串包含不允许的字符。'
    }
    $uri = [Uri]$connectionString
    if ($uri.Scheme -notin @('postgres', 'postgresql')) {
        throw '连接串必须以 postgres:// 或 postgresql:// 开头。'
    }
    if (-not $uri.Host.EndsWith('.pooler.supabase.com')) {
        throw '请复制 Session pooler 连接串，而不是 API 地址或其他链接。'
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
    Write-Host "本地数据库配置已保存：$($uri.Host):$($uri.Port)"
    Write-Host '连接串内容未显示，.env.database.local 已被 Git 忽略。'
}
finally {
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    $connectionString = $null
}
