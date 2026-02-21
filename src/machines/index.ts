/**
 * @pleme/builder-core - XState Machines
 *
 * Exports state machines for builder coordination.
 * XState owns ALL sync state transitions, Zustand subscribes and exposes reactive state.
 */

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
} from './builderSyncMachine'
