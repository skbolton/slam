# Pi session concurrency characterization

This spike characterizes the append-only session behavior used by Pi 0.82.0.
Two independent processes load the same current leaf before either writes, then
append one entry each without a session lock.

Run it with:

```sh
npm run check
```

The isolated temporary session demonstrates that both writes remain valid JSONL
entries and become sibling branches with the same `parentId`. A fresh loader's
current leaf is the final entry in append order, so one branch becomes active
while the other is abandoned from that active path.

This is characterization, not a concurrency guarantee. Slam intentionally does
not add locking, ownership, serialization, or fork-on-conflict behavior in the
proof of concept. Simultaneous mutation remains unsupported, while multiple
shells are still allowed to attach to one session.
