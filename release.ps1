<#
.SYNOPSIS
  Create a versioned ThermoIQ release and optionally deploy it to the Ubuntu VPS.

.DESCRIPTION
  Bumps the app version, writes release notes, commits and tags only those files,
  builds an archive from that tag, and deploys after an explicit DEPLOY prompt.
  The working tree must be clean. No GitHub push is performed.

  Examples:
    .\release.cmd -DryRun
    .\release.cmd -Notes "Improved audit exports"
    .\release.cmd -Version 6.3.0 -Notes "Quarterly release"
    .\release.cmd -DeployOnly -Version 6.2.1
#>
[CmdletBinding()]
param(
    [string]$Version,
    [string]$Notes,
    [string]$Server = 'ubuntu@148.113.244.247',
    [string]$RemoteRoot = '/opt/pbf-temp-dashboard',
    [switch]$DeployOnly,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Stop-Release([string]$Message) {
    throw $Message
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        Stop-Release "'$Executable $($Arguments -join ' ')' failed (exit code $LASTEXITCODE)."
    }
}

function Read-Text([string]$Path) {
    return [IO.File]::ReadAllText((Join-Path $PSScriptRoot $Path), $Utf8)
}

function Add-RequiredUpdate(
    [System.Collections.IDictionary]$Updates,
    [string]$Path,
    [string]$Pattern,
    [string]$Replacement,
    [int]$MinimumMatches = 1
) {
    $text = Read-Text $Path
    $count = [regex]::Matches($text, $Pattern).Count
    if ($count -lt $MinimumMatches) {
        Stop-Release "Expected at least $MinimumMatches version match(es) in $Path; found $count."
    }
    $Updates[$Path] = [regex]::Replace($text, $Pattern, $Replacement)
    Write-Host ("  {0,-34} {1} update(s)" -f $Path, $count)
}

