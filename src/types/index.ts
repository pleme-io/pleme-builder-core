/**
 * @pleme/builder-core - Core Types
 *
 * Generic types for the universal builder infrastructure.
 * These types are parameterized to work with any domain (yoga poses, tasks, etc.)
 */

import type { DocumentNode } from 'graphql'

// ============================================================================
// SECTION TYPES (Wellness Sequence Structure)
// ============================================================================

/**
 * Section types for wellness sequences (yoga, pilates, massage, etc.)
 * Each section represents a phase in the sequence flow.
 */
export type SectionType =
  | 'centering'    // Opening meditation/breathing
  | 'warmup'       // Warm-up exercises
  | 'buildup'      // Building intensity
  | 'peak'         // Most challenging poses/exercises
  | 'cooldown'     // Reducing intensity
  | 'savasana'     // Final relaxation (yoga-specific)
  | 'custom'       // Custom section with label

// ============================================================================
// CORE ITEM TYPES
// ============================================================================

/**
 * Base interface for library items (poses, techniques, tasks, etc.)
 * Each vertical extends this with domain-specific fields.
 */
export interface BaseItem {
  id: string
  name: string
  namePt?: string
  thumbnailUrl?: string
  defaultDurationSeconds?: number
  /** Default rest duration after this item (optional) */
  defaultRestDurationSeconds?: number
}

/**
 * Base interface for steps in a composition (sequence steps, task items)
 * Each vertical extends this with domain-specific fields.
 */
export interface BaseStep {
  id: string
  stepOrder: number
  createdAt: string
  updatedAt: string
  /** Duration in seconds for this step */
  durationSeconds?: number
  /** Rest duration in seconds after this step */
  restDurationSeconds?: number
  /** Section type for sequence organization */
  sectionType?: SectionType
  /** Custom section label (when sectionType is 'custom') */
  sectionLabel?: string
}

/**
 * Local step with optimistic UI support
 */
export type LocalStep<TStep extends BaseStep> = TStep & {
  /** True if not yet confirmed by backend */
  isOptimistic?: boolean
  /** True if waiting for backend response */
  isPending?: boolean
}

// ============================================================================
// PENDING OPERATIONS
// ============================================================================

/**
 * Pending operation types for sync with backend
 */
export type PendingOperationType = 'add' | 'update' | 'delete' | 'reorder'

/**
 * Base pending operation
 */
export interface BasePendingOperation {
  type: PendingOperationType
  timestamp: number
}

/**
 * Add operation - adds new item to composition
 */
export interface AddOperation<TPayload = Record<string, unknown>> extends BasePendingOperation {
  type: 'add'
  tempId: string
  payload: TPayload
}

/**
 * Update operation - updates existing item
 */
export interface UpdateOperation<TUpdates = Record<string, unknown>> extends BasePendingOperation {
  type: 'update'
  stepId: string
  updates: TUpdates
}

/**
 * Delete operation - removes item
 */
export interface DeleteOperation extends BasePendingOperation {
  type: 'delete'
  stepId: string
}

/**
 * Reorder operation - changes item order
 */
export interface ReorderOperation extends BasePendingOperation {
  type: 'reorder'
  stepIds: string[]
}

export type PendingOperation<TAddPayload = Record<string, unknown>, TUpdates = Record<string, unknown>> =
  | AddOperation<TAddPayload>
  | UpdateOperation<TUpdates>
  | DeleteOperation
  | ReorderOperation

// ============================================================================
// SYNC STATUS
// ============================================================================

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'pending'

// ============================================================================
// STORE TYPES
// ============================================================================

/**
 * Base state for all builder stores
 */
export interface BuilderStoreState<TItem extends BaseItem, TStep extends BaseStep> {
  // Session/composition data
  compositionId: string | null
  steps: LocalStep<TStep>[]

  // Items library (for resolving item data)
  itemsMap: Record<string, TItem>

