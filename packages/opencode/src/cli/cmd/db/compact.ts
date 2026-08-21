import type { Argv } from "yargs"
import fs from "fs"
import { Database } from "@opencode-ai/core/database/database"
import { STATEMENTS } from "@opencode-ai/core/database/migration/20260821001500_compact_part_events"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { effectCmd } from "../../effect-cmd"

// Reclaims the space the shell tool's progress frames used to consume.
//
// Two halves, deliberately separate. Deleting superseded rows is quick and safe
// and the migration already does it on first launch; this exists so it can be
// run again. Returning the bytes to the filesystem needs VACUUM, which SQLite
// refuses inside a transaction, so it cannot live in a migration at all.
//
// Measured on a real 2,380 MB database: the delete took 8.2s, the VACUUM 0.7s,
// and the file ended at 65.0 MB with all 61 sessions, 899 messages and 2,754
// parts intact. VACUUM still rewrites the whole file and wants free space of
// about its own size, so it stays opt-in -- but it is seconds, not minutes.

const bytes = (count: number) =>
  count < 1024 * 1024 ? `${Math.round(count / 1024)} KB` : `${(count / (1024 * 1024)).toFixed(1)} MB`

const fileSize = (path: string) => {
  let total = 0
  // The -wal holds pages not yet folded into the main file, so reporting the
  // main file alone would overstate what was actually reclaimed.
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      total += fs.statSync(`${path}${suffix}`).size
    } catch {
      // absent is fine -- a fresh database has no -wal
    }
  }
  return total
}

export const CompactCommand = effectCmd({
  command: "compact",
  describe: "drop superseded tool-progress events, optionally reclaiming disk space",
  instance: false,
  builder: (yargs: Argv) =>
    yargs.option("vacuum", {
      type: "boolean",
      default: false,
      describe: "also VACUUM, returning freed pages to the filesystem (slow; needs free space equal to the database)",
    }),
  handler: Effect.fn("Cli.db.compact")(function* (args: { vacuum: boolean }) {
    const { db } = yield* Database.Service
    const path = Database.path()
    const before = fileSize(path)

    const count = () =>
      db
        .all<{ n: number }>(sql.raw(`SELECT COUNT(*) AS n FROM event WHERE type = 'message.part.updated.1'`))
        .pipe(Effect.map((rows) => rows[0]?.n ?? 0))

    const partsBefore = yield* count().pipe(Effect.orDie)
    console.log(`${partsBefore} part events, ${bytes(before)} on disk`)

    // The same statements the migration runs, imported rather than restated so
    // the two cannot drift apart.
    for (const statement of STATEMENTS) yield* db.run(sql.raw(statement)).pipe(Effect.orDie)
    const partsAfter = yield* count().pipe(Effect.orDie)
    console.log(`removed ${partsBefore - partsAfter} superseded events, ${partsAfter} remain`)

    if (!args.vacuum) {
      console.log(
        `space is now reusable but still allocated. re-run with --vacuum to return ${bytes(before)} to the disk`,
      )
      return
    }

    console.log("vacuuming (rewrites the whole database; seconds on a few GB, but needs free space to match)...")
    yield* db.run(sql.raw("VACUUM")).pipe(Effect.orDie)
    const after = fileSize(path)
    console.log(`${bytes(before)} -> ${bytes(after)}, reclaimed ${bytes(Math.max(0, before - after))}`)
  }),
})
