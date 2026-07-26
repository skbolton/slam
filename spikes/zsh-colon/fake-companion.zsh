#!/usr/bin/env zsh

emulate -L zsh
setopt no_unset pipe_fail

integer state_fd=3
local message=${1-}

case $message in
  stream)
    print -nr -- 'first'
    sleep 0.15
    print -r -- ' second'
    ;;
  fail)
    print -r -- 'companion failed' >&2
    exit 23
    ;;
  interrupt)
    trap 'exit 130' INT
    print -r -- 'waiting'
    sleep 30
    ;;
  malformed)
    print -r -u $state_fd -- 'SLAM_STATE_V1'
    print -r -u $state_fd -- 'SLAM_ACTIVE=not-base64!'
    ;;
  unknown)
    print -r -u $state_fd -- 'SLAM_STATE_V1'
    print -r -u $state_fd -- 'SLAM_UNSUPPORTED=MQ=='
    ;;
  *)
    print -r -- "assistant:$message"
    print -r -u $state_fd -- 'SLAM_STATE_V1'
    print -r -u $state_fd -- 'SLAM_ACTIVE=MQ=='
    print -r -u $state_fd -- 'SLAM_SESSION_ID=c2Vzc2lvbi0x'
    print -r -u $state_fd -- 'SLAM_SESSION_NAME=RGVtbw=='
    print -r -u $state_fd -- 'SLAM_SESSION_FILE=L3RtcC9zZXNzaW9uLTEuanNvbmw='
    print -r -u $state_fd -- 'SLAM_SESSION_CWD=L3RtcC9wcm9qZWN0'
    print -r -u $state_fd -- 'SLAM_PROVIDER=emlvbmxhYg=='
    print -r -u $state_fd -- 'SLAM_MODEL=RGVsdGE='
    print -r -u $state_fd -- 'SLAM_THINKING_LEVEL=b2Zm'
    print -r -u $state_fd -- 'SLAM_MODEL_PENDING=MA=='
    ;;
esac
