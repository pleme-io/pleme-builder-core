/**
 * builderSyncMachine - XState machine for builder sync coordination
 *
 * This machine OWNS all sync state transitions. Zustand stores subscribe
 * to this machine and expose reactive selectors (no business logic in stores).
 *
 * States:
 * - idle: No pending operations, ready for new changes
 * - debouncing: Collecting changes before sync (batching)
 * - syncing: Actively syncing with backend
 * - error: Sync failed, waiting for retry or manual intervention
 *
 * @example
 * ```ts
 * const syncActor = createActor(builderSyncMachine, {
 *   input: {
 *     debounceMs: 500,
 *     maxRetries: 3,
 *     onFlush: async (operations) => { ... },
 *   },
 * })
 * syncActor.start()
 *
 * // Queue an operation
 * syncActor.send({ type: 'QUEUE_OPERATION', operation: { type: 'add', ... } })
 * ```
 */

import { setup, assign, fromPromise } from 'xstate'
import type { PendingOperation } from '../types'

// ============================================================================
// TYPES
// ============================================================================

export interface BuilderSyncContext {
  /** Pending operations waiting to be synced */
  pendingOperations: PendingOperation[]
  /** Operations currently being synced */
  inFlightOperations: PendingOperation[]
  /** Current retry count */
  retryCount: number
  /** Maximum retries before giving up */
  maxRetries: number
  /** Debounce delay in ms */
  debounceMs: number
  /** Last error message */
  lastError: string | null
  /** Last successful sync timestamp */
  lastSyncedAt: Date | null
}

export interface BuilderSyncInput {
  /** Debounce delay in ms (default: 500) */
  debounceMs?: number
  /** Maximum retries before giving up (default: 3) */
  maxRetries?: number
  /** Callback to flush operations to backend */
  onFlush: (operations: PendingOperation[]) => Promise<FlushResult>
  /** Optional error callback */
  onError?: (error: string, operations: PendingOperation[]) => void
  /** Optional success callback */
  onSuccess?: (operations: PendingOperation[]) => void
}

export interface FlushResult {
  /** Successfully synced operations */
  succeeded: PendingOperation[]
  /** Failed operations with errors */
  failed: Array<{ operation: PendingOperation; error: string }>
}

// ============================================================================
// EVENTS
// ============================================================================

export type BuilderSyncEvent =
  | { type: 'QUEUE_OPERATION'; operation: PendingOperation }
  | { type: 'QUEUE_OPERATIONS'; operations: PendingOperation[] }
  | { type: 'FLUSH_NOW' }
  | { type: 'RETRY' }
  | { type: 'RESET' }
  | { type: 'CLEAR_ERROR' }

// ============================================================================
// MACHINE
// ============================================================================

