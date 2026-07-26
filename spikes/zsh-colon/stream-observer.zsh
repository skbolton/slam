#!/usr/bin/env zsh

emulate -L zsh
setopt no_unset

local plugin=$1
local output_file=$2
source $plugin
: stream > $output_file
