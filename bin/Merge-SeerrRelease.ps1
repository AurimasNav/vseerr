#!/usr/bin/env pwsh
#Requires -Version 7.4
<#
.SYNOPSIS
Merges a Seerr release into the current branch, the same way VSeerr's
upstream check does.

.DESCRIPTION
Files listed in .github/vseerr-owned-files keep VSeerr's version (the "ours"
merge driver), so Seerr's edits to them never cause conflicts. The merge is
left uncommitted: resolve any conflicts, review the result, then commit.

The daily upstream check (.github/workflows/vseerr-upstream-check.yml) runs
this script too, so a merge made by hand matches the one it tested.

.PARAMETER Tag
The Seerr release tag, for example v3.6.0.

.PARAMETER Remote
Where to fetch the tag from. Defaults to Seerr's repository.

.PARAMETER OutputFile
Also write the result (merge, conflicts, kept, workflows) as key=value lines
to this file. Used for GITHUB_OUTPUT.

.EXAMPLE
git switch -c seerr-v3.6.0 origin/main
./bin/Merge-SeerrRelease.ps1 -Tag v3.6.0
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidatePattern('^v\d+\.\d+\.\d+$')]
  [string]$Tag,

  [string]$Remote = 'https://github.com/seerr-team/seerr.git',

  [string]$OutputFile
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

Set-Location (git rev-parse --show-toplevel)
if (git status --porcelain --untracked-files=no) {
  throw 'The working tree has uncommitted changes. Commit or stash them first.'
}

git fetch --quiet --no-tags $Remote "refs/tags/${Tag}:refs/tags/$Tag"

# Files VSeerr maintains itself keep VSeerr's version. The attributes go in
# .git/info/attributes, which only this clone reads, so Seerr's own
# .gitattributes stays as Seerr has it.
$owned = @(
  Get-Content .github/vseerr-owned-files |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith('#') }
)
# A directory entry ("vseerr-docs/") matches nothing in an attributes file;
# "vseerr-docs/**" matches every file under it.
$patterns = $owned | ForEach-Object { $_.EndsWith('/') ? "$_**" : $_ }
git config merge.ours.driver true
$attributesPath = git rev-parse --git-path info/attributes
$begin = '# BEGIN vseerr-owned-files (written by bin/Merge-SeerrRelease.ps1)'
$end = '# END vseerr-owned-files'
$otherLines = [System.Collections.Generic.List[string]]::new()
$inBlock = $false
if (Test-Path $attributesPath) {
  foreach ($line in Get-Content $attributesPath) {
    if ($line -eq $begin) { $inBlock = $true; continue }
    if ($line -eq $end) { $inBlock = $false; continue }
    if (-not $inBlock) { $otherLines.Add($line) }
  }
}
$block = @($begin) + @($patterns | ForEach-Object { "$_ merge=ours" }) + @($end)
New-Item -ItemType Directory -Force -Path (Split-Path $attributesPath) | Out-Null
Set-Content -Path $attributesPath -Value (@($otherLines) + $block)

# Workflow files run in this repository once merged, so list Seerr's changes
# to them for review.
$base = git merge-base HEAD $Tag
$workflows = @(git diff --name-only $base $Tag -- .github/workflows)

$PSNativeCommandUseErrorActionPreference = $false
git merge --no-ff --no-commit $Tag
$merged = $LASTEXITCODE -eq 0
$PSNativeCommandUseErrorActionPreference = $true

$conflicts = @(git diff --name-only --diff-filter=U)
if (-not $merged -and $conflicts.Count -eq 0) {
  throw "git merge $Tag failed without conflicts; see the output above."
}
$result = $merged ? 'clean' : 'conflict'

Write-Information "Seerr $Tag merged: $result. Nothing is committed yet." -InformationAction Continue
if ($conflicts.Count -gt 0) {
  Write-Information "Resolve these conflicts: $($conflicts -join ', ')" -InformationAction Continue
}
if ($workflows.Count -gt 0) {
  Write-Information "Seerr changed these workflow files; review them: $($workflows -join ', ')" -InformationAction Continue
}
Write-Information "Kept VSeerr's version of: $($owned -join ', ')" -InformationAction Continue

if ($OutputFile) {
  Add-Content -Path $OutputFile -Value @(
    "merge=$result"
    "conflicts=$($conflicts -join ' ')"
    "kept=$($owned -join ' ')"
    "workflows=$($workflows -join ' ')"
  )
}
