/**
 * Tests for useBuilderDragDrop hook
 *
 * Tests:
 * - Sensor configuration
 * - Drag ID utilities (isItemDragId, extractItemId)
 * - Drag event handlers
 * - Session creation on first drop
 * - Reorder logic
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { DragStartEvent, DragOverEvent, DragEndEvent, Active, Over } from '@dnd-kit/core'
import {
  useBuilderDragDrop,
  DROP_ZONE_ID,
  ITEM_DRAG_PREFIX,
  isItemDragId,
  extractItemId,
} from '../hooks/useBuilderDragDrop'
import type { BaseItem, BaseStep, LocalStep } from '../types'

// ============================================================================
// TEST TYPES
// ============================================================================

interface TestItem extends BaseItem {
  id: string
  name: string
  categoryId: string
}

interface TestStep extends BaseStep {
  id: string
  stepOrder: number
  createdAt: string
  updatedAt: string
  itemId: string
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

const testItem1: TestItem = {
  id: 'item-1',
  name: 'Test Item 1',
  categoryId: 'cat-1',
}

const testItem2: TestItem = {
  id: 'item-2',
  name: 'Test Item 2',
  categoryId: 'cat-1',
}

const testStep1: LocalStep<TestStep> = {
  id: 'step-1',
  stepOrder: 1,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  itemId: 'item-1',
}

const testStep2: LocalStep<TestStep> = {
  id: 'step-2',
  stepOrder: 2,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  itemId: 'item-2',
}

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('drag ID utilities', () => {
  describe('isItemDragId', () => {
    it('should return true for valid item drag IDs', () => {
      expect(isItemDragId(`${ITEM_DRAG_PREFIX}item-1`)).toBe(true)
      expect(isItemDragId(`${ITEM_DRAG_PREFIX}abc-123`)).toBe(true)
    })

    it('should return false for step IDs', () => {
      expect(isItemDragId('step-1')).toBe(false)
      expect(isItemDragId('step-abc-123')).toBe(false)
    })

    it('should return false for empty strings', () => {
      expect(isItemDragId('')).toBe(false)
    })
  })

  describe('extractItemId', () => {
    it('should extract item ID from drag ID', () => {
      expect(extractItemId(`${ITEM_DRAG_PREFIX}item-1`)).toBe('item-1')
      expect(extractItemId(`${ITEM_DRAG_PREFIX}abc-123`)).toBe('abc-123')
    })

    it('should return null for non-item drag IDs', () => {
      expect(extractItemId('step-1')).toBeNull()
      expect(extractItemId('')).toBeNull()
    })
  })

  describe('constants', () => {
    it('should have correct DROP_ZONE_ID', () => {
      expect(DROP_ZONE_ID).toBe('builder-drop-zone')
    })

    it('should have correct ITEM_DRAG_PREFIX', () => {
      expect(ITEM_DRAG_PREFIX).toBe('item-')
    })
  })
})

// ============================================================================
// HOOK TESTS
// ============================================================================

describe('useBuilderDragDrop', () => {
  const mockItemsMap: Record<string, TestItem> = {
    'item-1': testItem1,
    'item-2': testItem2,
  }

  const defaultOptions = {
    compositionId: 'session-1' as string | null,
    steps: [testStep1, testStep2] as LocalStep<TestStep>[],
    itemsMap: mockItemsMap,
    onAddStep: vi.fn(),
    onReorderSteps: vi.fn(),
    onCreateComposition: vi.fn().mockResolvedValue('new-session-id'),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initialization', () => {
    it('should initialize with sensors', () => {
      const { result } = renderHook(() => useBuilderDragDrop(defaultOptions))

      expect(result.current.sensors).toBeDefined()
      expect(Array.isArray(result.current.sensors)).toBe(true)
    })

    it('should initialize with null activeDragItem', () => {
      const { result } = renderHook(() => useBuilderDragDrop(defaultOptions))

      expect(result.current.activeDragItem).toBeNull()
    })

    it('should initialize with isOverDropZone false', () => {
      const { result } = renderHook(() => useBuilderDragDrop(defaultOptions))

      expect(result.current.isOverDropZone).toBe(false)
    })
  })

  describe('handleDragStart', () => {
    it('should set activeDragItem when dragging from library', () => {
      const { result } = renderHook(() => useBuilderDragDrop(defaultOptions))

      const mockEvent: DragStartEvent = {
        active: {
          id: `${ITEM_DRAG_PREFIX}item-1`,
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
      }

      act(() => {
        result.current.handleDragStart(mockEvent)
      })

      expect(result.current.activeDragItem).toEqual(testItem1)
    })

    it('should not set activeDragItem when reordering steps', () => {
      const { result } = renderHook(() => useBuilderDragDrop(defaultOptions))

      const mockEvent: DragStartEvent = {
        active: {
          id: 'step-1',
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
      }

      act(() => {
        result.current.handleDragStart(mockEvent)
      })

      expect(result.current.activeDragItem).toBeNull()
    })

    it('should not set activeDragItem if item not in itemsMap', () => {
      const { result } = renderHook(() => useBuilderDragDrop(defaultOptions))

      const mockEvent: DragStartEvent = {
        active: {
          id: `${ITEM_DRAG_PREFIX}unknown-item`,
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
      }

      act(() => {
        result.current.handleDragStart(mockEvent)
      })

      expect(result.current.activeDragItem).toBeNull()
    })
  })

  describe('handleDragOver', () => {
    it('should set isOverDropZone when over drop zone', () => {
      const { result } = renderHook(() => useBuilderDragDrop(defaultOptions))

      // First start dragging
      const startEvent: DragStartEvent = {
        active: {
          id: `${ITEM_DRAG_PREFIX}item-1`,
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
      }

      act(() => {
        result.current.handleDragStart(startEvent)
      })

      // Then hover over drop zone
      const overEvent: DragOverEvent = {
        active: {
          id: `${ITEM_DRAG_PREFIX}item-1`,
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
        over: {
          id: DROP_ZONE_ID,
          data: { current: {} },
          rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
          disabled: false,
        } as Over,
      }

      act(() => {
        result.current.handleDragOver(overEvent)
      })

      expect(result.current.isOverDropZone).toBe(true)
    })

    it('should set isOverDropZone when over a step', () => {
      const { result } = renderHook(() => useBuilderDragDrop(defaultOptions))

      // Start dragging
      const startEvent: DragStartEvent = {
        active: {
          id: `${ITEM_DRAG_PREFIX}item-1`,
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
      }

      act(() => {
        result.current.handleDragStart(startEvent)
      })

      // Hover over a step
      const overEvent: DragOverEvent = {
        active: {
          id: `${ITEM_DRAG_PREFIX}item-1`,
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
        over: {
          id: 'step-1',
          data: { current: {} },
          rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
          disabled: false,
        } as Over,
      }

      act(() => {
        result.current.handleDragOver(overEvent)
      })

      expect(result.current.isOverDropZone).toBe(true)
    })

    it('should not set isOverDropZone when over nothing', () => {
      const { result } = renderHook(() => useBuilderDragDrop(defaultOptions))

      const overEvent: DragOverEvent = {
        active: {
          id: `${ITEM_DRAG_PREFIX}item-1`,
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
        over: null,
      }

      act(() => {
        result.current.handleDragOver(overEvent)
      })

      expect(result.current.isOverDropZone).toBe(false)
    })
  })

  describe('handleDragEnd', () => {
    it('should reset drag state on drag end', () => {
      const { result } = renderHook(() => useBuilderDragDrop(defaultOptions))

      // Start dragging
      act(() => {
        result.current.handleDragStart({
          active: {
            id: `${ITEM_DRAG_PREFIX}item-1`,
            data: { current: {} },
            rect: { current: { initial: null, translated: null } },
          } as unknown as Active,
        })
      })

      expect(result.current.activeDragItem).toEqual(testItem1)

      // End drag
      act(() => {
        result.current.handleDragEnd({
          active: {
            id: `${ITEM_DRAG_PREFIX}item-1`,
            data: { current: {} },
            rect: { current: { initial: null, translated: null } },
          } as unknown as Active,
          over: null,
        })
      })

      expect(result.current.activeDragItem).toBeNull()
      expect(result.current.isOverDropZone).toBe(false)
    })

    it('should call onAddStep when dropping item on drop zone', () => {
      const onAddStep = vi.fn()
      const { result } = renderHook(() =>
        useBuilderDragDrop({
          ...defaultOptions,
          onAddStep,
        })
      )

      const endEvent: DragEndEvent = {
        active: {
          id: `${ITEM_DRAG_PREFIX}item-1`,
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
        over: {
          id: DROP_ZONE_ID,
          data: { current: {} },
          rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
          disabled: false,
        } as Over,
      }

      act(() => {
        result.current.handleDragEnd(endEvent)
      })

      expect(onAddStep).toHaveBeenCalledWith(testItem1)
    })

    it('should call onReorderSteps when reordering steps', () => {
      const onReorderSteps = vi.fn()
      const { result } = renderHook(() =>
        useBuilderDragDrop({
          ...defaultOptions,
          onReorderSteps,
        })
      )

      const endEvent: DragEndEvent = {
        active: {
          id: 'step-1',
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
        over: {
          id: 'step-2',
          data: { current: {} },
          rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
          disabled: false,
        } as Over,
      }

      act(() => {
        result.current.handleDragEnd(endEvent)
      })

      expect(onReorderSteps).toHaveBeenCalledWith(0, 1)
    })

    it('should not call onReorderSteps when dropping on same position', () => {
      const onReorderSteps = vi.fn()
      const { result } = renderHook(() =>
        useBuilderDragDrop({
          ...defaultOptions,
          onReorderSteps,
        })
      )

      const endEvent: DragEndEvent = {
        active: {
          id: 'step-1',
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
        over: {
          id: 'step-1',
          data: { current: {} },
          rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
          disabled: false,
        } as Over,
      }

      act(() => {
        result.current.handleDragEnd(endEvent)
      })

      expect(onReorderSteps).not.toHaveBeenCalled()
    })

    it('should not do anything when over is null', () => {
      const onAddStep = vi.fn()
      const onReorderSteps = vi.fn()
      const { result } = renderHook(() =>
        useBuilderDragDrop({
          ...defaultOptions,
          onAddStep,
          onReorderSteps,
        })
      )

      const endEvent: DragEndEvent = {
        active: {
          id: `${ITEM_DRAG_PREFIX}item-1`,
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
        over: null,
      }

      act(() => {
        result.current.handleDragEnd(endEvent)
      })

      expect(onAddStep).not.toHaveBeenCalled()
      expect(onReorderSteps).not.toHaveBeenCalled()
    })
  })

  describe('session creation on first drop', () => {
    it('should call onCreateComposition when dropping on empty composition', async () => {
      const onCreateComposition = vi.fn().mockResolvedValue('new-session-id')
      const onAddStep = vi.fn()

      const { result } = renderHook(() =>
        useBuilderDragDrop({
          ...defaultOptions,
          compositionId: null,
          steps: [],
          onCreateComposition,
          onAddStep,
        })
      )

      const endEvent: DragEndEvent = {
        active: {
          id: `${ITEM_DRAG_PREFIX}item-1`,
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
        over: {
          id: DROP_ZONE_ID,
          data: { current: {} },
          rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
          disabled: false,
        } as Over,
      }

      await act(async () => {
        await result.current.handleDragEnd(endEvent)
      })

      expect(onCreateComposition).toHaveBeenCalled()
    })

    it('should pass item to onCreateComposition (which handles adding first step)', async () => {
      // Note: onCreateComposition is responsible for adding the first step
      // because composition must exist before steps can be added
      const onCreateComposition = vi.fn().mockResolvedValue(undefined)
      const onAddStep = vi.fn()

      const { result } = renderHook(() =>
        useBuilderDragDrop({
          ...defaultOptions,
          compositionId: null,
          steps: [],
          onCreateComposition,
          onAddStep,
        })
      )

      const endEvent: DragEndEvent = {
        active: {
          id: `${ITEM_DRAG_PREFIX}item-1`,
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
        over: {
          id: DROP_ZONE_ID,
          data: { current: {} },
          rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
          disabled: false,
        } as Over,
      }

      await act(async () => {
        await result.current.handleDragEnd(endEvent)
      })

      // onCreateComposition receives the item so it can add the first step
      expect(onCreateComposition).toHaveBeenCalledWith(testItem1)
      // onAddStep is NOT called because onCreateComposition handles first step
      expect(onAddStep).not.toHaveBeenCalled()
    })

    it('should not call onAddStep if composition creation fails', async () => {
      const onCreateComposition = vi.fn().mockResolvedValue(null)
      const onAddStep = vi.fn()

      const { result } = renderHook(() =>
        useBuilderDragDrop({
          ...defaultOptions,
          compositionId: null,
          steps: [],
          onCreateComposition,
          onAddStep,
        })
      )

      const endEvent: DragEndEvent = {
        active: {
          id: `${ITEM_DRAG_PREFIX}item-1`,
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
        over: {
          id: DROP_ZONE_ID,
          data: { current: {} },
          rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
          disabled: false,
        } as Over,
      }

      await act(async () => {
        await result.current.handleDragEnd(endEvent)
      })

      expect(onAddStep).not.toHaveBeenCalled()
    })

    it('should skip composition creation when compositionId exists', async () => {
      const onCreateComposition = vi.fn()
      const onAddStep = vi.fn()

      const { result } = renderHook(() =>
        useBuilderDragDrop({
          ...defaultOptions,
          compositionId: 'existing-session',
          onCreateComposition,
          onAddStep,
        })
      )

      const endEvent: DragEndEvent = {
        active: {
          id: `${ITEM_DRAG_PREFIX}item-1`,
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
        over: {
          id: DROP_ZONE_ID,
          data: { current: {} },
          rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
          disabled: false,
        } as Over,
      }

      await act(async () => {
        await result.current.handleDragEnd(endEvent)
      })

      expect(onCreateComposition).not.toHaveBeenCalled()
      expect(onAddStep).toHaveBeenCalledWith(testItem1)
    })
  })

  describe('reorder without compositionId', () => {
    it('should not reorder when compositionId is null', () => {
      const onReorderSteps = vi.fn()

      const { result } = renderHook(() =>
        useBuilderDragDrop({
          ...defaultOptions,
          compositionId: null,
          onReorderSteps,
        })
      )

      const endEvent: DragEndEvent = {
        active: {
          id: 'step-1',
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
        over: {
          id: 'step-2',
          data: { current: {} },
          rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
          disabled: false,
        } as Over,
      }

      act(() => {
        result.current.handleDragEnd(endEvent)
      })

      expect(onReorderSteps).not.toHaveBeenCalled()
    })
  })

  describe('step index lookup', () => {
    it('should find correct indices when reordering', () => {
      const onReorderSteps = vi.fn()
      const steps: LocalStep<TestStep>[] = [
        { ...testStep1, id: 'a' },
        { ...testStep2, id: 'b' },
        { ...testStep1, id: 'c' },
      ]

      const { result } = renderHook(() =>
        useBuilderDragDrop({
          ...defaultOptions,
          steps,
          onReorderSteps,
        })
      )

      const endEvent: DragEndEvent = {
        active: {
          id: 'a',
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
        over: {
          id: 'c',
          data: { current: {} },
          rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
          disabled: false,
        } as Over,
      }

      act(() => {
        result.current.handleDragEnd(endEvent)
      })

      expect(onReorderSteps).toHaveBeenCalledWith(0, 2)
    })

    it('should not reorder if step not found', () => {
      const onReorderSteps = vi.fn()

      const { result } = renderHook(() =>
        useBuilderDragDrop({
          ...defaultOptions,
          onReorderSteps,
        })
      )

      const endEvent: DragEndEvent = {
        active: {
          id: 'unknown-step',
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as unknown as Active,
        over: {
          id: 'step-1',
          data: { current: {} },
          rect: { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 },
          disabled: false,
        } as Over,
      }

      act(() => {
        result.current.handleDragEnd(endEvent)
      })

      expect(onReorderSteps).not.toHaveBeenCalled()
    })
  })
})
