// IMPORTANT: set env vars BEFORE anything imports from src/.
// xdg-basedir resolves these at import time, and src/global.ts both creates the
// directories and adopts any pre-rename ones during module evaluation. Without
// isolation a test run would reach into the developer's real ~/.local/share and
// rename it out from under a running install.
import os from "os"
import path from "path"
import fs from "fs/promises"

const dir = path.join(os.tmpdir(), "arcus-code-core-test-" + process.pid)
await fs.mkdir(dir, { recursive: true })

process.env["XDG_DATA_HOME"] = path.join(dir, "share")
process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
process.env["XDG_STATE_HOME"] = path.join(dir, "state")

process.env.OPENCODE_DB = ":memory:"
process.env.OPENCODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.OPENCODE_DISABLE_MODELS_FETCH = "true"
