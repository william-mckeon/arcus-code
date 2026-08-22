export * as Database from "./database"

import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { layer as sqliteLayer } from "#sqlite"
import { Context, Effect, Layer } from "effect"
import { Brand } from "../brand"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { isAbsolute, join } from "path"
import { DatabaseMigration } from "./migration"
import { InstallationChannel } from "../installation/version"
import { makeGlobalNode } from "../effect/app-node"

const makeDatabase = EffectDrizzleSqlite.makeWithDefaults()
type DatabaseShape = Effect.Success<typeof makeDatabase>

export interface Interface {
  db: DatabaseShape
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/storage/Database") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeDatabase

    yield* db.run("PRAGMA journal_mode = WAL")
    yield* db.run("PRAGMA synchronous = NORMAL")
    yield* db.run("PRAGMA busy_timeout = 5000")
    yield* db.run("PRAGMA cache_size = -64000")
    yield* db.run("PRAGMA foreign_keys = ON")
    // Without this, freed pages are never returned: deleting a session leaves
    // the file exactly as large and the space is silently reused by whatever
    // grows next. INCREMENTAL rather than FULL so the cost is paid in small
    // deliberate steps instead of on every commit.
    //
    // On a database created before this line existed the mode is baked in at
    // creation and only a full VACUUM can change it, which is why
    // `arcus-code db compact --vacuum` exists rather than this being enough.
    yield* db.run("PRAGMA auto_vacuum = INCREMENTAL")
    yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")
    yield* DatabaseMigration.apply(db)

    return { db }
  }).pipe(Effect.orDie),
)

export function layerFromPath(filename: string) {
  return layer.pipe(Layer.provide(sqliteLayer({ filename })))
}

export function path() {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return join(Global.Path.data, Flag.OPENCODE_DB)
  }
  // One database, unless we actually publish channels.
  //
  // The channel is the git branch a build was cut from, so splitting on it gave
  // every branch its own history: building on `dev` wrote arcus-code-dev.db,
  // a feature branch wrote arcus-code-<branch>.db, and running from source
  // wrote arcus-code-local.db. Sessions silently disappeared on checkout, and
  // none of those builds could see the history in arcus-code.db.
  //
  // The split exists so upstream's beta testers cannot corrupt a stable
  // database. That only makes sense for a project shipping parallel channels,
  // which is exactly what Brand.selfUpdate tracks.
  if (
    !Brand.selfUpdate ||
    ["latest", "beta", "prod"].includes(InstallationChannel) ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "true"
  )
    return join(Global.Path.data, `${Brand.slug}.db`)
  return join(Global.Path.data, `${Brand.slug}-${InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
}

export const node = makeGlobalNode({ service: Service, layer: layerFromPath(path()), deps: [] })
