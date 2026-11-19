# shellcheck shell=bash
# The setup guides' shared parts. A guide only looks: everything here reads, prints or asks.
# Nothing installs, creates, downloads or launches; the user runs every command the guide shows.
# Written for bash 3.2, the bash a fresh Mac runs `curl … | bash` with.

AL_MIN_BUN=1.4.4
AL_MIN_CLAUDE=2.1.314
AL_MIN_CMUX=0.65.2
AL_NAME_PATTERN='^[A-Za-z0-9][A-Za-z0-9 -]*$'
AL_PLUGIN=agentlayer
AL_DEV_MARKETPLACE=agentlayer-dev
AL_MARKETPLACE_REPO=AgentLayer1/agentlayer-agent-marketplace
AL_REPO_URL=https://github.com/AgentLayer1/agentlayer-agent.git
AL_DOCS=https://agentlayer.one/docs/getting-started/install
AL_AGENTS_DIR="$HOME/Documents/Agents"
AL_DEFAULT_NAME=Oppi
AL_DEFAULT_CLONE="$HOME/Developer/agentlayer-agent"
# Where installers put tools before a shell profile puts them on PATH. Overridable so tests see only their stubs.
AL_TOOL_DIRS=${AL_TOOL_DIRS:-"$HOME/.bun/bin:$HOME/.local/bin:$HOME/.local/share/fnm:/opt/homebrew/bin:/usr/local/bin"}

AL_MODE=guide
# agent (set one up) or prereqs (only the apps and tools); empty until a flag or the welcome menu picks.
AL_GOAL=""
# What the guide calls this computer: "this Mac", "your Mac". A guide sets its own.
AL_MACHINE=machine
AL_KEY=""
AL_NAME=""
AL_HOME=""
AL_CMUX=""
AL_PATH_CHOICE=""
AL_CLONE=""
AL_PATH_FROM_HOME=""
AL_PENDING=0
AL_DETAIL=""
AL_LINK=""
AL_COMMAND=""

al_usage() {
  cat <<EOF
AgentLayer setup guide. It checks this machine and shows each step to do: a link to the maker's site,
or a command for you to read, copy and run. It installs and changes nothing itself.

  --prereqs           only the apps and tools, to get a machine ready before any agent is set up
  --name <name>       set up a new agent called <name> (its folder: ~/Documents/Agents/<name>)
  --home <folder>     set up a new agent in this folder
  --marketplace       get the plugin from the marketplace (to use the agent)
  --dev [<folder>]    get the plugin from a local clone or your fork (to develop it)
  --cmux, --no-cmux   use cmux as the agent's workspace, or don't ask (macOS)
  --check             print what's done and what's left, then stop

By hand: $AL_DOCS
EOF
}

al_die() {
  printf '%s\n' "$1" >&2
  exit "${2:-1}"
}

al_parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name)
        [[ $# -ge 2 ]] || al_die "--name needs a value." 2
        AL_NAME=$2
        shift
        ;;
      --name=*) AL_NAME=${1#--name=} ;;
      --home)
        [[ $# -ge 2 ]] || al_die "--home needs a value." 2
        AL_HOME=$2
        shift
        ;;
      --home=*) AL_HOME=${1#--home=} ;;
      --marketplace) AL_PATH_CHOICE=marketplace ;;
      --dev)
        AL_PATH_CHOICE=dev
        if [[ $# -ge 2 && $2 != --* ]]; then
          AL_CLONE=$2
          shift
        fi
        ;;
      --dev=*)
        AL_PATH_CHOICE=dev
        AL_CLONE=${1#--dev=}
        ;;
      --cmux) AL_CMUX=yes ;;
      --no-cmux) AL_CMUX=no ;;
      --prereqs | --prerequisites) AL_GOAL=prereqs ;;
      --check) AL_MODE=check ;;
      --list) [[ $AL_MODE == check ]] || AL_MODE=list ;;
      --help | -h)
        al_usage
        exit 0
        ;;
      *) al_die "Unknown option: $1 (see --help)." 2 ;;
    esac
    shift
  done
  if [[ -n $AL_NAME && ! $AL_NAME =~ $AL_NAME_PATTERN ]]; then
    al_die "\"$AL_NAME\" won't work as a name. Use letters, digits, spaces and hyphens, starting with a letter or digit." 2
  fi
}

# --- The look -----------------------------------------------------------------

# Oppi's colors and banner, copies of the plugin's (src/shared/persona.ts, src/hooks/banner.ts): the guide runs
# before any agent exists, so it wears the ones a new agent wakes up with.
AL_COLOR_PRIMARY='#B456A8'
AL_COLOR_ACCENT='#3BAA70'
AL_WORDMARK=(' ╔═╗ ╔═╗ ╔═╗ ╔╗╔ ╔╦╗' ' ╠═╣ ║ ╦ ║╣  ║║║  ║ ' ' ╩ ╩ ╚═╝ ╚═╝ ╝╚╝  ╩ ')

