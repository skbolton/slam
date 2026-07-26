#!/usr/bin/env zsh

emulate -L zsh
setopt errexit no_unset pipe_fail

typeset -gr SPIKE_DIR=${0:A:h}
local transcript=$(mktemp "${TMPDIR:-/tmp}/slam-bat-tty.XXXXXXXX")
trap 'rm -f -- $transcript' EXIT

BAT_THEME=ansi script -qefc "node ${(q)SPIKE_DIR}/render-spike.mjs" $transcript >/dev/null
local content=$(< $transcript)
local plain=$(print -rn -- $content | perl -pe 's/\e\[[0-9;]*[A-Za-z]//g; s/\r//g')

[[ $plain == *'Streamed response'* ]] || {
  print -r -- 'tty-check: rendered heading missing' >&2
  exit 1
}
[[ $plain == *"console.log('hello');"* ]] || {
  print -r -- 'tty-check: fenced code missing' >&2
  exit 1
}
[[ $content == *$'\e['* ]] || {
  print -r -- 'tty-check: expected terminal color sequences' >&2
  exit 1
}
print -r -- 'tty-check: OK'
