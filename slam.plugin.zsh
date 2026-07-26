if (( ${+functions[:]} )) && [[ ${functions[:]} == *SLAM_STATE_FILE* ]]; then
  unfunction :
fi

typeset -g SLAM_PACKAGE_ROOT=${${(%):-%N}:A:h}
typeset -g SLAM_BIN=${SLAM_BIN_OVERRIDE:-${SLAM_PACKAGE_ROOT:h:h}/bin/slam}

typeset -g SLAM_ACTIVE=${SLAM_ACTIVE:-0}
typeset -g SLAM_SESSION_ID=${SLAM_SESSION_ID:-}
typeset -g SLAM_SESSION_NAME=${SLAM_SESSION_NAME:-}
typeset -g SLAM_SESSION_FILE=${SLAM_SESSION_FILE:-}
typeset -g SLAM_SESSION_CWD=${SLAM_SESSION_CWD:-}
typeset -g SLAM_PROVIDER=${SLAM_PROVIDER:-}
typeset -g SLAM_MODEL=${SLAM_MODEL:-}
typeset -g SLAM_THINKING_LEVEL=${SLAM_THINKING_LEVEL:-}
typeset -g SLAM_MODEL_PENDING=${SLAM_MODEL_PENDING:-0}

_slam_not_implemented() {
  print -r -- 'slam: implementation is not available yet' >&2
  return 1
}

