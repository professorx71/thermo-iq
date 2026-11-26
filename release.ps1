<#
.SYNOPSIS
  Commit, push, deploy and tag a ThermoIQ release.

.DESCRIPTION
  1. Stages ALL changes (git add -A), bumps the app version, writes release
     notes, commits and pushes the branch to GitHub (after a CREATE prompt).
  2. Builds a package from that commit and deploys it to the Ubuntu VPS
     (after a DEPLOY prompt).
  3. Only when the deploy is healthy: creates the vX.Y.Z tag and pushes it.
     The tag push runs .github/workflows/release.yml, which creates the
     GitHub Release. Failed or skipped deploys get no tag and no Release.

  Versioning: if the current version was never deployed (has no tag), it is
  reused; otherwise the patch number is bumped (or use -Version).

  Examples:
    .\release.cmd -DryRun                          # show what would happen
    .\release.cmd -Notes "Improved audit exports"  # commit, push, deploy, tag
    .\release.cmd -Version 6.3.0 -Notes "Quarterly release"
    .\release.cmd -DeployOnly                      # deploy current version (tags it if new)
    .\release.cmd -DeployOnly -Version 6.2.1       # redeploy / roll back to an existing tag
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

function Test-TagExists([string]$Name) {
    return (@(git tag --list $Name).Count -gt 0)
}

# Paths that must never be committed or packaged (secrets and runtime data).
function Get-PrivatePaths([string[]]$Paths) {
    return @($Paths | Where-Object {
        (($_ -match '(^|/)\.env($|\.)') -and ($_ -notmatch '(^|/)\.env(\.cloud)?\.example$')) -or
        ($_ -match '(^|/)(data|logs|\.venv)/|(^|/).+\.(sqlite3?|db)$|(^|/)\.release-sha256$')
    })
}

