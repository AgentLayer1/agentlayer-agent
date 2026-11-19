# The Windows setup guide, started by install.ps1 in PowerShell 7. It checks each step and shows what
# to do; the user runs every command. Rerunning it is always safe: finished steps are ticked and skipped.
# Dot-sourcing it loads the functions without running the guide, which is how its tests drive it.
param(
  [string]$Name = '',
  [string]$HomeFolder = '',
  [switch]$Marketplace,
  [switch]$Dev,
  [string]$Clone = '',
  [switch]$Prereqs,
  [switch]$Check,
  [switch]$List
)

$Script:MinBun = '1.4.4'
$Script:MinClaude = '2.1.314'
$Script:NamePattern = '^[A-Za-z0-9][A-Za-z0-9 -]*$'
$Script:Plugin = 'agentlayer'
$Script:DevMarketplace = 'agentlayer-dev'
$Script:MarketplaceRepo = 'AgentLayer1/agentlayer-agent-marketplace'
$Script:RepoUrl = 'https://github.com/AgentLayer1/agentlayer-agent.git'
$Script:Docs = 'https://agentlayer.one/docs/getting-started/install'
$Script:AgentsDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Agents'
$Script:DefaultClone = Join-Path $HOME 'Developer' 'agentlayer-agent'

$Script:Mode = 'guide'
# agent (set one up) or prereqs (only the apps and tools); empty until a parameter or the welcome menu picks.
$Script:Goal = ''
$Script:Pending = 0
$Script:PathChoice = ''
$Script:CloneFolder = ''
$Script:Listing = $null
$Script:ListingFor = ''
$Script:PathFromHome = $false

# --- The look ---

# Oppi's colors and banner, copies of the plugin's (src/shared/persona.ts, src/hooks/banner.ts): the guide runs
# before any agent exists, so it wears the ones a new agent wakes up with. Plain when the output isn't a console.
$Script:DefaultName = 'Oppi'
$Script:ColorPrimary = '#B456A8'
$Script:ColorAccent = '#3BAA70'
$Script:Wordmark = @(' ╔═╗ ╔═╗ ╔═╗ ╔╗╔ ╔╦╗', ' ╠═╣ ║ ╦ ║╣  ║║║  ║ ', ' ╩ ╩ ╚═╝ ╚═╝ ╝╚╝  ╩ ')
$Script:Color = -not ([Console]::IsOutputRedirected -or $env:NO_COLOR)
function Get-Rgb([int]$Red, [int]$Green, [int]$Blue) { if ($Script:Color) { "$([char]27)[38;2;$Red;$Green;$($Blue)m" } else { '' } }
function Get-Channels([string]$Hex) { 1, 3, 5 | ForEach-Object { [Convert]::ToInt32($Hex.Substring($_, 2), 16) } }
$accentChannels = @(Get-Channels $Script:ColorAccent)
$Script:Accent = Get-Rgb @accentChannels
$Script:Bold = if ($Script:Color) { "$([char]27)[1m" } else { '' }
$Script:Reset = if ($Script:Color) { "$([char]27)[0m" } else { '' }

# The wordmark shades from orchid to a lighter pink, line by line.
function Write-Banner([string]$Title) {
  Write-Host ''
  $red, $green, $blue = Get-Channels $Script:ColorPrimary
  for ($i = 0; $i -lt $Script:Wordmark.Count; $i++) {
    Write-Host "  $($Script:Bold)$(Get-Rgb ($red + 26 * $i) ($green + 18 * $i) ($blue + 15 * $i))$($Script:Wordmark[$i])$($Script:Reset)"
  }
  Write-Host "   $($Script:Bold)$($Script:Accent)===$($Script:DefaultName.ToUpper())=== $([char]::ConvertFromUtf32(0x1F419))$($Script:Reset)"
  Write-Host ''
  Write-Host "   $($Script:Bold)$Title$($Script:Reset) " -NoNewline
  Write-Host '· agentlayer.one' -ForegroundColor DarkGray
  Write-Host ''
}

# A box with a title in its top edge, for what a reader should take in before anything else.
function Write-Panel([string]$Title, [string[]]$Paragraphs) {
  $width = 72
  $inner = $width - 4
  $edge = { param($Text) Write-Host "  $($Script:Accent)$Text$($Script:Reset)" }
  & $edge ("╭─ $($Script:Reset)$($Script:Bold)$Title$($Script:Reset)$($Script:Accent) " + ('─' * ($width - $Title.Length - 5)) + '╮')
  $first = $true
  foreach ($paragraph in $Paragraphs) {
    if (-not $first) { & $edge ('│' + (' ' * ($width - 2)) + '│') }
    $first = $false
    $lines = @()
    $line = ''
    foreach ($word in ($paragraph -split ' ')) {
      if ($line -and ($line.Length + $word.Length + 1) -gt $inner) { $lines += $line; $line = $word }
      else { $line = if ($line) { "$line $word" } else { $word } }
    }
    if ($line) { $lines += $line }
    foreach ($text in $lines) {
      Write-Host "  $($Script:Accent)│$($Script:Reset) $($text.PadRight($inner)) $($Script:Accent)│$($Script:Reset)"
    }
  }
  & $edge ('╰' + ('─' * ($width - 2)) + '╯')
}

