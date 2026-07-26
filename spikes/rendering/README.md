# Bat streaming spike

This spike validates Slam's assistant-rendering boundary. It starts one Bat
process for an assistant message, writes fragmented Markdown directly to Bat's
stdin, and waits for Bat after closing the message stream.

Run the checks with:

```sh
npm run check
```

Run a visible terminal demo with:

```sh
npm run demo
```

The deterministic fake-Bat checks prove that Slam forces
`--language=markdown`, `--paging=never`, `--color=always`, and `--style=plain`, passes no theme
flag, preserves the user's Bat environment, forwards fragments without document buffering, and
reports startup, nonzero-exit, and broken-pipe failures. The pseudo-TTY check
uses real Bat to verify Markdown content and terminal color output without a
pager.

These invocation and failure contracts are durable. Exact coloring, chunk
coalescing performed by the operating system, and terminal escape sequences are
characterization details rather than stable output contracts.
