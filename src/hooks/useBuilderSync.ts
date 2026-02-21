/**
 * useBuilderSync - Generic sync hook for builder stores
 *
 * Connects the optimistic UI store with GraphQL mutations.
 * Handles debounced flushing of pending operations.
 *
 * @example
 * ```ts
 * const sync = useBuilderSync({
 *   store: useYogaBuilderStore,
 *   mutations: {
 *     add: ADD_STEP_MUTATION,
 *     update: UPDATE_STEP_MUTATION,
 *     delete: DELETE_STEP_MUTATION,
 *     reorder: REORDER_STEPS_MUTATION,
 *   },
 *   mapAddVariables: (op, compositionId) => ({
 *     input: {
 *       sessionId: compositionId,
 *       positionId: op.payload.positionId,
 *       durationSeconds: op.payload.durationSeconds,
 *     },
 *   }),
 *   // ...
 * })
 * ```
 */

import { useCallback, useEffect, useRef } from 'react'
import { useMutation, type DocumentNode, type OperationVariables } from '@apollo/client'
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
}

export interface UseBuilderSyncConfig<
  TItem extends BaseItem,
  TStep extends BaseStep,
  TAddPayload extends Record<string, unknown>,
  TUpdatePayload extends Record<string, unknown>
> {
  /** The builder store hook (Zustand) */
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

  /** Whether to show toast notifications on errors */
  showErrorToasts?: boolean

  /** Toast function for error notifications */
  toastError?: (message: string) => void
}

export interface UseBuilderSyncReturn<TItem extends BaseItem, TStep extends BaseStep> {
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
  /** Sync status */
  syncStatus: SyncStatus
  /** Is currently syncing */
  isSyncing: boolean
  /** Sync error message */
  syncError: string | null
  /** Force an immediate sync */
  flushSync: () => Promise<void>
}

// ============================================================================
// HOOK
// ============================================================================

export function useBuilderSync<
  TItem extends BaseItem,
  TStep extends BaseStep,
  TAddPayload extends Record<string, unknown> = Record<string, unknown>,
  TUpdatePayload extends Record<string, unknown> = Record<string, unknown>
