# The Windows guide's stand-in tests. They need PowerShell 7, so they run in a container:
#   docker run --rm -v "<repo>:/src:ro" mcr.microsoft.com/powershell pwsh -NoProfile -File /src/test/install/windows.tests.ps1
# Each scenario runs the guide in a child pwsh that dot-sources it and replaces the tools it calls with
# functions that log every call, so nothing real is reached and every call can be checked.
$ErrorActionPreference = 'Stop'
$guide = Join-Path $PSScriptRoot '..' '..' 'install' 'windows.ps1'
$failures = [System.Collections.Generic.List[string]]::new()
$passed = 0

function New-Machine {
  $base = Join-Path ([IO.Path]::GetTempPath()) "windows-guide-$([guid]::NewGuid().ToString('N'))"
  $agents = Join-Path $base 'Agents'
  New-Item -ItemType Directory -Force -Path $agents | Out-Null
  [pscustomobject]@{ Base = $base; Agents = $agents; Log = (Join-Path $base 'calls.log'); Plugins = (Join-Path $base 'plugins.json') }
}

function New-Home($Machine, [string]$Name, [string]$Plugin = 'agentlayer') {
  $folder = Join-Path $Machine.Agents $Name
  New-Item -ItemType Directory -Force -Path (Join-Path $folder '.state') | Out-Null
  @{ plugin = $Plugin } | ConvertTo-Json | Set-Content (Join-Path $folder '.state' 'version.json')
  $folder
}

function New-PluginFolder($Machine, [string]$Name, [switch]$Clone, [switch]$Packages) {
  $root = Join-Path $Machine.Base $Name
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  if ($Clone) {
    New-Item -ItemType Directory -Force -Path (Join-Path $root '.claude-plugin') | Out-Null
    @{ name = 'agentlayer' } | ConvertTo-Json | Set-Content (Join-Path $root '.claude-plugin' 'plugin.json')
  }
  if ($Packages) {
    foreach ($name in @('chromium-1223', 'chromium_headless_shell-1223')) {
      $browser = Join-Path $root 'node_modules' 'playwright-core' '.local-browsers' $name
      New-Item -ItemType Directory -Force -Path $browser | Out-Null
      '' | Set-Content (Join-Path $browser 'INSTALLATION_COMPLETE')
    }
  }
  $root
}

