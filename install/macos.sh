#!/usr/bin/env bash
# The macOS setup guide, started by install.sh. It checks each step and shows what to do; the user
# runs every command. Rerunning it is always safe: finished steps are ticked and skipped.
set -uo pipefail

AL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$AL_DIR/lib.sh"

AL_OS_NAME=macOS
AL_MIN_MACOS=26
# The cmux pack looks for cmux in the first of these. Overridable so tests see only their own apps.
AL_APP_DIRS=${AL_APP_DIRS:-"/Applications:$HOME/Applications"}

mac_app() {
  local dir IFS=:
  AL_APP_PATH=""
  for dir in $AL_APP_DIRS; do
    if [[ -d "$dir/$1.app" ]]; then
      AL_APP_PATH="$dir/$1.app"
      return 0
    fi
  done
  return 1
}

mac_app_version() {
  plutil -extract CFBundleShortVersionString raw -o - "$1/Contents/Info.plist" 2>/dev/null
}

mac_primary_apps() {
  printf '%s' "${AL_APP_DIRS%%:*}"
}

mac_app_check() {
  if mac_app "$1"; then
    AL_DETAIL=$(mac_app_version "$AL_APP_PATH")
    return 0
  fi
  AL_DETAIL="not installed"
  return 1
}

os_package() {
  if command -v brew >/dev/null 2>&1; then
    al_box "$(al_tool_path brew) install $1"
  else
    al_para "This one comes through Homebrew. Install Homebrew first (the step above), or skip it for now."
    al_link https://brew.sh
  fi
}

# --- This Mac ---

check_macos() {
  local version
  version=$(sw_vers -productVersion 2>/dev/null)
  AL_DETAIL="macOS ${version:-unknown}"
  [[ -n $version ]] && al_version_ge "$version" "$AL_MIN_MACOS"
}

show_macos() {
  al_para "The guide needs macOS $AL_MIN_MACOS or later, and this Mac runs ${AL_DETAIL#macOS }. Update it in System Settings, General, Software Update, then run the guide again. To set up an older Mac by hand, follow the docs."
  al_link "$AL_DOCS"
}

# --- CotEditor ---

check_coteditor() { mac_app_check CotEditor; }

show_coteditor() {
  al_para "A plain-text editor for the agent's notes and settings files. Some steps, and setup itself, may ask you to edit a config file; TextEdit can save rich text and curl straight quotes, which breaks JSON and config files. Download it from its site or the App Store."
  al_link https://coteditor.com
}

# --- Homebrew ---

check_brew() { al_tool_check brew; }

show_brew() {
  al_para "Homebrew installs the command-line tools below, and its installer also installs Apple's Command Line Tools (git) when they're missing. Copy the install line on its home page, run it, then run the Next steps it prints."
  al_link https://brew.sh
}

# --- Command Line Tools ---

check_clt() {
  if ! xcode-select -p >/dev/null 2>&1; then
    AL_DETAIL="not installed"
    return 1
  fi
  al_tool_check git || return 1
  AL_DETAIL="git $AL_DETAIL"
}

show_clt() {
  al_para "Apple's Command Line Tools bring git, which the agent's history and the plugin's install use. Run this; Apple's dialog takes about ten minutes."
  al_box "xcode-select --install"
}

# --- Tools ---

show_gh() {
  gh_purpose
  os_package gh
}

# --- cmux ---

decide_cmux() {
  if [[ -z $AL_CMUX ]]; then
    if mac_app cmux; then
      AL_CMUX=yes
    else
      al_choose "Use cmux as your agent's workspace? It's a Mac terminal for running agents side by side, with the AgentLayer sidebar." \
        "Yes, use cmux (recommended)" "No, skip it"
      if [[ $AL_CHOICE == 1 ]]; then AL_CMUX=yes; else AL_CMUX=no; fi
    fi
  fi
  if [[ $AL_CMUX == yes ]]; then al_done "Workspace" "cmux"; else al_done "Workspace" "no cmux"; fi
}

check_ghostty() { mac_app_check Ghostty; }

show_ghostty() {
  al_para "cmux draws with Ghostty's engine and reads its settings, so Ghostty comes first. Download it from its site."
  al_link https://ghostty.org
}

check_cmux() {
  local primary
  primary=$(mac_primary_apps)
  if [[ -d "$primary/cmux.app" ]]; then
    al_meets_floor "$(mac_app_version "$primary/cmux.app")" "$AL_MIN_CMUX"
    return
  fi
  if mac_app cmux; then
    AL_DETAIL="in $(al_show_path "$(dirname "$AL_APP_PATH")"), not $primary"
    return 1
  fi
  AL_DETAIL="not installed"
  return 1
}

