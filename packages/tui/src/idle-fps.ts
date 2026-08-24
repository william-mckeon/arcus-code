// Drops the render frame rate when nothing is happening.
//
// The TUI is created with a fixed `targetFps: 60`, so it redraws sixty times a
// second whether or not anything changed. Measured on a real session left open
// overnight: 5.41% of one core, sustained, for twelve hours on a static screen
// -- 43 minutes of CPU to display a screen that never moved. On a laptop that is
// battery and heat for nothing.
//
// The threshold is deliberately long. The risk in a change like this is the wake
// path: if a keypress does not restore the frame rate promptly, typing feels
// laggy, and that is a far worse outcome than the CPU it saves. At IDLE_AFTER_MS
// the low rate is only ever reached by walking away, so interactive use never
// touches this code path at all.

/** Frame rate while the session is being used. Matches the original constant. */
export const ACTIVE_FPS = 60

/**
 * Frame rate once idle. Not zero: the loop still has to notice input and repaint
 * promptly, and a visibly frozen UI would be its own bug.
 */
export const IDLE_FPS = 5

/** How long without input or activity before dropping. Long on purpose. */
export const IDLE_AFTER_MS = 60_000

export interface State {
  /** When input, output or any activity was last seen. */
  readonly lastActivity: number
  /** True while a session is streaming -- output is changing, so keep painting. */
  readonly busy: boolean
  readonly now: number
}

/**
 * The frame rate this state should render at.
 *
 * Kept pure and separate from the renderer so the decision can be tested without
 * a terminal, which is the only part of this that a test can reach.
 */
export function targetFor(state: State): number {
  if (state.busy) return ACTIVE_FPS
  // Guard against a clock that goes backwards: treat it as activity rather than
  // letting a negative age read as "idle for a very long time".
  const idleFor = state.now - state.lastActivity
  if (idleFor < 0) return ACTIVE_FPS
  return idleFor >= IDLE_AFTER_MS ? IDLE_FPS : ACTIVE_FPS
}

/** True when the rate needs changing, so the renderer is only written on transitions. */
export function shouldApply(current: number, next: number) {
  return current !== next
}
