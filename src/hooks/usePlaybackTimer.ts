/**
 * usePlaybackTimer - Timer hook for builder playback mode
 *
 * Provides countdown functionality with configurable speed and callbacks.
 * Used by PlaybackEngine for teaching mode timers.
 *
 * @example
 * ```tsx
 * const timer = usePlaybackTimer({
 *   initialSeconds: 60,
 *   onComplete: () => goToNextStep(),
 *   playbackSpeed: 1.5,
 * })
 *
 * // Render
 * <Timer seconds={timer.remaining} />
 * <Button onClick={timer.toggle}>{timer.isRunning ? 'Pause' : 'Play'}</Button>
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react'

// ============================================================================
// TYPES
// ============================================================================

export interface UsePlaybackTimerOptions {
  /** Initial duration in seconds */
  initialSeconds: number
  /** Callback when timer reaches zero */
  onComplete: () => void
  /** Playback speed multiplier (0.5, 1, 1.5, 2) - default: 1 */
  playbackSpeed?: number
  /** Callback for countdown warnings (e.g., last 3 seconds) */
  onCountdownWarning?: (secondsRemaining: number) => void
  /** Number of seconds before completion to trigger warning (default: 3) */
  warningThreshold?: number
  /** Auto-start the timer when mounted (default: false) */
  autoStart?: boolean
  /** Callback on each tick (useful for visual effects) */
  onTick?: (remaining: number) => void
}

export interface UsePlaybackTimerReturn {
  /** Remaining seconds */
  remaining: number
  /** Total duration in seconds */
  totalDuration: number
  /** Whether timer is running */
  isRunning: boolean
  /** Start the timer */
  start: () => void
  /** Pause the timer */
  pause: () => void
  /** Toggle play/pause */
  toggle: () => void
  /** Reset to initial or new duration */
  reset: (newDuration?: number) => void
  /** Set new duration without resetting (continues from current remaining) */
  setDuration: (newDuration: number) => void
  /** Progress percentage (0-100) */
  progress: number
  /** Formatted time string (MM:SS) */
  formattedTime: string
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Format seconds as MM:SS string
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

// ============================================================================
// HOOK
// ============================================================================

export function usePlaybackTimer({
  initialSeconds,
  onComplete,
  playbackSpeed = 1,
  onCountdownWarning,
  warningThreshold = 3,
  autoStart = false,
  onTick,
}: UsePlaybackTimerOptions): UsePlaybackTimerReturn {
  const [remaining, setRemaining] = useState(initialSeconds)
  const [isRunning, setIsRunning] = useState(autoStart)
  const [duration, setDurationState] = useState(initialSeconds)

  // Use refs for callbacks to avoid recreating the interval on callback changes
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onCompleteRef = useRef(onComplete)
  const onCountdownWarningRef = useRef(onCountdownWarning)
  const onTickRef = useRef(onTick)
  const isMountedRef = useRef(true)

  // Keep callback refs updated
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    onCountdownWarningRef.current = onCountdownWarning
  }, [onCountdownWarning])

  useEffect(() => {
    onTickRef.current = onTick
  }, [onTick])

  // Track mounted state to prevent state updates after unmount
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Clear interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  // Timer tick logic
  useEffect(() => {
    if (!isRunning) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    // Adjust tick interval based on playback speed
    const tickInterval = 1000 / playbackSpeed

    intervalRef.current = setInterval(() => {
      if (!isMountedRef.current) return

      setRemaining((prev) => {
        // Call tick callback
        if (onTickRef.current) {
          onTickRef.current(prev - 1)
        }

        // Countdown warning for last N seconds
        if (prev <= warningThreshold + 1 && prev > 1 && onCountdownWarningRef.current) {
          onCountdownWarningRef.current(prev - 1)
        }

        // Timer complete
        if (prev <= 1) {
          setIsRunning(false)
          // Call onComplete in next tick to ensure state is updated
          setTimeout(() => {
            if (isMountedRef.current) {
              onCompleteRef.current()
            }
          }, 0)
          return 0
        }

        return prev - 1
      })
    }, tickInterval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isRunning, playbackSpeed, warningThreshold])

  // Reset remaining when initialSeconds changes (e.g., new step)
  useEffect(() => {
    setRemaining(initialSeconds)
    setDurationState(initialSeconds)
  }, [initialSeconds])

  const start = useCallback(() => {
    if (remaining > 0) {
      setIsRunning(true)
    }
  }, [remaining])

  const pause = useCallback(() => {
    setIsRunning(false)
  }, [])

  const toggle = useCallback(() => {
    if (isRunning) {
      pause()
    } else {
      start()
    }
  }, [isRunning, pause, start])

  const reset = useCallback((newDuration?: number) => {
    setIsRunning(false)
    const dur = newDuration ?? duration
    setDurationState(dur)
    setRemaining(dur)
  }, [duration])

  const setDuration = useCallback((newDuration: number) => {
    setDurationState(newDuration)
  }, [])

  const progress = duration > 0 ? ((duration - remaining) / duration) * 100 : 0
  const formattedTime = formatTime(remaining)

  return {
    remaining,
    totalDuration: duration,
    isRunning,
    start,
    pause,
    toggle,
    reset,
    setDuration,
    progress,
    formattedTime,
  }
}