# Runs the guide with stand-in tools: $Tools maps a tool to its version ('' leaves it out).
function Invoke-Scenario($Machine, [hashtable]$Tools, [string]$Params = '', [string]$Keys = '', [bool]$Windows = $true, [string]$GuideArgs = '') {
  $stubs = foreach ($tool in $Tools.Keys) {
    if ($Tools[$tool]) {
      @"
function $tool {
  Add-Content '$($Machine.Log)' ("$tool " + (`$args -join ' '))
  if (`$args[0] -eq '--version') { '$tool $($Tools[$tool])' }
  elseif ('$tool' -eq 'claude' -and `$args[0] -eq 'plugin' -and `$args[1] -eq 'list') { Get-Content '$($Machine.Plugins)' -Raw }
}
"@
    }
  }
  $script = @"
. '$guide' $GuideArgs
`$Script:AgentsDir = '$($Machine.Agents)'
function Test-Windows { `$$Windows }
function Get-RegistryPath { '' }
function Start-Process { Add-Content '$($Machine.Log)' ("open " + (`$args -join ' ')) }
function Set-Clipboard { Add-Content '$($Machine.Log)' 'copy' }
$($stubs -join "`n")
$Params
Invoke-Guide
"@
  if (-not (Test-Path $Machine.Plugins)) { '[]' | Set-Content $Machine.Plugins }
  $env:PATH = '/usr/bin:/bin'
  $output = $Keys | pwsh -NoProfile -Command $script 2>&1 | Out-String
  [pscustomobject]@{ Code = $LASTEXITCODE; Out = $output; Calls = @(if (Test-Path $Machine.Log) { Get-Content $Machine.Log }) }
}

function Set-Plugins($Machine, [object[]]$Entries) {
  ConvertTo-Json -InputObject @($Entries | ForEach-Object { @{ id = "agentlayer@$($_.Source)"; scope = 'local'; projectPath = $_.Home; installPath = $_.Root; enabled = $(if ($null -eq $_.Enabled) { $true } else { $_.Enabled }) } }) | Set-Content $Machine.Plugins
}

$readOnly = @('^\S+ --version$', '^claude plugin list --json$', '^git -C \S+ rev-parse --is-inside-work-tree$', '^open https?://\S+$', '^copy$')
function Get-ChangingCalls($Run) { @($Run.Calls | Where-Object { $call = $_; -not ($readOnly | Where-Object { $call -match $_ }) }) }

function Test-Case([string]$Name, [scriptblock]$Body) {
  try {
    & $Body
    $script:passed++
    Write-Host "  pass  $Name"
  } catch {
    $failures.Add("$Name`n      $($_.Exception.Message)")
    Write-Host "  FAIL  $Name" -ForegroundColor Red
  }
}

function Assert-Contains([string]$Text, [string]$Part) { if (-not $Text.Contains($Part)) { throw "expected the output to contain: $Part`n$Text" } }
function Assert-NotContains([string]$Text, [string]$Part) { if ($Text.Contains($Part)) { throw "expected the output not to contain: $Part" } }
function Assert-Equal($Actual, $Expected) { if ($Actual -ne $Expected) { throw "expected $Expected, got $Actual" } }

$all = @{ git = '2.47.1'; bun = '1.4.4'; claude = '2.1.326'; pdftoppm = '24.08.0'; jq = '1.7.1'; uv = '0.12.0'; gh = '2.60.0'; code = '1.95.0' }

function New-SetUpMachine {
  $machine = New-Machine
  $cache = New-PluginFolder $machine 'cache' -Packages
  $oppi = New-Home $machine 'Oppi'
  Set-Plugins $machine @(@{ Home = $oppi; Root = $cache; Source = 'agentlayer' })
  $programs = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs'
  foreach ($app in @('Obsidian/Obsidian.exe', 'Tabby/Tabby.exe')) {
    $path = Join-Path $programs $app
    New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
    if (-not (Test-Path $path)) { '' | Set-Content $path }
  }
  $machine
}

Test-Case 'a set-up machine is all ticks, asks nothing and changes nothing' {
  $machine = New-SetUpMachine
  $run = Invoke-Scenario $machine $all
  Assert-Equal $run.Code 0
  Assert-Contains $run.Out 'Path · use the agent'
  Assert-Contains $run.Out 'Plugin for Oppi · from the agentlayer marketplace'
  Assert-Contains $run.Out 'Nothing to do.'
  Assert-NotContains $run.Out '[Enter] check'
  Assert-Equal (Get-ChangingCalls $run).Count 0
}

Test-Case 'a bare machine lists every step with its link or command' {
  $machine = New-Machine
  $run = Invoke-Scenario $machine @{} '$List = $true'
  Assert-Equal $run.Code 1
  Assert-Contains $run.Out 'winget install --id Git.Git -e --source winget'
  Assert-Contains $run.Out 'https://bun.sh'
  Assert-Contains $run.Out 'https://code.claude.com/docs/en/setup'
  Assert-Contains $run.Out 'required step(s) left'
}

Test-Case 'a Claude Code below the floor shows both versions and the update command' {
  $machine = New-SetUpMachine
  $tools = $all.Clone()
  $tools.claude = '2.1.300'
  $run = Invoke-Scenario $machine $tools '$List = $true'
  Assert-Contains $run.Out '2.1.300 is older than 2.1.314'
  Assert-Contains $run.Out 'claude update'
}

Test-Case 'the guide waits on a required step and quits cleanly' {
  $machine = New-Machine
  $run = Invoke-Scenario $machine @{} '' '1'
  Assert-Equal $run.Code 0
  Assert-Contains $run.Out 'Stopped here.'
  Assert-Equal (Get-ChangingCalls $run).Count 0
}

Test-Case 'on the dev path the clone is checked and the plugin comes from its own marketplace' {
  $machine = New-SetUpMachine
  $clone = New-PluginFolder $machine 'clone' -Clone
  New-Item -ItemType Directory -Force -Path (Join-Path $machine.Agents 'Ada') | Out-Null
  $run = Invoke-Scenario $machine $all "`$Name = 'Ada'; `$Dev = `$true; `$Clone = '$clone'; `$List = `$true"
  Assert-Contains $run.Out 'Your clone'
  Assert-Contains $run.Out "claude plugin marketplace add $clone"
  Assert-Contains $run.Out 'claude plugin install agentlayer@agentlayer-dev -s local'
}

Test-Case '-Dev -Clone passed as parameters keeps the clone folder' {
  $machine = New-SetUpMachine
  $clone = New-PluginFolder $machine 'my clone' -Clone
  New-Item -ItemType Directory -Force -Path (Join-Path $machine.Agents 'Ada') | Out-Null
  $run = Invoke-Scenario $machine $all '$List = $true' '' $true "-Name Ada -Dev -Clone '$clone'"
  Assert-Contains $run.Out "claude plugin marketplace add '$clone'"
}

Test-Case 'a ready new folder ends with setup''s command, with the name passed on' {
  $machine = New-SetUpMachine
  $ada = Join-Path $machine.Agents 'Ada'
  New-Item -ItemType Directory -Force -Path $ada | Out-Null
  $cache = New-PluginFolder $machine 'cache2' -Packages
  Set-Plugins $machine @(@{ Home = $ada; Root = $cache; Source = 'agentlayer' })
  $run = Invoke-Scenario $machine $all "`$Name = 'Ada'; `$Marketplace = `$true"
  Assert-Equal $run.Code 0
  Assert-Contains $run.Out "claude '/agentlayer:init name=Ada'"
}

Test-Case 'a home another plugin made is pointed at its move' {
  $machine = New-SetUpMachine
  $other = New-Home $machine 'Other' 'acme-agent'
  $run = Invoke-Scenario $machine $all "`$HomeFolder = '$other'; `$Marketplace = `$true; `$List = `$true"
  Assert-Equal $run.Code 1
  Assert-Contains $run.Out 'move command'
}

Test-Case 'a name that breaks the rule is refused' {
  $machine = New-Machine
  $run = Invoke-Scenario $machine $all "`$Name = 'Ada;x'"
  Assert-Equal $run.Code 2
  Assert-Contains $run.Out "won't work as a name"
}

Test-Case 'the guide parses' {
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($guide, [ref]$null, [ref]$errors) | Out-Null
  Assert-Equal $errors.Count 0
}

Test-Case 'off Windows the guide stops at the first step' {
  $machine = New-Machine
  $run = Invoke-Scenario $machine $all '$List = $true' '' $false
  Assert-Equal $run.Code 1
  Assert-Contains $run.Out 'This system'
  Assert-NotContains $run.Out 'Git for Windows'
}

Test-Case 'a plugin that is installed but turned off gets the command to turn it on' {
  $machine = New-SetUpMachine
  $cache = New-PluginFolder $machine 'cache-off' -Packages
  Set-Plugins $machine @(@{ Home = (Join-Path $machine.Agents 'Oppi'); Root = $cache; Source = 'agentlayer'; Enabled = $false })
  $run = Invoke-Scenario $machine $all '$List = $true'
  Assert-Contains $run.Out 'but turned off'
  Assert-Contains $run.Out 'claude plugin enable agentlayer@agentlayer -s local'
}

Test-Case 'a folder with a quote in its name is shown so a pasted command keeps it literal' {
  $machine = New-SetUpMachine
  $odd = Join-Path $machine.Base "O'Brien"
  $run = Invoke-Scenario $machine $all "`$HomeFolder = '$($odd -replace "'", "''")'; `$Marketplace = `$true; `$List = `$true"
  Assert-Contains $run.Out "New-Item -ItemType Directory -Force '$($odd -replace "'", "''")'"
}

Test-Case 'a home with its own Claude subscription starts with agent' {
  $machine = New-SetUpMachine
  $secrets = Join-Path $machine.Agents 'Oppi' '.state' 'secrets'
  New-Item -ItemType Directory -Force -Path $secrets | Out-Null
  '{}' | Set-Content (Join-Path $secrets '.env.claude.json')
  $run = Invoke-Scenario $machine $all
  Assert-Contains $run.Out "; agent"
}

Test-Case '-Prereqs ticks the apps and tools, then stops before any agent' {
  $machine = New-SetUpMachine
  $run = Invoke-Scenario $machine $all '$Prereqs = $true; $Marketplace = $true'
  Assert-Equal $run.Code 0
  Assert-Contains $run.Out 'A guide, not an installer'
  Assert-NotContains $run.Out 'What would you like to do?'
  Assert-Contains $run.Out 'Your PC is ready for an agent.'
  Assert-NotContains $run.Out 'Plugin for'
  Assert-Equal (Get-ChangingCalls $run).Count 0
}

Test-Case '2 in the menu prepares the PC only' {
  $machine = New-SetUpMachine
  $run = Invoke-Scenario $machine $all '' '2'
  Assert-Contains $run.Out 'What would you like to do?'
  Assert-Contains $run.Out 'Your PC is ready for an agent.'
  Assert-NotContains $run.Out 'Plugin for'
}

Test-Case 'q in the menu quits before any step' {
  $machine = New-Machine
  $run = Invoke-Scenario $machine $all '' 'q'
  Assert-Equal $run.Code 0
  Assert-Contains $run.Out 'Stopped here.'
  Assert-NotContains $run.Out 'This system'
}

Test-Case 'the guide ends with the line the front door checks it arrived whole by' {
  Assert-Equal (Get-Content $guide -Tail 1) '# agentlayer:end'
}

Write-Host ''
Write-Host "  $passed pass, $($failures.Count) fail"
foreach ($failure in $failures) { Write-Host "  - $failure" -ForegroundColor Red }
exit ([int]($failures.Count -gt 0))
