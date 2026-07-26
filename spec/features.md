# Slam Features

## Product vision

Slam is an AI coding agent that lives in the user's existing Zsh session instead of opening a full-screen interface.

The user writes an agent message as a shell command, watches the response and tool activity in the same terminal, and returns to their normal prompt when the turn finishes. Between messages, the shell remains entirely theirs: they can inspect files, run commands, change directories, edit their prompt, or use any other shell utility.

Slam deliberately relies on the surrounding shell ecosystem:

- The user's shell prompt remains the prompt.
- Assistant Markdown is rendered using the user's Bat customization.
- Lists and interactive choices use Fzf.
- Multiline editing uses the user's configured editor.
- Agent configuration, sessions, tools, extensions, credentials, and trust remain managed by the underlying agent.

Slam is a frontend, not a second agent policy or configuration system.

The interactive shell handoff is based on the command-dispatch lifecycle proven by ForgeCode's Zsh plugin: Slam preserves shell history and terminal command boundaries, gives interactive children the controlling terminal, and protects conversation output while the prompt is redrawn. Slam reimplements this behavior for its Pi backend rather than depending on Forge at runtime.

## Core conversation workflow

### Send a message

An input line beginning with `: ` sends a message to the agent when Enter is pressed:

```zsh
: explain this function
```

Slam waits for the complete agent turn while streaming output into the current terminal. When the turn settles, the command exits and the user's normal shell prompt returns.

The first message in a newly started shell creates a session lazily. Sending later messages from the same shell continues that session:

```zsh
: inspect the test failures
: fix the first two failures
: rerun the focused tests
```

Sourcing Slam by itself does not start an agent or create a session.

### Message text

Normal shell words are joined with one space:

```zsh
: explain this function
```

One quoted argument preserves its exact spaces and newlines:

```zsh
: "preserve   these   spaces"
: $'review these points:\n- correctness\n- performance'
: "$(<notes.md)"
: "$(some-command)"
```

Multiple arguments, including multiple quoted arguments, are joined with one space. Leading dashes are message text rather than Slam options:

```zsh
: --help me understand this error
```

Explicit empty or whitespace-only messages are rejected without creating or changing a session.

### Bare colon and the original Zsh builtin

A bare colon remains Zsh's successful no-op:

```zsh
:
: > empty-file
```

Slam does not replace the `:` shell builtin. Agent dispatch happens only in the interactive line editor for lines beginning with colon-space. The builtin remains available explicitly:

```zsh
builtin : "${VALUE:=default}"
```

## Session workflow

### One attachment per shell

Each Zsh process keeps its own current attachment. A new shell starts unattached, even if it was launched from a shell that already has an active Slam session.

Two shells may attach to the same session. Slam does not add locking or ownership beyond the underlying agent's behavior; simultaneous mutations of one session are therefore not guaranteed to merge or serialize cleanly.

### List sessions

`:sessions` lists sessions associated with the shell's current working directory:

```zsh
:sessions
```

The list makes sessions identifiable through their ID, optional name, and recent activity. Slam follows the underlying agent's project-scoped session model rather than introducing a global cross-project browser.

### Attach to a session

`:attach` connects the current shell to an existing session without sending a message:

```zsh
:attach 019abc123
:attach /path/to/session.jsonl
```

The target must resolve to a valid session belonging to the current directory's session set. A failed attachment leaves the previous valid attachment unchanged.

The next message continues the attached conversation:

```zsh
:attach 019abc123
: continue with the refactor
```

### Start fresh

`:new` clears the current shell attachment:

```zsh
:new
```

It does not create an empty session. The next message lazily creates the new session.

### Name a session

`:name` gives the attached session a human-readable name:

```zsh
:name Refactor authentication
```

The name appears in diagnostics and session listings.

### Change directories without losing the attachment

Changing directories does not detach the current session:

```zsh
cd ../another-directory
: continue the previous task
```

The agent continues using the session's original working directory. `:info` shows both the shell working directory and the session working directory so a mismatch is visible.

`:sessions` always lists sessions for the shell's current directory, even when the shell remains attached to a session from a different directory.

## Model workflow

### Choose a model

`:models` opens an Fzf picker containing the models available through the agent's existing configuration:

```zsh
:models
```

When a session is attached, the selected model becomes that session's active model. Cancelling the picker leaves the model unchanged.

### Select a model before the first message

In an unattached shell, `:models` selects a pending model without creating a session. The first subsequent message creates a session using that selection:

```zsh
:models
: review this repository
```

`:info` identifies this model as pending until a session is successfully created. If the first message fails, Slam does not falsely report that the pending model became active.

## Information and diagnostics

### Inspect current state

`:info` prints a human-readable summary without contacting the model or creating a session:

```zsh
:info
```

The summary includes:

- Slam version
- Underlying agent version and source revision
- Whether this shell is attached
- Session ID and optional name
- Session file
- Shell working directory
- Session working directory
- Provider and model, including whether a model is pending
- Thinking level

The output excludes credentials and raw conversation content.

### Inspect build versions

The companion command exposes the same immutable build identity independently of the Zsh integration:

```zsh
slam --version
```

This command does not start an agent, read a session, or access the network.

## Prompt integration

Slam exposes cached shell-local state so users can build their own prompt components without invoking the agent during every prompt redraw.

The public parameters are:

```text
SLAM_ACTIVE
SLAM_SESSION_ID
SLAM_SESSION_NAME
SLAM_SESSION_FILE
SLAM_SESSION_CWD
SLAM_PROVIDER
SLAM_MODEL
SLAM_THINKING_LEVEL
SLAM_MODEL_PENDING
```

