export * as Grounding from "./grounding"

// Are the CLAIMS in the closing answer grounded in the sources the run actually
// cited and touched?
//
// Ported from openagent_code's src/grounding.py. The regexes and the reasoning
// behind them are kept close to the original because each one is a scar: the
// comments record the specific false conclusion that motivated the rule, and
// re-deriving them from scratch would mean re-earning those bugs.
//
// Everything here is pure. Evidence and an existence oracle are injected, so
// this file has no dependency on Effect, the filesystem, or the session schema
// -- which is what makes each detector testable on a plain string.
//
// Nothing in here decides what to DO about a problem. It returns a list of
// human-readable strings; [] means grounded. The caller logs them, or later
// challenges on them.

// ---------------------------------------------------------------- extraction

// A path-like token in the answer. Backslash is included so a Windows-style
// citation `src\main.ts` is seen at all -- norm() folds it to '/'.
const QUOTED = /[`'"]([A-Za-z0-9_.\-/\\]+)[`'"]/g

// Known code/doc extensions -- the NARROW tier, used where a hard existence
// check runs with no model to sanity-check it.
const EXT = /\.(py|js|ts|tsx|jsx|go|rs|java|rb|c|h|cpp|md|ya?ml|json|toml|sql|sh|txt|env|conf|cfg|ini|lock|xml|html|css)$/i
const ANYEXT = /\.[A-Za-z0-9]{1,8}$/ // any file-ish extension -- BROAD tier
const DOMAIN = /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z]{2,}$/ // github.com, example.io
const DATE = /^\d{1,4}([/-]\d{1,4}){2}$/ // 2024/01/15

// Well-known extensionless files. A citation like `docker/Dockerfile` has a
// slash but no dotted extension, so the strict extractor would drop it and the
// existence check would never run on a described-but-nonexistent Dockerfile.
const NOEXT_FILES =
  /(?:^|\/)(?:Dockerfile|Containerfile|Makefile|GNUmakefile|Rakefile|Gemfile|Procfile|Justfile|Vagrantfile|Jenkinsfile|Caddyfile|Pipfile|Brewfile)$/i

