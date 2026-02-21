/**
 * PlaybackEngine - Render-prop component for builder playback/teaching mode
 *
 * Manages timer state, keyboard shortcuts, and fullscreen for teaching sequences.
 * Products provide their own UI through the render function.
 *
 * @example
 * ```tsx
 * <PlaybackEngine
 *   steps={sequence.steps}
 *   onComplete={() => navigate('/sequences')}
 * >
 *   {({ currentStep, timeRemaining, isRest, isPaused, controls, settings }) => (
 *     <FullScreenOverlay>
 *       <PoseImage src={posesMap[currentStep.positionId].imageUrl} />
 *       <Timer seconds={timeRemaining} />
 *       <ControlBar>
 *         <Button onClick={controls.previous}>Prev</Button>
 *         <Button onClick={controls.toggle}>{isPaused ? 'Play' : 'Pause'}</Button>
 *         <Button onClick={controls.next}>Next</Button>
 *       </ControlBar>
 *     </FullScreenOverlay>
 *   )}
 * </PlaybackEngine>
 * ```
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlaybackTimer } from '../hooks/usePlaybackTimer'
import {
  DEFAULT_PLAYBACK_SETTINGS,
  type BaseStep,
  type PlaybackControls,
  type PlaybackEngineProps,
  type PlaybackRenderProps,
  type PlaybackSettings,
} from '../types'

// Re-export default settings for convenience
export { DEFAULT_PLAYBACK_SETTINGS }

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_STORAGE_KEY = 'builder-playback-settings'
const DEFAULT_STEP_DURATION = 60
const DEFAULT_REST_DURATION = 0

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Load settings from localStorage with fallback to defaults
 */
function loadSettings(key: string): PlaybackSettings {
  if (typeof window === 'undefined') return DEFAULT_PLAYBACK_SETTINGS

  try {
    const stored = localStorage.getItem(key)
    if (stored) {
      return { ...DEFAULT_PLAYBACK_SETTINGS, ...JSON.parse(stored) }
    }
  } catch (e) {
    console.warn('[PlaybackEngine] Failed to load settings:', e)
  }
  return DEFAULT_PLAYBACK_SETTINGS
}

/**
 * Save settings to localStorage
 */