All parameters exist as soon as the plugin is sourced. Unavailable textual values are empty strings. `SLAM_ACTIVE` and `SLAM_MODEL_PENDING` use `1` and `0`.

They are not exported, so a child shell does not accidentally inherit the parent's attachment.

Example prompt component:

```zsh
slam_prompt_info() {
  (( SLAM_ACTIVE || SLAM_MODEL_PENDING )) || return
  print -nr -- "[$SLAM_PROVIDER/$SLAM_MODEL]"
}
```

Session state is refreshed after successful creation, attachment, model changes, naming, and completed turns.

## Assistant output

### Stream Markdown in the shell

Assistant text streams into Bat as Markdown while the agent responds. Slam forces Markdown syntax and non-paging behavior, but it does not choose a Bat theme or replace the user's Bat customization.

Each assistant message gets its own rendered document. This allows tool activity to appear between assistant messages without being interpreted as Markdown.

Raw protocol messages, diagnostics, and tool events never enter the assistant Markdown stream.

### Show concise tool activity

Tool execution is visible without reproducing a full TUI. Slam prints concise lifecycle lines such as:

```text
→ bash: npm test
✓ bash
→ edit: src/parser.ts
✗ edit: permission denied
```

The exact styling may improve later, but the initial behavior communicates:

- Which tool started
- A compact, safe summary of its operation
- Whether it succeeded or failed
- Useful final error information on failure

Repeated accumulated progress is not printed. Tool summaries avoid exposing unbounded or obviously sensitive arguments.

### Retry and compaction activity

Provider retries and session compaction produce concise status messages when they affect the wait. Detailed internal events and per-turn token or cost reports are not printed automatically.

### Thinking content

Thinking content is hidden in the first release. A future command may expose or toggle thinking behavior.

## Interactive agent requests

Extensions can request interaction while the agent is working. Slam supports these requests without opening its own permanent interface.

### Select from options

Selection requests open an Fzf picker. The user can search and choose one option. Duplicate or unusual option text remains selectable without ambiguity.

### Confirm an action

Confirmation requests open an input-disabled Fzf picker containing Yes and No:

```text
Yes
No
```

Choosing Yes confirms. Choosing No, pressing Escape, or pressing Ctrl-C declines.

Slam forwards the user's decision and does not automatically approve requests.

### Enter a single-line value

Single-line input requests use the Fzf query field. The entered query is returned even when it does not match a suggested candidate. Escape or Ctrl-C cancels the request.

### Edit multiline content

Multiline editor requests open `$VISUAL`, falling back to `$EDITOR`, with the requested initial content in a private temporary file. A successful editor exit returns the complete edited file.

If neither editor variable is configured, the request is cancelled with a diagnostic. Temporary files are private to the current user and are removed after success, failure, cancellation, timeout, or interruption.

### Dialog timeouts

When an extension puts a timeout on a dialog, Slam closes the active picker or editor when the timeout expires and returns the dialog's cancellation/default result. No interactive child remains behind holding the terminal.

### Notifications, statuses, and widgets

Nonblocking extension messages are represented with simple shell output:

- Notifications become concise severity-aware messages.
- Useful non-empty status updates may be printed.
- Text widgets may be printed once.
- Clear-status and clear-widget requests may be ignored because prior terminal output cannot be removed reliably.
- Terminal-title and editor-prefill requests are ignored in the first release.

An unknown blocking interaction fails visibly instead of leaving the agent hung.

## Interruption and failure recovery

### Interrupt a turn

Pressing Ctrl-C during an agent turn asks the agent to abort, cleans up the invocation, restores the terminal, and returns control to Zsh.

The current session attachment remains available so the user can continue or send a correction afterward.

### Preserve valid state on failure

Slam updates shell attachment and model state only after the requested transition succeeds. Failures such as a missing session, rejected model, broken renderer, or agent process exit produce a concise diagnostic without silently switching to unrelated state.

No completed or interrupted invocation leaves an agent, renderer, picker, or editor child process behind.

## Agent behavior and trust

Slam preserves the underlying agent's behavior for:

- Provider credentials
- Project trust
- Extensions
- Tool availability and execution
- Session persistence
- User confirmations

Slam does not add a second permission system, intercept tool calls to impose policy, or automatically approve extension requests. Stronger controls belong in agent extensions so they work consistently across frontends.

## Distribution and supported environment

The first release is distributed as a Nix flake for `x86_64-linux` and targets Zsh 5.9.

The user sources the installed `slam.plugin.zsh` from their Zsh configuration. Loading it does not print output, create a session, change directory, replace the prompt, or alter key bindings.

Interactive use requires a controlling TTY with basic ANSI support. It works in normal SSH and tmux sessions that provide such a TTY. Interactive use without a controlling terminal is not supported.

Specific third-party Zsh plugin managers are not part of the initial compatibility promise, although the conventional plugin filename may allow them to work.

## Future feature directions

The following ideas are intentionally outside the first release but fit the product direction discussed so far:

- A `:thinking` control for thinking visibility or level
- Prompt-state fields for token usage, cost, or context consumption
- More polished and configurable tool-call styling
- Image and attachment input
- Steering or follow-up messages while an agent is already running
- Session compaction controls
- Session branching, cloning, and export commands
- A global or cross-project session browser
- Additional shells, operating systems, and architectures
- A persistent agent process if measured startup time degrades the workflow
- A different agent backend if the Pi-based proof of concept reveals material limitations

These directions do not change Slam's central workflow: the user's shell remains the interface, and Slam provides agent capabilities without taking ownership of the terminal.