  // Sync state
  isSyncing: boolean
  syncError: string | null
  lastSyncedAt: Date | null

  // Pending operations buffer
  pendingOperations: PendingOperation[]
}

/**
 * Base actions for all builder stores
 */
export interface BuilderStoreActions<TItem extends BaseItem, TStep extends BaseStep, TAddPayload, TUpdatePayload> {
  // Composition management
  setCompositionId: (id: string | null) => void

  // Load steps from backend
  loadSteps: (steps: TStep[]) => void

  // Register items for resolution
  registerItems: (items: TItem[]) => void

  // Optimistic operations
  addStepOptimistic: (item: TItem, payload?: Partial<TAddPayload>) => string
  updateStepOptimistic: (stepId: string, updates: Partial<TUpdatePayload>) => void
  deleteStepOptimistic: (stepId: string) => void
  reorderStepsOptimistic: (fromIndex: number, toIndex: number) => void

  // Confirm operations from backend
  confirmStepAdded: (tempId: string, serverStep: TStep) => void
  confirmStepUpdated: (stepId: string) => void
  confirmStepDeleted: (stepId: string) => void
  confirmReorder: () => void

  // Rollback on error
  rollbackOperation: (operation: PendingOperation, error: string) => void

  // Sync control
  setSyncing: (syncing: boolean) => void
  setSyncError: (error: string | null) => void

  // Get pending operations
  getPendingOperations: () => PendingOperation[]
  clearPendingOperations: () => void

  // Debounced sync scheduling
  scheduleSyncFlush: (flushFn: () => Promise<void>, delayMs?: number) => void
  cancelPendingSync: () => void

  // Reset store
  reset: () => void
}

export type BuilderStore<
  TItem extends BaseItem,
  TStep extends BaseStep,
  TAddPayload = Record<string, unknown>,
  TUpdatePayload = Record<string, unknown>
> = BuilderStoreState<TItem, TStep> & BuilderStoreActions<TItem, TStep, TAddPayload, TUpdatePayload>

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/**
 * Configuration for creating a builder store
 */
export interface BuilderStoreConfig<TItem extends BaseItem, TStep extends BaseStep, TAddPayload, TUpdatePayload> {
  /** Unique name for the store (used for debugging) */
  name: string

  /** Default values when adding a new step */
  defaultStepValues?: Partial<TAddPayload>

  /** Function to create a local step from an item */
  createLocalStep: (
    tempId: string,
    compositionId: string,
    item: TItem,
    stepOrder: number,
    payload?: Partial<TAddPayload>
  ) => LocalStep<TStep>

  /** Function to apply updates to a step */
  applyStepUpdates: (step: LocalStep<TStep>, updates: Partial<TUpdatePayload>) => void

  /** Debounce delay for sync operations (default: 500ms) */
  syncDebounceMs?: number
}

/**
 * Configuration for sync hook
 */
export interface BuilderSyncConfig {
  /** GraphQL mutation for adding steps */
  addMutation: DocumentNode
  /** GraphQL mutation for updating steps */
  updateMutation: DocumentNode
  /** GraphQL mutation for deleting steps */
  deleteMutation: DocumentNode
  /** GraphQL mutation for reordering steps */
  reorderMutation: DocumentNode
  /** GraphQL query to refetch after reorder */
  refetchQuery?: DocumentNode

  /** Debounce delay in ms (default: 500) */
  debounceMs?: number
  /** Whether to show toast notifications on errors */
  showErrorToasts?: boolean
}

// ============================================================================
// COMPONENT PROPS TYPES
// ============================================================================

/**
 * Props for rendering a library item (in the left panel)
 */
export interface ItemRendererProps<TItem extends BaseItem> {
  item: TItem
  isDragging: boolean
  onAdd: (item: TItem) => void
  isFavorite?: boolean
  onToggleFavorite?: (item: TItem) => void
}

