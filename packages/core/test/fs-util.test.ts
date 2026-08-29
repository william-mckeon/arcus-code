import { describe, expect, test } from "bun:test"
import { FSUtil } from "@opencode-ai/core/fs-util"

// windowsPath existed and worked, and only two callers used it: the shell tool
// and read. write, edit and the v2 resolver did not, so a path the shell itself
// had just printed resolved somewhere else entirely.
//
// A model ran `pwd`, got /c/Users/willi/... from Git Bash, passed it straight to
// write, and Node read the leading /c as a rooted path on the current drive. The
// five files landed in C:\c\Users\willi\... The directories the model had made
// with `mkdir -p` were real, so the listing confirmed the work while the files
// were somewhere nobody would look. Nothing errored.
//
// There was no test for this function anywhere, which is why nobody noticed it
// was load-bearing for two callers out of nine.

const win = process.platform === "win32"

describe("FSUtil.windowsPath", () => {
  test.skipIf(!win)("converts an MSYS drive path from Git Bash pwd", () => {
    expect(FSUtil.windowsPath("/c/Users/willi/project")).toBe("C:/Users/willi/project")
  })

  test.skipIf(!win)("converts a bare drive root", () => {
    expect(FSUtil.windowsPath("/c/")).toBe("C:/")
    expect(FSUtil.windowsPath("/c")).toBe("C:/")
  })

  test.skipIf(!win)("uppercases the drive letter", () => {
    expect(FSUtil.windowsPath("/d/work")).toBe("D:/work")
  })

  test.skipIf(!win)("converts the /c:/ form", () => {
    expect(FSUtil.windowsPath("/c:/Users/willi")).toBe("C:/Users/willi")
  })

  test.skipIf(!win)("converts cygwin and WSL forms", () => {
    expect(FSUtil.windowsPath("/cygdrive/c/Users")).toBe("C:/Users")
    expect(FSUtil.windowsPath("/mnt/c/Users")).toBe("C:/Users")
  })

  // The rule is a SINGLE letter segment. Multi-letter roots are left alone,
  // which matters because the other half of this failure is roots the model
  // invents outright -- /workdir, /workspace, /app. Those are a different
  // problem and this function must not silently rewrite them into drive
  // letters, or an invented path would start resolving to a real disk.
  test.skipIf(!win)("leaves an invented multi-letter root untouched", () => {
    expect(FSUtil.windowsPath("/workdir/backend/main.go")).toBe("/workdir/backend/main.go")
    expect(FSUtil.windowsPath("/workspace/main.go")).toBe("/workspace/main.go")
    expect(FSUtil.windowsPath("/app")).toBe("/app")
  })

  test.skipIf(!win)("leaves a normal POSIX path untouched", () => {
    expect(FSUtil.windowsPath("/usr/local/bin")).toBe("/usr/local/bin")
  })

  test.skipIf(!win)("leaves an already-Windows path untouched", () => {
    expect(FSUtil.windowsPath("C:/Users/willi")).toBe("C:/Users/willi")
  })

  test.skipIf(!win)("leaves a relative path untouched", () => {
    expect(FSUtil.windowsPath("src/index.ts")).toBe("src/index.ts")
    expect(FSUtil.windowsPath("./src/index.ts")).toBe("./src/index.ts")
  })

  test.skipIf(win)("is a no-op off win32", () => {
    expect(FSUtil.windowsPath("/c/Users/willi")).toBe("/c/Users/willi")
    expect(FSUtil.windowsPath("/usr/local")).toBe("/usr/local")
  })
})