function Write-Done([string]$Title, [string]$Detail) {
  Write-Host '  ' -NoNewline
  Write-Host "$($Script:Accent)$([char]0x2713)$($Script:Reset)" -NoNewline
  Write-Host " $Title" -NoNewline
  if ($Detail) { Write-Host " · $Detail" -ForegroundColor DarkGray } else { Write-Host '' }
}

function Write-Todo([string]$Title, [string]$Detail) {
  Write-Host '  ' -NoNewline
  Write-Host ([char]0x25CB) -ForegroundColor Yellow -NoNewline
  Write-Host " $Title" -NoNewline
  Write-Host " · $Detail" -ForegroundColor DarkGray
}

function Write-Para([string]$Text) {
  $width = 72
  $line = ''
  foreach ($word in ($Text -split ' ')) {
    if (($line.Length + $word.Length + 1) -gt $width -and $line) {
      Write-Host "    $line"
      $line = $word
    } else {
      $line = if ($line) { "$line $word" } else { $word }
    }
  }
  if ($line) { Write-Host "    $line" }
}

function Write-Link([string]$Url) {
  $Script:Link = $Url
  Write-Host "    -> $Url" -ForegroundColor Cyan
}

function Write-Box([string[]]$Lines) {
  $width = ($Lines | Measure-Object -Property Length -Maximum).Maximum
  Write-Host ('    +' + ('-' * ($width + 2)) + '+') -ForegroundColor DarkGray
  foreach ($line in $Lines) {
    Write-Host '    | ' -ForegroundColor DarkGray -NoNewline
    Write-Host $line.PadRight($width) -ForegroundColor White -NoNewline
    Write-Host ' |' -ForegroundColor DarkGray
  }
  Write-Host ('    +' + ('-' * ($width + 2)) + '+') -ForegroundColor DarkGray
  $Script:Command = $Lines -join "`n"
}

function Write-CardTitle([string]$Title, [string]$Kind, [string]$Detail) {
  Write-Host ''
  Write-Host "  -- $Title " -NoNewline
  Write-Host $Kind -ForegroundColor DarkGray
  if ($Detail) {
    Write-Host '  ' -NoNewline
    Write-Host ([char]0x25CB) -ForegroundColor Yellow -NoNewline
    Write-Host " $Detail"
  }
  Write-Host ''
}

# --- Versions, tools and PATH (read-only) ---

function Get-Version([string]$Text) {
  if ($Text -match '(\d+(\.\d+)+)') { return $Matches[1] }
  return ''
}

function Test-VersionAtLeast([string]$Have, [string]$Need) {
  $haveParts = @($Have -split '\.' | ForEach-Object { [int]($_ -replace '\D.*$', '0') })
  $needParts = @($Need -split '\.' | ForEach-Object { [int]($_ -replace '\D.*$', '0') })
  for ($i = 0; $i -lt $needParts.Count; $i++) {
    $part = if ($i -lt $haveParts.Count) { $haveParts[$i] } else { 0 }
    if ($part -gt $needParts[$i]) { return $true }
    if ($part -lt $needParts[$i]) { return $false }
  }
  return $true
}

# Read from the registry, so tools an installer just added are found without a new window.
function Get-RegistryPath {
  @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User')) -join ';'
}

# Rebuilt from the PATH the guide started with each time, so it never grows step by step.
$Script:StartPath = $env:Path
function Update-GuidePath {
  $bunBin = Join-Path $HOME '.bun' 'bin'
  $env:Path = (@((Get-RegistryPath), $bunBin, $Script:StartPath) | Where-Object { $_ }) -join ';'
}

function Test-Tool([string]$Tool, [string]$Floor = '') {
  $found = Get-Command $Tool -ErrorAction SilentlyContinue
  if (-not $found) {
    $Script:Detail = 'not found'
    return $false
  }
  $version = Get-Version ((& $Tool --version 2>$null) -join ' ')
  $Script:Detail = if ($version) { $version } else { 'installed' }
  if ($Floor -and -not (Test-VersionAtLeast $version $Floor)) {
    $Script:Detail = "$version is older than $Floor"
    return $false
  }
  return $true
}