al_rgb() {
  local hex=${1#\#}
  printf '\033[38;2;%d;%d;%dm' $((16#${hex:0:2})) $((16#${hex:2:2})) $((16#${hex:4:2}))
}

# Each terminal gets the closest it can draw: 24-bit, the 256-color palette, or plain magenta and green.
al_style_init() {
  if [[ -t 1 && -z ${NO_COLOR:-} && ${TERM:-dumb} != dumb ]]; then
    C_RESET=$'\033[0m' C_BOLD=$'\033[1m' C_DIM=$'\033[2m'
    C_YELLOW=$'\033[33m' C_RED=$'\033[31m' C_CYAN=$'\033[36m'
    case "${COLORTERM:-}:${TERM:-}" in
      truecolor:* | 24bit:*) AL_DEPTH=24 C_PRIMARY=$(al_rgb "$AL_COLOR_PRIMARY") C_ACCENT=$(al_rgb "$AL_COLOR_ACCENT") ;;
      *256color*) AL_DEPTH=8 C_PRIMARY=$'\033[38;5;133m' C_ACCENT=$'\033[38;5;72m' ;;
      *) AL_DEPTH=3 C_PRIMARY=$'\033[35m' C_ACCENT=$'\033[32m' ;;
    esac
  else
    AL_DEPTH=0 C_RESET='' C_BOLD='' C_DIM='' C_YELLOW='' C_RED='' C_CYAN='' C_PRIMARY='' C_ACCENT=''
  fi
  C_GREEN=$C_ACCENT
  case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
    *[Uu][Tt][Ff]-8* | *[Uu][Tt][Ff]8*)
      G_DONE='✓' G_TODO='○' G_FAIL='✗' G_ARROW='→' G_DOT='·' G_LOGO='🐙 '
      B_TL='┌' B_TR='┐' B_BL='└' B_BR='┘' B_H='─' B_V='│'
      R_TL='╭' R_TR='╮' R_BL='╰' R_BR='╯'
      ;;
    *)
      G_DONE='ok' G_TODO='..' G_FAIL='!!' G_ARROW='->' G_DOT='-' G_LOGO=''
      B_TL='+' B_TR='+' B_BL='+' B_BR='+' B_H='-' B_V='|'
      R_TL='+' R_TR='+' R_BL='+' R_BR='+'
      ;;
  esac
  AL_WIDTH=78
  if [[ -t 1 ]]; then
    local cols
    cols=$(tput cols 2>/dev/null || echo 78)
    [[ $cols =~ ^[0-9]+$ ]] && ((cols < 78)) && AL_WIDTH=$cols
  fi
}

# Line i of the wordmark's three, shaded from orchid to a lighter pink.
al_shade() {
  local codes=(133 170 212)
  case $AL_DEPTH in
    24) printf '\033[38;2;%d;%d;%dm' $((16#${AL_COLOR_PRIMARY:1:2} + 26 * $1)) $((16#${AL_COLOR_PRIMARY:3:2} + 18 * $1)) \
      $((16#${AL_COLOR_PRIMARY:5:2} + 15 * $1)) ;;
    8) printf '\033[38;5;%sm' "${codes[$1]}" ;;
    *) printf '%s' "$C_PRIMARY" ;;
  esac
}

# A box with a title in its top edge, for what a reader should take in before anything else.
al_panel() {
  local title=$1 width=$((AL_WIDTH - 6)) text line first=1
  local inner=$((width - 4))
  shift
  printf '  %s%s%s %s%s%s %s%s%s\n' "$C_ACCENT" "$R_TL$B_H" "$C_RESET" "$C_BOLD" "$title" "$C_RESET" \
    "$C_ACCENT" "$(al_repeat "$B_H" $((width - ${#title} - 5)))$R_TR" "$C_RESET"
  for text in "$@"; do
    [[ -n $first ]] || printf '  %s%s%s%s%s%s\n' "$C_ACCENT" "$B_V" "$(al_repeat ' ' $((width - 2)))" "$B_V" "$C_RESET"
    first=""
    while IFS= read -r line; do
      line=${line% }
      printf '  %s%s%s %s%s %s%s%s\n' "$C_ACCENT" "$B_V" "$C_RESET" "$line" "$(al_repeat ' ' $((inner - ${#line})))" \
        "$C_ACCENT" "$B_V" "$C_RESET"
    done <<<"$(printf '%s\n' "$text" | fold -s -w "$inner")"
  done
  printf '  %s%s%s\n' "$C_ACCENT" "$R_BL$(al_repeat "$B_H" $((width - 2)))$R_BR" "$C_RESET"
}

al_header() {
  local i
  if [[ $AL_MODE != guide ]]; then
    printf '\n  %s%s%sAgentLayer %s %s%s\n\n' "$C_BOLD" "$C_PRIMARY" "$G_LOGO" "$G_DOT" "$1" "$C_RESET"
    return
  fi
  printf '\n'
  if [[ -n $G_LOGO ]] && ((AL_WIDTH >= 40)); then
    for i in 0 1 2; do printf '  %s%s%s%s\n' "$C_BOLD" "$(al_shade "$i")" "${AL_WORDMARK[i]}" "$C_RESET"; done
    printf '   %s%s===%s=== %s%s\n\n' "$C_BOLD" "$C_ACCENT" "$(printf '%s' "$AL_DEFAULT_NAME" | tr '[:lower:]' '[:upper:]')" "${G_LOGO% }" "$C_RESET"
    printf '   %s%s%s %s%s agentlayer.one%s\n\n' "$C_BOLD" "$1" "$C_RESET" "$C_DIM" "$G_DOT" "$C_RESET"
  else
    printf '  %s%sAgentLayer %s %s%s\n\n' "$C_BOLD" "$C_PRIMARY" "$G_DOT" "$1" "$C_RESET"
  fi
  al_panel "A guide, not an installer" \
    "Nothing here installs or changes anything by itself. It checks this $AL_MACHINE one step at a time and shows what to do: a link to the maker's own site, or a command for you to read, copy and run yourself. Nothing needs sudo." \
    "Run it again any time. Finished steps are simply ticked."
  printf '\n'
}

al_menu_line() {
  printf '    %s%s%s%s  %s%-20s%s %s%s%s\n' "$C_BOLD" "$C_ACCENT" "$1" "$C_RESET" "$C_BOLD" "$2" "$C_RESET" "$C_DIM" "$3" "$C_RESET"
}

# Asked only when the command line hasn't already said what to do, and only with someone at the keyboard.
al_menu() {
  if [[ $AL_MODE != guide || -n $AL_GOAL || -n $AL_NAME || -n $AL_HOME ]]; then
    AL_GOAL=${AL_GOAL:-agent}
    return 0
  fi
  AL_GOAL=agent
  printf '  %sWhat would you like to do?%s\n\n' "$C_BOLD" "$C_RESET"
  al_menu_line 1 "Set up an agent" "the tools, then the agent's folder and plugin"
  al_menu_line 2 "Prepare this $AL_MACHINE" "only the apps and tools, ready for an agent later"
  al_menu_line 3 "Check this $AL_MACHINE" "a list of what's done and what's left"
  al_menu_line q "Quit" ""
  printf '\n    %sPress 1, 2, 3 or q (Enter for 1):%s ' "$C_DIM" "$C_RESET"
  AL_KEY=""
  while al_read_key; do
    case "$AL_KEY" in
      "" | 1) break ;;
      2) AL_GOAL=prereqs && break ;;
      3) AL_MODE=check && break ;;
      q | Q) printf 'q\n' && al_quit ;;
    esac
  done
  printf '%s\n' "${AL_KEY:-1}"
}

