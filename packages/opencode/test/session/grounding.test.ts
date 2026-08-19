import { describe, expect, test } from "bun:test"
import {
  absenceClaim,
  absenceContradictions,
  challenge,
  citedPaths,
  citedUrls,
  deterministicProblems,
  groundedBy,
  norm,
  problems,
  ranCheck,
  unbackedMutationClaim,
  unverifiedSuccessClaim,
  webCitationProblems,
  type Evidence,
  type PathKind,
} from "../../src/session/grounding"

const kindOf =
  (map: Record<string, PathKind>) =>
  (p: string): PathKind =>
    map[p] ?? "missing"

const evidence = (over: Partial<Evidence> = {}): Evidence => ({
  touched: new Set<string>(),
  fetched: new Set<string>(),
  mutations: 0,
  verified: false,
  kindOf: () => "missing",
  ...over,
})

describe("grounding.citedPaths", () => {
  test("extracts quoted local paths", () => {
    expect(citedPaths("see `src/tool/websearch.ts` and 'docs/config.mdx'").sort()).toEqual([
      "docs/config.mdx",
      "src/tool/websearch.ts",
    ])
  })

  test("normalizes Windows separators and leading ./", () => {
    // A citation written `src\main.ts` was invisible before backslash was added
    // to the token class; evidence is stored forward-slashed, so both sides
    // must fold identically or a correct citation reads as a phantom.
    expect(citedPaths("`src\\main.ts` and `./src/main.ts`")).toEqual(["src/main.ts"])
  })

  test("skips URLs, scoped packages and absolute paths", () => {
    expect(citedPaths("`https://x.dev/a.ts` `@scope/pkg` `/etc/hosts`")).toEqual([])
  })

  test("strict mode drops import hosts and dates that look like paths", () => {
    // A hard existence check has no model to catch its mistakes, so it must not
    // fail a correct answer that quotes a package path or a date.
    expect(citedPaths("`github.com/foo/bar.go` `2024/01/15` `src/a.ts`", true)).toEqual(["src/a.ts"])
  })

  test("strict mode keeps well-known extensionless files", () => {
    expect(citedPaths("`docker/Dockerfile`", true)).toEqual(["docker/Dockerfile"])
  })

  test("broad mode keeps a bare directory citation", () => {
    // An absence claim often names a directory, so under-inclusion here would
    // skip the check for the whole answer.
    expect(citedPaths("`src/auth` is empty")).toEqual(["src/auth"])
  })
})

describe("grounding.absenceContradictions", () => {
  test("flags a file claimed missing that exists", () => {
    const out = absenceContradictions("The file `src/main.ts` is missing.", kindOf({ "src/main.ts": "file" }))
    expect(out).toEqual(["'src/main.ts' is described as missing/empty, but the file EXISTS"])
  })

  test("flags a directory claimed empty that has files", () => {
    const out = absenceContradictions("`src/auth` is empty.", kindOf({ "src/auth": "nonEmptyDirectory" }))
    expect(out).toEqual(["'src/auth' is described as empty, but the directory CONTAINS files"])
  })

  test("says nothing when the path really is missing", () => {
    expect(absenceContradictions("`src/gone.ts` does not exist.", kindOf({}))).toEqual([])
  })

  test("is scoped per sentence, not per answer", () => {
    // The path is mentioned in one sentence and an absence asserted in another
    // about something else; treating the answer as one blob would flag it.
    const text = "I read `src/main.ts` carefully. The tests directory is missing."
    expect(absenceContradictions(text, kindOf({ "src/main.ts": "file" }))).toEqual([])
  })

  // The ABSENCE_META guard. Each of these is a sentence that contains absence
  // words but does NOT assert the path is absent, and each produced a phantom
  // flag (and a rebuttal loop) in the original before the guard existed.
  describe("strict mode false positives", () => {
    const exists = kindOf({ "src/main.ts": "file" })

    test("an action-negation is not an absence claim", () => {
      const text = "I did not open `src/main.ts`, so I have no view on its contents."
      expect(absenceContradictions(text, exists, { strict: true })).toEqual([])
    })

    test("rebutting someone else's absence claim is not making one", () => {
      const text = "The claim that `src/main.ts` is missing is incorrect."
      expect(absenceContradictions(text, exists, { strict: true })).toEqual([])
    })

    test("an explicit denial is not an absence claim", () => {
      expect(absenceContradictions("`src/main.ts` is not missing.", exists, { strict: true })).toEqual([])
    })

    test("but a genuine absence claim still flags in strict mode", () => {
      expect(absenceContradictions("`src/main.ts` is missing.", exists, { strict: true })).toHaveLength(1)
    })
  })

  test("absenceClaim recognises the prose forms that name no path", () => {
    expect(absenceClaim("the auth service has no Go source")).toBe(true)
    expect(absenceClaim("the directory is empty")).toBe(true)
    expect(absenceClaim("I reviewed the handler and it looks correct")).toBe(false)
  })
})

