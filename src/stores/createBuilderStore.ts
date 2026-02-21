// @ts-nocheck - Immer Draft<T> types don't work well with generics, runtime is correct
/**
 * createBuilderStore - Factory for creating optimistic builder stores
 *
 * Creates a Zustand store with Immer for optimistic UI updates.
 * The store handles:
 * 1. Local state management (instant UI feedback)
 * 2. Pending operations buffer
 * 3. Debounced sync scheduling
 * 4. Rollback on errors
 *
 * @example
 * ```ts
 * const useYogaBuilderStore = createBuilderStore<YogaPose, YogaStep, AddPayload, UpdatePayload>({
 *   name: 'yoga-builder',
 *   createLocalStep: (tempId, sessionId, pose, order) => ({
 *     id: tempId,
 *     sessionId,
 *     positionId: pose.id,
 *     stepOrder: order,
 *     durationSeconds: 60,
 *     // ...
 *   }),
 *   applyStepUpdates: (step, updates) => {
 *     if (updates.durationSeconds) step.durationSeconds = updates.durationSeconds
 *   },
 * })
 * ```
 */

import { create, type StateCreator } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  BaseItem,
  BaseStep,
  LocalStep,
  PendingOperation,
  BuilderStore,
  BuilderStoreConfig,
} from '../types'

// ============================================================================
// CONSTANTS
// ============================================================================

/** Prefix for temporary optimistic step IDs */
export const TEMP_ID_PREFIX = 'temp-'

/** Default debounce delay for sync operations */
export const DEFAULT_SYNC_DEBOUNCE_MS = 500

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique temporary ID for optimistic operations
 */