al_done() {
  if [[ -n $2 ]]; then
    printf '  %s%s%s %s %s%s %s%s\n' "$C_GREEN" "$G_DONE" "$C_RESET" "$1" "$C_DIM" "$G_DOT" "$2" "$C_RESET"
  else
    printf '  %s%s%s %s\n' "$C_GREEN" "$G_DONE" "$C_RESET" "$1"
  fi
}

al_todo_line() {
  printf '  %s%s%s %s %s%s %s%s\n' "$C_YELLOW" "$G_TODO" "$C_RESET" "$1" "$C_DIM" "$G_DOT" "$2" "$C_RESET"
}

al_fail_line() {
  printf '  %s%s %s%s\n' "$C_RED" "$G_FAIL" "$1" "$C_RESET"
}

al_para() {
  printf '%s\n' "$1" | fold -s -w $((AL_WIDTH - 6)) | sed 's/^/    /'
}

al_note() {
  printf '%s' "$C_DIM"
  al_para "$1"
  printf '%s' "$C_RESET"
}

al_link() {
  AL_LINK=$1
  printf '    %s%s %s%s\n' "$C_CYAN" "$G_ARROW" "$1" "$C_RESET"
}

al_repeat() {
  local spaces
  printf -v spaces '%*s' "$2" ''
  printf '%s' "${spaces// /$1}"
}