# A Node already on PATH passes, however it was installed. Otherwise fnm's default Node counts, since this guide's
# own PATH predates the profile setup fnm's page has you add.
function Test-Node {
  if (Test-Tool 'node') { return $true }
  if (-not (Get-Command 'fnm' -ErrorAction SilentlyContinue)) { return $false }
  $version = Get-Version ((& fnm exec --using=default node --version 2>$null) -join ' ')
  if (-not $version) {
    $Script:Detail = 'fnm has no Node yet'
    return $false
  }
  $Script:Detail = "$version through fnm"
  return $true
}

function Test-App([string]$Path) {
  $Script:Detail = if (Test-Path $Path) { 'installed' } else { 'not installed' }
  Test-Path $Path
}

function Test-Windows { [bool]$IsWindows }

# --- Keys ---

function Read-GuideKey {
  if ([Console]::IsInputRedirected) {
    $code = [Console]::In.Read()
    if ($code -lt 0) { return $null }
    $char = [char]$code
    if ($char -eq "`r" -or $char -eq "`n") { return '' }
    return [string]$char
  }
  $key = [Console]::ReadKey($true)
  if ($key.Key -eq 'Enter') { return '' }
  return [string]$key.KeyChar
}

function Read-Choice([string]$Question, [string]$First, [string]$Second) {
  if ($Script:Mode -ne 'guide') { return 1 }
  Write-Host ''
  Write-Host "    $Question"
  Write-Host "      [1] $First"
  Write-Host "      [2] $Second"
  Write-Host '    Choose 1 or 2 (Enter for 1): ' -ForegroundColor DarkGray -NoNewline
  while ($true) {
    $key = Read-GuideKey
    if ($null -eq $key -or $key -eq '' -or $key -eq '1') { Write-Host '1'; return 1 }
    if ($key -eq '2') { Write-Host '2'; return 2 }
  }
}

# Asked only when the parameters haven't already said what to do. Returns agent, prereqs or check.
function Read-Menu {
  Write-Host ''
  Write-Host '  What would you like to do?'
  Write-Host ''
  foreach ($option in @(
      @('1', 'Set up an agent', "the tools, then the agent's folder and plugin"),
      @('2', 'Prepare this PC', 'only the apps and tools, ready for an agent later'),
      @('3', 'Check this PC', "a list of what's done and what's left"),
      @('q', 'Quit', ''))) {
    Write-Host "    $($Script:Bold)$($Script:Accent)$($option[0])$($Script:Reset)  $($Script:Bold)$($option[1].PadRight(20))$($Script:Reset) " -NoNewline
    Write-Host $option[2] -ForegroundColor DarkGray
  }
  Write-Host ''
  Write-Host '    Press 1, 2, 3 or q (Enter for 1): ' -ForegroundColor DarkGray -NoNewline
  while ($true) {
    $key = Read-GuideKey
    if ($null -eq $key -or $key -eq '' -or $key -eq '1') { Write-Host '1'; return 'agent' }
    if ($key -eq '2') { Write-Host '2'; return 'prereqs' }
    if ($key -eq '3') { Write-Host '3'; return 'check' }
    if ($key -eq 'q') { Write-Host 'q'; Stop-Guide }
  }
}

function Read-Answer([string]$Question, [string]$Default) {
  if ($Script:Mode -ne 'guide') { return $Default }
  Write-Host ''
  Write-Host "    $Question [$Default] " -NoNewline
  $reply = if ([Console]::IsInputRedirected) { [Console]::In.ReadLine() } else { Read-Host }
  if ($reply) { return $reply }
  return $Default
}

function Stop-Guide {
  Write-Host ''
  Write-Host '  Stopped here. Run the same line again any time: finished steps are skipped.'
  Write-Host ''
  exit 0
}

# --- Steps ---

# Invoke-Step <title> <required|recommended|optional> <check> <show>: a check sets $Script:Detail and
# returns $true when done; a show prints what to do, with Write-Link (o) and Write-Box (c).
function Invoke-Step([string]$Title, [string]$Kind, [scriptblock]$Check, [scriptblock]$Show) {
  Update-GuidePath
  $Script:Detail = ''
  if (& $Check) {
    Write-Done $Title $Script:Detail
    return $true
  }
  if ($Script:Mode -eq 'check') {
    Write-Todo $Title "$Kind · $($Script:Detail)"
    if ($Kind -eq 'required') { $Script:Pending++ }
    return $false
  }
  $Script:Link = ''
  $Script:Command = ''
  if ($Kind -eq 'optional' -and $Script:Mode -eq 'guide') {
    & $Show *> $null
    Write-Todo $Title "optional · $($Script:Link)"
    return $false
  }
  Write-CardTitle $Title $Kind $Script:Detail
  & $Show
  if ($Script:Mode -eq 'list') {
    if ($Kind -eq 'required') { $Script:Pending++ }
    return $false
  }
  return Wait-Step $Kind $Check $Show
}

