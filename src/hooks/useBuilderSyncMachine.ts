/**
 * useBuilderSyncMachine - XState-coordinated sync hook for builders
 *
 * This hook follows the XState + Zustand Coordination Pattern:
 * - XState machine owns ALL sync state transitions (debouncing, retries, errors)
 * - Zustand store subscribes to machine and exposes reactive state
 * - This hook creates the sync store with GraphQL mutation handlers
 *
 * Use this hook instead of useBuilderSync for proper state management.
 *
 * @example
 * ```ts
 * const { addStep, syncStatus, steps } = useBuilderSyncMachine({
 *   store: useYogaBuilderStore,
 *   mutations: {
 *     add: ADD_STEP_MUTATION,
 *     update: UPDATE_STEP_MUTATION,
 *     delete: DELETE_STEP_MUTATION,
 *     reorder: REORDER_STEPS_MUTATION,
 *   },
 *   mapAddVariables: (op, compositionId) => ({
 *     input: { sessionId: compositionId, ... }
 *   }),
 *   // ...
 * })
 * ```
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useMutation, type DocumentNode, type OperationVariables } from '@apollo/client'
import { createBuilderSyncStore } from '../stores/createBuilderSyncStore'
import type { FlushResult } from '../machines/builderSyncMachine'
import type {
  BaseItem,
  BaseStep,
  BuilderStore,
  LocalStep,
  PendingOperation,
  AddOperation,
  UpdateOperation,
  DeleteOperation,
  ReorderOperation,
  SyncStatus,
} from '../types'

// ============================================================================
// TYPES
// ============================================================================

/** Zustand store hook type with selector support */
export type StoreHook<T> = {
  (): T
  <U>(selector: (state: T) => U): U
  getState: () => T
}

export interface UseBuilderSyncMachineConfig<
  TItem extends BaseItem,
  TStep extends BaseStep,
  TAddPayload extends Record<string, unknown>,
  TUpdatePayload extends Record<string, unknown>
> {
  /** The builder store hook (Zustand) - manages optimistic local state */
  store: StoreHook<BuilderStore<TItem, TStep, TAddPayload, TUpdatePayload>>

  /** GraphQL mutations */
  mutations: {
    add: DocumentNode
    update: DocumentNode
    delete: DocumentNode
    reorder: DocumentNode
  }

  /** Optional refetch queries after operations */
  refetchQueries?: {
    add?: DocumentNode[]
    update?: DocumentNode[]
    delete?: DocumentNode[]
    reorder?: DocumentNode[]
  }

  /** Map add operation to mutation variables */
  mapAddVariables: (op: AddOperation<TAddPayload>, compositionId: string) => OperationVariables

  /** Map update operation to mutation variables */
  mapUpdateVariables: (op: UpdateOperation<TUpdatePayload>) => OperationVariables

  /** Map delete operation to mutation variables */
  mapDeleteVariables: (op: DeleteOperation) => OperationVariables

  /** Map reorder operation to mutation variables */
  mapReorderVariables: (op: ReorderOperation, compositionId: string) => OperationVariables

  /** Extract step from add mutation response */
  extractAddedStep: (data: unknown) => TStep | null

  /** Debounce delay in ms (default: 500) */
  debounceMs?: number

  /** Maximum retries before giving up (default: 3) */
  maxRetries?: number

  /** Whether to show toast notifications on errors */
  showErrorToasts?: boolean

  /** Toast function for error notifications */
  toastError?: (message: string) => void
}

export interface UseBuilderSyncMachineReturn<TItem extends BaseItem, TStep extends BaseStep> {
  /** Add an item optimistically */
  addStep: (item: TItem, payload?: Record<string, unknown>) => void
  /** Update a step optimistically */
  updateStep: (stepId: string, updates: Record<string, unknown>) => void
  /** Delete a step optimistically */
  deleteStep: (stepId: string) => void
  /** Reorder steps optimistically */
  reorderSteps: (fromIndex: number, toIndex: number) => void
  /** Current steps (local state) */
  steps: LocalStep<TStep>[]
  /** Sync status from XState machine */
  syncStatus: SyncStatus
  /** Is currently syncing */
  isSyncing: boolean
  /** Sync error message */
  syncError: string | null
  /** Has unsaved changes */
  hasUnsavedChanges: boolean
  /** Force an immediate sync */
  flushNow: () => void
  /** Retry failed sync */
  retry: () => void
}