/**
 * Props for rendering a step in the composition zone
 */
export interface StepRendererProps<TStep extends BaseStep> {
  step: LocalStep<TStep>
  index: number
  onUpdate: (stepId: string, updates: Record<string, unknown>) => void
  onDelete: (stepId: string) => void
}

/**
 * Props for the BuilderShell component
 */
export interface BuilderShellProps<TItem extends BaseItem, TStep extends BaseStep> {
  // Identity
  category: string
  /** Current composition/session ID (null for new) */
  compositionId: string | null

  // Library panel (left side)
  items: TItem[]
  itemsLoading?: boolean
  ItemRenderer: React.ComponentType<ItemRendererProps<TItem>>
  /** Header above the library (search, tabs, etc.) */
  LibraryHeader?: React.ReactNode
  /** Filters for the library (drawer or inline) */
  LibraryFilters?: React.ReactNode

  // Composition zone (right side)
  steps: LocalStep<TStep>[]
  stepsLoading?: boolean
  StepRenderer: React.ComponentType<StepRendererProps<TStep>>
  emptyStateMessage?: string
  emptyStateIcon?: React.ReactNode

  // Step operations
  onAddItem: (item: TItem) => void
  onUpdateStep: (stepId: string, updates: Record<string, unknown>) => void
  onDeleteStep: (stepId: string) => void
  onReorderSteps: (fromIndex: number, toIndex: number) => void

  // Sync status
  syncStatus: SyncStatus
  syncError: string | null

  // Toolbar actions (play, print, publish, etc.)
  actions?: BuilderAction[]

  // Optional features
  enableCustomItems?: boolean
  CustomItemForm?: React.ComponentType<{ onSubmit: (item: TItem) => void; onCancel: () => void }>

  // Header extension (e.g., for negotiation status bar)
  HeaderExtension?: React.ReactNode

  // Composition header (title, description editing)
  CompositionHeader?: React.ReactNode
  compositionTitle?: string
  compositionDescription?: string
  onTitleChange?: (title: string) => void
  onDescriptionChange?: (description: string) => void

  // Session creation callback (when first item dropped on new composition)
  onCompositionCreate?: () => Promise<string>
}

// ============================================================================
// PLAYBACK TYPES
// ============================================================================

/**
 * Playback settings for teaching mode
 */
export interface PlaybackSettings {
  /** Auto-advance to next step when timer completes */
  autoAdvance: boolean
  /** Show cues/instructions during playback */
  showCues: boolean
  /** Play sound on step transitions */
  soundEnabled: boolean
  /** Playback speed multiplier (0.5, 1, 1.5, 2) */
  playbackSpeed: number
  /** Show rest periods between steps */
  showRestPeriods: boolean
}

/**
 * Default playback settings
 */
export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  autoAdvance: true,
  showCues: true,
  soundEnabled: true,
  playbackSpeed: 1,
  showRestPeriods: true,
}

/**
 * Playback controls exposed to render function
 */
export interface PlaybackControls {
  /** Start/resume playback */
  play: () => void
  /** Pause playback */
  pause: () => void
  /** Toggle play/pause */
  toggle: () => void
  /** Skip to next step */
  next: () => void
  /** Go to previous step */
  previous: () => void
  /** Restart from beginning */
  restart: () => void
  /** Skip rest period (jump to next pose) */
  skipRest: () => void
  /** Go to specific step */
  goToStep: (index: number) => void
  /** Toggle fullscreen mode */
  toggleFullscreen: () => void
}

/**
 * Props passed to PlaybackEngine render function
 */
