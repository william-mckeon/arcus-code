import { useRenderer } from "@opentui/solid"
import { useKeyboard } from "@opentui/solid"
import { onCleanup, onMount } from "solid-js"
import { useSync } from "../context/sync"
import { ACTIVE_FPS, IDLE_AFTER_MS, shouldApply, targetFor } from "../idle-fps"

// Lowers the render frame rate once nothing is happening.
//
// The renderer is created with a fixed targetFps of 60, so it repaints sixty
// times a second whether or not the screen changed. Measured on a real session
// left open overnight: 5.41% of one core, sustained, for twelve hours on a
// static screen. That is battery and heat spent drawing the same pixels.
//
// Renders nothing. It exists to hold the timer and the input hook, mounted once
// near the root so it sees every keypress regardless of which view is up.
export function IdleFps() {
  const renderer = useRenderer()
  // Read through a guard. This component is mounted near the root of the tree,
  // and its worst failure mode is not "the frame rate is wrong" but "the TUI
  // does not start". Nothing here is worth taking the app down for, so a
  // missing or changed context degrades to "always active" -- the behaviour
  // before this component existed.
  let sync: ReturnType<typeof useSync> | undefined
  try {
    sync = useSync()
  } catch {
    sync = undefined
  }

  let lastActivity = Date.now()
  const wake = () => {
    lastActivity = Date.now()
    // Restore immediately rather than waiting for the next tick. A keypress that
    // repaints late is exactly the failure this whole change must not cause.
    if (shouldApply(renderer.targetFps, ACTIVE_FPS)) {
      renderer.targetFps = ACTIVE_FPS
      renderer.maxFps = ACTIVE_FPS
    }
  }

  useKeyboard(wake)

  onMount(() => {
    // Any session streaming counts as activity even with no one at the keyboard,
    // or a long reply would turn choppy partway through. Checked across all
    // sessions rather than the focused one, so a background task keeps the
    // frame rate up too.
    const busy = () => {
      try {
        const statuses = sync?.data?.session_status
        if (!statuses) return false
        return Object.values(statuses).some((status) => status?.type !== "idle")
      } catch {
        // Treat an unreadable status as busy: staying at full rate costs CPU,
        // dropping wrongly costs the user a stuttering screen.
        return true
      }
    }

    // Polled rather than driven by a signal: the point is to notice the ABSENCE
    // of events, which no event can tell us. A quarter of the idle threshold is
    // frequent enough to be responsive and rare enough to cost nothing.
    const timer = setInterval(() => {
      if (busy()) {
        lastActivity = Date.now()
        return
      }
      const next = targetFor({ lastActivity, busy: false, now: Date.now() })
      if (!shouldApply(renderer.targetFps, next)) return
      renderer.targetFps = next
      renderer.maxFps = next
    }, IDLE_AFTER_MS / 4)

    onCleanup(() => {
      clearInterval(timer)
      // Leave the renderer as it was found; a torn-down component must not
      // strand the UI at the idle rate.
      renderer.targetFps = ACTIVE_FPS
      renderer.maxFps = ACTIVE_FPS
    })
  })

  return null
}