function Write-Keys([string]$Kind) {
  $keys = @()
  if ($Script:Link) { $keys += '[o] open link' }
  if ($Script:Command) { $keys += '[c] copy' }
  $keys += '[t] terminal here', '[Enter] check'
  if ($Kind -ne 'required') { $keys += '[s] skip' }
  $keys += '[q] quit'
  Write-Host ''
  Write-Host ('  ' + ($keys -join '   ')) -ForegroundColor DarkGray
}

# After the user acted, so the plugin list is read again too.
function Test-Again([scriptblock]$Check) {
  Update-GuidePath
  $Script:Listing = $null
  if (& $Check) { Write-Done 'Done' $Script:Detail; return $true }
  Write-Host "  Not yet: $($Script:Detail)" -ForegroundColor Red
  $false
}

# A failed re-check redraws the step: the user may have moved it to another unfinished state with another fix.
function Show-Again([scriptblock]$Show, [string]$Kind) {
  $Script:Link = ''
  $Script:Command = ''
  Write-Host ''
  & $Show
  Write-Keys $Kind
}

function Wait-Step([string]$Kind, [scriptblock]$Check, [scriptblock]$Show) {
  Write-Keys $Kind
  while ($true) {
    $key = Read-GuideKey
    if ($null -eq $key) { Stop-Guide }
    switch ($key) {
      '' { if (Test-Again $Check) { return $true }; Show-Again $Show $Kind }
      'o' { if ($Script:Link) { Start-Process $Script:Link } }
      'c' { if ($Script:Command) { Set-Clipboard -Value $Script:Command; Write-Host '    Copied.' -ForegroundColor Green } }
      't' {
        Write-Host ''
        Write-Host '    Your shell, here. Run the command, then type exit to come back.' -ForegroundColor DarkGray
        & pwsh -NoLogo
        if (Test-Again $Check) { return $true }
        Show-Again $Show $Kind
      }
      's' {
        if ($Kind -ne 'required') { Write-Host '    Skipped.' -ForegroundColor DarkGray; return $false }
        Write-Host '    This one is required: the agent needs it.' -ForegroundColor DarkGray
      }
      'q' { Stop-Guide }
    }
  }
}

# --- Homes and the plugin (read-only) ---

function Get-HomePlugin([string]$Folder) {
  $version = Join-Path $Folder '.state' 'version.json'
  if (-not (Test-Path $version)) { return '' }
  try { return [string](Get-Content $version -Raw | ConvertFrom-Json).plugin } catch { return '' }
}

function Find-Homes {
  if (-not (Test-Path $Script:AgentsDir)) { return @() }
  @(Get-ChildItem -Directory $Script:AgentsDir | Where-Object { (Get-HomePlugin $_.FullName) -eq $Script:Plugin } | ForEach-Object { $_.FullName })
}

# Read from inside the folder, since Claude Code reports "enabled" for the folder it runs in.
function Get-PluginListing([string]$Folder) {
  if ($null -eq $Script:Listing -or $Script:ListingFor -ne $Folder) {
    $Script:ListingFor = $Folder
    Push-Location $Folder
    try {
      $Script:Listing = @((claude plugin list --json 2>$null) -join "`n" | ConvertFrom-Json | Where-Object { "$($_.id)".StartsWith("$($Script:Plugin)@") })
    } catch { $Script:Listing = @() } finally { Pop-Location }
  }
  $Script:Listing
}

# The copy of the plugin a folder uses: its own entry, or a user-wide one.
function Get-PluginFor([string]$Folder) {
  if (-not (Test-Path $Folder)) { return $null }
  $here = (Resolve-Path $Folder).Path
  $copies = Get-PluginListing $here
  $mine = $copies | Where-Object { $_.projectPath -and ((Resolve-Path $_.projectPath -ErrorAction SilentlyContinue).Path -eq $here) } | Select-Object -First 1
  if (-not $mine) { $mine = $copies | Where-Object { $_.scope -eq 'user' } | Select-Object -First 1 }
  if (-not $mine) { return $null }
  $root = if ($mine.readFromFolder) { $mine.readFromFolder } else { $mine.installPath }
  [pscustomobject]@{ Source = "$($mine.id)".Split('@')[1]; Root = $root; Enabled = $mine.enabled -ne $false; Scope = $(if ($mine.scope) { $mine.scope } else { 'local' }) }
}

function Test-Clone([string]$Folder) {
  $manifest = Join-Path $Folder '.claude-plugin' 'plugin.json'
  if (-not (Test-Path $manifest)) { return $false }
  try { return (Get-Content $manifest -Raw | ConvertFrom-Json).name -eq $Script:Plugin } catch { return $false }
}

