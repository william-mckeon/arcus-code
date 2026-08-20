export * as ToolDiagnostics from "./diagnostics"

// Canonical wording for tool failures and empty results.
//
// These strings are read by a model, not a person, and the phrasing decides
// what it concludes. The scar this exists for: `Cannot read binary file:
// logo.png` says nothing about whether logo.png is THERE, and a run reported
// the asset as missing from the directory it was sitting in. Absence of output
// is not output about absence, and a message that leaves the difference to
// inference will eventually be inferred wrong.
//
// Two rules hold for everything here:
//   1. State what IS true before stating what failed. "The file exists but is
//      binary" forecloses the wrong reading; "cannot read" leaves it open.
//   2. Name what was actually searched. A wrong path and a genuinely empty
//      result produce identical text otherwise, so the model cannot tell a
//      mis-aimed search from a real absence -- and will usually guess absence.
//
// This lives in core rather than beside either tool set so the v1 tools
// (packages/opencode/src/tool) and the v2 tools (./..) cannot drift into
// saying different things about the same situation. They already had: v2's
// grep restricted a file search correctly and v1's did not.

/** Bytes as a short human count, so a size never dominates the sentence. */
function bytes(count: number) {
  if (!Number.isFinite(count) || count < 0) return undefined
  if (count < 1024) return `${count} bytes`
  if (count < 1024 * 1024) return `${Math.round(count / 1024)} KB`
  return `${(count / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * A file that is present but is not text.
 *
 * The existence claim comes first and is stated twice, in two different
 * phrasings, because this is the message that has actually been misread.
 */
export function binaryFile(resource: string, size?: number) {
  const measured = size === undefined ? undefined : bytes(size)
  return [
    `${resource} exists${measured ? ` (${measured})` : ""} but is a binary file, so it cannot be read as text.`,
    `The file is present -- this is not a missing file.`,
    `To inspect it, use bash.`,
  ].join(" ")
}

/**
 * A grep that ran and matched nothing.
 *
 * The old text was "No files found", which names the wrong noun: the files were
 * found, the pattern was not. That reading turns a failed search into a claim
 * that the code does not exist in the project.
 */
export function noMatches(input: { pattern: string; searched: string; include?: string }) {
  const filter = input.include ? `, filtered to ${input.include}` : ""
  return [
    `No matches for "${input.pattern}" in ${input.searched}${filter}.`,
    `The search ran; the pattern did not match.`,
    `That is not evidence the text is absent -- check the pattern and the path before concluding it is not there.`,
  ].join(" ")
}

/**
 * A glob that ran and matched nothing.
 *
 * Same failure mode as noMatches, one level up: the directory was read
 * successfully, so its existence is settled and only the pattern is in doubt.
 */
export function noFilesMatching(input: { pattern: string; searched: string }) {
  return [
    `No files match "${input.pattern}" under ${input.searched}.`,
    `The directory exists and was searched; nothing matched the pattern.`,
    `That is not evidence the directory is empty -- try a broader pattern or a different path.`,
  ].join(" ")
}

/**
 * A path that genuinely is not there, optionally with near misses.
 *
 * Shared so every tool that reports a missing file offers the same neighbours;
 * read did and edit did not, which made the same mistake cost more depending on
 * which tool happened to hit it first.
 */
export function fileNotFound(resource: string, suggestions: readonly string[] = []) {
  const head = `File not found: ${resource}`
  if (suggestions.length === 0) return head
  return `${head}\n\nDid you mean one of these?\n${suggestions.join("\n")}`
}

/**
 * Directory entries that look like a near miss for `base`.
 *
 * The matching is deliberately loose in both directions -- a listed entry that
 * contains the name, or a name that contains the entry -- because the point is
 * to catch a typo or a wrong extension, and a suggestion that turns out to be
 * irrelevant costs far less than silence that gets read as "nothing like it
 * exists here".
 */
export function nearby(entries: readonly string[], base: string, limit = 3) {
  const needle = base.toLowerCase()
  if (!needle) return []
  return entries
    .filter((entry) => {
      const candidate = entry.toLowerCase()
      return candidate.includes(needle) || needle.includes(candidate)
    })
    .slice(0, limit)
}
