/**
 * BuilderShell - Two-panel orchestrator component for builder UIs
 *
 * Provides responsive layout structure for builder interfaces with:
 * - Library panel (item collection)
 * - Composition panel (sortable steps)
 * - Drag-drop context wiring
 * - Sync status display
 * - Action toolbar
 *
 * Products configure the shell by providing renderer components for items and steps,
 * and handle all business logic (GraphQL, navigation, etc.) themselves.
 *
 * @example
 * ```tsx
 * <BuilderShell
 *   category="yoga"
 *   compositionId={sessionId}
 *   items={poses}
 *   ItemRenderer={PoseCard}
 *   LibraryHeader={<SearchBar />}
 *   steps={steps}
 *   StepRenderer={PoseStepItem}
 *   onAddItem={addStepOptimistic}
 *   onUpdateStep={updateStepOptimistic}
 *   onDeleteStep={deleteStepOptimistic}
 *   onReorderSteps={reorderStepsOptimistic}
 *   syncStatus={syncStatus}
 *   syncError={syncError}
 *   actions={[
 *     { key: 'play', icon: <PlayIcon />, label: 'Play', onClick: () => navigate('play') },
 *     { key: 'print', icon: <PrintIcon />, label: 'Print', onClick: () => setPrintOpen(true) },
 *   ]}
 * />
 * ```
 */

import { useCallback, useMemo, useRef, type CSSProperties } from 'react'
import { DndContext, closestCenter, DragOverlay, useSensors, useSensor, PointerSensor } from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type {
  BaseItem,
  BaseStep,
  BuilderAction,
  BuilderShellProps,
  ItemRendererProps,
  LocalStep,
  SyncStatus,
} from '../types'
import {
  DROP_ZONE_ID,
  ITEM_DRAG_PREFIX,
  isItemDragId,
  extractItemId,
} from '../hooks/useBuilderDragDrop'

// ============================================================================
// STYLES
// ============================================================================

const shellContainerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  padding: '1rem',
  minHeight: '100vh',
}

const twoColumnStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: '1rem',
}

const twoColumnDesktopStyle: CSSProperties = {
  ...twoColumnStyle,
  gridTemplateColumns: '1fr 1fr',
}

const panelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  backgroundColor: '#fff',
  borderRadius: '8px',
  border: '1px solid #e0e0e0',
  padding: '1rem',
  minHeight: '400px',
}

const libraryGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
  gap: '0.5rem',
}

const stepsListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  flex: 1,
}

const dropZoneStyle: CSSProperties = {
  border: '2px dashed #ccc',
  borderRadius: '8px',
  padding: '2rem',
  textAlign: 'center',
  color: '#999',
  transition: 'all 0.2s ease',
  minHeight: '200px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'column',
}

const dropZoneActiveStyle: CSSProperties = {
  ...dropZoneStyle,
  borderColor: '#1976d2',
  backgroundColor: 'rgba(25, 118, 210, 0.08)',
  color: '#1976d2',
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  flexWrap: 'wrap',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '0.5rem',
}

const syncIndicatorStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
  fontSize: '0.75rem',
  color: '#666',
}

// ============================================================================
// SYNC STATUS INDICATOR
// ============================================================================

interface SyncStatusIndicatorProps {
  status: SyncStatus
  error: string | null
}

function SyncStatusIndicator({ status, error }: SyncStatusIndicatorProps) {
  const statusConfig: Record<SyncStatus, { color: string; label: string }> = {
    idle: { color: '#4caf50', label: 'Saved' },
    pending: { color: '#ff9800', label: 'Pending...' },
    syncing: { color: '#2196f3', label: 'Saving...' },
    error: { color: '#f44336', label: 'Error' },
  }

  const config = statusConfig[status]

  return (
    <div style={syncIndicatorStyle} title={error || undefined}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: config.color,
          display: 'inline-block',
        }}
      />
      <span>{config.label}</span>
      {error && <span style={{ color: '#f44336' }}>(!)</span>}
    </div>
  )
}

// ============================================================================
// EMPTY STATE
// ============================================================================

interface EmptyStateProps {
  icon?: React.ReactNode
  message?: string
  isOver?: boolean
}

function EmptyState({ icon, message = 'Drag items here to get started', isOver }: EmptyStateProps) {
  return (
    <div style={isOver ? dropZoneActiveStyle : dropZoneStyle}>
      {icon && <div style={{ marginBottom: '0.5rem', fontSize: '2rem' }}>{icon}</div>}
      <div>{isOver ? 'Drop to add!' : message}</div>
    </div>
  )
}

