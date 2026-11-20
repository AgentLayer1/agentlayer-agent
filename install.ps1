# AgentLayer's setup guide for Windows: irm https://agentlayer.one/install.ps1 | iex
# It checks this machine and shows each step to do. It runs nothing itself: you run every command.
# Written to start in Windows PowerShell 5.1, which a fresh Windows opens; the guide itself runs in PowerShell 7.
# By hand instead: https://agentlayer.one/docs/getting-started/install

$ErrorActionPreference = 'Stop'

function Start-AgentLayerGuide {
  param([string[]]$GuideArgs)

  $release = 'v1.0.7'
  $sourceUrl = "https://raw.githubusercontent.com/AgentLayer1/agentlayer-agent/$release/install"
  $powershellPage = 'https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows'

  if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Host ''
    Write-Host '  AgentLayer - Windows setup guide' -ForegroundColor Magenta
    Write-Host ''
    Write-Host '  This guide runs in PowerShell 7, and this window is an older PowerShell.'
    Write-Host '  Install PowerShell 7 from Microsoft, or run this:'
    Write-Host ''
    Write-Host '    winget install --id Microsoft.PowerShell --source winget' -ForegroundColor White
    Write-Host ''
    Write-Host "  -> $powershellPage" -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  Then open PowerShell 7 (pwsh) and run the same line again.'
    Write-Host ''
    return
  }

  # From a checkout the guide sits beside this file; piped from irm, it's fetched from the same repository.
  $local = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'install' 'windows.ps1' } else { '' }
  if ($local -and (Test-Path $local)) {
    & pwsh -NoProfile -File $local @GuideArgs
    return
  }

  $folder = Join-Path ([IO.Path]::GetTempPath()) "agentlayer-guide-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $folder | Out-Null
  try {
    $guide = Join-Path $folder 'windows.ps1'
    try {
      Invoke-WebRequest -Uri "$sourceUrl/windows.ps1" -OutFile $guide -UseBasicParsing
    } catch {
      Write-Host "  Couldn't download the guide. Check your connection, then run the line again." -ForegroundColor Red
      return
    }
    # A file cut short still parses, so the guide ends with a known last line.
    if ((Get-Content $guide -Tail 1) -ne '# agentlayer:end') {
      Write-Host '  The downloaded guide is incomplete. Run the line again.' -ForegroundColor Red
      return
    }
    & pwsh -NoProfile -File $guide @GuideArgs
  } finally {
    Remove-Item -Recurse -Force $folder -ErrorAction SilentlyContinue
  }
}

Start-AgentLayerGuide -GuideArgs $args