// ============================================================================
// HOOK
// ============================================================================

export function useBuilderSyncMachine<
  TItem extends BaseItem,
  TStep extends BaseStep,
  TAddPayload extends Record<string, unknown> = Record<string, unknown>,
  TUpdatePayload extends Record<string, unknown> = Record<string, unknown>
>(
  config: UseBuilderSyncMachineConfig<TItem, TStep, TAddPayload, TUpdatePayload>
): UseBuilderSyncMachineReturn<TItem, TStep> {
  const {
    store: useStore,
    mutations,
    refetchQueries,
    mapAddVariables,
    mapUpdateVariables,
    mapDeleteVariables,
    mapReorderVariables,
    extractAddedStep,
    debounceMs = 500,
    maxRetries = 3,
    showErrorToasts = true,
    toastError = console.error,
  } = config

  // Store state for optimistic UI
  const compositionId = useStore((s) => s.compositionId)
  const steps = useStore((s) => s.steps)

  // Store actions for optimistic updates
  const addStepOptimistic = useStore((s) => s.addStepOptimistic)
  const updateStepOptimistic = useStore((s) => s.updateStepOptimistic)
  const deleteStepOptimistic = useStore((s) => s.deleteStepOptimistic)
  const reorderStepsOptimistic = useStore((s) => s.reorderStepsOptimistic)
  const confirmStepAdded = useStore((s) => s.confirmStepAdded)
  const confirmStepUpdated = useStore((s) => s.confirmStepUpdated)
  const confirmStepDeleted = useStore((s) => s.confirmStepDeleted)
  const confirmReorder = useStore((s) => s.confirmReorder)
  const rollbackOperation = useStore((s) => s.rollbackOperation)

  // Mutations
  const [addMutation] = useMutation(mutations.add, {
    refetchQueries: refetchQueries?.add,
  })
  const [updateMutation] = useMutation(mutations.update, {
    refetchQueries: refetchQueries?.update,
  })
  const [deleteMutation] = useMutation(mutations.delete, {
    refetchQueries: refetchQueries?.delete,
  })
  const [reorderMutation] = useMutation(mutations.reorder, {
    refetchQueries: refetchQueries?.reorder,
  })

  // Refs for stable references in flush handler
  const compositionIdRef = useRef(compositionId)
  compositionIdRef.current = compositionId

  // Create the flush handler that executes GraphQL mutations
  // This is passed to the XState machine
  const handleFlush = useCallback(
    async (operations: PendingOperation[]): Promise<FlushResult> => {
      const succeeded: PendingOperation[] = []
      const failed: Array<{ operation: PendingOperation; error: string }> = []

      for (const op of operations) {
        try {
          switch (op.type) {
            case 'add': {
              const currentCompositionId = compositionIdRef.current
              if (!currentCompositionId) {
                failed.push({ operation: op, error: 'No composition ID' })
                continue
              }
              const { data } = await addMutation({
                variables: mapAddVariables(op as AddOperation<TAddPayload>, currentCompositionId),
              })
              const addedStep = extractAddedStep(data)
              if (addedStep) {
                confirmStepAdded(op.tempId, addedStep)
                succeeded.push(op)
              } else {
                failed.push({ operation: op, error: 'No step returned from mutation' })
              }
              break
            }

            case 'update': {
              await updateMutation({
                variables: mapUpdateVariables(op as UpdateOperation<TUpdatePayload>),
              })
              confirmStepUpdated(op.stepId)
              succeeded.push(op)
              break
            }

            case 'delete': {
              await deleteMutation({
                variables: mapDeleteVariables(op),
              })
              confirmStepDeleted(op.stepId)
              succeeded.push(op)
              break
            }

            case 'reorder': {
              const currentCompositionId = compositionIdRef.current
              if (!currentCompositionId) {
                failed.push({ operation: op, error: 'No composition ID' })
                continue
              }
              await reorderMutation({
                variables: mapReorderVariables(op, currentCompositionId),
              })
              confirmReorder()
              succeeded.push(op)
              break
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Operation failed'
          rollbackOperation(op, message)
          failed.push({ operation: op, error: message })

          if (showErrorToasts) {
            const errorMessages: Record<PendingOperation['type'], string> = {
              add: 'Erro ao adicionar',
              update: 'Erro ao atualizar',
              delete: 'Erro ao remover',
              reorder: 'Erro ao reordenar',
            }
            toastError(`${errorMessages[op.type]}: ${message}`)
          }
        }
      }

      return { succeeded, failed }
    },
    [
      addMutation,
      updateMutation,
      deleteMutation,
      reorderMutation,
      mapAddVariables,
      mapUpdateVariables,
      mapDeleteVariables,
      mapReorderVariables,
      extractAddedStep,
      confirmStepAdded,
      confirmStepUpdated,
      confirmStepDeleted,
      confirmReorder,
      rollbackOperation,
      showErrorToasts,
      toastError,
    ]
  )

  // Create the sync store (XState machine + Zustand adapter)
  // useMemo ensures we only create it once
  const useSyncStore = useMemo(
    () =>
      createBuilderSyncStore({
        onFlush: handleFlush,
        debounceMs,
        maxRetries,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleFlush is stable via useCallback
    [debounceMs, maxRetries]
  )

  // Subscribe to sync store state
  const syncStatus = useSyncStore((s) => s.syncStatus)
  const lastError = useSyncStore((s) => s.lastError)
  const hasUnsavedChanges = useSyncStore((s) => s.hasUnsavedChanges)
  const queueOperation = useSyncStore((s) => s.queueOperation)
  const flushNow = useSyncStore((s) => s.flushNow)
  const retry = useSyncStore((s) => s.retry)

  // Wrapper functions that apply optimistic updates and queue sync operations
  const addStep = useCallback(
    (item: TItem, payload?: Record<string, unknown>) => {
      // Apply optimistic update to local store
      const tempId = addStepOptimistic(item, payload as Partial<TAddPayload>)

      // Queue operation for sync (XState machine handles debouncing)
      queueOperation({
        type: 'add',
        tempId,
        timestamp: Date.now(),
        payload: payload || {},
      })
    },
    [addStepOptimistic, queueOperation]
  )

  const updateStep = useCallback(
    (stepId: string, updates: Record<string, unknown>) => {
      // Apply optimistic update
      updateStepOptimistic(stepId, updates as Partial<TUpdatePayload>)

      // Queue for sync
      queueOperation({
        type: 'update',
        stepId,
        updates,
        timestamp: Date.now(),
      })
    },
    [updateStepOptimistic, queueOperation]
  )

  const deleteStep = useCallback(
    (stepId: string) => {
      // Apply optimistic update
      deleteStepOptimistic(stepId)

      // Queue for sync
      queueOperation({
        type: 'delete',
        stepId,
        timestamp: Date.now(),
      })
    },
    [deleteStepOptimistic, queueOperation]
  )

  const reorderSteps = useCallback(
    (fromIndex: number, toIndex: number) => {
      // Apply optimistic update
      reorderStepsOptimistic(fromIndex, toIndex)

      // Get current step IDs after reorder for the operation
      // Note: We need to get this from the store after reorder
      const currentSteps = useStore.getState().steps
      const stepIds = currentSteps
        .filter((s: LocalStep<TStep>) => !s.id.startsWith('temp-'))
        .map((s: LocalStep<TStep>) => s.id)

      // Queue for sync
      queueOperation({
        type: 'reorder',
        stepIds,
        timestamp: Date.now(),
      })
    },
    [reorderStepsOptimistic, queueOperation, useStore]
  )

  // Flush on unmount if there are pending changes
  useEffect(() => {
    return () => {
      if (useSyncStore.getState().hasUnsavedChanges) {
        console.log('[BuilderSyncMachine] Flushing pending operations on unmount')
        useSyncStore.getState().flushNow()
      }
    }
  }, [useSyncStore])

  return {
    addStep,
    updateStep,
    deleteStep,
    reorderSteps,
    steps,
    syncStatus,
    isSyncing: syncStatus === 'syncing',
    syncError: lastError,
    hasUnsavedChanges,
    flushNow,
    retry,
  }
}
