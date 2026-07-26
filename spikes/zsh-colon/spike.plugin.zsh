if (( ${+functions[_slam_spike_apply_state]} )); then
  return 0
fi

typeset -g SLAM_ACTIVE=0
typeset -g SLAM_SESSION_ID=''
typeset -g SLAM_SESSION_NAME=''
typeset -g SLAM_SESSION_FILE=''
typeset -g SLAM_SESSION_CWD=''
typeset -g SLAM_PROVIDER=''
typeset -g SLAM_MODEL=''
typeset -g SLAM_THINKING_LEVEL=''
typeset -g SLAM_MODEL_PENDING=0

typeset -ga _SLAM_SPIKE_STATE_KEYS=(
  SLAM_ACTIVE
  SLAM_SESSION_ID
  SLAM_SESSION_NAME
  SLAM_SESSION_FILE
  SLAM_SESSION_CWD
  SLAM_PROVIDER
  SLAM_MODEL
  SLAM_THINKING_LEVEL
  SLAM_MODEL_PENDING
)

_slam_spike_apply_state() {
  emulate -L zsh
  setopt local_options no_unset pipe_fail extended_glob

  local state_file=$1
  local header
  IFS= read -r header < $state_file || {
    print -r -- 'slam: missing state header' >&2
    return 1
  }
  [[ $header == SLAM_STATE_V1 ]] || {
    print -r -- 'slam: unsupported state record' >&2
    return 1
  }

  local -A candidate seen
  local line key encoded decoded
  while IFS= read -r line; do
    [[ $line == (#b)([A-Z0-9_]##)\=(*) ]] || {
      print -r -- 'slam: malformed state field' >&2
      return 1
    }
    key=$match[1]
    encoded=$match[2]
    (( ${_SLAM_SPIKE_STATE_KEYS[(Ie)$key]} )) || {
      print -r -- "slam: unknown state field: $key" >&2
      return 1
    }
    [[ -z ${seen[$key]-} ]] || {
      print -r -- "slam: duplicate state field: $key" >&2
      return 1
    }
    decoded=$(print -rn -- $encoded | base64 --decode 2>/dev/null) || {
      print -r -- "slam: invalid state encoding: $key" >&2
      return 1
    }
    candidate[$key]=$decoded
    seen[$key]=1
  done < <(command tail -n +2 -- $state_file)

  [[ ${candidate[SLAM_ACTIVE]-} == (0|1) ]] || {
    print -r -- 'slam: invalid active state' >&2
    return 1
  }
  [[ ${candidate[SLAM_MODEL_PENDING]-} == (0|1) ]] || {
    print -r -- 'slam: invalid pending state' >&2
    return 1
  }

  for key in $_SLAM_SPIKE_STATE_KEYS; do
    [[ -n ${seen[$key]-} ]] || {
      print -r -- "slam: missing state field: $key" >&2
      return 1
    }
  done

  for key in $_SLAM_SPIKE_STATE_KEYS; do
    typeset -g "$key=${candidate[$key]}"
  done
}

_slam_spike_invoke() {
  emulate -L zsh
  setopt local_options no_unset pipe_fail

  local message=$1
  local state_file
  state_file=$(mktemp "${TMPDIR:-/tmp}/slam-state.XXXXXXXX") || return 1
  chmod 600 -- $state_file || {
    rm -f -- $state_file
    return 1
  }

  local companion=${SLAM_SPIKE_COMPANION:-${${(%):-%N}:A:h}/fake-companion.zsh}
  local child_pid=''
  trap '
    if [[ -n $child_pid ]]; then
      kill -INT $child_pid 2>/dev/null
      wait $child_pid 2>/dev/null
    fi
    rm -f -- $state_file
    return 130
  ' INT
  zsh -f $companion $message 3>$state_file &
  child_pid=$!
  wait $child_pid
  local result=$?
  trap - INT

  if (( result == 0 )) && [[ -s $state_file ]]; then
    _slam_spike_apply_state $state_file || result=$?
  fi
  rm -f -- $state_file
  return $result
}

function : {
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
  _slam_spike_invoke $message
}
