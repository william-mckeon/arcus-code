import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { STATEMENTS } from "@opencode-ai/core/database/migration/20260821001500_compact_part_events"

// The compaction migration deletes rows from a table that is the system's
// source of truth, so the claim that it is safe has to be a test rather than an
// argument in a commit message. What is asserted here is the property the
// safety rests on: a part event is a FULL SNAPSHOT, so replaying only the last
// event for a part reconstructs the same projection as replaying all of them.

const PART_UPDATED = "message.part.updated.1"

/** Minimal stand-in for the real schema -- only the columns the SQL touches. */
function db() {
  const database = new Database(":memory:")
  database.run(`
    CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, owner_id TEXT);
    CREATE TABLE event (
      id TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL REFERENCES event_sequence(aggregate_id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `)
  return database
}

let counter = 0
function put(database: Database, aggregate: string, seq: number, type: string, data: Record<string, unknown>) {
  database.run(`INSERT OR IGNORE INTO event_sequence (aggregate_id, seq) VALUES (?, ?)`, [aggregate, seq])
  database.run(`UPDATE event_sequence SET seq = ? WHERE aggregate_id = ? AND seq < ?`, [seq, aggregate, seq])
  database.run(`INSERT INTO event (id, aggregate_id, seq, type, data) VALUES (?, ?, ?, ?, ?)`, [
    `evt_${counter++}`,
    aggregate,
    seq,
    type,
    JSON.stringify(data),
  ])
}

/** A part update as session.ts publishes it: a whole cloned part, not a delta. */
const partUpdate = (partID: string, status: string, output: string) => ({
  part: { id: partID, tool: "bash", state: { status, metadata: { output } } },
})

/** The read model, rebuilt the way replay does: ascending seq, last write wins. */
function project(database: Database, aggregate: string) {
  const rows = database
    .query(`SELECT data FROM event WHERE aggregate_id = ? AND type = ? ORDER BY seq ASC`)
    .all(aggregate, PART_UPDATED) as { data: string }[]
  const parts = new Map<string, unknown>()
  for (const row of rows) {
    const value = JSON.parse(row.data).part
    parts.set(value.id, value)
  }
  return parts
}

const compact = (database: Database) => {
  for (const statement of STATEMENTS) database.run(statement)
}

