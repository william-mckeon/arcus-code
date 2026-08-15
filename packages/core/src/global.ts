import path from "path"
import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import os from "os"
import { Context, Effect, Layer } from "effect"
import { Flock } from "./util/flock"
import { Flag } from "./flag/flag"
import { makeGlobalNode } from "./effect/app-node"
import { MigrateDataDir } from "./migrate-data-dir"
import { Brand } from "./brand"

const app = Brand.slug
// Arcus Code was seeded from opencode and shipped under its XDG namespace, so
// installs predating the rename keep their state here. See adoption below.
const legacy = Brand.legacy.slug
const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)
const tmp = path.join(os.tmpdir(), app)

const paths = {
  get home() {
    return process.env.OPENCODE_TEST_HOME ?? os.homedir()
  },
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  repos: path.join(data, "repos"),
  cache,
  config,
  state,
  tmp,
}

export const Path = paths

Flock.setGlobal({ state })

// Adopt any pre-rename directories before creating the new ones — once the new
// directory exists there is nothing left to adopt. tmp is excluded on purpose:
// it is ephemeral, so migrating it would only move garbage.
//
// Run sequentially, not with Promise.all: on failure we stop, and a concurrent
// batch would leave some directories moved and others not — a partial migration
// is the state hardest to recover from.
try {
  for (const [from, to] of [
    [path.join(xdgData!, legacy), data],
    [path.join(xdgCache!, legacy), cache],
    [path.join(xdgConfig!, legacy), config],
    [path.join(xdgState!, legacy), state],
  ] as const) {
    await MigrateDataDir.adopt({ from, to })
  }
  // Must follow directory adoption: the databases are renamed in place, inside
  // whichever directory we just ended up with.
  await MigrateDataDir.adoptDatabases(data)
} catch (error) {
  // Refuse to start rather than continue into a split install. Print the plain
  // message — a stack trace here tells the user nothing they can act on.
  if (error instanceof MigrateDataDir.MigrationBlockedError) {
    process.stderr.write(`\n${error.message}\n\n`)
    process.exit(1)
  }
  throw error
}

await Promise.all([
  fs.mkdir(Path.data, { recursive: true }),
  fs.mkdir(Path.config, { recursive: true }),
  fs.mkdir(Path.state, { recursive: true }),
  fs.mkdir(Path.tmp, { recursive: true }),
  fs.mkdir(Path.log, { recursive: true }),
  fs.mkdir(Path.bin, { recursive: true }),
  fs.mkdir(Path.repos, { recursive: true }),
])

export class Service extends Context.Service<Service, Interface>()("@opencode/Global") {}

export interface Interface {
  readonly home: string
  readonly data: string
  readonly cache: string
  readonly config: string
  readonly state: string
  readonly tmp: string
  readonly bin: string
  readonly log: string
  readonly repos: string
}

export function make(input: Partial<Interface> = {}): Interface {
  return {
    home: Path.home,
    data: Path.data,
    cache: Path.cache,
    config: Flag.OPENCODE_CONFIG_DIR ?? Path.config,
    state: Path.state,
    tmp: Path.tmp,
    bin: Path.bin,
    log: Path.log,
    repos: Path.repos,
    ...input,
  }
}

const layer = Layer.effect(
  Service,
  Effect.sync(() => Service.of(make())),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [] })

export const layerWith = (input: Partial<Interface>) =>
  Layer.effect(
    Service,
    Effect.sync(() => Service.of(make(input))),
  )

export * as Global from "./global"
