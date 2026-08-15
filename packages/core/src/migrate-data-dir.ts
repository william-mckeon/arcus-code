export * as MigrateDataDir from "./migrate-data-dir"

import fs from "fs/promises"
import path from "path"
import { Brand } from "./brand"

/**
 * Arcus Code inherited opencode's XDG namespace, so renaming it would strand
 * every existing install: sessions, credentials, snapshots and worktrees all
 * live under the old slug. On first run we adopt the old directory instead.
 *
 * Rename rather than copy. The data directory holds a live SQLite database and
 * git snapshot repositories; a half-copied tree is worse than either outcome.
 * If the rename fails — cross-device, permissions, or another instance holding
 * the database open — both trees are left untouched and the new install starts
 * empty. That loses history, but it never corrupts it.
 *
 * Must run before the directories are created. Once `to` exists there is
 * nothing to adopt, which is also what makes this safe to call on every start.
 */
export class MigrationBlockedError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
    override readonly cause: unknown,
  ) {
    super(
      [
        `Could not move ${from} to ${to}.`,
        "",
        "This usually means another instance is running and holding files open.",
        "Close every running instance and start again.",
        "",
        "Nothing has been deleted — your data is still in the old location.",
      ].join("\n"),
    )
    this.name = "MigrationBlockedError"
  }
}

/**
 * Returns true when it adopted, false when there was nothing to adopt.
 *
 * Throws MigrationBlockedError when there *was* something to adopt and the move
 * failed. Swallowing that and continuing is what produced a split install on
 * 2026-08-15: a running process held the databases, the rename failed, startup
 * carried on and created empty directories, and the result was indistinguishable
 * from data loss — credentials stranded on one side, a blank database on the
 * other. Refusing to start is the only honest outcome, because the alternative
 * silently divides a user's history across two locations.
 */
export async function adopt(input: { from: string; to: string }) {
  if (await exists(input.to)) return false
  if (!(await exists(input.from))) return false
  try {
    await fs.mkdir(path.dirname(input.to), { recursive: true })
    await fs.rename(input.from, input.to)
    return true
  } catch (cause) {
    throw new MigrationBlockedError(input.from, input.to, cause)
  }
}

const exists = (dir: string) =>
  fs
    .stat(dir)
    .then(() => true)
    .catch(() => false)

const LEGACY_DB_PREFIX = Brand.legacy.slug
const DB_PREFIX = Brand.slug

/**
 * Adopting the directory is not enough: the databases inside it are named after
 * the old slug too, and there is one per release channel — `opencode.db`,
 * `opencode-dev.db`, `opencode-local.db` — each with SQLite `-shm` and `-wal`
 * sidecars. Miss them and the renamed install opens a blank database beside a
 * full one, which reads to the user as "it deleted all my sessions".
 *
 * Renaming by prefix rather than reconstructing names from the channel keeps
 * this correct for channels this build has never heard of. Safe to run at
 * startup because no connection is open yet; a sidecar left behind by a crash
 * still travels with its database.
 */
export async function adoptDatabases(dir: string) {
  const entries = await fs.readdir(dir).catch(() => [] as string[])
  const legacy = entries.filter((entry) => entry.startsWith(LEGACY_DB_PREFIX) && entry.includes(".db"))
  const adopted: string[] = []
  for (const entry of legacy) {
    const target = DB_PREFIX + entry.slice(LEGACY_DB_PREFIX.length)
    // Never clobber: if the new name already exists it is the live database.
    if (entries.includes(target)) continue
    await fs
      .rename(path.join(dir, entry), path.join(dir, target))
      .then(() => adopted.push(target))
      .catch(() => undefined)
  }
  return adopted
}
