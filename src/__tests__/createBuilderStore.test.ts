/**
 * Tests for createBuilderStore factory function
 *
 * Tests:
 * - Store creation with configuration
 * - Optimistic add/update/delete/reorder operations
 * - Pending operations queue
 * - Confirm and rollback operations
 * - Sync scheduling with debounce
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import { createBuilderStore } from '../stores/createBuilderStore'
import type { BaseItem, BaseStep, LocalStep } from '../types'

// ============================================================================
// TEST TYPES
// ============================================================================

interface TestItem extends BaseItem {
  id: string
  name: string
  thumbnailUrl?: string
  defaultDurationSeconds?: number
  categoryId: string
}

interface TestStep extends BaseStep {
  id: string
  stepOrder: number
  createdAt: string
  updatedAt: string
  durationSeconds: number
  restDurationSeconds: number
  itemId: string
}

interface TestAddPayload {
  durationSeconds?: number
  restDurationSeconds?: number
}

interface TestUpdatePayload {
  durationSeconds?: number
  restDurationSeconds?: number
  customNotes?: string
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

const testItem: TestItem = {
  id: 'item-1',
  name: 'Test Item',
  thumbnailUrl: 'https://example.com/thumb.jpg',
  defaultDurationSeconds: 60,
  categoryId: 'cat-1',
}

const testItem2: TestItem = {
  id: 'item-2',
  name: 'Test Item 2',
  categoryId: 'cat-1',
}

const serverStep: TestStep = {
  id: 'step-server-1',
  stepOrder: 1,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  durationSeconds: 60,
  restDurationSeconds: 10,
  itemId: 'item-1',
}

// ============================================================================
// STORE FACTORY
// ============================================================================

function createTestStore() {
  return createBuilderStore<TestItem, TestStep, TestAddPayload, TestUpdatePayload>({
    name: 'test-builder',
    createLocalStep: (tempId, compositionId, item, stepOrder, payload) => ({
      id: tempId,
      stepOrder,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      durationSeconds: payload?.durationSeconds ?? item.defaultDurationSeconds ?? 60,
      restDurationSeconds: payload?.restDurationSeconds ?? 10,
      itemId: item.id,
      isOptimistic: true,
      isPending: true,
    }),
    applyStepUpdates: (step, updates) => {
      if (updates.durationSeconds !== undefined) {
        step.durationSeconds = updates.durationSeconds
      }
      if (updates.restDurationSeconds !== undefined) {
        step.restDurationSeconds = updates.restDurationSeconds
      }
    },
    syncDebounceMs: 100,
  })
}

// ============================================================================
// TESTS
// ============================================================================

describe('createBuilderStore', () => {
  let useStore: ReturnType<typeof createTestStore>

  beforeEach(() => {
    vi.useFakeTimers()
    useStore = createTestStore()
  })

  afterEach(() => {
    vi.useRealTimers()
    // Reset the store
    act(() => {
      useStore.getState().reset()
    })
  })

  describe('store creation', () => {
    it('should create store with initial state', () => {
      const state = useStore.getState()

      expect(state.compositionId).toBeNull()
      expect(state.steps).toEqual([])
      expect(state.itemsMap).toEqual({})
      expect(state.isSyncing).toBe(false)
      expect(state.syncError).toBeNull()
      expect(state.pendingOperations).toEqual([])
    })
  })

  describe('composition management', () => {
    it('should set composition ID', () => {
      act(() => {
        useStore.getState().setCompositionId('session-123')
      })

      expect(useStore.getState().compositionId).toBe('session-123')
    })

    it('should clear composition ID', () => {
      act(() => {
        useStore.getState().setCompositionId('session-123')
        useStore.getState().setCompositionId(null)
      })

      expect(useStore.getState().compositionId).toBeNull()
    })
  })

  describe('items registration', () => {
    it('should register items in itemsMap', () => {
      act(() => {
        useStore.getState().registerItems([testItem, testItem2])
      })

      const state = useStore.getState()
      expect(state.itemsMap['item-1']).toEqual(testItem)
      expect(state.itemsMap['item-2']).toEqual(testItem2)
    })

    it('should merge new items with existing items', () => {
      act(() => {
        useStore.getState().registerItems([testItem])
        useStore.getState().registerItems([testItem2])
      })

      const state = useStore.getState()
      expect(Object.keys(state.itemsMap)).toHaveLength(2)
    })
  })

  describe('loadSteps', () => {
    it('should load steps from backend', () => {
      act(() => {
        useStore.getState().loadSteps([serverStep])
      })

      const state = useStore.getState()
      expect(state.steps).toHaveLength(1)
      expect(state.steps[0].id).toBe('step-server-1')
      expect(state.steps[0].isOptimistic).toBe(false)
      expect(state.steps[0].isPending).toBe(false)
    })

    it('should preserve optimistic steps when loading', () => {
      // First add an optimistic step
      act(() => {
        useStore.getState().setCompositionId('session-1')
        useStore.getState().registerItems([testItem])
        useStore.getState().addStepOptimistic(testItem)
      })

      const tempId = useStore.getState().steps[0].id

      // Now load server steps (which don't include the optimistic one)
      act(() => {
        useStore.getState().loadSteps([serverStep])
      })

      const state = useStore.getState()
      // Should have both server step and optimistic step
      expect(state.steps.length).toBeGreaterThanOrEqual(1)
      // Server step should be present
      expect(state.steps.some((s) => s.id === 'step-server-1')).toBe(true)
      // Optimistic step should still be present (not yet confirmed)
      expect(state.steps.some((s) => s.id === tempId)).toBe(true)
    })

    it('should sort steps by stepOrder after loading', () => {
      const step1 = { ...serverStep, id: 's1', stepOrder: 3 }
      const step2 = { ...serverStep, id: 's2', stepOrder: 1 }
      const step3 = { ...serverStep, id: 's3', stepOrder: 2 }

      act(() => {
        useStore.getState().loadSteps([step1, step2, step3])
      })

      const state = useStore.getState()
      expect(state.steps[0].id).toBe('s2') // stepOrder: 1
      expect(state.steps[1].id).toBe('s3') // stepOrder: 2
      expect(state.steps[2].id).toBe('s1') // stepOrder: 3
    })
  })

  describe('addStepOptimistic', () => {
    it('should add step optimistically and return temp ID', () => {
      act(() => {
        useStore.getState().setCompositionId('session-1')
        useStore.getState().registerItems([testItem])
      })

      let tempId: string = ''
      act(() => {
        tempId = useStore.getState().addStepOptimistic(testItem)
      })

      expect(tempId).toMatch(/^temp-/)

      const state = useStore.getState()
      expect(state.steps).toHaveLength(1)
      expect(state.steps[0].id).toBe(tempId)
      expect(state.steps[0].isOptimistic).toBe(true)
      expect(state.steps[0].isPending).toBe(true)
      expect(state.steps[0].durationSeconds).toBe(60) // from defaultDurationSeconds
      expect(state.steps[0].itemId).toBe('item-1')
    })

    it('should use payload values when provided', () => {
      act(() => {
        useStore.getState().setCompositionId('session-1')
        useStore.getState().registerItems([testItem])
      })

      act(() => {
        useStore.getState().addStepOptimistic(testItem, {
          durationSeconds: 90,
          restDurationSeconds: 15,
        })
      })

      const state = useStore.getState()
      expect(state.steps[0].durationSeconds).toBe(90)
      expect(state.steps[0].restDurationSeconds).toBe(15)
    })

    it('should queue add operation in pendingOperations', () => {
      act(() => {
        useStore.getState().setCompositionId('session-1')
        useStore.getState().registerItems([testItem])
      })

      let tempId: string = ''
      act(() => {
        tempId = useStore.getState().addStepOptimistic(testItem)
      })

      const ops = useStore.getState().pendingOperations
      expect(ops).toHaveLength(1)
      expect(ops[0].type).toBe('add')
      if (ops[0].type === 'add') {
        expect(ops[0].tempId).toBe(tempId)
      }
    })

    it('should calculate correct stepOrder for new steps', () => {
      act(() => {
        useStore.getState().setCompositionId('session-1')
        useStore.getState().registerItems([testItem, testItem2])
        useStore.getState().addStepOptimistic(testItem)
        useStore.getState().addStepOptimistic(testItem2)
      })

      const state = useStore.getState()
      expect(state.steps[0].stepOrder).toBe(1)
      expect(state.steps[1].stepOrder).toBe(2)
    })

    it('should warn and still return tempId when compositionId is null', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      act(() => {
        useStore.getState().registerItems([testItem])
      })

      let tempId: string = ''
      act(() => {
        tempId = useStore.getState().addStepOptimistic(testItem)
      })

      expect(tempId).toMatch(/^temp-/)
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('updateStepOptimistic', () => {
    beforeEach(() => {
      act(() => {
        useStore.getState().setCompositionId('session-1')
        useStore.getState().loadSteps([serverStep])
      })
    })

    it('should update step locally', () => {
      act(() => {
        useStore.getState().updateStepOptimistic('step-server-1', {
          durationSeconds: 120,
        })
      })

      const state = useStore.getState()
      expect(state.steps[0].durationSeconds).toBe(120)
      expect(state.steps[0].isPending).toBe(true)
    })

    it('should queue update operation', () => {
      act(() => {
        useStore.getState().updateStepOptimistic('step-server-1', {
          durationSeconds: 120,
        })
      })

      const ops = useStore.getState().pendingOperations
      expect(ops).toHaveLength(1)
      expect(ops[0].type).toBe('update')
      if (ops[0].type === 'update') {
        expect(ops[0].stepId).toBe('step-server-1')
        expect(ops[0].updates).toEqual({ durationSeconds: 120 })
      }
    })

    it('should merge multiple updates for same step', () => {
      act(() => {
        useStore.getState().updateStepOptimistic('step-server-1', {
          durationSeconds: 120,
        })
        useStore.getState().updateStepOptimistic('step-server-1', {
          restDurationSeconds: 20,
        })
      })

      // Should merge into single operation
      const ops = useStore.getState().pendingOperations
      expect(ops).toHaveLength(1)
      if (ops[0].type === 'update') {
        expect(ops[0].updates).toEqual({
          durationSeconds: 120,
          restDurationSeconds: 20,
        })
      }
    })

    it('should warn when step not found', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      act(() => {
        useStore.getState().updateStepOptimistic('non-existent', {
          durationSeconds: 120,
        })
      })

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('deleteStepOptimistic', () => {
    beforeEach(() => {
      act(() => {
        useStore.getState().setCompositionId('session-1')
        useStore.getState().loadSteps([
          { ...serverStep, id: 's1', stepOrder: 1 },
          { ...serverStep, id: 's2', stepOrder: 2 },
          { ...serverStep, id: 's3', stepOrder: 3 },
        ])
      })
    })

    it('should remove step from local state', () => {
      act(() => {
        useStore.getState().deleteStepOptimistic('s2')
      })

      const state = useStore.getState()
      expect(state.steps).toHaveLength(2)
      expect(state.steps.find((s) => s.id === 's2')).toBeUndefined()
    })

    it('should renumber remaining steps', () => {
      act(() => {
        useStore.getState().deleteStepOptimistic('s2')
      })

      const state = useStore.getState()
      expect(state.steps[0].stepOrder).toBe(1)
      expect(state.steps[1].stepOrder).toBe(2) // Renumbered from 3
    })

    it('should queue delete operation for server steps', () => {
      act(() => {
        useStore.getState().deleteStepOptimistic('s1')
      })

      const ops = useStore.getState().pendingOperations
      expect(ops).toHaveLength(1)
      expect(ops[0].type).toBe('delete')
      if (ops[0].type === 'delete') {
        expect(ops[0].stepId).toBe('s1')
      }
    })

    it('should remove add operation when deleting optimistic step', () => {
      // Add an optimistic step
      act(() => {
        useStore.getState().registerItems([testItem])
      })

      let tempId: string = ''
      act(() => {
        tempId = useStore.getState().addStepOptimistic(testItem)
      })

      expect(useStore.getState().pendingOperations.length).toBe(1)

      // Delete the optimistic step
      act(() => {
        useStore.getState().deleteStepOptimistic(tempId)
      })

      // Should remove the add operation, not add a delete
      const ops = useStore.getState().pendingOperations
      expect(ops.find((op) => op.type === 'add')).toBeUndefined()
      expect(ops.find((op) => op.type === 'delete')).toBeUndefined()
    })

    it('should also remove pending update for deleted step', () => {
      act(() => {
        useStore.getState().updateStepOptimistic('s1', { durationSeconds: 120 })
      })

      expect(useStore.getState().pendingOperations).toHaveLength(1)

      act(() => {
        useStore.getState().deleteStepOptimistic('s1')
      })

      // Should have delete but not update
      const ops = useStore.getState().pendingOperations
      expect(ops.find((op) => op.type === 'update')).toBeUndefined()
      expect(ops.some((op) => op.type === 'delete')).toBe(true)
    })
  })

  describe('reorderStepsOptimistic', () => {
    beforeEach(() => {
      act(() => {
        useStore.getState().setCompositionId('session-1')
        useStore.getState().loadSteps([
          { ...serverStep, id: 's1', stepOrder: 1 },
          { ...serverStep, id: 's2', stepOrder: 2 },
          { ...serverStep, id: 's3', stepOrder: 3 },
        ])
      })
    })

    it('should reorder steps locally', () => {
      act(() => {
        useStore.getState().reorderStepsOptimistic(0, 2) // Move first to last
      })

      const state = useStore.getState()
      expect(state.steps[0].id).toBe('s2')
      expect(state.steps[1].id).toBe('s3')
      expect(state.steps[2].id).toBe('s1')
    })

    it('should update stepOrder values after reorder', () => {
      act(() => {
        useStore.getState().reorderStepsOptimistic(0, 2)
      })

      const state = useStore.getState()
      expect(state.steps[0].stepOrder).toBe(1)
      expect(state.steps[1].stepOrder).toBe(2)
      expect(state.steps[2].stepOrder).toBe(3)
    })

    it('should queue reorder operation', () => {
      act(() => {
        useStore.getState().reorderStepsOptimistic(0, 2)
      })

      const ops = useStore.getState().pendingOperations
      expect(ops).toHaveLength(1)
      expect(ops[0].type).toBe('reorder')
    })

    it('should replace previous reorder operation', () => {
      act(() => {
        useStore.getState().reorderStepsOptimistic(0, 1)
        useStore.getState().reorderStepsOptimistic(1, 2)
      })

      // Should only have one reorder operation
      const ops = useStore.getState().pendingOperations
      const reorderOps = ops.filter((op) => op.type === 'reorder')
      expect(reorderOps).toHaveLength(1)
    })

    it('should skip invalid indices', () => {
      const beforeState = useStore.getState().steps.map((s) => s.id)

      act(() => {
        useStore.getState().reorderStepsOptimistic(-1, 2)
        useStore.getState().reorderStepsOptimistic(0, 10)
        useStore.getState().reorderStepsOptimistic(0, 0)
      })

      const afterState = useStore.getState().steps.map((s) => s.id)
      expect(afterState).toEqual(beforeState)
    })
  })

  describe('confirm operations', () => {
    it('should confirm added step', () => {
      act(() => {
        useStore.getState().setCompositionId('session-1')
        useStore.getState().registerItems([testItem])
      })

      let tempId: string = ''
      act(() => {
        tempId = useStore.getState().addStepOptimistic(testItem)
      })

      // Confirm with server step
      act(() => {
        useStore.getState().confirmStepAdded(tempId, serverStep)
      })

      const state = useStore.getState()
      expect(state.steps).toHaveLength(1)
      expect(state.steps[0].id).toBe('step-server-1') // Server ID
      expect(state.steps[0].isOptimistic).toBe(false)
      expect(state.steps[0].isPending).toBe(false)

      // Add operation should be removed
      expect(state.pendingOperations).toHaveLength(0)
    })

    it('should confirm updated step', () => {
      act(() => {
        useStore.getState().loadSteps([serverStep])
        useStore.getState().updateStepOptimistic('step-server-1', { durationSeconds: 120 })
      })

      expect(useStore.getState().steps[0].isPending).toBe(true)

      act(() => {
        useStore.getState().confirmStepUpdated('step-server-1')
      })

      expect(useStore.getState().steps[0].isPending).toBe(false)
      expect(useStore.getState().pendingOperations).toHaveLength(0)
    })

    it('should confirm deleted step', () => {
      act(() => {
        useStore.getState().loadSteps([serverStep])
        useStore.getState().deleteStepOptimistic('step-server-1')
      })

      act(() => {
        useStore.getState().confirmStepDeleted('step-server-1')
      })

      expect(useStore.getState().pendingOperations).toHaveLength(0)
    })

    it('should confirm reorder', () => {
      act(() => {
        useStore.getState().loadSteps([
          { ...serverStep, id: 's1', stepOrder: 1 },
          { ...serverStep, id: 's2', stepOrder: 2 },
        ])
        useStore.getState().reorderStepsOptimistic(0, 1)
      })

      expect(useStore.getState().steps.some((s) => s.isPending)).toBe(true)

      act(() => {
        useStore.getState().confirmReorder()
      })

      expect(useStore.getState().steps.every((s) => !s.isPending)).toBe(true)
      expect(useStore.getState().pendingOperations).toHaveLength(0)
    })
  })

  describe('rollbackOperation', () => {
    it('should rollback add operation', () => {
      act(() => {
        useStore.getState().setCompositionId('session-1')
        useStore.getState().registerItems([testItem])
      })

      let tempId: string = ''
      act(() => {
        tempId = useStore.getState().addStepOptimistic(testItem)
      })

      const addOp = useStore.getState().pendingOperations[0]

      act(() => {
        useStore.getState().rollbackOperation(addOp, 'Add failed')
      })

      const state = useStore.getState()
      expect(state.steps.find((s) => s.id === tempId)).toBeUndefined()
      expect(state.syncError).toBe('Add failed')
    })

    it('should rollback update operation', () => {
      act(() => {
        useStore.getState().loadSteps([serverStep])
        useStore.getState().updateStepOptimistic('step-server-1', { durationSeconds: 120 })
      })

      const updateOp = useStore.getState().pendingOperations[0]

      act(() => {
        useStore.getState().rollbackOperation(updateOp, 'Update failed')
      })

      const state = useStore.getState()
      expect(state.steps[0].isPending).toBe(false)
      expect(state.syncError).toBe('Update failed')
    })
  })

  describe('sync scheduling', () => {
    it('should schedule sync with debounce', async () => {
      const flushFn = vi.fn().mockResolvedValue(undefined)

      act(() => {
        useStore.getState().scheduleSyncFlush(flushFn, 100)
      })

      // Should not be called immediately
      expect(flushFn).not.toHaveBeenCalled()

      // Advance time
      await act(async () => {
        vi.advanceTimersByTime(150)
      })

      expect(flushFn).toHaveBeenCalledTimes(1)
    })

    it('should cancel pending sync on new schedule', async () => {
      const flushFn1 = vi.fn().mockResolvedValue(undefined)
      const flushFn2 = vi.fn().mockResolvedValue(undefined)

      act(() => {
        useStore.getState().scheduleSyncFlush(flushFn1, 100)
      })

      await act(async () => {
        vi.advanceTimersByTime(50)
      })

      act(() => {
        useStore.getState().scheduleSyncFlush(flushFn2, 100)
      })

      await act(async () => {
        vi.advanceTimersByTime(150)
      })

      expect(flushFn1).not.toHaveBeenCalled()
      expect(flushFn2).toHaveBeenCalledTimes(1)
    })

    it('should set isSyncing during flush', async () => {
      let syncingDuringFlush = false
      const flushFn = vi.fn().mockImplementation(async () => {
        syncingDuringFlush = useStore.getState().isSyncing
      })

      act(() => {
        useStore.getState().scheduleSyncFlush(flushFn, 100)
      })

      await act(async () => {
        vi.advanceTimersByTime(150)
      })

      expect(syncingDuringFlush).toBe(true)
      expect(useStore.getState().isSyncing).toBe(false)
    })

    it('should set syncError on flush failure', async () => {
      const flushFn = vi.fn().mockRejectedValue(new Error('Sync failed'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      act(() => {
        useStore.getState().scheduleSyncFlush(flushFn, 100)
      })

      await act(async () => {
        vi.advanceTimersByTime(150)
      })

      expect(useStore.getState().syncError).toBe('Sync failed')
      consoleSpy.mockRestore()
    })

    it('should cancel sync on cancelPendingSync', async () => {
      const flushFn = vi.fn().mockResolvedValue(undefined)

      act(() => {
        useStore.getState().scheduleSyncFlush(flushFn, 100)
      })

      act(() => {
        useStore.getState().cancelPendingSync()
      })

      await act(async () => {
        vi.advanceTimersByTime(150)
      })

      expect(flushFn).not.toHaveBeenCalled()
    })
  })

  describe('reset', () => {
    it('should reset store to initial state', () => {
      act(() => {
        useStore.getState().setCompositionId('session-1')
        useStore.getState().registerItems([testItem])
        useStore.getState().loadSteps([serverStep])
        useStore.getState().setSyncError('Some error')
      })

      act(() => {
        useStore.getState().reset()
      })

      const state = useStore.getState()
      expect(state.compositionId).toBeNull()
      expect(state.steps).toEqual([])
      expect(state.itemsMap).toEqual({})
      expect(state.syncError).toBeNull()
      expect(state.pendingOperations).toEqual([])
    })

    it('should cancel pending sync on reset', async () => {
      const flushFn = vi.fn().mockResolvedValue(undefined)

      act(() => {
        useStore.getState().scheduleSyncFlush(flushFn, 100)
        useStore.getState().reset()
      })

      await act(async () => {
        vi.advanceTimersByTime(150)
      })

      expect(flushFn).not.toHaveBeenCalled()
    })
  })

  describe('getPendingOperations', () => {
    it('should return current pending operations', () => {
      act(() => {
        useStore.getState().setCompositionId('session-1')
        useStore.getState().registerItems([testItem])
        useStore.getState().addStepOptimistic(testItem)
      })

      const ops = useStore.getState().getPendingOperations()
      expect(ops).toHaveLength(1)
    })
  })

  describe('clearPendingOperations', () => {
    it('should clear all pending operations', () => {
      act(() => {
        useStore.getState().setCompositionId('session-1')
        useStore.getState().registerItems([testItem])
        useStore.getState().addStepOptimistic(testItem)
      })

      expect(useStore.getState().pendingOperations.length).toBe(1)

      act(() => {
        useStore.getState().clearPendingOperations()
      })

      expect(useStore.getState().pendingOperations).toEqual([])
    })
  })
})