export interface PlaybackRenderProps<TStep extends BaseStep> {
  /** Current step being displayed */
  currentStep: TStep
  /** Index of current step (0-based) */
  currentIndex: number
  /** Total number of steps */
  totalSteps: number
  /** Seconds remaining on current timer */
  timeRemaining: number
  /** Total duration of current step in seconds */
  totalDuration: number
  /** Progress percentage (0-100) */
  progress: number
  /** True if currently in rest period */
  isRest: boolean
  /** True if playback is paused */
  isPaused: boolean
  /** True if in fullscreen mode */
  isFullscreen: boolean
  /** Playback controls */
  controls: PlaybackControls
  /** Current settings */
  settings: PlaybackSettings
  /** Update settings */
  onSettingsChange: (settings: Partial<PlaybackSettings>) => void
}

/**
 * Props for PlaybackEngine component
 */
export interface PlaybackEngineProps<TStep extends BaseStep> {
  /** Steps to play through */
  steps: TStep[]
  /** Get duration for a step (default: step.durationSeconds or 60) */
  getStepDuration?: (step: TStep) => number
  /** Get rest duration for a step (default: step.restDurationSeconds or 0) */
  getRestDuration?: (step: TStep) => number
  /** Called when step changes */
  onStepChange?: (index: number, step: TStep) => void
  /** Called when playback completes all steps */
  onComplete?: () => void
  /** Called when playback is paused */
  onPause?: () => void
  /** Called when playback is resumed */
  onResume?: () => void
  /** Initial settings (merged with defaults) */
  initialSettings?: Partial<PlaybackSettings>
  /** Storage key for persisting settings (default: 'playback-settings') */
  settingsStorageKey?: string
  /** Render function for playback UI */
  children: (props: PlaybackRenderProps<TStep>) => React.ReactNode
}

// ============================================================================
// EXPORT TYPES
// ============================================================================

/**
 * Export options for print/PDF
 */
export interface ExportOptions {
  /** Show step durations */
  showDurations?: boolean
  /** Show custom instructions/cues */
  showInstructions?: boolean
  /** Show rest durations */
  showRest?: boolean
  /** Compact layout (more items per row) */
  compactMode?: boolean
  /** Items per row (4-6, default: 4) */
  itemsPerRow?: 4 | 5 | 6
}

/**
 * Branding config for exports
 */
export interface ExportBranding {
  /** Provider/company logo URL */
  logoUrl?: string
  /** Provider/company name */
  name?: string
  /** Additional footer text */
  footerText?: string
}

/**
 * Props for step export renderer
 */
export interface StepExportRendererProps<TStep extends BaseStep> {
  step: TStep
  index: number
  options: ExportOptions
}

/**
 * Props for ExportEngine component
 */
export interface ExportEngineProps<TStep extends BaseStep> {
  /** Composition title */
  title: string
  /** Optional description */
  description?: string
  /** Steps to export */
  steps: TStep[]
  /** Render a step for export (image, title, duration) */
  StepRenderer: React.ComponentType<StepExportRendererProps<TStep>>
  /** Export options */
  options?: ExportOptions
  /** Branding configuration */
  branding?: ExportBranding
  /** Metadata to include (duration, difficulty, etc.) */
  metadata?: Record<string, string | number>
}

/**
 * Props for PrintDialog component
 */
export interface PrintDialogProps<TStep extends BaseStep> extends ExportEngineProps<TStep> {
  /** Dialog open state */
  open: boolean
  /** Called when dialog should close */
  onClose: () => void
  /** Called after successful print */
  onPrint?: () => void
}

// ============================================================================
// BUILDER ACTION TYPES
// ============================================================================

/**
 * Action button for BuilderShell toolbar
 */
export interface BuilderAction {
  /** Unique key for the action */
  key: string
  /** Button label */
  label: string
  /** MUI icon component */
  icon?: React.ReactNode
  /** Click handler */
  onClick: () => void
  /** Disabled state */
  disabled?: boolean
  /** Tooltip text */
  tooltip?: string
  /** Button variant */
  variant?: 'text' | 'outlined' | 'contained'
  /** Button color */
  color?: 'primary' | 'secondary' | 'success' | 'warning' | 'error'
}
