import { describe, expect, test } from "bun:test"
import { ACTIVE_FPS, IDLE_AFTER_MS, IDLE_FPS, shouldApply, targetFor } from "../src/idle-fps"

// The renderer itself needs a terminal, so what is testable here is the
// decision. That is also where the risk lives: every way this can be wrong ends
// with the UI painting slowly while someone is typing.

const at = (idleFor: number, busy = false) => targetFor({ lastActivity: 0, busy, now: idleFor })

describe("idle fps", () => {
  test("stays at full rate while being used", () => {
    expect(at(0)).toBe(ACTIVE_FPS)
    expect(at(1_000)).toBe(ACTIVE_FPS)
  })

  test("stays at full rate right up to the threshold", () => {
    // Off-by-one here would drop the rate a frame early; harmless, but the
    // boundary is the thing worth pinning.
    expect(at(IDLE_AFTER_MS - 1)).toBe(ACTIVE_FPS)
  })

  test("drops exactly at the threshold", () => {
    expect(at(IDLE_AFTER_MS)).toBe(IDLE_FPS)
    expect(at(IDLE_AFTER_MS * 100)).toBe(IDLE_FPS)
  })

  test("never drops while a session is streaming", () => {
    // Output is changing even though nobody has touched the keyboard. This is
    // the case where a naive idle check would stutter the visible response.
    expect(at(IDLE_AFTER_MS * 10, true)).toBe(ACTIVE_FPS)
  })

  test("a backwards clock reads as active, not as a long idle", () => {
    // now < lastActivity gives a negative age, which would otherwise compare as
    // less than the threshold by luck rather than by intent.
    expect(targetFor({ lastActivity: 10_000, busy: false, now: 0 })).toBe(ACTIVE_FPS)
  })

  test("the idle rate is low but never zero", () => {
    // A frozen UI would be a worse bug than the CPU this saves.
    expect(IDLE_FPS).toBeGreaterThan(0)
    expect(IDLE_FPS).toBeLessThan(ACTIVE_FPS)
  })

  test("the threshold is long enough that typing never reaches it", () => {
    // The whole safety argument: interactive use never enters the low state, so
    // the wake path cannot make typing feel laggy.
    expect(IDLE_AFTER_MS).toBeGreaterThanOrEqual(30_000)
  })

  test("only writes to the renderer on a transition", () => {
    expect(shouldApply(ACTIVE_FPS, ACTIVE_FPS)).toBe(false)
    expect(shouldApply(ACTIVE_FPS, IDLE_FPS)).toBe(true)
    expect(shouldApply(IDLE_FPS, ACTIVE_FPS)).toBe(true)
  })
})