try {
    foreach ($tool in @('git')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            Stop-Release "'$tool' is not installed or is not on PATH."
        }
    }
    if ($Server -notmatch '^(?:[A-Za-z_][A-Za-z0-9_-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*$') {
        Stop-Release "Invalid SSH target '$Server'."
    }
    if ($RemoteRoot -notmatch '^/opt/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$' -or $RemoteRoot -match '(^|/)\.\.?(/|$)') {
        Stop-Release "RemoteRoot must be a safe path under /opt (got '$RemoteRoot')."
    }

    $status = @(git status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { Stop-Release 'Could not read git status.' }
    if ($status.Count -gt 0) {
        Stop-Release 'The worktree is not clean. Commit or otherwise resolve all changes before releasing; nothing was changed.'
    }

    $serverText = Read-Text 'app/server.py'
    $versionMatches = [regex]::Matches($serverText, '"version"\s*:\s*"(\d+\.\d+\.\d+)"')
    $currentVersions = @($versionMatches | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
    if ($currentVersions.Count -ne 1) {
        Stop-Release 'Could not determine one consistent version from app/server.py.'
    }
    $Current = $currentVersions[0]

    if ($DeployOnly) {
        $New = if ($Version) { $Version } else { $Current }
        if ($New -notmatch '^\d+\.\d+\.\d+$') { Stop-Release "Version must look like 6.2.1 (got '$New')." }
        $Tag = "v$New"
        $tagMatches = @(git tag --list $Tag)
        if ($LASTEXITCODE -ne 0 -or $tagMatches.Count -ne 1) {
            Stop-Release "Release tag '$Tag' was not found; cannot deploy it."
        }
    } else {
        if ($Version) {
            if ($Version -notmatch '^\d+\.\d+\.\d+$') { Stop-Release "Version must look like 6.3.0 (got '$Version')." }
            $New = $Version
        } else {
            $parts = $Current.Split('.')
            $New = '{0}.{1}.{2}' -f $parts[0], $parts[1], ([int]$parts[2] + 1)
        }
        if ([version]$New -le [version]$Current) {
            Stop-Release "New version $New must be greater than current version $Current."
        }
        $Tag = "v$New"
        if (@(git tag --list $Tag).Count -gt 0) {
            Stop-Release "Tag '$Tag' already exists."
        }
    }

    if (-not $Notes -and -not $DeployOnly -and -not $DryRun) {
        $Notes = Read-Host 'One-line release summary (optional)'
    }
    if (-not $Notes) { $Notes = 'Maintenance release.' }
    if ($Notes -match '[\r\n]') { Stop-Release 'Release notes must fit on one line.' }

    $summary = ($Notes -replace '\|', '/') -replace '\s+', ' '
    $summary = $summary.Trim()
    if ($summary.Length -gt 160) { $summary = $summary.Substring(0, 157) + '...' }

    $updates = [ordered]@{}
    if (-not $DeployOnly) {
        $versionPattern = '(?<![\d.])' + [regex]::Escape($Current) + '(?![\d.])'
        $serverVersionCount = [regex]::Matches($serverText, $versionPattern).Count
        Add-RequiredUpdate $updates 'app/server.py' $versionPattern $New $serverVersionCount

        foreach ($path in @(
            'app/static/index.html',
            'app/static/audit.html',
            'app/static/events.html',
            'app/static/settings.html',
            'app/static/trends.html'
        )) {
            Add-RequiredUpdate $updates $path $versionPattern $New
        }

        Add-RequiredUpdate $updates '.env.cloud.example' `
            '(?m)^(# ===== PBF Temperature Dashboard v)\d+\.\d+\.\d+( Cloud Edition =====)$' `
            ('$1' + $New + '$2')
        Add-RequiredUpdate $updates 'cloud/deploy_cloud.sh' `
            '(?m)^(echo "Building PBF Temperature Dashboard v)\d+\.\d+\.\d+( Cloud Edition\.\.\.")$' `
            ('$1' + $New + '$2')
        Add-RequiredUpdate $updates 'docs/guides/CLOUD_DEPLOYMENT.txt' `
            '(?m)^(v)\d+\.\d+\.\d+( OVH Cloud Edition)$' `
            ('$1' + $New + '$2')
        Add-RequiredUpdate $updates 'README.md' `
            '(?m)^(\*\*Current version: v)\d+\.\d+\.\d+( \(Cloud Edition\)\*\*)$' `
            ('$1' + $New + '$2')

        $readme = $updates['README.md']
        $historyMarker = "| **v$Current** |"
        $historyIndex = $readme.IndexOf($historyMarker, [StringComparison]::Ordinal)
        if ($historyIndex -lt 0) { Stop-Release "Could not find the v$Current entry in the README version history." }
        $row = "| **v$New** | $summary |" + [Environment]::NewLine
        $updates['README.md'] = $readme.Insert($historyIndex, $row)
    }

    $notesPath = "docs/release-notes/V$($New.Replace('.', '_'))_RELEASE.txt"
    if (-not $DeployOnly -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot $notesPath))) {
        Stop-Release "Release notes already exist at $notesPath."
    }

    Write-Host ''
    Write-Host "Release: $Tag"
    Write-Host "Target:  $Server"
    Write-Host "Install: $RemoteRoot"
    if (-not $DeployOnly) { Write-Host "Notes:   $summary" }
    if ($DryRun) {
        Write-Host ''
        Write-Host 'Dry run: no files, tags, commits, packages, or server state were changed.'
        exit 0
    }

    if (-not $DeployOnly) {
        $confirmation = Read-Host "Type CREATE to update version files, commit and tag $Tag"
        if ($confirmation -cne 'CREATE') { Stop-Release 'Cancelled before changing files.' }

        foreach ($path in $updates.Keys) {
            [IO.File]::WriteAllText((Join-Path $PSScriptRoot $path), $updates[$path], $Utf8)
        }
        $noteText = "ThermoIQ release $Tag`r`nReleased $(Get-Date -Format 'yyyy-MM-dd').`r`n`r`n- $Notes`r`n"
        [IO.File]::WriteAllText((Join-Path $PSScriptRoot $notesPath), $noteText, $Utf8)

        $pathsToStage = @($updates.Keys) + @($notesPath)
        Invoke-Checked 'git' (@('add', '--') + $pathsToStage)
        Invoke-Checked 'git' @(
            'commit',
            '-m', "Release $Tag",
            '-m', $Notes
        )
        Invoke-Checked 'git' @('tag', '-a', $Tag, '-m', "Release $Tag")
    }

    $trackedFiles = @(git ls-tree -r --name-only $Tag)
    if ($LASTEXITCODE -ne 0) { Stop-Release "Could not inspect release tag '$Tag'." }
    $privateFiles = @($trackedFiles | Where-Object {
        (($_ -match '(^|/)\.env($|\.)') -and ($_ -notmatch '(^|/)\.env(\.cloud)?\.example$')) -or
        ($_ -match '(^|/)(data|logs|\.venv)/|(^|/).+\.(sqlite3?|db)$|(^|/)\.release-sha256$')
    })
    if ($privateFiles.Count -gt 0) {
        Stop-Release "Refusing to package private/runtime paths from the tag: $($privateFiles -join ', ')."
    }

    $downloads = Join-Path $env:USERPROFILE 'Downloads'
    if (-not (Test-Path -LiteralPath $downloads)) {
        New-Item -ItemType Directory -Path $downloads | Out-Null
    }
    $package = Join-Path $downloads "thermoiq-$Tag.tar.gz"
    Invoke-Checked 'git' @(
        'archive', '--format=tar.gz', "--prefix=thermoiq-$Tag/",
        '-o', $package, $Tag
    )
    $hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host ''
    Write-Host "Package:  $package"
    Write-Host "SHA-256:  $hash"

    $deployConfirmation = Read-Host "Type DEPLOY to upload and activate $Tag on $Server (anything else stops here)"
    if ($deployConfirmation -cne 'DEPLOY') {
        Write-Host "Release $Tag is committed and tagged locally; it was not deployed."
        Write-Host "Push later if desired: git push origin HEAD refs/tags/$Tag"
        exit 0
    }

    foreach ($tool in @('ssh', 'scp')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            Stop-Release "'$tool' is not installed or is not on PATH."
        }
    }

    $remotePackage = "/tmp/thermoiq-$Tag.tar.gz"
    Write-Host ''
    Write-Host "Uploading release package and deploy helper to $Server ..."
    Invoke-Checked 'scp' @($package, "${Server}:$remotePackage")
    Invoke-Checked 'scp' @(
        (Join-Path $PSScriptRoot 'cloud/deploy_release.sh'),
        "${Server}:/tmp/thermoiq-deploy-release.sh"
    )
    Invoke-Checked 'ssh' @(
        $Server,
        "bash /tmp/thermoiq-deploy-release.sh $Tag $hash $RemoteRoot"
    )
    Write-Host ''
    Write-Host "Release $Tag is deployed. The dashboard remains bound to VPS loopback."
    Write-Host "For access, use the configured HTTPS proxy or an SSH tunnel to 127.0.0.1:8000."
} catch {
    Write-Host ''
    Write-Host "STOPPED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
