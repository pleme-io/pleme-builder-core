/**
 * @pleme/builder-core
 *
 * Universal builder infrastructure for drag-drop composition UIs.
 * Provides optimistic UI stores, XState-coordinated sync, and drag-drop utilities
 * that can be used across different verticals (yoga sequences, task lists, etc.)
 *
 * Architecture follows XState + Zustand Coordination Pattern:
 * - XState machine owns ALL sync state transitions (debouncing, retries, errors)
 * - Zustand stores subscribe to machine and expose reactive state
 * - Components interact via actions that delegate to machine.send()
 *
 * @example
 * ```tsx
 * import {
 *   createBuilderStore,
 *   useBuilderSyncMachine,  // Recommended: XState-coordinated
 *   useBuilderDragDrop,
 * } from '@pleme/builder-core'
 *
 * // Create a typed store for your domain (optimistic local state)
 * const useYogaBuilderStore = createBuilderStore<YogaPose, YogaStep, AddPayload, UpdatePayload>({
 *   name: 'yoga-builder',
 *   createLocalStep: (tempId, sessionId, pose, order) => ({ ... }),
 *   applyStepUpdates: (step, updates) => { ... },
 * })
 *
 * // Use the XState-coordinated sync hook
 * function YogaBuilder() {
 *   const sync = useBuilderSyncMachine({
 *     store: useYogaBuilderStore,
 *     mutations: { add, update, delete, reorder },
 *     // ...
 *   })
 *
 *   const dragDrop = useBuilderDragDrop({
 *     compositionId: currentSessionId,
 *     steps: sync.steps,
 *     onAddStep: sync.addStep,
 *     onReorderSteps: sync.reorderSteps,
 *   })
 *
 *   return (
 *     <DndContext
 *       sensors={dragDrop.sensors}
 *       onDragStart={dragDrop.handleDragStart}
 *       onDragOver={dragDrop.handleDragOver}
 *       onDragEnd={dragDrop.handleDragEnd}
 *     >
 *       {/* Your builder UI *\/}
 *     </DndContext>
 *   )
 * }
 * ```
 */

// Types
export * from './types'

// Stores - explicit exports to avoid conflicts with machines
export {
  createBuilderStore,
  TEMP_ID_PREFIX,
  DEFAULT_SYNC_DEBOUNCE_MS,
  isTempId,
  // Renamed to avoid conflict with machine version
  getSyncStatus as getStoreSyncStatus,
  hasUnsavedChanges as storeHasUnsavedChanges,
} from './stores/createBuilderStore'

export {
  createBuilderSyncStore,
  type BuilderSyncStoreConfig,
  type BuilderSyncStore,
  type BuilderSyncStoreHook,
} from './stores/createBuilderSyncStore'

// Hooks (useBuilderSyncMachine recommended over useBuilderSync)
export * from './hooks'

// Components (PlaybackEngine, ExportEngine, BuilderShell)
export * from './components'

// XState Machines - primary sync utilities (recommended)
export {
  builderSyncMachine,
  type BuilderSyncContext,
  type BuilderSyncInput,
  type BuilderSyncEvent,
  type FlushResult,
  type SyncState,
  getSyncState,
  getSyncStatus,
  hasUnsavedChanges,
} from './machines/builderSyncMachine'