// ============================================================================
// ACTION BUTTON
// ============================================================================

interface ActionButtonProps {
  action: BuilderAction
}

function ActionButton({ action }: ActionButtonProps) {
  const baseStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.5rem 1rem',
    borderRadius: '4px',
    border: 'none',
    cursor: action.disabled ? 'not-allowed' : 'pointer',
    fontSize: '0.875rem',
    fontWeight: 500,
    transition: 'all 0.2s ease',
    opacity: action.disabled ? 0.5 : 1,
  }

  const variantStyles: Record<string, CSSProperties> = {
    text: {
      ...baseStyle,
      backgroundColor: 'transparent',
      color: action.color === 'primary' ? '#1976d2' : '#666',
    },
    outlined: {
      ...baseStyle,
      backgroundColor: 'transparent',
      border: `1px solid ${action.color === 'primary' ? '#1976d2' : '#ccc'}`,
      color: action.color === 'primary' ? '#1976d2' : '#666',
    },
    contained: {
      ...baseStyle,
      backgroundColor: action.color === 'primary' ? '#1976d2' : '#666',
      color: '#fff',
    },
  }

  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      style={variantStyles[action.variant || 'outlined']}
      title={action.tooltip}
    >
      {action.icon}
      <span>{action.label}</span>
    </button>
  )
}

// ============================================================================
// DRAGGABLE ITEM WRAPPER
// ============================================================================

interface DraggableItemProps<TItem extends BaseItem> {
  item: TItem
  ItemRenderer: React.ComponentType<ItemRendererProps<TItem>>
  onAdd: (item: TItem) => void
  isFavorite?: boolean
  onToggleFavorite?: (item: TItem) => void
}

function DraggableItem<TItem extends BaseItem>({
  item,
  ItemRenderer,
  onAdd,
  isFavorite,
  onToggleFavorite,
}: DraggableItemProps<TItem>) {
  // Note: Actual draggable behavior is set up via useDraggable hook in the product's ItemRenderer
  // This wrapper just passes the required props
  return (
    <ItemRenderer
      item={item}
      isDragging={false}
      onAdd={onAdd}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
    />
  )
}

// ============================================================================
// BUILDER SHELL COMPONENT
// ============================================================================