# Playwright writes INSTALLATION_COMPLETE last, so a browser folder without it is an interrupted download. The web
# tools launch the headless shell, which downloads separately after Chromium.
function Test-Packages([string]$Root) {
  $browsers = Join-Path $Root 'node_modules' 'playwright-core' '.local-browsers'
  $ready = { param($Filter) @(Get-ChildItem -Directory $browsers -Filter $Filter -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName 'INSTALLATION_COMPLETE') }).Count -gt 0 }
  (Test-Path (Join-Path $Root 'node_modules')) -and (& $ready 'chromium-*') -and (& $ready 'chromium_headless_shell-*')
}

function Get-FolderProblem([string]$Target) {
  if (($Target -split '[\\/]') -contains '..' -or ($Target -split '[\\/]') -contains '.') { return 'Give the folder as a plain path, without . or ..' }
  $above = $HOME
  while ($above) {
    if ([IO.Path]::GetFullPath($Target).TrimEnd('\', '/') -eq [IO.Path]::GetFullPath($above).TrimEnd('\', '/')) {
      return "$Target is your home folder, or above it. An agent needs a folder of its own."
    }
    $above = Split-Path $above -Parent
  }
  $plugin = Get-HomePlugin $Target
  if ($plugin -and $plugin -ne $Script:Plugin) {
    return "$Target is a home another plugin made. Open it with that plugin and run its move command, which copies it to a new folder for this one."
  }
  $parent = Split-Path $Target -Parent
  while ($parent) {
    if ((Test-Path (Join-Path $parent 'SOUL.md')) -or (Test-Path (Join-Path $parent '.state' 'version.json'))) {
      return "$Target is inside another agent's home ($parent). An agent's home is a folder of its own."
    }
    $parent = Split-Path $parent -Parent
  }
  if (-not $plugin -and (Test-Path (Join-Path $Target 'SOUL.md'))) { return "$Target already holds an agent this guide didn't set up (it has a SOUL.md)." }
  $probe = $Target
  while ($probe -and -not (Test-Path $probe)) { $probe = Split-Path $probe -Parent }
  if ($probe -and (git -C $probe rev-parse --is-inside-work-tree 2>$null) -eq 'true') { return "$Target is inside a git repository. An agent's home is a folder of its own." }
  return ''
}

# A pinned AGENT_HOME makes Claude Code use that home wherever it starts; a pin at this agent's own folder is fine.
function Get-PinProblem([string]$Target) {
  $pin = $env:AGENT_HOME
  $where = 'in your shell'
  $settings = Join-Path $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }) 'settings.json'
  if (-not $pin -and (Test-Path $settings)) {
    try { $pin = [string](Get-Content $settings -Raw | ConvertFrom-Json).env.AGENT_HOME } catch { $pin = '' }
    $where = 'in your Claude Code settings'
  }
  if (-not $pin) { return '' }
  $pin = $pin -replace '^~', $HOME
  if ((Test-Path $Target) -and (Test-Path $pin) -and (Resolve-Path $pin).Path -eq (Resolve-Path $Target).Path) { return '' }
  "AGENT_HOME is set to $pin $where, so Claude Code would use that home instead of $Target. Remove the pin, then run the guide again."
}

# A tool as a shown command names it: bare when the window the guide started in finds it, else by its full path
# with the call operator, since PATH changes in this process never reach the user's other windows.
function Format-Tool([string]$Tool) {
  $found = Get-Command $Tool -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found -and ($Script:StartPath -split ';') -notcontains (Split-Path $found.Source)) { return "& $(Format-Path $found.Source)" }
  $Tool
}

# A path as a command shows it: bare when nothing needs quoting, else in single quotes with any quote doubled.
function Format-Path([string]$Path) {
  if ($Path -match '^[\w\\/:.@+-]+$') { return $Path }
  "'" + ($Path -replace "'", "''") + "'"
}

# --- The run ---