const URL_RE = /https?:\/\/[^\s`'"<>\]]+/gi

/**
 * Normalize a path token to the workspace-relative, forward-slash form that a
 * CITATION and a piece of EVIDENCE are both compared in, so `.\docker\README.md`,
 * `./docker/README.md` and `docker/README.md` all match. Citation and evidence
 * extraction must use this identically or a correct citation gets flagged
 * ungrounded on nothing but a path separator.
 */
export function norm(p: string | undefined) {
  const s = (p ?? "").replace(/\\/g, "/").trim()
  return (s.startsWith("./") ? s.slice(2) : s).replace(/^\/+|\/+$/g, "")
}

/**
 * Local file/dir paths the answer references. Two strictnesses, because the two
 * consumers pull in opposite directions.
 *
 * strict=false (BROAD): any token with a slash or a file-ish extension.
 * Over-inclusion is harmless when a reader judges the result; under-inclusion
 * silently skips the check for the whole answer.
 *
 * strict=true (NARROW): require a known extension, and drop import-hosts
 * (`github.com/...`) and date look-alikes, because a hard existence check with
 * no model would wrongly fail a correct answer quoting `lodash/fp` or
 * `2024/01/15`.
 *
 * Both exclude URLs, scoped packages and absolute paths -- none of which are
 * workspace-relative files.
 */
export function citedPaths(finalText: string | undefined, strict = false) {
  const out = new Set<string>()
  for (const m of (finalText ?? "").matchAll(QUOTED)) {
    const raw = m[1]
    if (raw.includes("://") || raw.startsWith("@")) continue // URL or scoped package
    if (raw.replace(/\\/g, "/").trim().startsWith("/")) continue // absolute -- not judgeable
    const p = norm(raw)
    if (!p || p === "." || p === "..") continue
    if (strict) {
      if (!EXT.test(p) && !NOEXT_FILES.test(p)) continue
      if (DATE.test(p) || (p.includes("/") && DOMAIN.test(p.split("/", 1)[0]))) continue
    } else if (!p.includes("/") && !ANYEXT.test(p)) {
      continue
    }
    out.add(p)
  }
  return [...out]
}

export function citedUrls(finalText: string | undefined) {
  const out = new Set<string>()
  for (const m of (finalText ?? "").matchAll(URL_RE)) out.add(normUrl(m[0]))
  return [...out]
}

/** Trailing punctuation is stripped from both sides of the comparison so a
 *  prose-wrapped "(see https://x/y)" still matches the fetch ledger's key. */
export function normUrl(u: string) {
  return u
    .trim()
    .replace(/[).,;:'"\]]+$/, "")
    .toLowerCase()
}

// ---------------------------------------------------------------- absence

// Language asserting that a file, directory or body of code is MISSING, EMPTY
// or ABSENT -- the honest-but-wrong "the auth service has no source / the
// directory is empty" class. Deliberately over-triggering: a false trigger
// costs one wasted check, while a missed false-absence is the entire failure
// mode this exists to catch.
//
// The final alternative is a deliberate addition to the original, not a port.
// Upstream handles "the FILE `x` is missing" (a noun, then the predicate) and
// "missing `x.ts`" (the predicate, then an extension), but not "`x` is missing"
// -- a quoted path followed straight by the predicate, with no noun and the
// extension on the wrong side of it. That is the most natural way to write the
// claim, and all three of the first tests written against this file used it.
// Requiring the quoted token to be immediately followed by is/are/was/were plus
// an absence word keeps the false-positive risk about as low as a regex gets.
export const ABSENCE =
  /\b(?:no|not|without|lacks?|lacking|missing|absent|empty|nonexistent|un(?:implemented|written|available))\b.{0,40}?(?:\b(?:sources?|code|implementation|implemented|logic|files?|director(?:y|ies)|folder|module|package|tests?|endpoints?|built)\b|\.(?:go|py|ts|tsx|js|jsx|rs|java|rb|sql|sh|c|cpp|h)\b)|\b(?:sources?|code|implementation|files?|director(?:y|ies)|folder|module|service)\b.{0,25}?\b(?:is|are|was|were)\s+(?:empty|missing|absent)\b|\bcannot\s+be\s+(?:built|run|compiled|found)\b|\bdoes\s+not\s+exist\b|\b(?:only|just|solely)\s+(?:docs?|documentation|config)|[`'"][^`'"\n\s]+[`'"]\s+(?:is|are|was|were)\s+(?:completely\s+|entirely\s+|totally\s+)?(?:empty|missing|absent|gone|nonexistent|non-existent)\b/i

// A REAL absence PREDICATE -- the cited thing IS empty/missing/absent. Used in
// strict mode so the absence must actually predicate the path rather than
// merely co-occur with an absence word in the same sentence.
export const ABSENCE_PREDICATE =
  /\b(?:is|are|was|were|seems?|appears?|looks?|remains?)\s+(?:to\s+be\s+)?(?:completely\s+|entirely\s+|totally\s+|basically\s+|essentially\s+)?(?:empty|missing|absent|gone|nonexistent|non-existent|unpopulated|not\s+present|not\s+there)\b|\bdoes\s+not\s+exist\b|\bdoesn'?t\s+exist\b|\bdo\s+not\s+exist\b|\bhas\s+no\s+(?:[\w.\-]+\s+){0,3}(?:source|code|content|files?|implementation)\b|\b(?:no|zero)\s+(?:[\w.\-]+\s+){0,3}(?:source|code|content|files?|implementation)\b|\bcannot\s+be\s+(?:built|compiled|found)\b/i

// Markers that make an absence hit a FALSE positive: a quoted or meta rebuttal
// (the answer denying the claim), or an ACTION-negation about the path -- "I
// did not open it" is not "it does not exist". Without this guard a correct
// rebuttal gets flagged, which in the original produced a self-perpetuating
// loop of the model rebutting its own rebuttal.
export const ABSENCE_META =
  /\b(?:claim|claimed|describ(?:ed|es)\s+as|says?|stated|state|assert|incorrect|wrong|false|never\s+(?:said|described|claimed|called)|is\s+not\s+(?:missing|empty|absent)|isn'?t\s+(?:missing|empty|absent)|did(?:\s+not|n'?t)\s+(?:open|read|review|view|check|see|find|examine|inspect|look)|only\s+read|haven'?t\s+(?:read|reviewed|opened|checked))\b/i

