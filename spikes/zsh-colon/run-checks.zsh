#!/usr/bin/env zsh

emulate -L zsh
setopt errexit no_unset pipe_fail

typeset -gr SPIKE_DIR=${0:A:h}
typeset -gi assertions=0

fail() {
  print -r -- "zsh-colon-checks: FAIL: $*" >&2
  exit 1
}

check() {
  (( ++assertions ))
  eval "$1" || fail "$2"
}

local source_output
source_output=$(zsh -f -c 'source "$1"; source "$1"' _ "$SPIKE_DIR/spike.plugin.zsh" 2>&1)
check '[[ -z $source_output ]]' 'source and duplicate source must be silent'

source "$SPIKE_DIR/spike.plugin.zsh"

local output result
local first_output="$SPIKE_DIR/.first-output.$$"
: hello world > $first_output
output=$(< $first_output)
rm -f -- $first_output
check '[[ $output == "assistant:hello world" ]]' 'multiple arguments must join with one space'
check '[[ $SLAM_ACTIVE == 1 && $SLAM_SESSION_ID == session-1 && $SLAM_MODEL == Delta ]]' 'valid state did not reach parent shell'
check '[[ ${(t)SLAM_ACTIVE} != *export* ]]' 'SLAM_ACTIVE must not be exported'

output=$(: 'preserve   spaces')
check '[[ $output == "assistant:preserve   spaces" ]]' 'one argument did not preserve spaces'
output=$(: $'first\nsecond')
check '[[ $output == $'"'"'assistant:first\nsecond'"'"' ]]' 'one argument did not preserve newlines'
output=$(: --help)
check '[[ $output == "assistant:--help" ]]' 'leading dash was not message content'

output=$(:)
check '[[ -z $output && $? == 0 ]]' 'bare colon was not a silent success'
local redirected="$SPIKE_DIR/.redirected.$$"
: > $redirected
check '[[ -f $redirected && ! -s $redirected ]]' 'redirection-only colon did not retain shell behavior'
rm -f -- $redirected
builtin : ignored arguments
check '(( $? == 0 ))' 'builtin colon escape hatch failed'

set +e
: '' 2>/dev/null
result=$?
set -e
check '(( result == 2 ))' 'explicit empty message must fail with status 2'
set +e
: '   ' 2>/dev/null
result=$?
set -e
check '(( result == 2 ))' 'whitespace-only message must fail with status 2'

set +e
: fail >/dev/null 2>/dev/null
result=$?
set -e
check '(( result == 23 ))' 'companion failure status was not propagated'

local old_id=$SLAM_SESSION_ID old_model=$SLAM_MODEL
set +e
: malformed >/dev/null 2>/dev/null
result=$?
set -e
check '(( result != 0 )) && [[ $SLAM_SESSION_ID == $old_id && $SLAM_MODEL == $old_model ]]' 'malformed state changed parent state'
set +e
: unknown >/dev/null 2>/dev/null
result=$?
set -e
check '(( result != 0 )) && [[ $SLAM_SESSION_ID == $old_id && $SLAM_MODEL == $old_model ]]' 'unknown state field changed parent state'

local child_state
child_state=$(zsh -f -c 'print -r -- "${SLAM_ACTIVE-unset}:${SLAM_SESSION_ID-unset}"')
check '[[ $child_state == unset:unset ]]' 'nested shell inherited non-exported state'

export SLAM_SPIKE_EXPORT_DEMO=leaked
local export_demo
export_demo=$(zsh -f -c 'print -r -- "$SLAM_SPIKE_EXPORT_DEMO"')
unset SLAM_SPIKE_EXPORT_DEMO
check '[[ $export_demo == leaked ]]' 'export characterization did not demonstrate child inheritance'

local stream_file="$SPIKE_DIR/.stream.$$"
zsh -f "$SPIKE_DIR/stream-observer.zsh" "$SPIKE_DIR/spike.plugin.zsh" $stream_file &
local observer_pid=$!
sleep 0.07
check '[[ -f $stream_file && $(< $stream_file) == first ]]' 'normal output was buffered instead of streaming'
wait $observer_pid
check '[[ $(< $stream_file) == "first second" ]]' 'streamed output was incomplete'
rm -f -- $stream_file

local interrupt_state_file
interrupt_state_file=$(mktemp "${TMPDIR:-/tmp}/slam-interrupt-state.XXXXXXXX")
zsh -f -c '
  source "$1"
  : ok >/dev/null
  print -r -- "$SLAM_SESSION_ID" > "$2"
  kill -INT $$ &
  : interrupt
' _ "$SPIKE_DIR/spike.plugin.zsh" $interrupt_state_file >/dev/null 2>/dev/null &
local interrupt_pid=$!
set +e
wait $interrupt_pid
result=$?
set -e
check '(( result == 130 ))' 'SIGINT did not return status 130'
check '[[ $(< $interrupt_state_file) == session-1 ]]' 'interrupt setup did not preserve prior valid state'
rm -f -- $interrupt_state_file

print -r -- "zsh-colon-checks: $assertions assertions OK"