function saveSettings(key: string, settings: PlaybackSettings): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(key, JSON.stringify(settings))
  } catch (e) {
    console.warn('[PlaybackEngine] Failed to save settings:', e)
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

export function PlaybackEngine<TStep extends BaseStep>({
  steps,
  getStepDuration,
  getRestDuration,
  onStepChange,
  onComplete,
  onPause,
  onResume,
  initialSettings,
  settingsStorageKey = DEFAULT_STORAGE_KEY,
  children,
}: PlaybackEngineProps<TStep>): React.ReactNode {
  // State
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isRest, setIsRest] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [settings, setSettingsState] = useState<PlaybackSettings>(() => ({
    ...loadSettings(settingsStorageKey),
    ...initialSettings,
  }))

  // Refs
  const containerRef = useRef<HTMLDivElement>(null)

  // Current step
  const currentStep = steps[currentIndex] as TStep | undefined

  // Duration helpers
  const getDuration = useCallback(
    (step: TStep) => {
      if (getStepDuration) return getStepDuration(step)
      return step.durationSeconds ?? DEFAULT_STEP_DURATION
    },
    [getStepDuration]
  )

  const getRest = useCallback(
    (step: TStep) => {
      if (getRestDuration) return getRestDuration(step)
      return step.restDurationSeconds ?? DEFAULT_REST_DURATION
    },
    [getRestDuration]
  )

  // Current duration based on whether we're in rest period
  const currentDuration = useMemo(() => {
    if (!currentStep) return DEFAULT_STEP_DURATION
    return isRest ? getRest(currentStep) : getDuration(currentStep)
  }, [currentStep, isRest, getDuration, getRest])

  // Timer completion handler
  const handleTimerComplete = useCallback(() => {
    if (!currentStep) return

    if (!isRest && settings.showRestPeriods && getRest(currentStep) > 0) {
      // Transition to rest period
      setIsRest(true)
    } else if (settings.autoAdvance) {
      // Move to next step
      if (currentIndex < steps.length - 1) {
        setIsRest(false)
        setCurrentIndex((prev) => prev + 1)
      } else {
        // Playback complete
        onComplete?.()
      }
    }
  }, [currentStep, isRest, settings.showRestPeriods, settings.autoAdvance, getRest, currentIndex, steps.length, onComplete])

  // Timer hook
  const timer = usePlaybackTimer({
    initialSeconds: currentDuration,
    onComplete: handleTimerComplete,
    playbackSpeed: settings.playbackSpeed,
    autoStart: settings.autoAdvance,
  })

  // Reset timer when step or rest state changes
  useEffect(() => {
    timer.reset(currentDuration)
    if (settings.autoAdvance && currentStep) {
      timer.start()
    }
  }, [currentIndex, isRest]) // eslint-disable-line react-hooks/exhaustive-deps

  // Notify on step change
  useEffect(() => {
    if (currentStep && !isRest) {
      onStepChange?.(currentIndex, currentStep)
    }
  }, [currentIndex, currentStep, isRest, onStepChange])

  // Settings change handler (persists to localStorage)
  const handleSettingsChange = useCallback(
    (updates: Partial<PlaybackSettings>) => {
      setSettingsState((prev) => {
        const newSettings = { ...prev, ...updates }
        saveSettings(settingsStorageKey, newSettings)
        return newSettings
      })
    },
    [settingsStorageKey]
  )

  // Fullscreen handling
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().catch(console.error)
      setIsFullscreen(true)
    } else {
      document.exitFullscreen?.().catch(console.error)
      setIsFullscreen(false)
    }
  }, [])

  // Listen for fullscreen changes (e.g., user presses Esc)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  // Controls
  const controls: PlaybackControls = useMemo(
    () => ({
      play: () => {
        timer.start()
        onResume?.()
      },
      pause: () => {
        timer.pause()
        onPause?.()
      },
      toggle: () => {
        if (timer.isRunning) {
          timer.pause()
          onPause?.()
        } else {
          timer.start()
          onResume?.()
        }
      },
      next: () => {
        if (currentIndex < steps.length - 1) {
          setIsRest(false)
          setCurrentIndex((prev) => prev + 1)
        } else {
          onComplete?.()
        }
      },
      previous: () => {
        if (currentIndex > 0) {
          setIsRest(false)
          setCurrentIndex((prev) => prev - 1)
        }
      },
      restart: () => {
        setIsRest(false)
        setCurrentIndex(0)
      },
      skipRest: () => {
        if (isRest) {
          setIsRest(false)
          if (currentIndex < steps.length - 1) {
            setCurrentIndex((prev) => prev + 1)
          } else {
            onComplete?.()
          }
        }
      },
      goToStep: (index: number) => {
        if (index >= 0 && index < steps.length) {
          setIsRest(false)
          setCurrentIndex(index)
        }
      },
      toggleFullscreen,
    }),
    [currentIndex, steps.length, isRest, timer, onPause, onResume, onComplete, toggleFullscreen]
  )

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          controls.toggle()
          break
        case 'ArrowRight':
          e.preventDefault()
          controls.next()
          break
        case 'ArrowLeft':
          e.preventDefault()
          controls.previous()
          break
        case 'KeyR':
          e.preventDefault()
          controls.restart()
          break
        case 'KeyF':
          e.preventDefault()
          controls.toggleFullscreen()
          break
        case 'Escape':
          if (isFullscreen) {
            document.exitFullscreen?.().catch(console.error)
          }
          break
        case 'KeyS':
          if (isRest) {
            e.preventDefault()
            controls.skipRest()
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [controls, isFullscreen, isRest])

  // If no steps, render nothing
  if (!currentStep) {
    return null
  }

  // Render props
  const renderProps: PlaybackRenderProps<TStep> = {
    currentStep,
    currentIndex,
    totalSteps: steps.length,
    timeRemaining: timer.remaining,
    totalDuration: timer.totalDuration,
    progress: timer.progress,
    isRest,
    isPaused: !timer.isRunning,
    isFullscreen,
    controls,
    settings,
    onSettingsChange: handleSettingsChange,
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      {children(renderProps)}
    </div>
  )
}
