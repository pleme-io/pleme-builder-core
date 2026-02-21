/**
 * Tests for usePlaybackTimer hook
 *
 * Tests:
 * - Timer initialization
 * - Start/pause/toggle controls
 * - Countdown with playback speed
 * - Timer completion callback
 * - Reset and setDuration
 * - Progress calculation
 * - Formatted time display
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePlaybackTimer } from '../hooks/usePlaybackTimer'

describe('usePlaybackTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initialization', () => {
    it('should initialize with provided duration', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 60,
          onComplete,
        })
      )

      expect(result.current.remaining).toBe(60)
      expect(result.current.totalDuration).toBe(60)
      expect(result.current.isRunning).toBe(false)
      expect(result.current.progress).toBe(0)
    })

    it('should auto-start when autoStart is true', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 60,
          onComplete,
          autoStart: true,
        })
      )

      expect(result.current.isRunning).toBe(true)
    })

    it('should not auto-start by default', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 60,
          onComplete,
        })
      )

      expect(result.current.isRunning).toBe(false)
    })
  })

  describe('start/pause/toggle', () => {
    it('should start counting down when start is called', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 60,
          onComplete,
        })
      )

      act(() => {
        result.current.start()
      })

      expect(result.current.isRunning).toBe(true)

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(result.current.remaining).toBe(59)
    })

    it('should stop counting when pause is called', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 60,
          onComplete,
        })
      )

      // Start the timer
      act(() => {
        result.current.start()
      })

      // Let it count down
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(result.current.remaining).toBe(59)

      // Pause
      act(() => {
        result.current.pause()
      })

      expect(result.current.isRunning).toBe(false)

      // Advance time while paused
      act(() => {
        vi.advanceTimersByTime(5000)
      })

      // Should still be 59 since paused
      expect(result.current.remaining).toBe(59)
    })

    it('should toggle between start and pause', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 60,
          onComplete,
        })
      )

      expect(result.current.isRunning).toBe(false)

      act(() => {
        result.current.toggle()
      })

      expect(result.current.isRunning).toBe(true)

      act(() => {
        result.current.toggle()
      })

      expect(result.current.isRunning).toBe(false)
    })
  })

  describe('countdown', () => {
    it('should count down and call onComplete when reaching zero', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 3,
          onComplete,
        })
      )

      act(() => {
        result.current.start()
      })

      // Tick 3 times to reach zero
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(result.current.remaining).toBe(2)

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(result.current.remaining).toBe(1)

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(result.current.remaining).toBe(0)

      // onComplete is called via setTimeout, so we need to flush it
      act(() => {
        vi.runAllTimers()
      })

      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(result.current.isRunning).toBe(false)
    })

    it('should count down faster at 2x speed', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 4,
          onComplete,
          playbackSpeed: 2,
        })
      )

      act(() => {
        result.current.start()
      })

      // At 2x speed, tick interval is 500ms
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(result.current.remaining).toBe(3)

      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(result.current.remaining).toBe(2)
    })

    it('should count down slower at 0.5x speed', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 4,
          onComplete,
          playbackSpeed: 0.5,
        })
      )

      act(() => {
        result.current.start()
      })

      // At 0.5x speed, tick interval is 2000ms
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(result.current.remaining).toBe(3)
    })
  })

  describe('reset', () => {
    it('should reset timer to initial duration', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 60,
          onComplete,
        })
      )

      act(() => {
        result.current.start()
      })

      act(() => {
        vi.advanceTimersByTime(10000)
      })

      expect(result.current.remaining).toBe(50)

      act(() => {
        result.current.reset()
      })

      expect(result.current.remaining).toBe(60)
      expect(result.current.isRunning).toBe(false)
    })

    it('should reset to new duration when provided', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 60,
          onComplete,
        })
      )

      act(() => {
        result.current.reset(90)
      })

      expect(result.current.remaining).toBe(90)
      expect(result.current.totalDuration).toBe(90)
    })
  })

  describe('setDuration', () => {
    it('should update totalDuration', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 60,
          onComplete,
        })
      )

      act(() => {
        result.current.setDuration(90)
      })

      // setDuration only updates totalDuration, not remaining
      expect(result.current.totalDuration).toBe(90)
    })
  })

  describe('progress', () => {
    it('should calculate progress as percentage', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 100,
          onComplete,
        })
      )

      expect(result.current.progress).toBe(0)

      act(() => {
        result.current.start()
      })

      act(() => {
        vi.advanceTimersByTime(25000)
      })

      expect(result.current.remaining).toBe(75)
      expect(result.current.progress).toBe(25)
    })
  })

  describe('formattedTime', () => {
    it('should format time as MM:SS with leading zeros', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 125, // 2:05
          onComplete,
        })
      )

      // Implementation uses padStart(2, '0') for both minutes and seconds
      expect(result.current.formattedTime).toBe('02:05')
    })

    it('should format single digit seconds with leading zero', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 63, // 1:03
          onComplete,
        })
      )

      expect(result.current.formattedTime).toBe('01:03')
    })

    it('should handle zero correctly', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 0,
          onComplete,
        })
      )

      expect(result.current.formattedTime).toBe('00:00')
    })

    it('should handle seconds only', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 45,
          onComplete,
        })
      )

      expect(result.current.formattedTime).toBe('00:45')
    })
  })

  describe('onCountdownWarning', () => {
    it('should call warning callback when threshold reached', () => {
      const onComplete = vi.fn()
      const onWarning = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 5,
          onComplete,
          onCountdownWarning: onWarning,
          warningThreshold: 3,
        })
      )

      act(() => {
        result.current.start()
      })

      // Tick from 5 -> 4 (no warning yet, threshold is 3)
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(onWarning).not.toHaveBeenCalled()

      // Tick from 4 -> 3 (warning should be called)
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(onWarning).toHaveBeenCalledWith(3)
    })
  })

  describe('onTick', () => {
    it('should call onTick callback every second', () => {
      const onComplete = vi.fn()
      const onTick = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 5,
          onComplete,
          onTick,
        })
      )

      act(() => {
        result.current.start()
      })

      // Advance through 3 seconds
      for (let i = 0; i < 3; i++) {
        act(() => {
          vi.advanceTimersByTime(1000)
        })
      }

      expect(onTick).toHaveBeenCalledTimes(3)
      expect(onTick).toHaveBeenLastCalledWith(2) // 5 - 3 = 2 remaining
    })
  })

  describe('cleanup', () => {
    it('should cleanup interval on unmount', () => {
      const onComplete = vi.fn()
      const { result, unmount } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 60,
          onComplete,
        })
      )

      act(() => {
        result.current.start()
      })

      unmount()

      // Advancing timers after unmount should not cause issues
      act(() => {
        vi.advanceTimersByTime(60000)
      })

      // onComplete should NOT be called after unmount
      expect(onComplete).not.toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('should handle very short duration', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 1,
          onComplete,
        })
      )

      act(() => {
        result.current.start()
      })

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      act(() => {
        vi.runAllTimers() // Flush setTimeout for onComplete
      })

      expect(onComplete).toHaveBeenCalledTimes(1)
    })

    it('should not go below zero', () => {
      const onComplete = vi.fn()
      const { result } = renderHook(() =>
        usePlaybackTimer({
          initialSeconds: 2,
          onComplete,
        })
      )

      act(() => {
        result.current.start()
      })

      // Advance way past completion
      act(() => {
        vi.advanceTimersByTime(10000)
      })

      expect(result.current.remaining).toBe(0)
    })
  })
})