function Invoke-Guide {
  if ($Check) { $Script:Mode = 'check' } elseif ($List) { $Script:Mode = 'list' }
  if ($Name -and $Name -notmatch $Script:NamePattern) {
    Write-Host "  `"$Name`" won't work as a name. Use letters, digits, spaces and hyphens, starting with a letter or digit." -ForegroundColor Red
    exit 2
  }
  if ($Dev) { $Script:PathChoice = 'dev'; $Script:CloneFolder = $Clone } elseif ($Marketplace) { $Script:PathChoice = 'marketplace' }

  if ($Prereqs) { $Script:Goal = 'prereqs' }
  if ($Script:Mode -eq 'guide') {
    Write-Banner 'Windows setup guide'
    Write-Panel 'A guide, not an installer' @(
      "Nothing here installs or changes anything by itself. It checks this PC one step at a time and shows what to do: a link to the maker's own site, or a command for you to read, copy and run yourself. Nothing needs to run as administrator.",
      'Run it again any time. Finished steps are simply ticked.'
    )
    if (-not $Script:Goal -and -not $Name -and -not $HomeFolder) {
      $Script:Goal = Read-Menu
      if ($Script:Goal -eq 'check') { $Script:Mode = 'check'; $Script:Goal = 'agent' }
    }
  } else {
    Write-Host ''
    Write-Host "  $($Script:Bold)AgentLayer · Windows setup guide$($Script:Reset)"
  }
  if (-not $Script:Goal) { $Script:Goal = 'agent' }
  Write-Host ''

  $null = Invoke-Step 'This system' 'required' { $Script:Detail = 'Windows'; Test-Windows } {
    Write-Para 'This guide is for Windows. Elsewhere, run the curl line from the docs.'
    Write-Link $Script:Docs
  }
  if ($Script:Pending) { Complete-Guide }

  $homes = @(Find-Homes)
  if (-not $Script:PathChoice -and -not $Name -and -not $HomeFolder) {
    foreach ($folder in $homes) {
      $found = Get-PluginFor $folder
      if ($found) {
        $Script:PathChoice = if ($found.Source -eq $Script:DevMarketplace) { 'dev' } else { 'marketplace' }
        $Script:PathFromHome = $true
        if ($Script:PathChoice -eq 'dev' -and -not $Script:CloneFolder) { $Script:CloneFolder = $found.Root }
        break
      }
    }
  }
  if (-not $Script:PathChoice) {
    $choice = Read-Choice 'How will you use AgentLayer?' 'Use the agent: the plugin from the marketplace (recommended)' 'Develop the plugin: a local clone or your fork'
    $Script:PathChoice = if ($choice -eq 2) { 'dev' } else { 'marketplace' }
  }
  $dev = $Script:PathChoice -eq 'dev'
  Write-Done 'Path' $(if ($dev) { 'develop the plugin' } else { 'use the agent' })

  $null = Invoke-Step 'Git for Windows' 'required' { Test-Tool 'git' } {
    Write-Para 'git versions what the agent knows, and Git Bash comes with it. Install it from its site, or run this:'
    Write-Box @('winget install --id Git.Git -e --source winget')
    Write-Link 'https://git-scm.com/downloads/win'
  }
  $null = Invoke-Step 'Node.js' 'required' { Test-Node } {
    if (Get-Command 'fnm' -ErrorAction SilentlyContinue) {
      Write-Para "fnm is installed. Install Node's long-term support release with it:"
      Write-Box @("$(Format-Tool 'fnm') install --lts")
    }
    else {
      Write-Para 'Node.js runs the tools and MCP servers that start with npx, which many packs and plugins use. fnm installs it and switches versions: follow the Windows install on its page, then open a new window.'
      Write-Link 'https://github.com/Schniz/fnm'
    }
  }
  $null = Invoke-Step 'Bun' 'required' { Test-Tool 'bun' $Script:MinBun } {
    if ($Script:Detail -like '*older*') { Write-Para "The plugin needs Bun $($Script:MinBun) or later."; Write-Box @("$(Format-Tool 'bun') upgrade") }
    else { Write-Para "Bun runs the agent's tools. Copy the Windows install line on its home page and run it."; Write-Link 'https://bun.sh' }
  }
  $null = Invoke-Step 'Claude Code' 'required' { Test-Tool 'claude' $Script:MinClaude } {
    if ($Script:Detail -like '*older*') { Write-Para "The plugin needs Claude Code $($Script:MinClaude) or later."; Write-Box @("$(Format-Tool 'claude') update") }
    else { Write-Para 'Claude Code is where the agent runs. Follow the Windows install on its setup page.'; Write-Link 'https://code.claude.com/docs/en/setup' }
  }
  $null = Invoke-Step 'poppler' 'recommended' { Test-Tool 'pdftoppm' } {
    Write-Para 'poppler lets the agent read PDFs.'
    Write-Box @('winget install --id oschwartz10612.Poppler -e')
  }
  $null = Invoke-Step 'jq' 'recommended' { Test-Tool 'jq' } {
    Write-Para 'jq reads JSON on the command line, and agents reach for it often.'
    Write-Box @('winget install --id jqlang.jq -e')
  }
  $null = Invoke-Step 'uv' 'recommended' { Test-Tool 'uv' } {
    Write-Para "uv runs the agent's Python scripts in a throwaway environment each time. Follow the Windows install on its page."
    Write-Link 'https://docs.astral.sh/uv/getting-started/installation/'
  }
  $null = Invoke-Step 'gh' $(if ($dev) { 'recommended' } else { 'optional' }) { Test-Tool 'gh' } {
    Write-Para $(if ($dev) { "GitHub's command line, for forks and pull requests while you develop the plugin." } else { "GitHub's command line. Only the GitHub pack needs it." })
    Write-Box @('winget install --id GitHub.cli -e')
  }
  $programs = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs'
  $null = Invoke-Step 'Obsidian' 'recommended' { Test-App (Join-Path $programs 'Obsidian' 'Obsidian.exe') } {
    Write-Para "Obsidian reads the agent's brain: open its folder as a vault to follow the links and see the graph."
    Write-Link 'https://obsidian.md'
  }
  $null = Invoke-Step 'Tabby' $(if ($dev) { 'recommended' } else { 'optional' }) { Test-App (Join-Path $programs 'Tabby' 'Tabby.exe') } {
    Write-Para 'A terminal with a tab or split per agent session, with Git Bash as its shell.'
    Write-Link 'https://tabby.sh'
  }
  if ($dev) {
    $null = Invoke-Step 'VS Code' 'recommended' { Test-Tool 'code' } {
      Write-Para "An editor for the plugin's code while you develop it."
      Write-Link 'https://code.visualstudio.com'
    }
  }
  if ($Script:Pending) { Complete-Guide }

  Write-Host ''
  Write-Para "Windows has no sandbox for the agent's shell commands, so it asks before running them. WSL2 is the alternative: in it, the curl line from the docs sets up a Linux agent."
  if ($Script:Goal -eq 'prereqs') { Complete-Prereqs }

  $newHome = ''
  if ($Name -or $HomeFolder -or $homes.Count -eq 0) {
    if ($HomeFolder) { $newHome = [IO.Path]::GetFullPath($HomeFolder) }
    else {
      if (-not $Name) {
        do { $Name = Read-Answer 'What should your agent be called?' $Script:DefaultName } while ($Name -notmatch $Script:NamePattern)
      }
      $newHome = Join-Path $Script:AgentsDir $Name
    }
    if (-not $Name) { $Name = Split-Path $newHome -Leaf }
    if ($Name -notmatch $Script:NamePattern) { $Name = '' }
    if ((Get-HomePlugin $newHome) -eq $Script:Plugin) { $homes = @($newHome); $newHome = '' }
    else {
      $problem = Get-FolderProblem $newHome
      if ($problem) { Write-Host "  $problem" -ForegroundColor Red; exit 1 }
      # A folder holding only .claude, from a run that stopped after the plugin step, counts as empty.
      $files = @(Get-ChildItem -Force $newHome -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne '.claude' })
      if ($files.Count -and (Read-Answer "$newHome already holds files. Set the agent up there anyway? (y/n)" 'n') -notmatch '^[yY]') {
        Write-Para 'Pick another folder with -Name or -HomeFolder, then run the guide again.'
        exit 0
      }
    }
  }

  if ($dev) {
    if (-not $Script:CloneFolder) { $Script:CloneFolder = $Script:DefaultClone }
    $url = $Script:RepoUrl
    if (-not (Test-Clone $Script:CloneFolder)) { $url = Read-Answer "Clone from (our repository, or your fork's URL)" $Script:RepoUrl }
    $cloneFolder = $Script:CloneFolder
    $null = Invoke-Step 'Your clone' 'required' { $Script:Detail = $cloneFolder; Test-Clone $cloneFolder } {
      Write-Para 'Your copy of the plugin: our repository, or your fork of it. Claude Code runs the plugin straight from this folder.'
      Write-Box @("git clone $url $(Format-Path $cloneFolder)")
    }
    if ($Script:Pending) { Complete-Guide }
  }

  $targets = if ($newHome) { @($newHome) } else { $homes }
  foreach ($target in $targets) {
    $problem = Get-PinProblem $target
    if ($problem) { Write-Host "  $problem" -ForegroundColor Red; exit 1 }
  }
  if ($newHome) {
    $null = Invoke-Step "$(Split-Path $newHome -Leaf)'s folder" 'required' { $Script:Detail = $newHome; Test-Path $newHome } {
      Write-Para "The agent's home, where everything it knows is kept as plain files."
      Write-Box @("New-Item -ItemType Directory -Force $(Format-Path $newHome)")
    }
    if ($Script:Pending) { Complete-Guide }
  }
  $roots = @()
  foreach ($target in $targets) {
    if (-not $newHome) { Write-Done (Split-Path $target -Leaf) "$target is set up" }
    $plugged = Invoke-Step "Plugin for $(Split-Path $target -Leaf)" 'required' {
      $script:found = Get-PluginFor $target
      if (-not $script:found) { $Script:Detail = 'not installed for this folder'; return $false }
      $isDev = $script:found.Source -eq $Script:DevMarketplace
      $Script:Detail = if ($isDev) { "dev install from $($script:found.Root)" } else { "from the $($script:found.Source) marketplace" }
      if (-not $script:found.Enabled) { $Script:Detail += ', but turned off'; return $false }
      if ($Script:PathFromHome) { return $true }
      $sameClone = $isDev -and (Test-Path $script:found.Root) -and (Test-Path $Script:CloneFolder) -and
        (Resolve-Path $script:found.Root).Path -eq (Resolve-Path $Script:CloneFolder).Path
      if ($dev -and -not $sameClone) { $Script:Detail += ', not your clone'; return $false }
      if (-not $dev -and $isDev) { $Script:Detail += ', not the marketplace'; return $false }
      $true
    } {
      $here = "Set-Location $(Format-Path $target)"
      if ($script:found -and -not $script:found.Enabled) {
        Write-Para 'The plugin is installed for this folder but turned off, which happens when the trust question is dismissed. Turn it back on:'
        Write-Box @("$here; $(Format-Tool 'claude') plugin enable $($Script:Plugin)@$($script:found.Source) -s local")
        return
      }
      # A user-scope copy is shared by every folder, so it's switched off for this one rather than removed.
      $remove = @()
      if ($script:found -and $script:found.Scope -eq 'user') {
        Write-Para "This folder uses the plugin from $($script:found.Source) that every folder shares, not the one you picked. The first line switches that copy off for this folder only."
        $remove = @("$here; $(Format-Tool 'claude') plugin disable $($Script:Plugin)@$($script:found.Source) -s local")
      } elseif ($script:found) {
        Write-Para "This folder has the plugin from $($script:found.Source), not the one you picked. The first line removes that copy."
        $remove = @("$here; $(Format-Tool 'claude') plugin uninstall $($Script:Plugin)@$($script:found.Source) -s $($script:found.Scope)")
      }
      if ($dev) {
        Write-Para 'Add your clone as a marketplace, then switch the plugin on for this folder only.'
        Write-Box @($remove + "$(Format-Tool 'claude') plugin marketplace add $(Format-Path $Script:CloneFolder)" + "$here; $(Format-Tool 'claude') plugin install $($Script:Plugin)@$($Script:DevMarketplace) -s local")
      } else {
        Write-Para 'This switches the plugin on for this folder only, and adds the AgentLayer marketplace to Claude Code the first time.'
        Write-Box @($remove + "$here; $(Format-Tool 'claude') plugin install $($Script:Plugin) --marketplace $($Script:MarketplaceRepo) -s local")
      }
    }
    if ($plugged -and $roots -notcontains $script:found.Root) {
      $root = $script:found.Root
      $roots += $root
      $null = Invoke-Step 'Packages' 'required' { Test-Packages $root } {
        Write-Para "The plugin's packages, and the browser its web tools use: about 300 MB the first time."
        Write-Box @("Set-Location $(Format-Path $root); $(Format-Tool 'bun') install")
      }
    }
  }
  Complete-Guide -NewHome $newHome -Homes $targets
}

function Complete-Prereqs {
  Write-Host ''
  if ($Script:Pending -gt 0) {
    Write-Para "$($Script:Pending) required step(s) left. Run the same line again when they're done; finished steps are skipped."
    Write-Host ''
    exit 1
  }
  Write-Para 'Your PC is ready for an agent.'
  Write-Para "To set one up, run the guide again and choose Set up an agent. An agent from another plugin moves over with that plugin's own move command instead."
  Write-Host ''
  exit 0
}

function Complete-Guide([string]$NewHome = '', [string[]]$Homes = @()) {
  Write-Host ''
  if ($Script:Pending -gt 0) {
    Write-Para "$($Script:Pending) required step(s) left. Run the same line again when they're done; finished steps are skipped."
    Write-Host ''
    exit 1
  }
  if ($Script:Mode -eq 'check') { Write-Para "Everything's set up."; Write-Host ''; exit 0 }
  $claude = Format-Tool 'claude'
  if ($NewHome) {
    $init = if ($Name) { "/$($Script:Plugin):init name=$Name" } else { "/$($Script:Plugin):init" }
    Write-Para 'Ready. Start setup, which asks a few questions and wakes your agent:'
    Write-Box @("Set-Location $(Format-Path $NewHome); $claude '$init'")
  } else {
    Write-Para 'Nothing to do. Start an agent:'
    # A home with its own Claude subscription starts with the agent launcher, which passes that file to Claude Code.
    Write-Box @($Homes | ForEach-Object {
        $launcher = if (Test-Path (Join-Path $_ '.state' 'secrets' '.env.claude.json')) { 'agent' } else { $claude }
        "Set-Location $(Format-Path $_); $launcher"
      })
    Write-Para 'A new agent: run the guide again with -Name and the name you want.'
  }
  Write-Host ''
  exit 0
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-Guide }
# agentlayer:end