export function absenceClaim(finalText: string | undefined) {
  return ABSENCE.test(finalText ?? "")
}

const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n+/)

// A question is not an assertion. An answer that asks "Tests pass?" before
// saying it cannot tell was read as claiming they do, because the sentence
// splitter cuts at the question mark and leaves "Tests pass?" standing alone.
const isQuestion = (sentence: string) => sentence.trim().endsWith("?")

// A filename is not prose. `never.txt` contains "never", and a live run used
// exactly that name: the negation guard read the filename as an honest denial
// and let a false completion claim through. `deleted-rows.md` would trip the
// mutation verb, `test-pass.ts` the success net.
//
// So claim and guard patterns are matched against the sentence with quoted
// spans removed. Patterns that need the citation itself -- FILE_REF, which
// looks for a quoted filename, and the quoted-token branch of ABSENCE -- keep
// the original text.
const prose = (sentence: string) => sentence.replace(/[`'"][^`'"\n]*[`'"]/g, " ")

// The path is being described as a CONTAINER of something absent rather than
// absent itself: "no test files in `src/auth`" says nothing about whether
// src/auth exists, so reporting it as "described as empty" is simply wrong.
// Detected by a containment preposition immediately before the citation.
const CONTAINED_IN = /\b(?:in|inside|within|under|from|across|throughout)\s+$/i

function claimsPathIsAbsent(sentence: string, path: string) {
  for (const quote of ["`", "'", '"']) {
    const at = sentence.indexOf(quote + path)
    if (at === -1) continue
    if (CONTAINED_IN.test(sentence.slice(0, at))) return false
  }
  return true
}

export type PathKind = "file" | "nonEmptyDirectory" | "missing"

/**
 * Flag a claim that a cited path is empty/missing/absent when it actually
 * exists. Model-free and authoritative for the live workspace, so it catches a
 * false absence even when a semantic reader mis-reads a listing.
 *
 * Scoped PER SENTENCE: the path must be claimed absent in context, not merely
 * mentioned somewhere else in the answer.
 */
export function absenceContradictions(
  finalText: string | undefined,
  kindOf: (path: string) => PathKind,
  options: { strict?: boolean } = {},
) {
  if (!finalText || !absenceClaim(finalText)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const sent of sentences(finalText)) {
    if (isQuestion(sent)) continue
    if (!ABSENCE.test(sent)) continue
    // In strict mode require a real absence predicate and no rebuttal marker,
    // so "I did not open `X`" and "the claim that `X` is missing is incorrect"
    // stop producing phantom flags.
    if (options.strict && (!ABSENCE_PREDICATE.test(prose(sent)) || ABSENCE_META.test(prose(sent)))) continue
    for (const p of citedPaths(sent, false)) {
      // BROAD on purpose: a bare directory citation must count too.
      if (!claimsPathIsAbsent(sent, p)) continue
      const kind = kindOf(p)
      let msg: string | undefined
      if (kind === "file") msg = `'${p}' is described as missing/empty, but the file EXISTS`
      else if (kind === "nonEmptyDirectory") msg = `'${p}' is described as empty, but the directory CONTAINS files`
      if (!msg || seen.has(msg)) continue
      seen.add(msg)
      out.push(msg)
    }
  }
  return out
}

// ---------------------------------------------------------------- success

// An UNCONDITIONAL assertion that a build/test/check SUCCEEDED -- the class
// where success is INFERRED from reading code instead of running anything.
export const SUCCESS =
  /\b(?:tests?|test\s+suite|build|lint(?:ing)?|type[- ]?check|compilation|checks?)\b[^.\n]{0,48}?\b(?:pass(?:es|ed|ing)?|succeed(?:s|ed)?|are\s+green|is\s+green|clean(?:ly)?|compil(?:es|ed)|without\s+errors?|no\s+errors?)\b|\b(?:it|the\s+code|the\s+app|everything)\b[^.\n]{0,24}?\b(?:now\s+)?works?\b|\bcompiles?\s+(?:cleanly|successfully|without\s+errors?)\b|\bno\s+(?:test\s+)?(?:errors?|failures?)\b/i

// Hedges that make a success mention conditional, future or negated -- "should
// pass", "run the tests to confirm", "the tests fail" are not assertions of a
// result that happened.
export const HEDGED =
  /\b(?:should|would|will|to\s+(?:confirm|verify|check|ensure)|run\s+(?:the\s+|npm\s+|)?tests?|you\s+can|please\s+run|if\s+you\s+run|once\s+you|after\s+(?:you\s+)?run|expected\s+to|ought\s+to|could|might|may|need\s+to\s+run|have\s+not|haven'?t|has\s+not|did\s+not|didn'?t|do\s+not|don'?t|cannot|can'?t|unable|fail(?:s|ed|ing)?|not\s+(?:yet\s+)?(?:pass|passing|verified|run|able))\b/i

// A command that IS a check, so an exit-0 from it really verifies a success
// claim. The original's earlier version matched bare `build|compile|lint`,
// which caught `mkdir build`, `git checkout build` and `npm run dev` -- any of
// which flipped the verified flag and silenced this net for a whole turn. Hence
// distinctive tools only, or an explicit `<tool> <verb>`.
export const CHECK_CMD =
  /\b(?:pytest|jest|vitest|mocha|tox|nox|ctest|rspec|phpunit|tsc|tsgo|eslint|oxlint|ruff|flake8|pylint|mypy|pyright|black\s+--check|prettier\s+--check|cmake|ninja|bazel|meson|msbuild|xcodebuild|gradle|mvn|make|go\s+(?:test|build|vet)|cargo\s+(?:test|build|check|clippy)|dotnet\s+(?:test|build)|npm\s+(?:test|ci)|npm\s+run\s+(?:\w*test\w*|build|lint|check|typecheck|tsc|compile|ci)|yarn\s+(?:test|build|lint|check|typecheck|tsc)|pnpm\s+(?:test|build|lint|check|typecheck|tsc)|bun\s+(?:test|run\s+(?:\w*test\w*|build|lint|check|typecheck)))\b/i

// A sentence saying tests do not EXIST is not a claim that they passed. "no
// tests exist to pass" matched SUCCESS on `tests ... pass` and slipped past
// HEDGED, which covers "cannot"/"did not" but not a bare "no" -- and a bare
// "no" cannot go in HEDGED, because "compiles with no errors" is a real
// success claim that must keep firing.
const SUCCESS_ABSENT =
  /\b(?:no|zero)\s+(?:\w+\s+){0,2}tests?\b|\bthere\s+(?:are|were)\s+no\s+tests?\b|\bnothing\s+to\s+(?:test|run)\b|\bvacuous(?:ly)?\b|\bn\/a\b/i

// A shell command that can create or change a file. Files get written by shell
// far more often than by the write tool -- a live run created a file with a
// redirect, said so truthfully, and was told nothing had been written.
//
// The bias here is the opposite of CHECK_CMD's. Over-matching costs a missed
// catch; under-matching accuses the answer of lying about work it actually did.
// So a redirect anywhere counts, even into /dev/null, because the cost of
// counting it is only silence.
const WRITE_CMD =
  /(?<!\|)>>?|\btee\b|\b(?:cp|mv|rm|mkdir|touch|truncate|install|ln)\b|\bsed\b[^|]*-i|\bgit\s+(?:apply|checkout|restore|clean|mv|rm)\b|\bpatch\b|\bdd\b|\b(?:Set|Add|Clear)-Content\b|\bOut-File\b|\b(?:New|Copy|Move|Remove|Rename)-Item\b/i

export function writesFiles(command: string | undefined) {
  return WRITE_CMD.test(command ?? "")
}

export function ranCheck(command: string | undefined) {
  return CHECK_CMD.test(command ?? "")
}

/**
 * Flag an unconditional "the tests pass / it compiles / it works" when nothing
 * this turn actually confirmed it. Per sentence, hedge-guarded.
 */
export function unverifiedSuccessClaim(finalText: string | undefined, verified: boolean) {
  if (!finalText || verified) return []
  for (const sent of sentences(finalText)) {
    if (isQuestion(sent)) continue
    const said = prose(sent)
    if (!SUCCESS.test(said) || HEDGED.test(said) || SUCCESS_ABSENT.test(said)) continue
    return [
      "you state a build, test or check succeeded, but nothing this turn ran one -- run the check, or say plainly that it has not been run",
    ]
  }
  return []
}

// ---------------------------------------------------------------- mutation

const MUTATION_DONE = /\b(?:created|wrote|written|copied|moved|renamed|deleted|scaffolded)\b/i
const FILE_REF =
  /\b(?:files?|folders?|director(?:y|ies)|scripts?|modules?|packages?|repos?|repositor(?:y|ies)|the\s+(?:working\s+)?directory)\b|[`'"][^`'"\n\s]*\.[A-Za-z0-9]{1,8}[`'"]/i
// An honest read-only answer says "No files were created" -- the OPPOSITE of a
// completion claim, and true on an empty ledger.
const MUT_NEGATED =
  /\b(?:no|not|never|none|nothing|without|didn'?t|doesn'?t|don'?t|hasn'?t|haven'?t|hadn'?t|wasn'?t|weren'?t|isn'?t|aren'?t|cannot|can'?t)\b/i
// Only fire on a claim the answer makes about ITSELF -- first person, or a
// directional result. Descriptive prose about what code does ("the file created
// on first run") is neither, and flagging it was the brittle-NL failure the
// original caught in a live smoke test.
const MUT_FIRST_PERSON = /\b(?:I|we)\b/i
const MUT_DIRECTIONAL =
  /\b(?:to|into|onto|in|under|at)\s+(?:the\s+)?(?:working\s+)?(?:director|workspace|repo|folder|cwd|root|here\b)/i

/**
 * Flag "I created/copied/wrote X" when nothing was written this run. Returns []
 * the moment any real mutation happened -- a partial change is not this check's
 * business, so it never second-guesses a run that did change files.
 */
export function unbackedMutationClaim(finalText: string | undefined, mutationCount: number) {
  if (!finalText || mutationCount > 0) return []
  for (const sent of sentences(finalText)) {
    if (isQuestion(sent)) continue
    // FILE_REF keeps the original: it looks for the quoted filename itself.
    const said = prose(sent)
    if (!(MUTATION_DONE.test(said) && FILE_REF.test(sent))) continue
    if (HEDGED.test(said) || MUT_NEGATED.test(said)) continue
    if (!(MUT_FIRST_PERSON.test(said) || MUT_DIRECTIONAL.test(said))) continue
    return [
      "you state you created, copied or changed a file this run, but nothing was written, edited or deleted -- make the change, or say plainly that nothing changed",
    ]
  }
  return []
}

// ---------------------------------------------------------------- citations

/**
 * Each cited path must be backed by evidence. The oracle is injected: at
 * runtime it checks the workspace plus the mutation ledger.
 */
export function deterministicProblems(paths: string[], exists: (path: string) => boolean) {
  return [...paths]
    .sort()
    .filter((p) => !exists(p))
    .map((p) => `'${p}' -- cited in the answer but not found in the workspace`)
}

/**
 * A cited path counts as backed by an exact normalized match OR the same
 * basename: a file read at `src/config.ts` but cited in prose as `config.ts` is
 * the same claim. The leniency keeps this conservative on purpose -- err toward
 * grounded, so a correct citation is never called a phantom over a bare name.
 */
/**
 * True if a cited token is a bare filename rather than a path. Absence of such
 * a token is unprovable by resolving it against the workspace root: an answer
 * citing `cors.go` for a file that really lives at
 * src/auth/internal/middleware/cors.go is correct, and reporting it as "not
 * found in the workspace" is the check being wrong, not the answer.
 */
export function isBareName(cited: string) {
  return !cited.includes("/")
}

export function groundedBy(cited: string, evidence: Iterable<string>) {
  const base = cited.split("/").pop()
  for (const e of evidence) {
    if (e === cited) return true
    if (e.split("/").pop() === base) return true
  }
  return false
}

/** A cited URL the run never fetched is a phantom web source. */
export function webCitationProblems(finalText: string | undefined, fetched: Iterable<string>) {
  const cited = citedUrls(finalText)
  if (cited.length === 0) return []
  const have = new Set([...fetched].map(normUrl))
  return cited
    .filter((u) => !have.has(u))
    .sort()
    .map((u) => `you cite ${u} but never fetched it this run -- fetch it, or drop the claim`)
}

// ---------------------------------------------------------------- aggregate

export interface Evidence {
  /** Workspace-relative paths the run actually engaged (read/wrote/edited). */
  readonly touched: ReadonlySet<string>
  /** URLs put on the fetch ledger this run. */
  readonly fetched: ReadonlySet<string>
  /** Successful file mutations this run. */
  readonly mutations: number
  /** True if some command this turn was a real check that exited 0. */
  readonly verified: boolean
  /** Live-workspace oracle. Returns "missing" when it cannot tell. */
  readonly kindOf: (path: string) => PathKind
}

export interface Options {
  readonly absenceStrict?: boolean
  readonly checkPaths?: boolean
  readonly checkWeb?: boolean
  readonly checkMutations?: boolean
  /**
   * "Does this citation name something that exists?" Separate from
   * Evidence.kindOf, which answers about one exact location: a bare filename
   * has no location to resolve, so the caller supplies an oracle that can look
   * it up wherever it lives. Falls back to kindOf when not given.
   */
  readonly existsSomewhere?: (path: string) => boolean
}

/**
 * Every deterministic check, in one pass. [] means grounded.
 *
 * The absence and success nets run regardless of whether the answer cited a
 * path: an absence claim names its target only in prose, so gating on citations
 * would skip exactly the case this is for.
 */
export function problems(finalText: string | undefined, evidence: Evidence, options: Options = {}) {
  if (!finalText) return []
  const out: string[] = []

  out.push(...absenceContradictions(finalText, evidence.kindOf, { strict: options.absenceStrict }))
  out.push(...unverifiedSuccessClaim(finalText, evidence.verified))

  if (options.checkWeb) out.push(...webCitationProblems(finalText, evidence.fetched))
  if (options.checkMutations) out.push(...unbackedMutationClaim(finalText, evidence.mutations))
  if (options.checkPaths) {
    const cited = citedPaths(finalText, true) // NARROW: a hard check with no model to catch its mistakes
    const exists = options.existsSomewhere ?? ((p: string) => evidence.kindOf(p) !== "missing")
    out.push(...deterministicProblems(cited, (p) => exists(p) || groundedBy(p, evidence.touched)))
  }

  return out
}

/**
 * The re-prompt, for when this stops being log-only. Deliberately narrow and
 * non-hijacking: re-check the flagged claim and still answer the CURRENT task.
 *
 * Capped at six. The original found that re-prompting a weak model to fix
 * twenty flagged claims at once sent it into a repetition loop; the rest are
 * still detected on the next round, which is far better than inducing one.
 */
export function challenge(found: string[]) {
  const shown = found.slice(0, 6)
  const more = found.length - shown.length
  let body = shown.map((p) => `- ${p}`).join("\n")
  if (more > 0) body += `\n- (+${more} more unbacked claim(s) -- fix these first, or drop what you cannot back)`
  return (
    "Some claims in your last answer may not be backed by the files:\n" +
    body +
    "\nCheck ONLY these against the files. Then RE-SEND your COMPLETE answer with just the flagged claim(s) " +
    "fixed -- keep every other part fully written out, not collapsed to a 'confirmed' note. If a flagged " +
    "claim turns out to be correct when you check, KEEP it. No meta-commentary about this instruction."
  )
}