describe("event compaction", () => {
  test("the projection is identical before and after", () => {
    // This is the whole safety argument, stated as an assertion.
    const database = db()
    for (let seq = 1; seq <= 40; seq++)
      put(database, "ses_a", seq, PART_UPDATED, partUpdate("prt_1", "running", `chunk ${seq}`))
    put(database, "ses_a", 41, PART_UPDATED, partUpdate("prt_1", "completed", "final output"))

    const before = project(database, "ses_a")
    compact(database)
    const after = project(database, "ses_a")

    expect(after).toEqual(before)
    expect(database.query(`SELECT COUNT(*) n FROM event`).get()).toEqual({ n: 1 })
  })

  test("the surviving row is the last one, not an arbitrary one", () => {
    const database = db()
    put(database, "ses_a", 1, PART_UPDATED, partUpdate("prt_1", "running", "early"))
    put(database, "ses_a", 2, PART_UPDATED, partUpdate("prt_1", "completed", "late"))
    compact(database)
    const row = database.query(`SELECT data FROM event`).get() as { data: string }
    expect(JSON.parse(row.data).part.state.metadata.output).toBe("late")
  })

  test("each part keeps its own terminal row", () => {
    // Grouping is by (aggregate, part). Collapsing to one row per aggregate
    // would silently destroy every earlier tool call in a session.
    const database = db()
    put(database, "ses_a", 1, PART_UPDATED, partUpdate("prt_1", "running", "a1"))
    put(database, "ses_a", 2, PART_UPDATED, partUpdate("prt_1", "completed", "a2"))
    put(database, "ses_a", 3, PART_UPDATED, partUpdate("prt_2", "running", "b1"))
    put(database, "ses_a", 4, PART_UPDATED, partUpdate("prt_2", "completed", "b2"))
    compact(database)
    expect(project(database, "ses_a").size).toBe(2)
    expect(database.query(`SELECT COUNT(*) n FROM event`).get()).toEqual({ n: 2 })
  })

  test("sessions are not collapsed into each other", () => {
    const database = db()
    put(database, "ses_a", 1, PART_UPDATED, partUpdate("prt_1", "running", "a"))
    put(database, "ses_a", 2, PART_UPDATED, partUpdate("prt_1", "completed", "a final"))
    put(database, "ses_b", 1, PART_UPDATED, partUpdate("prt_1", "completed", "b final"))
    compact(database)
    expect(project(database, "ses_a").get("prt_1")).toMatchObject({ state: { metadata: { output: "a final" } } })
    expect(project(database, "ses_b").get("prt_1")).toMatchObject({ state: { metadata: { output: "b final" } } })
  })

  test("other event types are untouched", () => {
    // Only the progress-frame type is pathological. Nothing else may be lost.
    const database = db()
    put(database, "ses_a", 1, "message.updated.1", { message: { id: "msg_1" } })
    put(database, "ses_a", 2, "session.updated.1", { session: { id: "ses_a" } })
    put(database, "ses_a", 3, PART_UPDATED, partUpdate("prt_1", "running", "x"))
    put(database, "ses_a", 4, PART_UPDATED, partUpdate("prt_1", "completed", "y"))
    compact(database)
    const types = database.query(`SELECT type FROM event ORDER BY seq`).all() as { type: string }[]
    expect(types.map((t) => t.type)).toEqual(["message.updated.1", "session.updated.1", PART_UPDATED])
  })

  test("event_sequence is left alone, so the next seq is unaffected", () => {
    // event.aggregate_id references it ON DELETE CASCADE, and new sequence
    // numbers come from here rather than MAX(event.seq) -- touching it would
    // both corrupt sequencing and cascade away the rows we just kept.
    const database = db()
    for (let seq = 1; seq <= 10; seq++)
      put(database, "ses_a", seq, PART_UPDATED, partUpdate("prt_1", "running", `${seq}`))
    compact(database)
    expect(database.query(`SELECT seq FROM event_sequence WHERE aggregate_id = 'ses_a'`).get()).toEqual({ seq: 10 })
  })

  test("replay tolerates the gaps compaction leaves", () => {
    // Replay reads `WHERE seq > after ORDER BY seq` and asserts no contiguity,
    // so a watermark part-way through must still return the right rows.
    const database = db()
    put(database, "ses_a", 1, PART_UPDATED, partUpdate("prt_1", "running", "a1"))
    put(database, "ses_a", 2, PART_UPDATED, partUpdate("prt_1", "completed", "a2"))
    put(database, "ses_a", 9, PART_UPDATED, partUpdate("prt_2", "completed", "b1"))
    compact(database)
    const after = database
      .query(`SELECT seq FROM event WHERE aggregate_id = ? AND seq > ? ORDER BY seq`)
      .all("ses_a", 2)
    expect(after).toEqual([{ seq: 9 }])
  })

  test("running the compaction twice changes nothing the second time", () => {
    // It ships as a migration, but the CLI can run it again; it has to be
    // idempotent or a re-run would eat the terminal rows.
    const database = db()
    put(database, "ses_a", 1, PART_UPDATED, partUpdate("prt_1", "running", "x"))
    put(database, "ses_a", 2, PART_UPDATED, partUpdate("prt_1", "completed", "y"))
    compact(database)
    const once = project(database, "ses_a")
    compact(database)
    expect(project(database, "ses_a")).toEqual(once)
    expect(database.query(`SELECT COUNT(*) n FROM event`).get()).toEqual({ n: 1 })
  })

  test("an empty table is not an error", () => {
    const database = db()
    expect(() => compact(database)).not.toThrow()
  })
})