function generateTempId(): string {
  return `${TEMP_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Check if an ID is a temporary optimistic ID
 */
export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_ID_PREFIX)
}

// ============================================================================
// STORE FACTORY
// ============================================================================

// Timer stored outside of Immer-managed state to avoid serialization issues
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Creates a typed Zustand store for builder functionality
 */
export function createBuilderStore<
  TItem extends BaseItem,
  TStep extends BaseStep,
  TAddPayload extends Record<string, unknown> = Record<string, unknown>,
  TUpdatePayload extends Record<string, unknown> = Record<string, unknown>
>(
  config: BuilderStoreConfig<TItem, TStep, TAddPayload, TUpdatePayload>
): () => BuilderStore<TItem, TStep, TAddPayload, TUpdatePayload> {
  const { name, createLocalStep, applyStepUpdates, syncDebounceMs = DEFAULT_SYNC_DEBOUNCE_MS } = config

  type Store = BuilderStore<TItem, TStep, TAddPayload, TUpdatePayload>

  const initialState = {
    compositionId: null,
    steps: [] as LocalStep<TStep>[],
    itemsMap: {} as Record<string, TItem>,
    isSyncing: false,
    syncError: null,
    lastSyncedAt: null,
    pendingOperations: [] as PendingOperation[],
  }

  const storeCreator: StateCreator<Store, [['zustand/immer', never]]> = (set, get) => ({
    ...initialState,

    // -------------------------------------------------------------------------
    // Composition management
    // -------------------------------------------------------------------------

    setCompositionId: (id) => {
      set((state) => {
        state.compositionId = id
      })
    },

    // -------------------------------------------------------------------------
    // Load steps from backend
    // -------------------------------------------------------------------------

    loadSteps: (steps) => {
      set((state) => {
        // Convert to local steps, preserving optimistic items
        const optimisticSteps = state.steps.filter((s) => s.isOptimistic)
        const serverStepIds = new Set(steps.map((s) => s.id))

        // Merge server steps with any remaining optimistic steps
        const mergedSteps: LocalStep<TStep>[] = steps.map((step) => ({
          ...step,
          isOptimistic: false,
          isPending: false,
        }))

        // Add optimistic steps that aren't yet confirmed
        for (const optStep of optimisticSteps) {
          if (!serverStepIds.has(optStep.id)) {
            mergedSteps.push(optStep)
          }
        }

        // Sort by step order
        mergedSteps.sort((a, b) => a.stepOrder - b.stepOrder)
        state.steps = mergedSteps
        state.lastSyncedAt = new Date()
      })
    },

    // -------------------------------------------------------------------------
    // Register items for resolution
    // -------------------------------------------------------------------------

    registerItems: (items) => {
      set((state) => {
        for (const item of items) {
          // Cast needed due to Immer Draft type incompatibility with generics
          ;(state.itemsMap as Record<string, TItem>)[item.id] = item
        }
      })
    },

    // -------------------------------------------------------------------------
    // Optimistic add
    // -------------------------------------------------------------------------

    addStepOptimistic: (item, payload) => {
      const tempId = generateTempId()
      const { compositionId, steps } = get()

      if (!compositionId) {
        console.warn(`[${name}] Cannot add step without compositionId`)
        return tempId
      }

      // Calculate next step order
      const maxOrder = steps.length > 0 ? Math.max(...steps.map((s) => s.stepOrder)) : 0
      const newStepOrder = maxOrder + 1

      set((state) => {
        // Create local step
        const newStep = createLocalStep(tempId, compositionId, item, newStepOrder, payload)
        newStep.isOptimistic = true
        newStep.isPending = true
        state.steps.push(newStep)

        // Queue pending operation
        state.pendingOperations.push({
          type: 'add',
          tempId,
          timestamp: Date.now(),
          payload: payload || {},
        })

        state.syncError = null
      })

      return tempId
    },

    // -------------------------------------------------------------------------
    // Optimistic update
    // -------------------------------------------------------------------------

    updateStepOptimistic: (stepId, updates) => {
      set((state) => {
        const stepIndex = state.steps.findIndex((s) => s.id === stepId)
        if (stepIndex === -1) {
          console.warn(`[${name}] Step not found: ${stepId}`)
          return
        }

        // Apply updates locally
        const step = state.steps[stepIndex]
        applyStepUpdates(step, updates)
        step.updatedAt = new Date().toISOString()
        step.isPending = true

        // Check if there's already a pending update for this step
        const existingOpIndex = state.pendingOperations.findIndex(
          (op) => op.type === 'update' && op.stepId === stepId
        )

        if (existingOpIndex !== -1) {
          // Merge updates into existing operation
          const existingOp = state.pendingOperations[existingOpIndex]
          if (existingOp.type === 'update') {
            existingOp.updates = { ...existingOp.updates, ...updates }
          }
        } else {
          // Queue new pending operation
          state.pendingOperations.push({
            type: 'update',
            stepId,
            updates,
            timestamp: Date.now(),
          })
        }

        state.syncError = null
      })
    },

    // -------------------------------------------------------------------------
    // Optimistic delete
    // -------------------------------------------------------------------------

    deleteStepOptimistic: (stepId) => {
      set((state) => {
        const stepIndex = state.steps.findIndex((s) => s.id === stepId)
        if (stepIndex === -1) {
          console.warn(`[${name}] Step not found for delete: ${stepId}`)
          return
        }

        state.steps.splice(stepIndex, 1)

        // Renumber remaining steps
        state.steps.forEach((step, index) => {
          step.stepOrder = index + 1
        })

        // If it's an optimistic step that hasn't been confirmed, remove any pending add
        if (isTempId(stepId)) {
          state.pendingOperations = state.pendingOperations.filter(
            (op) => !(op.type === 'add' && op.tempId === stepId)
          )
        } else {
          // Queue delete operation
          state.pendingOperations.push({
            type: 'delete',
            stepId,
            timestamp: Date.now(),
          })
        }

        // Remove any pending updates for this step
        state.pendingOperations = state.pendingOperations.filter(
          (op) => !(op.type === 'update' && op.stepId === stepId)
        )

        state.syncError = null
      })
    },

    // -------------------------------------------------------------------------
    // Optimistic reorder
    // -------------------------------------------------------------------------

    reorderStepsOptimistic: (fromIndex, toIndex) => {
      set((state) => {
        if (fromIndex === toIndex) return
        if (fromIndex < 0 || toIndex < 0) return
        if (fromIndex >= state.steps.length || toIndex >= state.steps.length) return

        // Reorder array
        const [movedStep] = state.steps.splice(fromIndex, 1)
        state.steps.splice(toIndex, 0, movedStep)

        // Update step orders
        state.steps.forEach((step, index) => {
          step.stepOrder = index + 1
          step.isPending = true
        })

        // Queue reorder operation (replaces any existing reorder)
        state.pendingOperations = state.pendingOperations.filter((op) => op.type !== 'reorder')
        state.pendingOperations.push({
          type: 'reorder',
          stepIds: state.steps.filter((s) => !isTempId(s.id)).map((s) => s.id),
          timestamp: Date.now(),
        })

        state.syncError = null
      })
    },

    // -------------------------------------------------------------------------
    // Confirm operations from backend
    // -------------------------------------------------------------------------

    confirmStepAdded: (tempId, serverStep) => {
      set((state) => {
        const stepIndex = state.steps.findIndex((s) => s.id === tempId)
        if (stepIndex !== -1) {
          // Replace optimistic step with server step
          state.steps[stepIndex] = {
            ...serverStep,
            isOptimistic: false,
            isPending: false,
          }
        }

        // Remove from pending operations
        state.pendingOperations = state.pendingOperations.filter(
          (op) => !(op.type === 'add' && op.tempId === tempId)
        )

        state.lastSyncedAt = new Date()
      })
    },

    confirmStepUpdated: (stepId) => {
      set((state) => {
        const step = state.steps.find((s) => s.id === stepId)
        if (step) {
          step.isPending = false
        }

        state.pendingOperations = state.pendingOperations.filter(
          (op) => !(op.type === 'update' && op.stepId === stepId)
        )

        state.lastSyncedAt = new Date()
      })
    },

    confirmStepDeleted: (stepId) => {
      set((state) => {
        state.pendingOperations = state.pendingOperations.filter(
          (op) => !(op.type === 'delete' && op.stepId === stepId)
        )

        state.lastSyncedAt = new Date()
      })
    },

    confirmReorder: () => {
      set((state) => {
        state.steps.forEach((step) => {
          step.isPending = false
        })

        state.pendingOperations = state.pendingOperations.filter((op) => op.type !== 'reorder')
        state.lastSyncedAt = new Date()
      })
    },

    // -------------------------------------------------------------------------
    // Rollback on error
    // -------------------------------------------------------------------------

    rollbackOperation: (operation, error) => {
      console.error(`[${name}] Rolling back operation:`, operation, error)

      set((state) => {
        state.syncError = error

        switch (operation.type) {
          case 'add':
            state.steps = state.steps.filter((s) => s.id !== operation.tempId)
            break
          case 'update': {
            const step = state.steps.find((s) => s.id === operation.stepId)
            if (step) step.isPending = false
            break
          }
          case 'delete':
          case 'reorder':
            state.steps.forEach((step) => {
              step.isPending = false
            })
            break
        }

        state.pendingOperations = state.pendingOperations.filter((op) => op !== operation)
      })
    },

    // -------------------------------------------------------------------------
    // Sync control
    // -------------------------------------------------------------------------

    setSyncing: (syncing) => {
      set((state) => {
        state.isSyncing = syncing
      })
    },

    setSyncError: (error) => {
      set((state) => {
        state.syncError = error
      })
    },

    // -------------------------------------------------------------------------
    // Get pending operations
    // -------------------------------------------------------------------------

    getPendingOperations: () => get().pendingOperations,

    clearPendingOperations: () => {
      set((state) => {
        state.pendingOperations = []
      })
    },

    // -------------------------------------------------------------------------
    // Schedule debounced sync
    // -------------------------------------------------------------------------

    scheduleSyncFlush: (flushFn, delayMs = syncDebounceMs) => {
      // Cancel existing timer
      const existingTimer = syncTimers.get(name)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      // Schedule new flush
      const timerId = setTimeout(async () => {
        try {
          set((state) => {
            state.isSyncing = true
          })
          await flushFn()
        } catch (error) {
          console.error(`[${name}] Sync flush error:`, error)
          set((state) => {
            state.syncError = error instanceof Error ? error.message : 'Sync failed'
          })
        } finally {
          set((state) => {
            state.isSyncing = false
          })
          syncTimers.delete(name)
        }
      }, delayMs)

      syncTimers.set(name, timerId)
    },

    cancelPendingSync: () => {
      const existingTimer = syncTimers.get(name)
      if (existingTimer) {
        clearTimeout(existingTimer)
        syncTimers.delete(name)
      }
    },

    // -------------------------------------------------------------------------
    // Reset store
    // -------------------------------------------------------------------------

    reset: () => {
      // Clear timer
      const existingTimer = syncTimers.get(name)
      if (existingTimer) {
        clearTimeout(existingTimer)
        syncTimers.delete(name)
      }

      set((state) => {
        state.compositionId = null
        state.steps = []
        state.itemsMap = {}
        state.isSyncing = false
        state.syncError = null
        state.lastSyncedAt = null
        state.pendingOperations = []
      })
    },
  })

  // Create the store with immer middleware
  return create<Store>()(immer(storeCreator))
}

// ============================================================================
// SELECTOR UTILITIES
// ============================================================================

/**
 * Get sync status from store state
 */
export function getSyncStatus<TItem extends BaseItem, TStep extends BaseStep>(
  state: BuilderStore<TItem, TStep>
): 'idle' | 'syncing' | 'error' | 'pending' {
  if (state.syncError) return 'error'
  if (state.isSyncing) return 'syncing'
  if (state.pendingOperations.length > 0) return 'pending'
  return 'idle'
}

/**
 * Check if there are unsaved changes
 */
export function hasUnsavedChanges<TItem extends BaseItem, TStep extends BaseStep>(
  state: BuilderStore<TItem, TStep>
): boolean {
  return state.pendingOperations.length > 0 || state.steps.some((s) => s.isPending)
}
