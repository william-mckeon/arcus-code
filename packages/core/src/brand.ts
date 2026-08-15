export * as Brand from "./brand"

/**
 * Single source of truth for product identity.
 *
 * Arcus Code is a downstream product built on the opencode engine. Three
 * namespaces coexist deliberately and must not be collapsed into one:
 *
 * - `name` / `cli` / `slug` / `config*` are ours. Rename them freely.
 * - `legacy` values are the pre-rename names. They are **read-only fallbacks**:
 *   discovery accepts them so existing installs and projects keep working, but
 *   nothing new is ever written under them. Removing one is a breaking change.
 * - `upstream` values are protocol identifiers owned by someone else — the
 *   `opencode` provider ID is a live hosted service, and the attribution
 *   headers in `plugin/provider/*` are how third-party APIs recognize this
 *   client. Renaming those deregisters us; it rebrands nothing a user sees.
 *
 * Anything a user reads should come from here. Anything a server compares
 * against should come from `upstream`.
 */
export const name = "Arcus Code"
export const cli = "arcus-code"

/** Filesystem namespace: data, cache, config, state and tmp directories. */
export const slug = "arcus-code"

/** Per-project config directory, searched by walking up from the cwd. */
export const configDir = ".arcus-code"

/** Config filenames, in ascending precedence. */
export const configFiles = ["arcus-code.json", "arcus-code.jsonc"] as const

/** Marker written into a repo's git directory to pin its project ID. */
export const projectMarker = "arcus-code"

/**
 * Whether the binary may update itself.
 *
 * MUST stay false until Arcus publishes its own release artifacts. Every path
 * in `installation/` resolves against upstream's `opencode-ai` npm package and
 * `opencode` Homebrew formula, so a self-update replaces Arcus Code with
 * upstream opencode — silently, and possibly with an older build.
 *
 * The `upgrade` command surfaces this as a message instead of acting.
 */
export const selfUpdate = false

/**
 * Pre-rename names. Accepted on read, never written. Ordered so that when both
 * are present the Arcus name wins — see `config.ts`, where discovery relies on
 * legacy entries sorting before current ones.
 */
export const legacy = {
  slug: "opencode",
  configDir: ".opencode",
  configFiles: ["opencode.json", "opencode.jsonc"],
  projectMarker: "opencode",
} as const

/** Every accepted config directory name, lowest precedence first. */
export const allConfigDirs = [legacy.configDir, configDir]

/** Every accepted config filename, lowest precedence first. */
export const allConfigFiles = [...legacy.configFiles, ...configFiles]

/**
 * Identifiers owned by upstream or by third parties. Never rename these to
 * match `cli` — they are wire values, not branding.
 */
export const upstream = {
  /** Provider ID for opencode zen, and the OAuth client it authenticates as. */
  provider: "opencode",
  clientID: "opencode-cli",
  console: "https://console.opencode.ai",
  /** Sent as X-Title / originator so third-party gateways can attribute us. */
  attribution: "opencode",
  /** OTLP service name; changing it splits trace history in two. */
  serviceName: "opencode",
} as const