# The shown commands, boxed; the last box's text is what the c key copies.
al_box() {
  local line width=0
  for line in "$@"; do ((${#line} > width)) && width=${#line}; done
  printf '    %s%s%s\n' "$C_DIM" "$B_TL$(al_repeat "$B_H" $((width + 2)))$B_TR" "$C_RESET"
  for line in "$@"; do
    printf '    %s%s%s %s%s%s%s %s%s%s\n' "$C_DIM" "$B_V" "$C_RESET" "$C_BOLD" "$line" "$C_RESET" \
      "$(al_repeat ' ' $((width - ${#line})))" "$C_DIM" "$B_V" "$C_RESET"
  done
  printf '    %s%s%s\n' "$C_DIM" "$B_BL$(al_repeat "$B_H" $((width + 2)))$B_BR" "$C_RESET"
  AL_COMMAND=$(printf '%s\n' "$@")
}

al_card_title() {
  local title=$1 kind=$2
  local pad=$((AL_WIDTH - ${#title} - ${#kind} - 8))
  ((pad < 1)) && pad=1
  printf '\n  %s%s %s %s%s%s%s\n\n' "$C_BOLD" "$(al_repeat "$B_H" 2)" "$title" \
    "$(al_repeat "$B_H" "$pad")" "$C_RESET" "$C_DIM" " $kind$C_RESET"
}

# --- Versions and tools (read-only) ---------------------------------------------

al_version_of() {
  [[ $1 =~ ([0-9]+(\.[0-9]+)+) ]] && printf '%s' "${BASH_REMATCH[1]}"
}

# True when version $1 is at least $2.
al_version_ge() {
  local IFS=. i have_part need_part
  local -a have=($1) need=($2)
  for ((i = 0; i < ${#need[@]}; i++)); do
    have_part=${have[i]:-0}
    need_part=${need[i]:-0}
    have_part=${have_part%%[!0-9]*}
    need_part=${need_part%%[!0-9]*}
    ((10#${have_part:-0} > 10#${need_part:-0})) && return 0
    ((10#${have_part:-0} < 10#${need_part:-0})) && return 1
  done
  return 0
}

# Tools an installer just added are found without a new terminal: their folders join PATH here.
al_refresh_path() {
  local dir IFS=:
  for dir in $AL_TOOL_DIRS; do
    [[ -d $dir && ":$PATH:" != *":$dir:"* ]] && PATH="$PATH:$dir"
  done
  export PATH
}

# The full path when a tool isn't on the user's own PATH yet, so a shown command works in any tab.
al_tool_path() {
  local found
  found=$(command -v "$1" 2>/dev/null) || {
    printf '%s' "$1"
    return
  }
  case ":$AL_USER_PATH:" in
    *":$(dirname "$found"):"*) printf '%s' "$1" ;;
    *) al_show_path "$found" ;;
  esac
}

# A path as a command shows it: ~/… when nothing needs quoting, else the full path in single quotes,
# with any single quote inside it escaped, so a pasted command never expands or breaks on it.
al_show_path() {
  local path=$1 quote="'"
  if [[ $path =~ ^[A-Za-z0-9_./@+-]+$ ]]; then
    [[ $path == "$HOME"/* ]] && path="~/${path#"$HOME"/}"
    printf '%s' "$path"
  else
    printf "'%s'" "${path//$quote/$quote\\$quote$quote}"
  fi
}

# Sets AL_DETAIL to the version, or to "<version> is older than <floor>", which a step's card matches on.
al_meets_floor() {
  local version=$1 floor=$2
  AL_DETAIL=${version:-installed}
  [[ -z $floor ]] && return 0
  al_version_ge "${version:-0}" "$floor" && return 0
  AL_DETAIL="$version is older than $floor"
  return 1
}

# al_tool_check <tool> [floor] [version flag]: true when the tool runs and meets the floor.
al_tool_check() {
  local out
  if ! out=$("$1" "${3:---version}" 2>&1 </dev/null); then
    AL_DETAIL="not found"
    return 1
  fi
  al_meets_floor "$(al_version_of "$out")" "${2:-}"
}

# --- Keys and questions -----------------------------------------------------------

al_read_key() {
  local key=""
  IFS= read -r -s -n1 key || return 1
  AL_KEY=$key
}

al_ask() {
  local question=$1 default=$2 reply=""
  if [[ $AL_MODE != guide ]]; then
    AL_REPLY=$default
    return
  fi
  printf '\n    %s %s[%s]%s ' "$question" "$C_DIM" "$default" "$C_RESET"
  IFS= read -r reply || reply=""
  AL_REPLY=${reply:-$default}
}

# al_choose <question> <first, the default> <second>: sets AL_CHOICE to 1 or 2.
al_choose() {
  AL_CHOICE=1
  [[ $AL_MODE == guide ]] || return 0
  printf '\n    %s\n' "$1"
  printf '      %s[1]%s %s\n      %s[2]%s %s\n\n    %sChoose 1 or 2 (Enter for 1):%s ' \
    "$C_BOLD" "$C_RESET" "$2" "$C_BOLD" "$C_RESET" "$3" "$C_DIM" "$C_RESET"
  while al_read_key; do
    case "$AL_KEY" in
      "" | 1) AL_CHOICE=1 && break ;;
      2) AL_CHOICE=2 && break ;;
    esac
  done
  printf '%s\n' "$AL_CHOICE"
}

al_open_link() {
  case "$(uname -s)" in
    Darwin) open "$1" >/dev/null 2>&1 ;;
    *) xdg-open "$1" >/dev/null 2>&1 ;;
  esac || printf '    Open it yourself: %s\n' "$1"
}

al_copy() {
  if command -v pbcopy >/dev/null 2>&1; then
    printf '%s' "$1" | pbcopy
  elif command -v wl-copy >/dev/null 2>&1; then
    printf '%s' "$1" | wl-copy
  elif command -v xclip >/dev/null 2>&1; then
    printf '%s' "$1" | xclip -selection clipboard
  else
    printf '    No clipboard tool here; select the command above instead.\n'
    return
  fi
  printf '    %sCopied.%s\n' "$C_GREEN" "$C_RESET"
}

al_quit() {
  printf '\n  Stopped here. Run the same line again any time: finished steps are skipped.\n\n'
  exit 0
}

# --- Steps ------------------------------------------------------------------------

# al_step <title> <required|recommended|optional> <check> <show>
# A check sets AL_DETAIL and succeeds when the step is done. A show prints what to do, using
# al_link (the o key) and al_box (the c key). Optional steps are listed, never waited on.
al_step() {
  local title=$1 kind=$2 check=$3 show=$4
  al_refresh_path
  AL_DETAIL=""
  if "$check"; then
    al_done "$title" "$AL_DETAIL"
    return 0
  fi
  if [[ $AL_MODE == check ]]; then
    al_todo_line "$title" "$kind $G_DOT $AL_DETAIL"
    [[ $kind == required ]] && AL_PENDING=$((AL_PENDING + 1))
    return 1
  fi
  if [[ $kind == optional && $AL_MODE == guide ]]; then
    AL_LINK=""
    "$show" >/dev/null
    al_todo_line "$title" "optional${AL_LINK:+ $G_DOT $AL_LINK}"
    return 1
  fi
  AL_LINK="" AL_COMMAND=""
  al_card_title "$title" "$kind"
  [[ -n $AL_DETAIL ]] && printf '  %s%s %s%s\n\n' "$C_YELLOW" "$G_TODO" "$AL_DETAIL" "$C_RESET"
  "$show"
  if [[ $AL_MODE == list ]]; then
    [[ $kind == required ]] && AL_PENDING=$((AL_PENDING + 1))
    return 1
  fi
  al_wait "$kind" "$check" "$show"
}

al_keys_line() {
  local keys=""
  [[ -n $AL_LINK ]] && keys="$keys  [o] open link "
  [[ -n $AL_COMMAND ]] && keys="$keys  [c] copy "
  keys="$keys  [t] terminal here   [Enter] check "
  [[ $1 != required ]] && keys="$keys  [s] skip "
  printf '\n  %s%s  [q] quit%s\n' "$C_DIM" "$keys" "$C_RESET"
}

# After the user acted, so the plugin list is read again too.
al_recheck() {
  al_refresh_path
  AL_DETAIL="" AL_LISTING=""
  if "$1"; then
    al_done "Done" "$AL_DETAIL"
    return 0
  fi
  al_fail_line "Not yet: $AL_DETAIL"
  return 1
}

# A failed re-check redraws the step: the user may have moved it to another unfinished state with another fix.
al_redraw() {
  AL_LINK="" AL_COMMAND=""
  printf '\n'
  "$1"
  al_keys_line "$2"
}

al_wait() {
  local kind=$1 check=$2 show=$3
  al_keys_line "$kind"
  while true; do
    al_read_key || al_quit
    case "$AL_KEY" in
      "") al_recheck "$check" && return 0
        al_redraw "$show" "$kind" ;;
      o | O) [[ -n $AL_LINK ]] && al_open_link "$AL_LINK" ;;
      c | C) [[ -n $AL_COMMAND ]] && al_copy "$AL_COMMAND" ;;
      t | T)
        printf '\n    %sYour shell, here. Run the command, then type exit to come back.%s\n\n' "$C_DIM" "$C_RESET"
        "${SHELL:-/bin/bash}" -l || true
        al_recheck "$check" && return 0
        al_redraw "$show" "$kind"
        ;;
      s | S)
        if [[ $kind != required ]]; then
          printf '    %sSkipped.%s\n' "$C_DIM" "$C_RESET"
          return 1
        fi
        printf '    %sThis one is required: the agent needs it.%s\n' "$C_DIM" "$C_RESET"
        ;;
      q | Q) al_quit ;;
    esac
  done
}

# --- Homes and the plugin (read-only) ------------------------------------------------

al_home_plugin() {
  local version="$1/.state/version.json"
  [[ -f $version ]] || return 1
  sed -n 's/.*"plugin"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$version" | head -n 1
}

al_is_home() {
  [[ "$(al_home_plugin "$1")" == "$AL_PLUGIN" ]]
}

# This plugin's homes in the agents folder, one per line.
al_find_homes() {
  local dir
  [[ -d $AL_AGENTS_DIR ]] || return 0
  for dir in "$AL_AGENTS_DIR"/*/; do
    dir=${dir%/}
    [[ -d $dir ]] && al_is_home "$dir" && printf '%s\n' "$dir"
  done
  return 0
}

al_expand_home() {
  case "$1" in
    "~") printf '%s' "$HOME" ;;
    "~/"*) printf '%s' "$HOME/${1#\~/}" ;;
    /*) printf '%s' "$1" ;;
    *) printf '%s' "$PWD/$1" ;;
  esac
}

al_nearest_dir() {
  local dir=$1
  while [[ ! -d $dir ]]; do dir=$(dirname "$dir"); done
  printf '%s' "$dir"
}

# Why a folder can't hold a new agent, or nothing when it can.
al_folder_problem() {
  local target=$1 dir plugin
  case "/$target/" in
    */../* | */./*) printf 'Give the folder as a plain path, without . or ..'; return ;;
  esac
  dir=$HOME
  while true; do
    if [[ $target -ef $dir ]]; then
      printf '%s is your home folder, or above it. An agent needs a folder of its own.' "$target"
      return
    fi
    [[ $dir == / ]] && break
    dir=$(dirname "$dir")
  done
  plugin=$(al_home_plugin "$target")
  if [[ -n $plugin && $plugin != "$AL_PLUGIN" ]]; then
    printf '%s is a home another plugin made. Open it with that plugin and run its move command, which copies it to a new folder for this one.' "$target"
    return
  fi
  dir=$(dirname "$target")
  while true; do
    if [[ -f $dir/SOUL.md || -f $dir/.state/version.json ]]; then
      printf '%s is inside another agent'"'"'s home (%s). An agent'"'"'s home is a folder of its own.' "$target" "$dir"
      return
    fi
    [[ $dir == / ]] && break
    dir=$(dirname "$dir")
  done
  if [[ -z $plugin && -f $target/SOUL.md ]]; then
    printf '%s already holds an agent this guide didn'"'"'t set up (it has a SOUL.md).' "$target"
    return
  fi
  if git -C "$(al_nearest_dir "$target")" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf '%s is inside a git repository. An agent'"'"'s home is a folder of its own.' "$target"
  fi
}

# A pinned AGENT_HOME makes Claude Code use that home wherever it starts, so a pin at any other folder than
# this agent's sends it to the wrong brain. A pin at this agent's own folder is fine.
al_pin_problem() {
  local pin=${AGENT_HOME:-} settings="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" where="in your shell"
  if [[ -z $pin && -f $settings ]]; then
    pin=$(sed -n 's/.*"AGENT_HOME"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$settings" | head -n 1)
    where="in your Claude Code settings"
  fi
  [[ -n $pin ]] || return 0
  pin=${pin/#\~/$HOME}
  [[ -d $1 && "$(cd "$pin" 2>/dev/null && pwd -P)" == "$(cd "$1" && pwd -P)" ]] && return 0
  printf 'AGENT_HOME is set to %s %s, so Claude Code would use that home instead of %s. Remove the pin, then run the guide again.' "$pin" "$where" "$1"
}

# A folder holding only .claude, from a run that stopped after the plugin step, counts as empty.
al_folder_has_files() {
  [[ -d $1 ]] && [[ -n "$(ls -A "$1" | grep -vxF .claude || true)" ]]
}

# Claude Code's plugin list as "folder<TAB>marketplace<TAB>plugin folder<TAB>enabled<TAB>scope" lines, one per copy of this
# plugin ("*" for a user-wide one). It's read from inside the home, since "enabled" is reported for the folder the
# command runs in; read once per home, and again only after a step the user acted on.
AL_LISTING=""
AL_LISTING_FOR=""
al_plugin_listing() {
  [[ -n $AL_LISTING && $AL_LISTING_FOR == "$1" ]] && return 0
  AL_LISTING_FOR=$1
  AL_LISTING=$(cd "$1" 2>/dev/null && claude plugin list --json </dev/null 2>/dev/null | AL_PLUGIN_NAME="$AL_PLUGIN" bun -e '
    const { realpathSync } = require("node:fs");
    const real = (path) => { try { return realpathSync(path); } catch { return path; } };
    const copies = JSON.parse(await Bun.stdin.text()).filter((entry) => String(entry.id).startsWith(`${process.env.AL_PLUGIN_NAME}@`));
    for (const entry of copies) {
      const folder = entry.scope === "user" ? "*" : real(entry.projectPath ?? "");
      console.log([folder, String(entry.id).split("@")[1], entry.readFromFolder ?? entry.installPath ?? "", entry.enabled !== false, entry.scope ?? "local"].join("\t"));
    }
  ' 2>/dev/null)
  AL_LISTING=${AL_LISTING:-none}
}

# Sets AL_PLUGIN_SOURCE (its marketplace), AL_PLUGIN_ROOT, AL_PLUGIN_ENABLED and AL_PLUGIN_SCOPE for a home; a
# user-wide copy is the fallback.
al_plugin_for_home() {
  local here line folder found="" fallback=""
  AL_PLUGIN_SOURCE="" AL_PLUGIN_ROOT="" AL_PLUGIN_ENABLED="" AL_PLUGIN_SCOPE=""
  here=$(cd "$1" 2>/dev/null && pwd -P) || return 1
  al_plugin_listing "$here"
  while IFS= read -r line; do
    folder=${line%%$'\t'*}
    [[ $folder == "*" && -z $fallback ]] && fallback=${line#*$'\t'}
    [[ $folder == "$here" && -z $found ]] && found=${line#*$'\t'}
  done <<<"$AL_LISTING"
  found=${found:-$fallback}
  [[ -n $found ]] || return 1
  AL_PLUGIN_SOURCE=${found%%$'\t'*}
  found=${found#*$'\t'}
  AL_PLUGIN_ROOT=${found%%$'\t'*}
  found=${found#*$'\t'}
  AL_PLUGIN_ENABLED=${found%%$'\t'*}
  AL_PLUGIN_SCOPE=${found#*$'\t'}
}

al_is_clone() {
  [[ -f $1/.claude-plugin/plugin.json ]] && grep -q "\"name\"[[:space:]]*:[[:space:]]*\"$AL_PLUGIN\"" "$1/.claude-plugin/plugin.json"
}

# Playwright writes this marker last, so a browser folder without it is an interrupted download.
al_browser_ready() {
  local browser
  for browser in "$1"-*; do
    [[ -f $browser/INSTALLATION_COMPLETE ]] && return 0
  done
  return 1
}

# The packages, Chromium, and the headless shell the web tools launch, which downloads separately after it.
al_packages_ready() {
  local browsers="$1/node_modules/playwright-core/.local-browsers"
  [[ -d $1/node_modules ]] && al_browser_ready "$browsers/chromium" && al_browser_ready "$browsers/chromium_headless_shell"
}

# --- The steps every guide shares --------------------------------------------------
# A guide sets AL_OS_NAME and defines os_package and os_after_agents (its own checks once the plugin is in).

# bash 3.2 calls an empty array unbound under set -u, so each expansion of AL_HOMES is guarded.
AL_HOMES=()
AL_NEW_HOME=""
AL_CLONE_URL=""
AL_ROOTS=""
AL_FIRST_ROOT=""

al_load_homes() {
  local home
  while IFS= read -r home; do [[ -n $home ]] && AL_HOMES+=("$home"); done <<<"$(al_find_homes)"
}

# --- Use the agent, or develop the plugin ---

decide_path() {
  local home
  if [[ -z $AL_PATH_CHOICE && -z $AL_NAME && -z $AL_HOME ]]; then
    for home in ${AL_HOMES[@]+"${AL_HOMES[@]}"}; do
      if al_plugin_for_home "$home"; then
        if [[ $AL_PLUGIN_SOURCE == "$AL_DEV_MARKETPLACE" ]]; then
          AL_PATH_CHOICE=dev
          [[ -n $AL_CLONE ]] || AL_CLONE=$AL_PLUGIN_ROOT
        else
          AL_PATH_CHOICE=marketplace
        fi
        AL_PATH_FROM_HOME=1
        al_done "Path" "$(path_label) (from $(basename "$home")'s install)"
        return
      fi
    done
  fi
  if [[ -z $AL_PATH_CHOICE ]]; then
    al_choose "How will you use AgentLayer?" \
      "Use the agent: the plugin from the marketplace (recommended)" \
      "Develop the plugin: a local clone or your fork"
    if [[ $AL_CHOICE == 2 ]]; then AL_PATH_CHOICE=dev; else AL_PATH_CHOICE=marketplace; fi
  fi
  al_done "Path" "$(path_label)"
}

path_label() {
  if [[ $AL_PATH_CHOICE == dev ]]; then printf 'develop the plugin'; else printf 'use the agent'; fi
}

check_bun() { al_tool_check bun "$AL_MIN_BUN"; }

show_bun() {
  if [[ $AL_DETAIL == *older* ]]; then
    al_para "Bun runs the agent's tools, and the plugin needs $AL_MIN_BUN or later."
    al_box "$(al_tool_path bun) upgrade"
  else
    al_para "Bun runs the agent's tools. Copy the install line on its home page and run it."
    al_link https://bun.sh
  fi
}

# A Node already on PATH passes, however it was installed. Otherwise fnm's default Node counts, since this guide's
# own PATH predates the shell setup fnm's installer adds.
check_node() {
  local out
  al_tool_check node && return 0
  command -v fnm >/dev/null 2>&1 || return 1
  if ! out=$(fnm exec --using=default node --version 2>/dev/null </dev/null); then
    AL_DETAIL="fnm has no Node yet"
    return 1
  fi
  AL_DETAIL="$(al_version_of "$out") through fnm"
}

show_node() {
  if command -v fnm >/dev/null 2>&1; then
    al_para "fnm is installed. Install Node's long-term support release with it:"
    al_box "$(al_tool_path fnm) install --lts"
  else
    al_para "Node.js runs the tools and MCP servers that start with npx, which many packs and plugins use. fnm installs it and switches versions: follow the $AL_OS_NAME install on its page, then open a new terminal tab."
    al_link https://github.com/Schniz/fnm
  fi
}

check_claude() { al_tool_check claude "$AL_MIN_CLAUDE"; }

show_claude() {
  if [[ $AL_DETAIL == *older* ]]; then
    al_para "The plugin needs Claude Code $AL_MIN_CLAUDE or later."
    al_box "$(al_tool_path claude) update"
  else
    al_para "Claude Code is where the agent runs. Follow the $AL_OS_NAME install on its setup page; the native install is the one to pick."
    al_link https://code.claude.com/docs/en/setup
  fi
}

check_uv() { al_tool_check uv; }

check_jq() { al_tool_check jq; }

check_gh() { al_tool_check gh; }

gh_purpose() {
  if [[ $AL_PATH_CHOICE == dev ]]; then
    al_para "GitHub's command line, for forks and pull requests while you develop the plugin, and for the GitHub pack."
  else
    al_para "GitHub's command line. Only the GitHub pack needs it."
  fi
}

check_poppler() { al_tool_check pdftoppm "" -v; }

# A guide's os_package <poppler|jq> shows how its system installs the tool.
show_poppler() {
  al_para "poppler lets the agent read PDFs."
  os_package poppler
}

show_jq() {
  al_para "jq reads JSON on the command line, and agents reach for it often."
  os_package jq
}

show_obsidian() {
  al_para "Obsidian reads the agent's brain: open its folder as a vault to follow the links and see the graph."
  al_link https://obsidian.md
}

show_vscode() {
  al_para "An editor for the plugin's code while you develop it."
  al_link https://code.visualstudio.com
}

show_uv() {
  al_para "uv runs the agent's Python scripts in a throwaway environment each time, so nothing on this machine gets Python packages installed. Follow the standalone install on its page."
  al_link https://docs.astral.sh/uv/getting-started/installation/
}

# --- Prepare only ---

al_prereqs_finish() {
  printf '\n'
  if ((AL_PENDING > 0)); then
    al_para "$AL_PENDING required step(s) left. Run the same line again when they're done; finished steps are skipped."
    printf '\n'
    exit 1
  fi
  al_para "Your $AL_MACHINE is ready for an agent."
  al_note "To set one up, run the guide again and choose Set up an agent$([[ ${AL_CMUX:-} == yes ]] && printf ', which also checks the Ghostty and cmux settings'). An agent from another plugin moves over with that plugin's own move command instead."
  printf '\n'
  exit 0
}

# --- The agent's folder ---

AL_TARGET=""

check_folder() {
  [[ -d $AL_TARGET ]] && AL_DETAIL=$(al_show_path "$AL_TARGET") && return 0
  AL_DETAIL="not created yet"
  return 1
}

show_folder() {
  al_para "The agent's home, where everything it knows is kept as plain files."
  al_box "mkdir -p $(al_show_path "$AL_TARGET")"
}

choose_new_home() {
  local problem
  if [[ -n $AL_HOME ]]; then
    AL_NEW_HOME=$(al_expand_home "$AL_HOME")
  else
    if [[ -z $AL_NAME ]]; then
      while true; do
        al_ask "What should your agent be called?" "$AL_DEFAULT_NAME"
        [[ $AL_REPLY =~ $AL_NAME_PATTERN ]] && break
        al_fail_line "\"$AL_REPLY\" won't work: use letters, digits, spaces and hyphens."
        [[ $AL_MODE == guide ]] || al_die "No usable name." 2
      done
      AL_NAME=$AL_REPLY
    fi
    AL_NEW_HOME="$AL_AGENTS_DIR/$AL_NAME"
  fi
  [[ -n $AL_NAME ]] || AL_NAME=$(basename "$AL_NEW_HOME")
  [[ $AL_NAME =~ $AL_NAME_PATTERN ]] || AL_NAME=""
  if al_is_home "$AL_NEW_HOME"; then
    AL_HOMES=("$AL_NEW_HOME")
    AL_NEW_HOME=""
    return
  fi
  problem=$(al_folder_problem "$AL_NEW_HOME")
  if [[ -n $problem ]]; then
    al_fail_line "$problem"
    al_note "Pick another folder with --name or --home, then run the guide again."
    exit 1
  fi
  if al_folder_has_files "$AL_NEW_HOME"; then
    al_ask "$(al_show_path "$AL_NEW_HOME") already holds files. Set the agent up there anyway? (y/n)" n
    [[ $AL_REPLY == [yY]* ]] || {
      al_note "Pick another folder with --name or --home, then run the guide again."
      exit 0
    }
  fi
}

# --- The clone (develop the plugin) ---

check_clone() {
  al_is_clone "$AL_CLONE" && AL_DETAIL=$(al_show_path "$AL_CLONE") && return 0
  AL_DETAIL="no clone at $(al_show_path "$AL_CLONE")"
  return 1
}

show_clone() {
  al_para "Your copy of the plugin: our repository, or your fork of it. Claude Code runs the plugin straight from this folder, so your edits apply after /reload-plugins."
  al_box "git clone $AL_CLONE_URL $(al_show_path "$AL_CLONE")"
}

# --- The plugin ---

# The install that's there, against the one wanted: a path the user chose must match it; one read from a home does.
check_plugin() {
  if ! al_plugin_for_home "$AL_TARGET"; then
    AL_DETAIL="not installed for this folder"
    return 1
  fi
  if [[ $AL_PLUGIN_SOURCE == "$AL_DEV_MARKETPLACE" ]]; then
    AL_DETAIL="dev install from $(al_show_path "$AL_PLUGIN_ROOT")"
  else
    AL_DETAIL="from the $AL_PLUGIN_SOURCE marketplace"
  fi
  if [[ $AL_PLUGIN_ENABLED != true ]]; then
    AL_DETAIL="$AL_DETAIL, but turned off"
    return 1
  fi
  [[ -n $AL_PATH_FROM_HOME ]] && return 0
  if [[ $AL_PATH_CHOICE == dev && ($AL_PLUGIN_SOURCE != "$AL_DEV_MARKETPLACE" || "$(cd "$AL_PLUGIN_ROOT" 2>/dev/null && pwd -P)" != "$(cd "$AL_CLONE" 2>/dev/null && pwd -P)") ]]; then
    AL_DETAIL="$AL_DETAIL, not your clone"
    return 1
  fi
  if [[ $AL_PATH_CHOICE == marketplace && $AL_PLUGIN_SOURCE == "$AL_DEV_MARKETPLACE" ]]; then
    AL_DETAIL="$AL_DETAIL, not the marketplace"
    return 1
  fi
}

show_plugin() {
  local home claude remove=()
  home=$(al_show_path "$AL_TARGET")
  claude=$(al_tool_path claude)
  if [[ -n $AL_PLUGIN_SOURCE && $AL_PLUGIN_ENABLED != true ]]; then
    al_para "The plugin is installed for this folder but turned off, which happens when the trust question is dismissed. Turn it back on:"
    al_box "cd $home && $claude plugin enable $AL_PLUGIN@$AL_PLUGIN_SOURCE -s local"
    return
  fi
  # A user-scope copy is shared by every folder, so it's switched off for this one rather than removed.
  if [[ $AL_PLUGIN_SCOPE == user ]]; then
    al_para "This folder uses the plugin from $AL_PLUGIN_SOURCE that every folder shares, not the one you picked. The first line switches that copy off for this folder only."
    remove=("cd $home && $claude plugin disable $AL_PLUGIN@$AL_PLUGIN_SOURCE -s local")
  elif [[ -n $AL_PLUGIN_SOURCE ]]; then
    al_para "This folder has the plugin from $AL_PLUGIN_SOURCE, not the one you picked. The first line removes that copy."
    remove=("cd $home && $claude plugin uninstall $AL_PLUGIN@$AL_PLUGIN_SOURCE -s $AL_PLUGIN_SCOPE")
  fi
  if [[ $AL_PATH_CHOICE == dev ]]; then
    al_para "Add your clone as a marketplace, then switch the plugin on for this folder only. If a line says the marketplace is already added, that's fine."
    al_box ${remove[@]+"${remove[@]}"} "$claude plugin marketplace add $(al_show_path "$AL_CLONE")" \
      "cd $home && $claude plugin install $AL_PLUGIN@$AL_DEV_MARKETPLACE -s local"
  else
    al_para "This switches the plugin on for this folder only, and adds the AgentLayer marketplace to Claude Code the first time."
    al_box ${remove[@]+"${remove[@]}"} "cd $home && $claude plugin install $AL_PLUGIN --marketplace $AL_MARKETPLACE_REPO -s local"
  fi
}

# --- Packages ---

AL_ROOT=""

check_packages() {
  al_packages_ready "$AL_ROOT" && return 0
  AL_DETAIL="not installed"
  return 1
}

show_packages() {
  al_para "The plugin's packages, and the browser its web tools use: about 300 MB the first time."
  al_box "cd $(al_show_path "$AL_ROOT") && $(al_tool_path bun) install"
}

# --- Start ---

# A home with its own Claude subscription starts with the agent launcher, which passes that file to Claude Code;
# started with claude, it would bill the default login instead.
start_line() {
  local home=$1 init=$2 claude
  claude=$(al_tool_path claude)
  if [[ -z $init && -f $home/.state/secrets/.env.claude.json ]]; then
    printf 'cd %s && agent' "$(al_show_path "$home")"
  elif [[ -z $init ]]; then
    printf 'cd %s && %s' "$(al_show_path "$home")" "$claude"
  elif [[ -n $AL_NAME ]]; then
    printf 'cd %s && %s "/%s:init name=%s"' "$(al_show_path "$home")" "$claude" "$AL_PLUGIN" "$AL_NAME"
  else
    printf 'cd %s && %s "/%s:init"' "$(al_show_path "$home")" "$claude" "$AL_PLUGIN"
  fi
}

finish() {
  local home lines=()
  printf '\n'
  if ((AL_PENDING > 0)); then
    al_para "$AL_PENDING required step(s) left. Run the same line again when they're done; finished steps are skipped."
    printf '\n'
    exit 1
  fi
  [[ $AL_MODE == check ]] && {
    al_para "Everything's set up."
    printf '\n'
    exit 0
  }
  if [[ -n $AL_NEW_HOME ]]; then
    al_para "Ready. Start setup$([[ $AL_CMUX == yes ]] && printf ' in a cmux tab'), which asks a few questions and wakes your agent:"
    al_box "$(start_line "$AL_NEW_HOME" init)"
  else
    for home in ${AL_HOMES[@]+"${AL_HOMES[@]}"}; do lines+=("$(start_line "$home" "")"); done
    al_para "Nothing to do. Start an agent$([[ $AL_CMUX == yes ]] && printf ' in a cmux tab'):"
    al_box ${lines[@]+"${lines[@]}"}
    al_note "A new agent: run the guide again with --name and the name you want."
  fi
  printf '\n'
}

# Homes on one plugin folder share its packages, so each folder is checked once.
plugin_steps_for() {
  AL_TARGET=$1
  al_step "Plugin for $(basename "$1")" required check_plugin show_plugin || return 0
  AL_ROOT=$AL_PLUGIN_ROOT
  AL_FIRST_ROOT=${AL_FIRST_ROOT:-$AL_ROOT}
  case "$AL_ROOTS" in *"|$AL_ROOT|"*) return 0 ;; esac
  AL_ROOTS="$AL_ROOTS|$AL_ROOT|"
  al_step "Packages" required check_packages show_packages
}

# The end of every guide.
al_agent_steps() {
  local home problem=""
  if ((AL_PENDING > 0)); then finish; fi
  if [[ -n $AL_NAME || -n $AL_HOME || -z ${AL_HOMES[*]+set} ]]; then
    choose_new_home
  fi
  if [[ -n $AL_NEW_HOME ]]; then
    problem=$(al_pin_problem "$AL_NEW_HOME")
  else
    for home in ${AL_HOMES[@]+"${AL_HOMES[@]}"}; do
      [[ -z $problem ]] && problem=$(al_pin_problem "$home")
    done
  fi
  if [[ -n $problem ]]; then
    al_fail_line "$problem"
    exit 1
  fi
  if [[ $AL_PATH_CHOICE == dev ]]; then
    AL_CLONE=$(al_expand_home "${AL_CLONE:-$AL_DEFAULT_CLONE}")
    if ! al_is_clone "$AL_CLONE"; then
      al_ask "Clone from (our repository, or your fork's URL)" "$AL_REPO_URL"
      AL_CLONE_URL=$AL_REPLY
    fi
    al_step "Your clone" required check_clone show_clone || finish
  fi
  if [[ -n $AL_NEW_HOME ]]; then
    AL_TARGET=$AL_NEW_HOME
    al_step "$(basename "$AL_NEW_HOME")'s folder" required check_folder show_folder || finish
    plugin_steps_for "$AL_NEW_HOME"
  else
    for home in ${AL_HOMES[@]+"${AL_HOMES[@]}"}; do
      al_done "$(basename "$home")" "$(al_show_path "$home") is set up"
      plugin_steps_for "$home"
    done
  fi
  os_after_agents
  finish
}

# Remembered before the refresh, so commands can tell what the user's own shell will find.
AL_USER_PATH=$PATH
# agentlayer:end