show_cmux() {
  case "$AL_DETAIL" in
    *older*) al_para "Open cmux and choose cmux, Check for Updates, in its menu. The AgentLayer sidebar needs $AL_MIN_CMUX or later." ;;
    in\ *) al_para "Move cmux.app into $(mac_primary_apps): the AgentLayer sidebar looks for it there." ;;
    *)
      al_para "Download cmux, drag it into Applications, and open it once."
      al_link https://cmux.com
      ;;
  esac
}

# --- Apps ---

check_obsidian() { mac_app_check Obsidian; }

check_vscode() { mac_app_check "Visual Studio Code"; }

# --- Ghostty and cmux settings ---

MAC_SETTINGS_FILE=""
MAC_SETTINGS_REPORT=""
MAC_SETTINGS_COMMAND=""
MAC_SETTINGS_PASTE=""

# One read of the plugin's checker: the missing count and summary first, then the parts a card shows.
check_settings() {
  local parsed status
  parsed=$(AGENT_LOG_FILE=off bun "$AL_ROOT/src/cli.ts" cmux settings --file="$MAC_SETTINGS_FILE" --launcher="$MAC_LAUNCHER" --json </dev/null 2>/dev/null | bun -e '
    const report = JSON.parse(await Bun.stdin.text());
    process.stdout.write([report.status, report.summary, report.report.join("\n"), report.command, report.paste].join("\x1e"));
  ' 2>/dev/null)
  if [[ -z $parsed ]]; then
    AL_DETAIL="this plugin version can't check them yet"
    return 0
  fi
  IFS=$'\x1e' read -r -d '' status AL_DETAIL MAC_SETTINGS_REPORT MAC_SETTINGS_COMMAND MAC_SETTINGS_PASTE <<<"$parsed" || true
  [[ $status == ok ]]
}

show_settings() {
  local line
  while IFS= read -r line; do [[ -n $line ]] && al_para "$line"; done <<<"$MAC_SETTINGS_REPORT"
  [[ -n $MAC_SETTINGS_COMMAND ]] || return 0
  printf '\n'
  al_box "$MAC_SETTINGS_COMMAND"
  AL_COMMAND=$MAC_SETTINGS_PASTE
  al_note "c copies what to paste; then run the command above. Your own values stay as they are."
}

# Machine-wide, so checked once, with the first plugin folder's checker.
MAC_LAUNCHER=claude

os_after_agents() {
  local home
  [[ $AL_CMUX == yes && -n $AL_FIRST_ROOT ]] || return 0
  AL_ROOT=$AL_FIRST_ROOT
  # Any home with its own subscription makes agent the button's launcher; it runs plain claude everywhere else.
  for home in ${AL_HOMES[@]+"${AL_HOMES[@]}"}; do
    [[ -f $home/.state/secrets/.env.claude.json ]] && MAC_LAUNCHER=agent
  done
  MAC_SETTINGS_FILE=ghostty
  al_step "Ghostty settings" recommended check_settings show_settings
  MAC_SETTINGS_FILE=cmux
  al_step "cmux settings" recommended check_settings show_settings
}

main() {
  local gh_kind=optional obsidian_kind=optional
  al_parse_args "$@"
  al_style_init
  al_header "Mac setup guide"

  al_step "This Mac" required check_macos show_macos || finish

  al_load_homes
  decide_path
  [[ $AL_PATH_CHOICE == dev ]] && gh_kind=recommended

  al_step "CotEditor" recommended check_coteditor show_coteditor
  al_step "Homebrew" recommended check_brew show_brew
  al_step "Command Line Tools" required check_clt show_clt
  al_step "Bun" required check_bun show_bun
  al_step "Claude Code" required check_claude show_claude
  al_step "poppler" recommended check_poppler show_poppler
  al_step "jq" recommended check_jq show_jq
  al_step "uv" recommended check_uv show_uv
  al_step "gh" "$gh_kind" check_gh show_gh

  decide_cmux
  if [[ $AL_CMUX == yes ]]; then
    al_step "Ghostty" required check_ghostty show_ghostty
    al_step "cmux" required check_cmux show_cmux
  else
    obsidian_kind=recommended
    al_step "Ghostty" optional check_ghostty show_ghostty
  fi
  al_step "Obsidian" "$obsidian_kind" check_obsidian show_obsidian
  [[ $AL_PATH_CHOICE == dev ]] && al_step "VS Code" recommended check_vscode show_vscode

  al_agent_steps
}

main "$@"
# agentlayer:end