>(
  config: UseBuilderSyncConfig<TItem, TStep, TAddPayload, TUpdatePayload>
): UseBuilderSyncReturn<TItem, TStep> {
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
    showErrorToasts = true,
    toastError = console.error,
  } = config

  // Store state
  const compositionId = useStore((s) => s.compositionId)
  const steps = useStore((s) => s.steps)
  const isSyncing = useStore((s) => s.isSyncing)
  const syncError = useStore((s) => s.syncError)
  const pendingOperationsCount = useStore((s) => s.pendingOperations.length)

  // Compute sync status
  const syncStatus: SyncStatus = syncError
    ? 'error'
    : isSyncing
      ? 'syncing'
      : pendingOperationsCount > 0
        ? 'pending'
        : 'idle'

  // Store actions
  const addStepOptimistic = useStore((s) => s.addStepOptimistic)
  const updateStepOptimistic = useStore((s) => s.updateStepOptimistic)
  const deleteStepOptimistic = useStore((s) => s.deleteStepOptimistic)
  const reorderStepsOptimistic = useStore((s) => s.reorderStepsOptimistic)

  const confirmStepAdded = useStore((s) => s.confirmStepAdded)
  const confirmStepUpdated = useStore((s) => s.confirmStepUpdated)
  const confirmStepDeleted = useStore((s) => s.confirmStepDeleted)
  const confirmReorder = useStore((s) => s.confirmReorder)
  const rollbackOperation = useStore((s) => s.rollbackOperation)

  const getPendingOperations = useStore((s) => s.getPendingOperations)
  const scheduleSyncFlush = useStore((s) => s.scheduleSyncFlush)
  const setSyncing = useStore((s) => s.setSyncing)
  const setSyncError = useStore((s) => s.setSyncError)

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

  // Track pending ops being flushed
  const pendingOpsRef = useRef<PendingOperation[]>([])

  // Flush pending operations to backend
  const flushSync = useCallback(async () => {
    const pendingOps = getPendingOperations()
    if (pendingOps.length === 0) return

    pendingOpsRef.current = [...pendingOps]
    setSyncing(true)
    setSyncError(null)

    try {
      for (const op of pendingOpsRef.current) {
        switch (op.type) {
          case 'add': {
            if (!compositionId) continue
            try {
              const { data } = await addMutation({
                variables: mapAddVariables(op as AddOperation<TAddPayload>, compositionId),
              })
              const addedStep = extractAddedStep(data)
              if (addedStep) {
                confirmStepAdded(op.tempId, addedStep)
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Failed to add step'
              rollbackOperation(op, message)
              if (showErrorToasts) {
                toastError(`Erro ao adicionar: ${message}`)
              }
              throw error
            }
            break
          }

          case 'update': {
            try {
              await updateMutation({
                variables: mapUpdateVariables(op as UpdateOperation<TUpdatePayload>),
              })
              confirmStepUpdated(op.stepId)
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Failed to update step'
              rollbackOperation(op, message)
              if (showErrorToasts) {
                toastError(`Erro ao atualizar: ${message}`)
              }
              throw error
            }
            break
          }

          case 'delete': {
            try {
              await deleteMutation({
                variables: mapDeleteVariables(op),
              })
              confirmStepDeleted(op.stepId)
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Failed to delete step'
              rollbackOperation(op, message)
              if (showErrorToasts) {
                toastError(`Erro ao remover: ${message}`)
              }
              throw error
            }
            break
          }

          case 'reorder': {
            if (!compositionId) continue
            try {
              await reorderMutation({
                variables: mapReorderVariables(op, compositionId),
              })
              confirmReorder()
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Failed to reorder steps'
              rollbackOperation(op, message)
              if (showErrorToasts) {
                toastError(`Erro ao reordenar: ${message}`)
              }
              throw error
            }
            break
          }
        }
      }
    } finally {
      setSyncing(false)
      pendingOpsRef.current = []
    }
  }, [
    compositionId,
    getPendingOperations,
    setSyncing,
    setSyncError,
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
  ])

  // Wrapper functions that apply optimistic updates and schedule sync
  const addStep = useCallback(
    (item: TItem, payload?: Record<string, unknown>) => {
      addStepOptimistic(item, payload as Partial<TAddPayload>)
      scheduleSyncFlush(flushSync, debounceMs)
    },
    [addStepOptimistic, scheduleSyncFlush, flushSync, debounceMs]
  )

  const updateStep = useCallback(
    (stepId: string, updates: Record<string, unknown>) => {
      updateStepOptimistic(stepId, updates as Partial<TUpdatePayload>)
      scheduleSyncFlush(flushSync, debounceMs)
    },
    [updateStepOptimistic, scheduleSyncFlush, flushSync, debounceMs]
  )

  const deleteStep = useCallback(
    (stepId: string) => {
      deleteStepOptimistic(stepId)
      scheduleSyncFlush(flushSync, debounceMs)
    },
    [deleteStepOptimistic, scheduleSyncFlush, flushSync, debounceMs]
  )

  const reorderSteps = useCallback(
    (fromIndex: number, toIndex: number) => {
      reorderStepsOptimistic(fromIndex, toIndex)
      scheduleSyncFlush(flushSync, debounceMs)
    },
    [reorderStepsOptimistic, scheduleSyncFlush, flushSync, debounceMs]
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const pendingOps = getPendingOperations()
      if (pendingOps.length > 0) {
        console.log('[BuilderSync] Flushing pending operations on unmount')
        flushSync().catch(console.error)
      }
    }
  }, [flushSync, getPendingOperations])

  return {
    addStep,
    updateStep,
    deleteStep,
    reorderSteps,
    steps,
    syncStatus,
    isSyncing,
    syncError,
    flushSync,
  }
}
