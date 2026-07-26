# Fake RPC scenarios

These JSON files are reusable inputs for the lifecycle spike's deterministic
fake Pi process. They describe protocol behavior without model credentials or
network access:

- `happy-path.json` — accepted prompt followed by a settled turn.
- `split-utf8-record.json` — a text event fragmented across byte writes.
- `stderr-during-run.json` — diagnostics kept separate from protocol stdout.
- `early-exit.json` — a child exits after accepting a prompt but before settling.
- `abort-during-run.json` — an accepted prompt settles after an abort command.

The spike also generates task-specific scenarios in temporary directories so
request IDs and isolated session paths can be asserted precisely.