function Add-RequiredUpdate(
    [System.Collections.IDictionary]$Updates,
    [string]$Path,
    [string]$Pattern,
    [string]$Replacement,
    [int]$MinimumMatches = 1
) {
    $text = if ($Updates.Contains($Path)) { $Updates[$Path] } else { Read-Text $Path }
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

    $branch = (git rev-parse --abbrev-ref HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $branch -eq 'HEAD') {
        Stop-Release 'Not on a branch (detached HEAD). Check out a branch, e.g. git switch main.'
    }

    $status = @(git status --porcelain --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { Stop-Release 'Could not read git status.' }

    $serverText = Read-Text 'app/server.py'
    $versionMatches = [regex]::Matches($serverText, '"version"\s*:\s*"(\d+\.\d+\.\d+)"')
    $currentVersions = @($versionMatches | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
    if ($currentVersions.Count -ne 1) {
        Stop-Release 'Could not determine one consistent version from app/server.py.'
    }
    $Current = $currentVersions[0]
    $currentTagged = Test-TagExists "v$Current"

    # ---------------------------------------------------------------- version
    $createTag = $true      # tag after a healthy deploy?
    $deployRef = 'HEAD'     # what gets packaged
    if ($DeployOnly) {
        $New = if ($Version) { $Version } else { $Current }
        if ($New -notmatch '^\d+\.\d+\.\d+$') { Stop-Release "Version must look like 6.2.1 (got '$New')." }
        $Tag = "v$New"
        if (Test-TagExists $Tag) {
            # Redeploy / roll back to an existing release. No new tag.
            $deployRef = $Tag
            $createTag = $false
        } else {
            if ($New -ne $Current) {
                Stop-Release "Tag '$Tag' does not exist, and $New is not the current version ($Current)."
            }
            if ($status.Count -gt 0) {
                Stop-Release 'There are uncommitted changes. Run release.cmd without -DeployOnly to commit, push and deploy them.'
            }
        }
    } else {
        if ($Version) {
            if ($Version -notmatch '^\d+\.\d+\.\d+$') { Stop-Release "Version must look like 6.3.0 (got '$Version')." }
            $New = $Version
            if ([version]$New -lt [version]$Current -or ($New -eq $Current -and $currentTagged)) {
                Stop-Release "Version $New must be greater than $Current$(if ($currentTagged) { ' (already released)' })."
            }
        } elseif ($currentTagged) {
            $parts = $Current.Split('.')
            $New = '{0}.{1}.{2}' -f $parts[0], $parts[1], ([int]$parts[2] + 1)
        } else {
            $New = $Current   # current version was never deployed: reuse it
        }
        $Tag = "v$New"
        if (Test-TagExists $Tag) { Stop-Release "Tag '$Tag' already exists." }
    }
    $bump = (-not $DeployOnly) -and ($New -ne $Current)

    # ------------------------------------------------------------------ notes
    if (-not $Notes -and -not $DeployOnly -and -not $DryRun) {
        $Notes = Read-Host 'One-line release summary (optional)'
    }
    if (-not $Notes) { $Notes = 'Maintenance release.' }
    if ($Notes -match '[\r\n]') { Stop-Release 'Release notes must fit on one line.' }
    $summary = (($Notes -replace '\|', '/') -replace '\s+', ' ').Trim()
    if ($summary.Length -gt 160) { $summary = $summary.Substring(0, 157) + '...' }

    # -------------------------------------------------------- version updates
    $updates = [ordered]@{}
    if ($bump) {
        Write-Host ''
        Write-Host "Version files ($Current -> $New):"
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
            '(?m)^(# ===== PBF Temperature Dashboard v)\d+\.\d+\.\d+( Cloud Edition =====)(?=\r?$)' `
            ('${1}' + $New + '${2}')
        Add-RequiredUpdate $updates 'cloud/deploy_cloud.sh' `
            '(?m)^(echo "Building PBF Temperature Dashboard v)\d+\.\d+\.\d+( Cloud Edition\.\.\.")(?=\r?$)' `
            ('${1}' + $New + '${2}')
        Add-RequiredUpdate $updates 'docs/guides/CLOUD_DEPLOYMENT.txt' `
            '(?m)^(v)\d+\.\d+\.\d+( OVH Cloud Edition)(?=\r?$)' `
            ('${1}' + $New + '${2}')
        Add-RequiredUpdate $updates 'README.md' `
            '(?m)^(\*\*Current version: v)\d+\.\d+\.\d+( \(Cloud Edition\)\*\*)(?=\r?$)' `
            ('${1}' + $New + '${2}')

        $readme = $updates['README.md']
        $historyMarker = "| **v$Current** |"
        $historyIndex = $readme.IndexOf($historyMarker, [StringComparison]::Ordinal)
        if ($historyIndex -lt 0) { Stop-Release "Could not find the v$Current entry in the README version history." }
        $updates['README.md'] = $readme.Insert($historyIndex, "| **v$New** | $summary |" + [Environment]::NewLine)
    }
    $notesPath = "docs/release-notes/V$($New.Replace('.', '_'))_RELEASE.txt"

    # ------------------------------------------------------------------- plan
    Write-Host ''
    Write-Host "Release: $Tag$(if (-not $bump -and -not $DeployOnly) { ' (version reused: not deployed yet)' })"
    Write-Host "Branch:  $branch -> origin"
    Write-Host "Target:  $Server"
    Write-Host "Install: $RemoteRoot"
    if ($DeployOnly) {
        Write-Host "Deploys: $(if ($createTag) { "current commit, tagged $Tag if healthy" } else { "existing tag $Tag (no new tag)" })"
    } else {
        Write-Host "Notes:   $summary"
        Write-Host ''
        if ($status.Count -gt 0) {
            Write-Host 'Changes that will be committed (git add -A):'
            $status | ForEach-Object { Write-Host "  $_" }
        } else {
            Write-Host 'No uncommitted changes (only the version/notes update will be committed).'
        }
        $privateChanges = Get-PrivatePaths @($status | ForEach-Object { ($_.Substring(3) -split ' -> ')[-1].Trim('"') })
        if ($privateChanges.Count -gt 0) {
            Stop-Release "Refusing to commit private/runtime files: $($privateChanges -join ', '). Add them to .gitignore."
        }
    }
    if ($DryRun) {
        Write-Host ''
        Write-Host 'Dry run: no files, commits, pushes, tags, packages, or server state were changed.'
        exit 0
    }

    # ------------------------------------------------------ commit and push
    if (-not $DeployOnly) {
        Write-Host ''
        $confirmation = Read-Host "Type CREATE to commit everything above as $Tag and push to GitHub"
        if ($confirmation -cne 'CREATE') { Stop-Release 'Cancelled before changing files.' }

        foreach ($path in $updates.Keys) {
            [IO.File]::WriteAllText((Join-Path $PSScriptRoot $path), $updates[$path], $Utf8)
        }
        $notesFile = Join-Path $PSScriptRoot $notesPath
        if (Test-Path -LiteralPath $notesFile) {
            [IO.File]::AppendAllText($notesFile, "- $Notes`r`n", $Utf8)   # version reused: add to its notes
        } else {
            $noteText = "ThermoIQ release $Tag`r`nReleased $(Get-Date -Format 'yyyy-MM-dd').`r`n`r`n- $Notes`r`n"
            [IO.File]::WriteAllText($notesFile, $noteText, $Utf8)
        }

        Invoke-Checked 'git' @('add', '-A')
        $staged = @(git diff --cached --name-only)
        $privateStaged = Get-PrivatePaths $staged
        if ($privateStaged.Count -gt 0) {
            git reset -q   # unstage only; working files are untouched
            Stop-Release "Refusing to commit private/runtime files: $($privateStaged -join ', '). Nothing was committed."
        }
        if ($staged.Count -gt 0) {
            Invoke-Checked 'git' @('commit', '-m', "Release $Tag", '-m', $Notes)
        }
        Write-Host "Pushing $branch to GitHub ..."
        Invoke-Checked 'git' @('push', 'origin', 'HEAD')
    } elseif ($createTag) {
        # Deploying an untagged commit: make sure GitHub has it before it goes live.
        Invoke-Checked 'git' @('push', 'origin', 'HEAD')
    }

    $commit = (git rev-parse "$deployRef^{commit}").Trim()
    if ($LASTEXITCODE -ne 0) { Stop-Release "Could not resolve '$deployRef'." }

    # ---------------------------------------------------------------- package
    $trackedFiles = @(git ls-tree -r --name-only $commit)
    if ($LASTEXITCODE -ne 0) { Stop-Release "Could not inspect commit '$commit'." }
    $privateFiles = Get-PrivatePaths $trackedFiles
    if ($privateFiles.Count -gt 0) {
        Stop-Release "Refusing to package private/runtime paths: $($privateFiles -join ', ')."
    }

    $downloads = Join-Path $env:USERPROFILE 'Downloads'
    if (-not (Test-Path -LiteralPath $downloads)) {
        New-Item -ItemType Directory -Path $downloads | Out-Null
    }
    $package = Join-Path $downloads "thermoiq-$Tag.tar.gz"
    Invoke-Checked 'git' @(
        'archive', '--format=tar.gz', "--prefix=thermoiq-$Tag/",
        '-o', $package, $commit
    )
    $hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host ''
    Write-Host "Commit:   $commit"
    Write-Host "Package:  $package"
    Write-Host "SHA-256:  $hash"

    # ----------------------------------------------------------------- deploy
    $deployConfirmation = Read-Host "Type DEPLOY to upload and activate $Tag on $Server (anything else stops here)"
    if ($deployConfirmation -cne 'DEPLOY') {
        Write-Host "Not deployed, so no $Tag tag or GitHub Release was created."
        if (-not $DeployOnly) { Write-Host "Your changes are committed and pushed to GitHub ($branch)." }
        Write-Host 'Deploy later with: .\release.cmd -DeployOnly'
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
    Write-Host "Release $Tag is deployed and healthy. The dashboard remains bound to VPS loopback."
    Write-Host "For access, use the configured HTTPS proxy or an SSH tunnel to 127.0.0.1:8000."

    # ------------------------------------------- tag + GitHub Release (healthy)
    if ($createTag) {
        Invoke-Checked 'git' @('tag', '-a', $Tag, '-m', "Release $Tag", $commit)
        Write-Host "Pushing tag $Tag to GitHub ..."
        Invoke-Checked 'git' @('push', 'origin', "refs/tags/$Tag")
        Write-Host "Tagged $Tag. GitHub Actions is creating the GitHub Release (repository -> Actions -> 'GitHub Release')."
    } else {
        Write-Host "Redeployed existing release $Tag; no new tag or GitHub Release."
    }
} catch {
    Write-Host ''
    Write-Host "STOPPED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