export const builderSyncMachine = setup({
  types: {
    context: {} as BuilderSyncContext,
    input: {} as BuilderSyncInput,
    events: {} as BuilderSyncEvent,
  },
  actors: {
    flushOperations: fromPromise<FlushResult, { operations: PendingOperation[]; onFlush: BuilderSyncInput['onFlush'] }>(
      async ({ input }) => {
        return await input.onFlush(input.operations)
      }
    ),
  },
  guards: {
    hasPendingOperations: ({ context }) => context.pendingOperations.length > 0,
    canRetry: ({ context }) => context.retryCount < context.maxRetries,
    hasInFlightOperations: ({ context }) => context.inFlightOperations.length > 0,
  },
  actions: {
    queueOperation: assign({
      pendingOperations: ({ context, event }) => {
        if (event.type !== 'QUEUE_OPERATION') return context.pendingOperations
        return mergeOperations(context.pendingOperations, [event.operation])
      },
    }),
    queueOperations: assign({
      pendingOperations: ({ context, event }) => {
        if (event.type !== 'QUEUE_OPERATIONS') return context.pendingOperations
        return mergeOperations(context.pendingOperations, event.operations)
      },
    }),
    moveToInFlight: assign({
      inFlightOperations: ({ context }) => [...context.pendingOperations],
      pendingOperations: () => [],
    }),
    clearInFlight: assign({
      inFlightOperations: () => [],
    }),
    returnToQueue: assign({
      pendingOperations: ({ context }) => [...context.inFlightOperations, ...context.pendingOperations],
      inFlightOperations: () => [],
    }),
    incrementRetry: assign({
      retryCount: ({ context }) => context.retryCount + 1,
    }),
    resetRetryCount: assign({
      retryCount: () => 0,
    }),
    setError: assign({
      lastError: (_, params: { error: string }) => params.error,
    }),
    clearError: assign({
      lastError: () => null,
    }),
    updateLastSyncedAt: assign({
      lastSyncedAt: () => new Date(),
    }),
    resetContext: assign({
      pendingOperations: () => [],
      inFlightOperations: () => [],
      retryCount: () => 0,
      lastError: () => null,
    }),
  },
  delays: {
    DEBOUNCE_DELAY: ({ context }) => context.debounceMs,
    RETRY_DELAY: ({ context }) => Math.min(1000 * Math.pow(2, context.retryCount), 10000), // Exponential backoff, max 10s
  },
}).createMachine({
  id: 'builderSync',
  context: ({ input }) => ({
    pendingOperations: [],
    inFlightOperations: [],
    retryCount: 0,
    maxRetries: input.maxRetries ?? 3,
    debounceMs: input.debounceMs ?? 500,
    lastError: null,
    lastSyncedAt: null,
  }),
  initial: 'idle',
  states: {
    idle: {
      on: {
        QUEUE_OPERATION: {
          target: 'debouncing',
          actions: 'queueOperation',
        },
        QUEUE_OPERATIONS: {
          target: 'debouncing',
          actions: 'queueOperations',
        },
      },
    },
    debouncing: {
      on: {
        QUEUE_OPERATION: {
          target: 'debouncing',
          actions: 'queueOperation',
          reenter: true, // Restart debounce timer
        },
        QUEUE_OPERATIONS: {
          target: 'debouncing',
          actions: 'queueOperations',
          reenter: true,
        },
        FLUSH_NOW: {
          target: 'syncing',
        },
      },
      after: {
        DEBOUNCE_DELAY: {
          target: 'syncing',
          guard: 'hasPendingOperations',
        },
      },
    },
    syncing: {
      entry: 'moveToInFlight',
      invoke: {
        src: 'flushOperations',
        input: ({ context, self }) => ({
          operations: context.inFlightOperations,
          onFlush: (self as unknown as { _parent: { input: BuilderSyncInput } })._parent?.input?.onFlush
            ?? (async () => ({ succeeded: [], failed: [] })),
        }),
        onDone: [
          {
            target: 'debouncing',
            guard: 'hasPendingOperations',
            actions: ['clearInFlight', 'resetRetryCount', 'clearError', 'updateLastSyncedAt'],
          },
          {
            target: 'idle',
            actions: ['clearInFlight', 'resetRetryCount', 'clearError', 'updateLastSyncedAt'],
          },
        ],
        onError: {
          target: 'error',
          actions: [
            'returnToQueue',
            {
              type: 'setError',
              params: ({ event }) => ({
                error: event.error instanceof Error ? event.error.message : 'Sync failed',
              }),
            },
          ],
        },
      },
    },
    error: {
      on: {
        RETRY: [
          {
            target: 'retrying',
            guard: 'canRetry',
            actions: 'incrementRetry',
          },
          {
            // Max retries exceeded, stay in error
            actions: {
              type: 'setError',
              params: { error: 'Max retries exceeded' },
            },
          },
        ],
        QUEUE_OPERATION: {
          actions: 'queueOperation',
        },
        QUEUE_OPERATIONS: {
          actions: 'queueOperations',
        },
        CLEAR_ERROR: {
          target: 'idle',
          actions: ['clearError', 'resetRetryCount'],
        },
        RESET: {
          target: 'idle',
          actions: 'resetContext',
        },
      },
      after: {
        // Auto-retry after delay
        RETRY_DELAY: {
          target: 'retrying',
          guard: 'canRetry',
          actions: 'incrementRetry',
        },
      },
    },
    retrying: {
      always: {
        target: 'syncing',
        guard: 'hasPendingOperations',
      },
    },
  },
})

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Merge new operations into existing queue, handling operation coalescing:
 * - Multiple updates to same step are merged
 * - Delete cancels pending add for temp IDs
 * - Reorder replaces any existing reorder
 */
function mergeOperations(existing: PendingOperation[], incoming: PendingOperation[]): PendingOperation[] {
  const result = [...existing]

  for (const op of incoming) {
    switch (op.type) {
      case 'add':
        result.push(op)
        break

      case 'update': {
        // Find existing update for same step
        const existingIndex = result.findIndex((e) => e.type === 'update' && e.stepId === op.stepId)
        if (existingIndex !== -1) {
          // Merge updates
          const existingOp = result[existingIndex]
          if (existingOp.type === 'update') {
            result[existingIndex] = {
              ...existingOp,
              updates: { ...existingOp.updates, ...op.updates },
              timestamp: op.timestamp,
            }
          }
        } else {
          result.push(op)
        }
        break
      }

      case 'delete': {
        // Remove any pending add for this ID (if temp ID)
        const addIndex = result.findIndex((e) => e.type === 'add' && e.tempId === op.stepId)
        if (addIndex !== -1) {
          result.splice(addIndex, 1)
        } else {
          // Remove any pending updates for this step
          const filteredResult = result.filter((e) => !(e.type === 'update' && e.stepId === op.stepId))
          result.length = 0
          result.push(...filteredResult, op)
        }
        break
      }

      case 'reorder':
        // Replace any existing reorder
        const reorderIndex = result.findIndex((e) => e.type === 'reorder')
        if (reorderIndex !== -1) {
          result[reorderIndex] = op
        } else {
          result.push(op)
        }
        break
    }
  }

  return result
}

// ============================================================================
// SELECTORS
// ============================================================================

export type SyncState = 'idle' | 'debouncing' | 'syncing' | 'error' | 'retrying'

/**
 * Get the current sync state from machine snapshot
 */
export function getSyncState(snapshot: { value: string | object }): SyncState {
  const value = snapshot.value
  if (typeof value === 'string') {
    return value as SyncState
  }
  // Handle compound states if needed
  return 'idle'
}

/**
 * Get sync status (simplified for UI)
 */
export function getSyncStatus(snapshot: { value: string | object; context: BuilderSyncContext }): 'idle' | 'syncing' | 'error' | 'pending' {
  const state = getSyncState(snapshot)
  const { pendingOperations, lastError } = snapshot.context

  if (lastError) return 'error'
  if (state === 'syncing' || state === 'retrying') return 'syncing'
  if (state === 'debouncing' || pendingOperations.length > 0) return 'pending'
  return 'idle'
}

/**
 * Check if there are unsaved changes
 */
export function hasUnsavedChanges(snapshot: { context: BuilderSyncContext }): boolean {
  const { pendingOperations, inFlightOperations } = snapshot.context
  return pendingOperations.length > 0 || inFlightOperations.length > 0
}
