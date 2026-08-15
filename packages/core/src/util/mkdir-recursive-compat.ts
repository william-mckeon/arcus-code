export * as MkdirRecursiveCompat from "./mkdir-recursive-compat"

import fs from "node:fs/promises"

/**
 * Restores Node's documented `mkdir(path, { recursive: true })` contract.
 *
 * Node guarantees that call is a no-op when `path` already exists. Under Bun
 * on Windows the guarantee does not hold for directories OneDrive has synced —
 * they throw EEXIST. Observed on every directory in a synced checkout (the
 * repository root, `.opencode`, `packages`, `node_modules`), while freshly
 * created directories elsewhere behave correctly. Same family as
 * oven-sh/bun#21901, which `FSUtil.ensureDir` already works around for our own
 * calls.
 *
 * The reason this is installed globally rather than wrapped around the one
 * caller: `@npmcli/arborist` destructures at module load —
 *
 *   const { lstat, mkdir, rm, symlink } = require('node:fs/promises')
 *
 * so it captures the function reference before any call-site patch could run.
 * The shim therefore has to be in place before arborist is imported, which is
 * why this module patches on import and never restores. Importing it early in
 * `npm.ts` is what guarantees that ordering.
 *
 * Without it every background dependency install fails on a synced checkout
 * and project plugins never receive their dependencies.
 *
 * Deliberately narrow: only `recursive: true` is affected, and only when the
 * path really is an existing directory. A file sitting where a directory
 * should be still raises EEXIST — that is a genuine error, not a platform
 * quirk.
 */
const original = fs.mkdir

const patched = async (target: Parameters<typeof fs.mkdir>[0], options?: Parameters<typeof fs.mkdir>[1]) => {
  try {
    return await original(target, options as never)
  } catch (error) {
    if (!isRecursive(options)) throw error
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error
    if (!(await isDirectory(target))) throw error
    // Node returns undefined here, meaning "nothing needed creating".
    return undefined
  }
}

const isRecursive = (options: unknown) =>
  typeof options === "object" && options !== null && (options as { recursive?: boolean }).recursive === true

const isDirectory = (target: unknown) =>
  fs
    .stat(target as never)
    .then((info) => info.isDirectory())
    .catch(() => false)

Object.defineProperty(fs, "mkdir", { value: patched, configurable: true, writable: true })

/** Exported so the patch is observable in tests. */
export const installed = true
