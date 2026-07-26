# Pi RPC lifecycle spike

This characterization spike validates Slam's initial one-process-per-message
architecture. It is intentionally self-contained and is not the production RPC
client or the project's final test scaffold.

## Run

From this directory:

```sh
npm run spike:fragmentation
npm run spike:lifecycle
npm run spike:protocol-edges
npm run spike:abort
npm run spike:live-pi
```

Run all checks with:

```sh
npm run check
```

Node 22.19 or newer is required. The real-Pi smoke uses `pi` from `PATH` by
default and targets `zionlab/Delta`; override those values with
`SLAM_PI_BINARY`, `SLAM_LIVE_PROVIDER`, and `SLAM_LIVE_MODEL`.

## Isolation

Every real-Pi run passes a newly created temporary `--session-dir`. The second
process resumes the exact session file returned by the first process. The spike
does not enumerate or modify the user's normal Pi sessions. Provider credentials
remain under Pi's normal configuration and are never read or printed by the
spike.

## What the checks prove

- Strict LF JSONL framing survives fragmented UTF-8 and Unicode line separators.
- Responses correlate by request ID while events are interleaved.
- Prompt acceptance is distinct from `agent_settled` completion.
- stderr remains diagnostic data rather than protocol input.
- Early child exit rejects an outstanding event wait promptly.
- SIGINT sends `abort`, observes settlement, and reaps the child.
- Two fresh real Pi processes create and resume one isolated session, with
  startup, prompt-acceptance, and settlement latency recorded.

The deterministic checks express durable protocol and lifecycle contracts and
are suitable references for later production tests. Measured latency and Pi's
exact event ordering are characterization data for the pinned Pi version, not
timing guarantees.