describe("grounding.unverifiedSuccessClaim", () => {
  test("flags an unconditional success claim when nothing ran", () => {
    expect(unverifiedSuccessClaim("The tests pass.", false)).toHaveLength(1)
    expect(unverifiedSuccessClaim("It compiles cleanly.", false)).toHaveLength(1)
  })

  test("says nothing when a check actually ran", () => {
    expect(unverifiedSuccessClaim("The tests pass.", true)).toEqual([])
  })

  test("a hedge is not an assertion", () => {
    expect(unverifiedSuccessClaim("The tests should pass once you run them.", false)).toEqual([])
    expect(unverifiedSuccessClaim("Run the tests to confirm they pass.", false)).toEqual([])
    expect(unverifiedSuccessClaim("The tests fail.", false)).toEqual([])
  })
})

describe("grounding.ranCheck", () => {
  test("recognises real check commands", () => {
    for (const cmd of ["bun test", "npm run typecheck", "pytest -q", "cargo clippy", "tsgo --noEmit"]) {
      expect(ranCheck(cmd)).toBe(true)
    }
  })

  // The scar: an earlier version matched bare build|compile|lint, so any of
  // these flipped the verified flag and silenced the success net for the turn.
  test("does not mistake these for checks", () => {
    for (const cmd of ["mkdir build", "git checkout build", "cat lint.log", "npm run dev", "echo compile"]) {
      expect(ranCheck(cmd)).toBe(false)
    }
  })
})

describe("grounding.unbackedMutationClaim", () => {
  test("flags a completion claim on an empty ledger", () => {
    expect(unbackedMutationClaim("I created the `src/new.ts` file.", 0)).toHaveLength(1)
  })

  test("says nothing when something really was written", () => {
    expect(unbackedMutationClaim("I created the `src/new.ts` file.", 1)).toEqual([])
  })

  test("an honest read-only answer is the opposite of a claim", () => {
    expect(unbackedMutationClaim("No files were created, edited, or deleted.", 0)).toEqual([])
    expect(unbackedMutationClaim("I did not write anything.", 0)).toEqual([])
  })

  test("descriptive prose about what code does is not a claim about this run", () => {
    // The brittle-NL failure the original caught in a live smoke test.
    expect(unbackedMutationClaim("The config file is created on first run.", 0)).toEqual([])
  })
})

describe("grounding.webCitationProblems", () => {
  test("flags a URL never fetched", () => {
    expect(webCitationProblems("see https://example.com/a", [])).toHaveLength(1)
  })

  test("says nothing when the URL is on the ledger", () => {
    expect(webCitationProblems("see https://example.com/a", ["https://example.com/a"])).toEqual([])
  })

  test("normalizes trailing punctuation on both sides", () => {
    expect(webCitationProblems("(see https://example.com/a).", ["https://example.com/a"])).toEqual([])
  })

  test("citedUrls finds bare and wrapped urls", () => {
    expect(citedUrls("a https://x.dev/one and `https://x.dev/two`").sort()).toEqual([
      "https://x.dev/one",
      "https://x.dev/two",
    ])
  })
})

describe("grounding.deterministicProblems", () => {
  test("flags a cited path with no backing", () => {
    expect(deterministicProblems(["a.ts"], () => false)).toEqual([
      "'a.ts' -- cited in the answer but not found in the workspace",
    ])
  })

  test("groundedBy accepts a bare basename for a nested file", () => {
    // Conservative on purpose: err toward grounded so a correct citation is
    // never called a phantom just because prose named it without its directory.
    expect(groundedBy("config.ts", ["src/config.ts"])).toBe(true)
    expect(groundedBy("other.ts", ["src/config.ts"])).toBe(false)
  })
})

describe("grounding.problems", () => {
  test("clean answer produces nothing", () => {
    expect(problems("I read `src/a.ts` and it handles the retry.", evidence({ kindOf: kindOf({ "src/a.ts": "file" }) }))).toEqual([])
  })

  test("catches the false-absence class end to end", () => {
    // The failure this exists for: asserting something is absent when it is not.
    const out = problems("`src/a.ts` is missing.", evidence({ kindOf: kindOf({ "src/a.ts": "file" }) }))
    expect(out).toHaveLength(1)
    expect(out[0]).toContain("EXISTS")
  })

  test("path and web checks stay off unless asked for", () => {
    const text = "see `ghost.ts` and https://x.dev/a"
    expect(problems(text, evidence())).toEqual([])
    expect(problems(text, evidence(), { checkPaths: true, checkWeb: true })).toHaveLength(2)
  })

  test("empty answer is vacuously grounded", () => {
    expect(problems(undefined, evidence())).toEqual([])
  })
})

describe("grounding.challenge", () => {
  test("caps the list and says how many were withheld", () => {
    const text = challenge(Array.from({ length: 9 }, (_, i) => `problem ${i}`))
    expect(text).toContain("problem 0")
    expect(text).toContain("+3 more")
    expect(text).not.toContain("problem 8")
  })

  test("tells the model to re-send the complete answer", () => {
    // The anti-collapse wording: without it a weak model reduced a whole review
    // to a one-line "confirmed" receipt, and the user got the receipt.
    expect(challenge(["x"])).toContain("COMPLETE answer")
  })
})

describe("grounding.norm", () => {
  test("folds separators, leading ./ and surrounding slashes", () => {
    expect(norm(".\\a\\b.ts")).toBe("a/b.ts")
    expect(norm("./a/b.ts")).toBe("a/b.ts")
    expect(norm("/a/b.ts/")).toBe("a/b.ts")
  })
})
