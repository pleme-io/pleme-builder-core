/**
 * useBuilderDragDrop - Generic drag-and-drop hook for builders
 *
 * Encapsulates all @dnd-kit drag-and-drop logic for builder UIs.
 * Handles dragging from library panel and reordering within composition.
 */

import { useCallback, useState } from 'react'
import {
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { BaseItem, BaseStep, LocalStep } from '../types'

// ============================================================================
// CONSTANTS
// ============================================================================

/** ID for the main drop zone */
export const DROP_ZONE_ID = 'builder-drop-zone'

/** Prefix for draggable library items */
export const ITEM_DRAG_PREFIX = 'item-'

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Check if a drag ID is from the library (vs reordering)
 */
export function isItemDragId(id: string): boolean {
  return id.startsWith(ITEM_DRAG_PREFIX)
}

/**
 * Create a drag ID for a library item
 */
export function createItemDragId(itemId: string): string {
  return `${ITEM_DRAG_PREFIX}${itemId}`
}

/**
 * Extract item ID from a drag ID
 */
export function extractItemId(dragId: string): string | null {
  if (!isItemDragId(dragId)) return null
  return dragId.slice(ITEM_DRAG_PREFIX.length)
}

// ============================================================================
// TYPES
// ============================================================================

export interface UseBuilderDragDropConfig<TItem extends BaseItem, TStep extends BaseStep> {
  /** Current composition ID (null if no composition yet) */
  compositionId: string | null

  /** Current steps in the composition */
  steps: LocalStep<TStep>[]

  /** Items map for resolving dragged items */
  itemsMap: Record<string, TItem>

  /** Callback to add a step */
  onAddStep: (item: TItem) => void

  /** Callback to reorder steps */
  onReorderSteps: (fromIndex: number, toIndex: number) => void

  /** Callback when first item is dropped (creates composition) */
  onCreateComposition?: (item: TItem) => Promise<void>

  /** Minimum drag distance before activating (default: 8px) */
  activationDistance?: number
}

export interface UseBuilderDragDropReturn<TItem extends BaseItem> {
  /** DnD Kit sensors configuration */
  sensors: ReturnType<typeof useSensors>
  /** Currently dragged item from library */
  activeDragItem: TItem | null
  /** Whether cursor is over the drop zone */
  isOverDropZone: boolean
  /** Is creating a composition (first drop) */
  isCreatingComposition: boolean
  /** Handler for drag start */
  handleDragStart: (event: DragStartEvent) => void
  /** Handler for drag over */
  handleDragOver: (event: DragOverEvent) => void
  /** Handler for drag end */
  handleDragEnd: (event: DragEndEvent) => Promise<void>
  /** Handler for click-to-add (alternative to drag) */
  handleItemClick: (item: TItem) => Promise<void>
}

// ============================================================================
// HOOK
// ============================================================================

export function useBuilderDragDrop<TItem extends BaseItem, TStep extends BaseStep>(
  config: UseBuilderDragDropConfig<TItem, TStep>
): UseBuilderDragDropReturn<TItem> {
  const {
    compositionId,
    steps,
    itemsMap,
    onAddStep,
    onReorderSteps,
    onCreateComposition,
    activationDistance = 8,
  } = config

  // Drag state
  const [activeDragItem, setActiveDragItem] = useState<TItem | null>(null)
  const [isOverDropZone, setIsOverDropZone] = useState(false)
  const [isCreatingComposition, setIsCreatingComposition] = useState(false)

  // DnD Kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: activationDistance,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // -------------------------------------------------------------------------
  // Create composition and add first item
  // -------------------------------------------------------------------------

  const createCompositionAndAddItem = useCallback(
    async (item: TItem): Promise<boolean> => {
      if (!onCreateComposition) {
        console.warn('[BuilderDragDrop] Cannot create composition - no handler provided')
        return false
      }

      setIsCreatingComposition(true)
      try {
        await onCreateComposition(item)
        return true
      } catch (error) {
        console.error('[BuilderDragDrop] Failed to create composition:', error)
        return false
      } finally {
        setIsCreatingComposition(false)
      }
    },
    [onCreateComposition]
  )

  // -------------------------------------------------------------------------
  // Drag handlers
  // -------------------------------------------------------------------------

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event
      const activeId = String(active.id)

      // Check if dragging from library
      if (isItemDragId(activeId)) {
        const itemId = extractItemId(activeId)
        if (itemId && itemsMap[itemId]) {
          setActiveDragItem(itemsMap[itemId])
        }
      }
    },
    [itemsMap]
  )

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event
    const activeId = String(active.id)

    // If dragging from library
    if (isItemDragId(activeId)) {
      // Check if over the drop zone or a step
      const isOverZone = over?.id === DROP_ZONE_ID || (over && !isItemDragId(String(over.id)))
      setIsOverDropZone(Boolean(isOverZone))
    }
  }, [])

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      const activeId = String(active.id)

      // Reset drag state
      setActiveDragItem(null)
      setIsOverDropZone(false)

      if (!over) return

      // Case 1: Dragging from library to composition
      if (isItemDragId(activeId)) {
        const itemId = extractItemId(activeId)
        const item = itemId ? itemsMap[itemId] : null
        if (!item) return

        // If no composition exists, create one first
        if (!compositionId) {
          await createCompositionAndAddItem(item)
          return
        }

        // Add to existing composition
        onAddStep(item)
        return
      }

      // Case 2: Reordering steps within composition
      if (!compositionId || active.id === over.id) return

      const oldIndex = steps.findIndex((s) => s.id === active.id)
      const newIndex = steps.findIndex((s) => s.id === over.id)

      if (oldIndex === -1 || newIndex === -1) return

      onReorderSteps(oldIndex, newIndex)
    },
    [compositionId, steps, itemsMap, createCompositionAndAddItem, onAddStep, onReorderSteps]
  )

  // -------------------------------------------------------------------------
  // Click-to-add handler
  // -------------------------------------------------------------------------

  const handleItemClick = useCallback(
    async (item: TItem) => {
      // If no composition exists, create one first
      if (!compositionId) {
        await createCompositionAndAddItem(item)
        return
      }

      // Add to existing composition
      onAddStep(item)
    },
    [compositionId, createCompositionAndAddItem, onAddStep]
  )

  return {
    sensors,
    activeDragItem,
    isOverDropZone,
    isCreatingComposition,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleItemClick,
  }
}
