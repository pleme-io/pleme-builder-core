// Legacy hook (still works, but doesn't use XState)
export { useBuilderSync, type UseBuilderSyncConfig, type UseBuilderSyncReturn } from './useBuilderSync'

// XState-coordinated sync hook (recommended)
export {
  useBuilderSyncMachine,
  type UseBuilderSyncMachineConfig,
  type UseBuilderSyncMachineReturn,
} from './useBuilderSyncMachine'

export {
  useBuilderDragDrop,
  type UseBuilderDragDropConfig,
  type UseBuilderDragDropReturn,
  DROP_ZONE_ID,
  ITEM_DRAG_PREFIX,
  isItemDragId,
  createItemDragId,
  extractItemId,
} from './useBuilderDragDrop'

// Playback timer hook for teaching mode
export {
  usePlaybackTimer,
  type UsePlaybackTimerOptions,
  type UsePlaybackTimerReturn,
} from './usePlaybackTimer'