export function BuilderShell<TItem extends BaseItem, TStep extends BaseStep>({
  // Identity
  category: _category,
  compositionId,

  // Library panel
  items,
  itemsLoading,
  ItemRenderer,
  LibraryHeader,
  LibraryFilters,

  // Composition zone
  steps,
  stepsLoading,
  StepRenderer,
  emptyStateMessage,
  emptyStateIcon,

  // Step operations
  onAddItem,
  onUpdateStep,
  onDeleteStep,
  onReorderSteps,

  // Sync status
  syncStatus,
  syncError,

  // Toolbar actions
  actions,

  // Optional features
  enableCustomItems,
  CustomItemForm,

  // Header extension
  HeaderExtension,

  // Composition header
  CompositionHeader,
  compositionTitle,
  compositionDescription,
  onTitleChange: _onTitleChange,
  onDescriptionChange: _onDescriptionChange,

  // Session creation callback
  onCompositionCreate,
}: BuilderShellProps<TItem, TStep>): React.ReactNode {
  // Note: category, onTitleChange, onDescriptionChange reserved for future use
  void _category
  void _onTitleChange
  void _onDescriptionChange
  // Refs
  const itemsMapRef = useRef<Map<string, TItem>>(new Map())

  // Build items map for quick lookup
  useMemo(() => {
    itemsMapRef.current.clear()
    items.forEach((item) => itemsMapRef.current.set(item.id, item))
  }, [items])

  // Sort steps by stepOrder
  const sortedSteps = useMemo(
    () => [...steps].sort((a, b) => a.stepOrder - b.stepOrder),
    [steps]
  )

  // Step IDs for sortable context
  const stepIds = useMemo(
    () => sortedSteps.map((s) => s.id),
    [sortedSteps]
  )

  // Sensors for drag-drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  // Drag state
  const activeDragItemRef = useRef<TItem | null>(null)

  // Drag handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event
    const activeId = String(active.id)

    if (isItemDragId(activeId)) {
      const itemId = extractItemId(activeId)
      if (itemId) {
        const item = itemsMapRef.current.get(itemId)
        if (item) {
          activeDragItemRef.current = item
        }
      }
    } else {
      // It's a step being reordered
      activeDragItemRef.current = null
    }
  }, [])

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      activeDragItemRef.current = null

      if (!over) return

      const activeId = String(active.id)
      const overId = String(over.id)

      // Case 1: Dropping an item from library
      if (isItemDragId(activeId)) {
        const itemId = extractItemId(activeId)
        if (!itemId) return

        const item = itemsMapRef.current.get(itemId)
        if (!item) return

        // If dropping on composition zone
        if (overId === DROP_ZONE_ID || !isItemDragId(overId)) {
          // If no composition yet, create one first
          if (!compositionId && onCompositionCreate) {
            const newId = await onCompositionCreate()
            if (newId) {
              onAddItem(item)
            }
          } else {
            onAddItem(item)
          }
        }
        return
      }

      // Case 2: Reordering steps within composition
      if (activeId !== overId && !isItemDragId(overId)) {
        const oldIndex = sortedSteps.findIndex((s) => s.id === activeId)
        const newIndex = sortedSteps.findIndex((s) => s.id === overId)

        if (oldIndex !== -1 && newIndex !== -1) {
          onReorderSteps(oldIndex, newIndex)
        }
      }
    },
    [compositionId, sortedSteps, onAddItem, onReorderSteps, onCompositionCreate]
  )

  // Check if we're in a desktop viewport
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div style={shellContainerStyle}>
        {/* Header Extension (e.g., negotiation status bar) */}
        {HeaderExtension}

        {/* Main Two-Panel Layout */}
        <div style={isDesktop ? twoColumnDesktopStyle : twoColumnStyle}>
          {/* Composition Panel */}
          <div style={panelStyle}>
            <div style={headerStyle}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                  {compositionTitle || 'Composition'}
                </h3>
                {compositionDescription && (
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#666' }}>
                    {compositionDescription}
                  </p>
                )}
              </div>
              <SyncStatusIndicator status={syncStatus} error={syncError} />
            </div>

            {/* Custom Composition Header */}
            {CompositionHeader}

            {/* Steps List */}
            <div style={stepsListStyle}>
              {stepsLoading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>
                  Loading...
                </div>
              ) : sortedSteps.length === 0 ? (
                <EmptyState
                  icon={emptyStateIcon}
                  message={emptyStateMessage}
                  isOver={false}
                />
              ) : (
                <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
                  {sortedSteps.map((step, index) => (
                    <StepRenderer
                      key={step.id}
                      step={step as LocalStep<TStep>}
                      index={index}
                      onUpdate={onUpdateStep}
                      onDelete={onDeleteStep}
                    />
                  ))}
                </SortableContext>
              )}
            </div>

            {/* Actions Toolbar */}
            {actions && actions.length > 0 && (
              <div style={toolbarStyle}>
                {actions.map((action) => (
                  <ActionButton key={action.key} action={action} />
                ))}
              </div>
            )}
          </div>

          {/* Library Panel */}
          <div style={panelStyle}>
            <div style={headerStyle}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Library</h3>
            </div>

            {/* Library Header (search, tabs, etc.) */}
            {LibraryHeader}

            {/* Library Filters */}
            {LibraryFilters}

            {/* Items Grid */}
            {itemsLoading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>
                Loading items...
              </div>
            ) : items.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>
                No items available
              </div>
            ) : (
              <div style={libraryGridStyle}>
                {items.map((item) => (
                  <DraggableItem
                    key={item.id}
                    item={item}
                    ItemRenderer={ItemRenderer}
                    onAdd={onAddItem}
                  />
                ))}
              </div>
            )}

            {/* Custom Item Form */}
            {enableCustomItems && CustomItemForm && (
              <CustomItemForm
                onSubmit={(item) => onAddItem(item)}
                onCancel={() => {}}
              />
            )}
          </div>
        </div>
      </div>

      {/* Drag Overlay - products can customize by wrapping with their own overlay */}
      <DragOverlay>
        {activeDragItemRef.current && (
          <div
            style={{
              padding: '0.5rem',
              backgroundColor: '#fff',
              borderRadius: '4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              opacity: 0.9,
            }}
          >
            <ItemRenderer
              item={activeDragItemRef.current}
              isDragging={true}
              onAdd={() => {}}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

// Re-export drag-drop utilities for convenience
export { DROP_ZONE_ID, ITEM_DRAG_PREFIX, isItemDragId, extractItemId }