_slam_send_message() {
  emulate -L zsh
  setopt local_options no_unset

  (( $# > 0 )) || return 0
  local message
  if (( $# == 1 )); then
    message=$1
  else
    message=${(j: :)@}
  fi
  [[ -n ${message//[[:space:]]/} ]] || {
    print -r -- 'slam: message must not be empty' >&2
    return 2
  }
  local state_file
  state_file=$(command mktemp "${TMPDIR:-/tmp}/slam-state.XXXXXXXX") || return 1
  command chmod 600 -- $state_file || { command rm -f -- $state_file; return 1; }

  local -x SLAM_STATE_FILE=$state_file
  local -x SLAM_SESSION_ID=$SLAM_SESSION_ID
  local -x SLAM_SESSION_FILE=$SLAM_SESSION_FILE
  local -x SLAM_PROVIDER=$SLAM_PROVIDER
  local -x SLAM_MODEL=$SLAM_MODEL
  if [[ -t 0 && -t 1 ]]; then
    "$SLAM_BIN" message -- "$message" </dev/tty >/dev/tty
  else
    "$SLAM_BIN" message -- "$message"
  fi
  local result=$?
  if (( result == 0 || result == 130 )) && [[ -s $state_file ]]; then
    _slam_apply_state_file $state_file || result=1
  fi
  command rm -f -- $state_file
  return $result
}

_slam_osc133() {
  [[ -t 1 ]] || return 0
  print -n -- $'\e]133;'"$1"$'\a'
}

_slam_reset() {
  local pad=${1:-${BUFFERLINES:-1}} index
  for (( index = 0; index < pad; index++ )); do
    print -r -- ''
  done
  BUFFER=''
  CURSOR=0
  zle -I
  zle reset-prompt
}

_slam_accept_line() {
  if [[ $BUFFER == ': '* ]]; then
    local message=${BUFFER#': '}
    local original_buffer=$BUFFER
    print -s -- "$original_buffer"
    local display_lines=${BUFFERLINES:-1}
    CURSOR=${#BUFFER}
    zle redisplay
    print -r -- ''
    _slam_osc133 B
    _slam_osc133 C
    _slam_send_message "$message"
    local result=$?
    _slam_osc133 "D;$result"
    _slam_osc133 A
    _slam_reset "$display_lines"
    return $result
  fi
  zle _slam_original_accept_line
}

_slam_apply_keybindings() {
  if (( ! $+widgets[_slam_original_accept_line] )); then
    zle -A accept-line _slam_original_accept_line
  fi
  zle -N _slam_accept_line
  bindkey '^M' _slam_accept_line
  bindkey '^J' _slam_accept_line
}

if [[ -o interactive ]] && (( $+widgets[accept-line] )); then
  _slam_apply_keybindings
  typeset -ga zvm_after_init_commands
  (( ${zvm_after_init_commands[(Ie)_slam_apply_keybindings]} )) || zvm_after_init_commands+=(_slam_apply_keybindings)
fi

function :sessions {
  "$SLAM_BIN" sessions
}

function :attach {
  emulate -L zsh
  (( $# == 1 )) || { print -r -- 'usage: :attach <session-id-or-path>' >&2; return 2; }
  local state_file
  state_file=$(command mktemp "${TMPDIR:-/tmp}/slam-state.XXXXXXXX") || return 1
  command chmod 600 -- $state_file || { command rm -f -- $state_file; return 1; }
  SLAM_STATE_FILE=$state_file "$SLAM_BIN" attach "$1"
  local result=$?
  if (( result == 0 )); then
    _slam_apply_state_file $state_file || result=1
  fi
  command rm -f -- $state_file
  return $result
}

function :new {
  SLAM_ACTIVE=0
  SLAM_SESSION_ID=''
  SLAM_SESSION_NAME=''
  SLAM_SESSION_FILE=''
  SLAM_SESSION_CWD=''
  SLAM_THINKING_LEVEL=''
}

function :name {
  emulate -L zsh
  (( $# > 0 )) || { print -r -- 'usage: :name <name>' >&2; return 2; }
  (( SLAM_ACTIVE )) || { print -r -- 'slam: no session is attached' >&2; return 1; }
  local name=${(j: :)@}
  local state_file
  state_file=$(command mktemp "${TMPDIR:-/tmp}/slam-state.XXXXXXXX") || return 1
  command chmod 600 -- $state_file || { command rm -f -- $state_file; return 1; }
  SLAM_STATE_FILE=$state_file \
  SLAM_SESSION_ID=$SLAM_SESSION_ID \
  SLAM_SESSION_FILE=$SLAM_SESSION_FILE \
  SLAM_SESSION_CWD=$SLAM_SESSION_CWD \
  SLAM_PROVIDER=$SLAM_PROVIDER \
  SLAM_MODEL=$SLAM_MODEL \
  SLAM_THINKING_LEVEL=$SLAM_THINKING_LEVEL \
    "$SLAM_BIN" name "$name"
  local result=$?
  if (( result == 0 )); then _slam_apply_state_file $state_file || result=1; fi
  command rm -f -- $state_file
  return $result
}

function :models {
  emulate -L zsh
  local state_file
  state_file=$(command mktemp "${TMPDIR:-/tmp}/slam-state.XXXXXXXX") || return 1
  command chmod 600 -- $state_file || { command rm -f -- $state_file; return 1; }
  SLAM_STATE_FILE=$state_file \
  SLAM_SESSION_ID=$SLAM_SESSION_ID \
  SLAM_SESSION_NAME=$SLAM_SESSION_NAME \
  SLAM_SESSION_FILE=$SLAM_SESSION_FILE \
  SLAM_SESSION_CWD=$SLAM_SESSION_CWD \
  SLAM_PROVIDER=$SLAM_PROVIDER \
  SLAM_MODEL=$SLAM_MODEL \
  SLAM_THINKING_LEVEL=$SLAM_THINKING_LEVEL \
    "$SLAM_BIN" models
  local result=$?
  if (( result == 0 )) && [[ -s $state_file ]]; then _slam_apply_state_file $state_file || result=1; fi
  command rm -f -- $state_file
  return $result
}

function :info {
  SLAM_ACTIVE=$SLAM_ACTIVE \
  SLAM_SESSION_ID=$SLAM_SESSION_ID \
  SLAM_SESSION_NAME=$SLAM_SESSION_NAME \
  SLAM_SESSION_FILE=$SLAM_SESSION_FILE \
  SLAM_SESSION_CWD=$SLAM_SESSION_CWD \
  SLAM_PROVIDER=$SLAM_PROVIDER \
  SLAM_MODEL=$SLAM_MODEL \
  SLAM_THINKING_LEVEL=$SLAM_THINKING_LEVEL \
  SLAM_MODEL_PENDING=$SLAM_MODEL_PENDING \
    "$SLAM_BIN" info
}

_slam_apply_state_file() {
  emulate -L zsh
  setopt local_options no_unset pipe_fail extended_glob

  local state_file=$1 header line key encoded decoded
  local -a allowed=(SLAM_ACTIVE SLAM_SESSION_ID SLAM_SESSION_NAME SLAM_SESSION_FILE SLAM_SESSION_CWD SLAM_PROVIDER SLAM_MODEL SLAM_THINKING_LEVEL SLAM_MODEL_PENDING)
  local -A candidate seen
  IFS= read -r header < $state_file || return 1
  [[ $header == SLAM_STATE_V1 ]] || return 1

  while IFS= read -r line; do
    [[ $line == (#b)([A-Z0-9_]##)\=(*) ]] || return 1
    key=$match[1]
    encoded=$match[2]
    (( ${allowed[(Ie)$key]} )) || return 1
    [[ -z ${seen[$key]-} ]] || return 1
    decoded=$(print -rn -- $encoded | command base64 --decode 2>/dev/null) || return 1
    candidate[$key]=$decoded
    seen[$key]=1
  done < <(command tail -n +2 -- $state_file)

  for key in $allowed; do
    [[ -n ${seen[$key]-} ]] || return 1
  done
  [[ ${candidate[SLAM_ACTIVE]} == (0|1) && ${candidate[SLAM_MODEL_PENDING]} == (0|1) ]] || return 1

  for key in $allowed; do
    typeset -g "$key=${candidate[$key]}"
  done
}
