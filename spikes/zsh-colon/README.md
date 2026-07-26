# Zsh colon and state-transfer spike

This spike characterizes the shell boundary Slam needs without invoking Pi. It
defines `:` in an isolated Zsh, streams a fake companion's normal output
directly, and receives a versioned state record through a dedicated file
descriptor and private temporary file.

Run all checks with:

```sh
zsh -f ./run-checks.zsh
```

The checks cover silent and duplicate sourcing, message argument behavior,
bare and builtin colon semantics, status propagation, validated atomic state
updates, child-shell isolation, streaming output, and interruption cleanup.

The state record is deliberately allowlisted and base64 encoded. The plugin
never evaluates companion output as shell code. State is decoded into a
candidate map and applied only after the complete record validates, so malformed
records cannot partially replace a previous valid attachment.

The shell behavior and state-validation rules are durable contracts suitable
for later production tests. The temporary-file side channel is a validated POC
choice; production may retain it or use an equally streaming-safe dedicated
descriptor mechanism.
