/**
 * createBuilderSyncStore - Zustand adapter for builder sync machine
 *
 * Following the XState + Zustand Coordination Pattern:
 * - XState machine owns ALL sync state transitions (debouncing, retries, errors)
 * - This Zustand store subscribes to the machine and exposes reactive state
 * - Actions delegate to machine.send() - NO business logic here
 *
 * @example
 * ```ts
 * const useSyncStore = createBuilderSyncStore({
 *   onFlush: async (operations) => {
 *     // Execute GraphQL mutations for each operation
 *     return { succeeded: operations, failed: [] }
 *   },
 *   debounceMs: 500,
 * })
 *
 * // In component
 * const { syncStatus, queueOperation } = useSyncStore()
 * ```
 */

import { create } from 'zustand'
import { createActor, type ActorRefFrom } from 'xstate'
import {
  builderSyncMachine,
  type BuilderSyncInput,
  type FlushResult,
  getSyncStatus as getMachineSyncStatus,
  hasUnsavedChanges as machineHasUnsavedChanges,
} from '../machines/builderSyncMachine'
import type { PendingOperation, SyncStatus } from '../types'

// ============================================================================
// TYPES
// ============================================================================

export interface BuilderSyncStoreConfig {
  /** Callback to flush operations to backend */
  onFlush: (operations: PendingOperation[]) => Promise<FlushResult>
  /** Debounce delay in ms (default: 500) */
  debounceMs?: number
  /** Maximum retries before giving up (default: 3) */
  maxRetries?: number
  /** Optional error callback */
  onError?: (error: string, operations: PendingOperation[]) => void
  /** Optional success callback */
  onSuccess?: (operations: PendingOperation[]) => void
}

export interface BuilderSyncStore {
  // Derived state (read-only, from machine)
  syncStatus: SyncStatus
  pendingCount: number
  lastError: string | null
  lastSyncedAt: Date | null
  hasUnsavedChanges: boolean
  machineState: string // For debugging

  // Actions (delegate to machine)
  queueOperation: (operation: PendingOperation) => void
  queueOperations: (operations: PendingOperation[]) => void
  flushNow: () => void
  retry: () => void
  reset: () => void
  clearError: () => void

  // Internal - the actor reference
  _actor: ActorRefFrom<typeof builderSyncMachine>
}

// ============================================================================
// STORE FACTORY
// ============================================================================

/**
 * Creates a Zustand store that wraps the builder sync XState machine.
 *
 * The store:
 * 1. Creates and starts the XState machine
 * 2. Subscribes to machine state changes
 * 3. Derives reactive state from machine snapshot
 * 4. Exposes actions that send events to the machine
 */
export function createBuilderSyncStore(config: BuilderSyncStoreConfig) {
  const { onFlush, debounceMs = 500, maxRetries = 3, onError, onSuccess } = config

  return create<BuilderSyncStore>((set) => {
    // Create the machine input
    const machineInput: BuilderSyncInput = {
      debounceMs,
      maxRetries,
      onFlush,
      onError,
      onSuccess,
    }

    // Create and start the actor
    const actor = createActor(builderSyncMachine, {
      input: machineInput,
    })

    // Subscribe to machine state changes - this is where Zustand syncs with XState
    actor.subscribe((snapshot) => {
      const newState: Partial<BuilderSyncStore> = {
        // Derive sync status from machine state
        syncStatus: getMachineSyncStatus(snapshot),

        // Derive pending count from context
        pendingCount:
          snapshot.context.pendingOperations.length + snapshot.context.inFlightOperations.length,

        // Copy error and timestamp from context
        lastError: snapshot.context.lastError,
        lastSyncedAt: snapshot.context.lastSyncedAt,

        // Derive unsaved changes flag
        hasUnsavedChanges: machineHasUnsavedChanges(snapshot),

        // Debug: expose machine state string
        machineState: typeof snapshot.value === 'string' ? snapshot.value : JSON.stringify(snapshot.value),
      }

      set(newState)
    })

    // Start the machine
    actor.start()

    // Return initial state + actions
    return {
      // Initial state (will be updated by subscription)
      syncStatus: 'idle',
      pendingCount: 0,
      lastError: null,
      lastSyncedAt: null,
      hasUnsavedChanges: false,
      machineState: 'idle',

      // Actions delegate to machine - NO business logic here
      queueOperation: (operation: PendingOperation) => {
        actor.send({ type: 'QUEUE_OPERATION', operation })
      },

      queueOperations: (operations: PendingOperation[]) => {
        actor.send({ type: 'QUEUE_OPERATIONS', operations })
      },

      flushNow: () => {
        actor.send({ type: 'FLUSH_NOW' })
      },

      retry: () => {
        actor.send({ type: 'RETRY' })
      },

      reset: () => {
        actor.send({ type: 'RESET' })
      },

      clearError: () => {
        actor.send({ type: 'CLEAR_ERROR' })
      },

      // Expose actor for advanced use cases
      _actor: actor,
    }
  })
}

// ============================================================================
// HOOK TYPE
// ============================================================================

/** Type for the created store hook */
export type BuilderSyncStoreHook = ReturnType<typeof createBuilderSyncStore>
