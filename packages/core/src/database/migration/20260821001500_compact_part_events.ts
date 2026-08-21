import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

/**
 * Drop superseded `message.part.updated.1` events.
 *
 * The shell tool published a durable event per stdout chunk, each carrying the
 * full 30 KB rolling preview. On the machine that surfaced this, that was
 * 73,007 rows and 2,316 MB of `running` progress frames -- to preserve the 323
 * completed frames anything ever reads, which come to 1.1 MB. The tool now
 * throttles those frames, but the rows already written stay until something
 * removes them.
 *
 * Why this is safe to do, rather than merely desirable:
 *
 *  - A part event is a FULL SNAPSHOT, not a delta. session.ts publishes
 *    `structuredClone(part)` on every update, so replaying only the last event
 *    for a part reconstructs exactly the same projection as replaying all of
 *    them. Everything dropped here is a state that was immediately overwritten.
 *
 *  - Sequence numbers are handed out by `event_sequence`, not by MAX(event.seq),
 *    so removing rows cannot corrupt the next sequence number for an aggregate.
 *    `event_sequence` is deliberately untouched -- and must stay that way, since
 *    `event.aggregate_id` references it ON DELETE CASCADE.
 *
 *  - Replay reads `WHERE seq > after ORDER BY seq`, which asserts no contiguity.
 *    Gaps are structurally tolerated; see event-compaction.test.ts, which proves
 *    a projection replayed after compaction equals one replayed before.
 *
 * This reads every row of a table that may be gigabytes, so it costs something
 * exactly once: 8.2s on a real 2,380 MB database, taking 77,247 part events
 * down to 2,754 -- one per part, matching the `part` projection exactly.
 *
 * The space is not returned to the filesystem here. SQLite cannot VACUUM inside
 * a transaction and migrations run in one, so `arcus-code db compact --vacuum`
 * does that half (0.7s on the same database, 2,380 MB -> 65.0 MB). Splitting it
 * keeps a whole-file rewrite, which wants free space of about its own size, out
 * of an unattended startup.
 */
// Exported so the test exercises the statements this migration actually runs,
// rather than a copy of them that can drift.
export const STATEMENTS = [
  `CREATE TEMP TABLE part_event_keep AS
     SELECT aggregate_id, MAX(seq) AS seq
     FROM event
     WHERE type = 'message.part.updated.1'
     GROUP BY aggregate_id, json_extract(data, '$.part.id')`,
  `CREATE INDEX temp.part_event_keep_idx ON part_event_keep (aggregate_id, seq)`,
  `DELETE FROM event
     WHERE type = 'message.part.updated.1'
       AND NOT EXISTS (
         SELECT 1 FROM part_event_keep k
         WHERE k.aggregate_id = event.aggregate_id AND k.seq = event.seq
       )`,
  `DROP TABLE part_event_keep`,
]

export default {
  id: "20260821001500_compact_part_events",
  up(tx) {
    return Effect.gen(function* () {
      for (const statement of STATEMENTS) yield* tx.run(statement)
    })
  },
} satisfies DatabaseMigration.Migration
