import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { MigrateDataDir } from "../src/migrate-data-dir"

const scratch = async () => {
  const dir = path.join(os.tmpdir(), `arcus-migrate-test-${crypto.randomUUID()}`)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

const write = async (file: string, body = "x") => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body)
}

const exists = (target: string) =>
  fs
    .stat(target)
    .then(() => true)
    .catch(() => false)

describe("MigrateDataDir.adopt", () => {
  test("moves a pre-rename directory when the new one is absent", async () => {
    const root = await scratch()
    await write(path.join(root, "opencode", "auth.json"), "creds")

    expect(await MigrateDataDir.adopt({ from: path.join(root, "opencode"), to: path.join(root, "arcus-code") })).toBe(
      true,
    )
    expect(await Bun.file(path.join(root, "arcus-code", "auth.json")).text()).toBe("creds")
    expect(await exists(path.join(root, "opencode"))).toBe(false)
  })

  test("leaves both alone when the new directory already exists", async () => {
    const root = await scratch()
    await write(path.join(root, "opencode", "auth.json"), "old")
    await write(path.join(root, "arcus-code", "auth.json"), "current")

    expect(await MigrateDataDir.adopt({ from: path.join(root, "opencode"), to: path.join(root, "arcus-code") })).toBe(
      false,
    )
    // The live directory must win — adopting over it would destroy real state.
    expect(await Bun.file(path.join(root, "arcus-code", "auth.json")).text()).toBe("current")
    expect(await Bun.file(path.join(root, "opencode", "auth.json")).text()).toBe("old")
  })

  test("is a no-op on a fresh install", async () => {
    const root = await scratch()
    expect(await MigrateDataDir.adopt({ from: path.join(root, "opencode"), to: path.join(root, "arcus-code") })).toBe(
      false,
    )
    expect(await exists(path.join(root, "arcus-code"))).toBe(false)
  })

  test("throws rather than silently skipping when the move fails", async () => {
    const root = await scratch()
    await write(path.join(root, "opencode", "auth.json"), "creds")
    // A file where the destination's parent must be makes mkdir/rename fail, in
    // the same shape as a Windows rename blocked by an open database handle.
    await write(path.join(root, "blocked"), "not a directory")

    const attempt = MigrateDataDir.adopt({
      from: path.join(root, "opencode"),
      to: path.join(root, "blocked", "arcus-code"),
    })

    // Returning false here is what stranded credentials in the old directory
    // while startup carried on and created an empty one.
    expect(attempt).rejects.toThrow(MigrateDataDir.MigrationBlockedError)
    // The source must be left completely untouched.
    expect(await Bun.file(path.join(root, "opencode", "auth.json")).text()).toBe("creds")
  })
})

describe("MigrateDataDir.adoptDatabases", () => {
  test("renames every channel database with its sqlite sidecars", async () => {
    const dir = await scratch()
    for (const file of [
      "opencode.db",
      "opencode.db-shm",
      "opencode.db-wal",
      "opencode-dev.db",
      "opencode-dev.db-wal",
      "opencode-local.db",
    ]) {
      await write(path.join(dir, file), file)
    }

    const adopted = await MigrateDataDir.adoptDatabases(dir)

    expect(adopted.toSorted()).toEqual([
      "arcus-code-dev.db",
      "arcus-code-dev.db-wal",
      "arcus-code-local.db",
      "arcus-code.db",
      "arcus-code.db-shm",
      "arcus-code.db-wal",
    ])
    // Content must survive: a rename that lost the sidecars would silently
    // truncate uncommitted WAL data.
    expect(await Bun.file(path.join(dir, "arcus-code.db-wal")).text()).toBe("opencode.db-wal")
    expect(await Bun.file(path.join(dir, "arcus-code-dev.db")).text()).toBe("opencode-dev.db")
    expect(await exists(path.join(dir, "opencode.db"))).toBe(false)
  })

  test("never clobbers an existing arcus database", async () => {
    const dir = await scratch()
    await write(path.join(dir, "opencode.db"), "legacy")
    await write(path.join(dir, "arcus-code.db"), "live")

    expect(await MigrateDataDir.adoptDatabases(dir)).toEqual([])
    expect(await Bun.file(path.join(dir, "arcus-code.db")).text()).toBe("live")
    expect(await Bun.file(path.join(dir, "opencode.db")).text()).toBe("legacy")
  })

  test("ignores non-database files that share the prefix", async () => {
    const dir = await scratch()
    await write(path.join(dir, "opencode.json"), "config")
    await write(path.join(dir, "auth.json"), "creds")

    expect(await MigrateDataDir.adoptDatabases(dir)).toEqual([])
    expect(await exists(path.join(dir, "opencode.json"))).toBe(true)
  })

  test("tolerates a missing directory", async () => {
    expect(await MigrateDataDir.adoptDatabases(path.join(os.tmpdir(), `arcus-missing-${crypto.randomUUID()}`))).toEqual(
      [],
    )
  })
})
