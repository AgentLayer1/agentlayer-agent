#!/usr/bin/env bash
# The Linux setup guide, started by install.sh. It checks each step and shows what to do; the user
# runs every command. Rerunning it is always safe: finished steps are ticked and skipped.
set -uo pipefail

AL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$AL_DIR/lib.sh"

AL_OS_NAME=Linux
LINUX_MANAGER=""

linux_manager() {
  local manager
  for manager in apt-get dnf pacman zypper; do
    if command -v "$manager" >/dev/null 2>&1; then
      LINUX_MANAGER=$manager
      return
    fi
  done
}

# linux_install <apt and dnf name> <pacman name> <zypper name>
linux_install() {
  case "$LINUX_MANAGER" in
    apt-get | dnf) al_box "sudo $LINUX_MANAGER install $1" ;;
    pacman) al_box "sudo pacman -S $2" ;;
    zypper) al_box "sudo zypper install $3" ;;
    *) al_para "Install $1 with your system's package manager." ;;
  esac
}

os_package() {
  case "$1" in
    poppler) linux_install poppler-utils poppler poppler-tools ;;
    *) linux_install "$1" "$1" "$1" ;;
  esac
}

# --- This system ---

check_system() {
  AL_DETAIL=$(uname -sr 2>/dev/null)
  [[ "$(uname -s 2>/dev/null)" == Linux ]]
}

show_system() {
  al_para "This guide is for Linux. Elsewhere, follow the docs."
  al_link "$AL_DOCS"
}

# --- git ---

check_git() { al_tool_check git; }

show_git() {
  al_para "git versions what the agent knows, and the plugin's install uses it."
  os_package git
}

# --- Tools ---

show_gh() {
  gh_purpose
  al_para "Follow the Linux install on its page."
  al_link https://cli.github.com
}

# --- Apps ---

check_obsidian() {
  command -v obsidian >/dev/null 2>&1 && AL_DETAIL=installed && return 0
  AL_DETAIL="not found"
  return 1
}

check_vscode() { al_tool_check code; }

# --- The browser's system libraries ---

# The browser the web tools use links against system libraries a fresh system often lacks.
check_browser_libs() {
  local browser missing
  for browser in "$AL_ROOT"/node_modules/playwright-core/.local-browsers/chromium_headless_shell-*/*/chrome-headless-shell; do
    if [[ -x $browser ]]; then
      missing=$(ldd "$browser" 2>/dev/null | sed -n 's/^[[:space:]]*\([^[:space:]]*\) => not found.*/\1/p' | tr '\n' ' ')
      if [[ -z ${missing// /} ]]; then
        AL_DETAIL="all present"
        return 0
      fi
      AL_DETAIL="missing ${missing% }"
      return 1
    fi
  done
  AL_DETAIL="no browser to check yet"
  return 0
}

show_browser_libs() {
  al_para "The web tools' browser needs a few system libraries this machine doesn't have. Everything else works without them. Playwright installs them for your system with this, which asks for your password:"
  # sudo resets PATH, so Bun goes by its full path.
  al_box "cd $(al_show_path "$AL_ROOT") && sudo $(al_show_path "$(command -v bun)") x playwright install-deps chromium"
}

os_after_agents() {
  [[ -n $AL_FIRST_ROOT ]] || return 0
  AL_ROOT=$AL_FIRST_ROOT
  al_step "Browser libraries" recommended check_browser_libs show_browser_libs
}

main() {
  local gh_kind=optional
  al_parse_args "$@"
  al_style_init
  linux_manager
  al_header "Linux setup guide"

  al_step "This system" required check_system show_system || finish

  al_load_homes
  decide_path
  [[ $AL_PATH_CHOICE == dev ]] && gh_kind=recommended

  al_step "git" required check_git show_git
  al_step "Bun" required check_bun show_bun
  al_step "Claude Code" required check_claude show_claude
  al_step "poppler" recommended check_poppler show_poppler
  al_step "jq" recommended check_jq show_jq
  al_step "uv" recommended check_uv show_uv
  al_step "gh" "$gh_kind" check_gh show_gh
  al_step "Obsidian" recommended check_obsidian show_obsidian
  [[ $AL_PATH_CHOICE == dev ]] && al_step "VS Code" recommended check_vscode show_vscode

  al_agent_steps
}

main "$@"
# agentlayer:end
