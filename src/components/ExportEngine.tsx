/**
 * ExportEngine - Render-prop component for builder print/PDF export
 *
 * Manages print preview, options, and browser print functionality.
 * Products provide their own step rendering through the render function.
 *
 * @example
 * ```tsx
 * <PrintDialog
 *   open={showPrint}
 *   onClose={() => setShowPrint(false)}
 *   title={sequence.name}
 *   steps={sequence.steps}
 *   StepRenderer={({ step, index, options }) => (
 *     <PoseExportCard
 *       pose={posesMap[step.positionId]}
 *       step={step}
 *       index={index}
 *       showDuration={options.showDurations}
 *       compact={options.compactMode}
 *     />
 *   )}
 *   branding={{ name: provider.name, logoUrl: provider.logoUrl }}
 * />
 * ```
 */

import { useCallback, useMemo, useRef, useState } from 'react'
// Note: useRef and useState are used by PrintDialog, useCallback and useMemo by both
import type {
  BaseStep,
  ExportEngineProps,
  ExportOptions,
  PrintDialogProps,
} from '../types'

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  showDurations: true,
  showInstructions: false,
  showRest: true,
  compactMode: false,
  itemsPerRow: 4,
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Format seconds as human-readable duration string
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

/**
 * Calculate total duration from steps
 */
function calculateTotalDuration<TStep extends BaseStep>(steps: TStep[]): number {
  return steps.reduce(
    (acc, step) => acc + (step.durationSeconds ?? 0) + (step.restDurationSeconds ?? 0),
    0
  )
}

/**
 * Generate print CSS based on options
 */
function generatePrintCSS(options: ExportOptions): string {
  const itemsPerRow = options.itemsPerRow ?? 4
  const compact = options.compactMode

  return `
    @page {
      size: A4;
      margin: 15mm;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1a1a1a;
      line-height: 1.4;
    }

    .export-header {
      text-align: center;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 2px solid #e0e0e0;
    }

    .export-header h1 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .export-header .description {
      font-size: 14px;
      color: #666;
      margin-bottom: 8px;
    }

    .export-header .meta {
      font-size: 12px;
      color: #666;
    }

    .export-header .meta span {
      margin: 0 8px;
    }

    .export-branding {
      font-size: 14px;
      color: #444;
      margin-top: 8px;
    }

    .export-branding-logo {
      max-height: 32px;
      max-width: 120px;
      margin-bottom: 4px;
    }

    .export-grid {
      display: grid;
      grid-template-columns: repeat(${itemsPerRow}, 1fr);
      gap: ${compact ? '8px' : '12px'};
    }

    .export-step {
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      overflow: hidden;
      break-inside: avoid;
    }

    .export-step-number {
      background: #f5f5f5;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      color: #666;
    }

    .export-step-content {
      padding: ${compact ? '4px' : '8px'};
    }

    .export-step-image {
      width: 100%;
      height: ${compact ? '60px' : '80px'};
      object-fit: contain;
      background: #fafafa;
    }

    .export-step-placeholder {
      width: 100%;
      height: ${compact ? '60px' : '80px'};
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ccc;
      font-size: 24px;
    }

    .export-step-title {
      font-size: ${compact ? '9px' : '11px'};
      font-weight: 600;
      margin-bottom: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .export-step-subtitle {
      font-size: ${compact ? '8px' : '9px'};
      color: #888;
      font-style: italic;
      margin-bottom: 4px;
    }

    .export-step-duration {
      font-size: ${compact ? '8px' : '10px'};
      color: #666;
    }

    .export-step-rest {
      font-size: ${compact ? '7px' : '9px'};
      color: #999;
    }

    .export-step-instructions {
      font-size: 8px;
      color: #666;
      margin-top: 4px;
      line-height: 1.3;
    }

    .export-footer {
      margin-top: 20px;
      padding-top: 10px;
      border-top: 1px solid #e0e0e0;
      font-size: 10px;
      color: #888;
      text-align: center;
    }

    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  `
}

// ============================================================================
// RENDER PROPS TYPES
// ============================================================================

export interface ExportRenderProps<TStep extends BaseStep> {
  /** Current export options */
  options: ExportOptions
  /** Update export options */
  onOptionsChange: (updates: Partial<ExportOptions>) => void
  /** Ref to attach to the printable content container */
  contentRef: React.RefObject<HTMLDivElement>
  /** Trigger browser print dialog */
  print: () => void
  /** Formatted total duration string */
  totalDurationFormatted: string
  /** Total duration in seconds */
  totalDurationSeconds: number
  /** Number of steps */
  stepCount: number
  /** Sorted steps (by stepOrder) */
  sortedSteps: TStep[]
  /** Helper to format a duration */
  formatDuration: (seconds: number) => string
}

// ============================================================================
// EXPORT ENGINE COMPONENT
// ============================================================================

export function ExportEngine<TStep extends BaseStep>({
  title,
  description,
  steps,
  StepRenderer,
  options: initialOptions,
  branding,
  metadata,
}: ExportEngineProps<TStep>): React.ReactNode {
  // Merge initial options with defaults (static - options don't change in ExportEngine)
  const options = useMemo<ExportOptions>(
    () => ({ ...DEFAULT_EXPORT_OPTIONS, ...initialOptions }),
    [initialOptions]
  )

  // Sort steps by stepOrder
  const sortedSteps = useMemo(
    () => [...steps].sort((a, b) => a.stepOrder - b.stepOrder),
    [steps]
  )

  // Calculate totals
  const totalDurationSeconds = useMemo(
    () => calculateTotalDuration(sortedSteps),
    [sortedSteps]
  )
  const totalDurationFormatted = formatDuration(totalDurationSeconds)

  // Note: ExportEngine is a static render component. For interactive print with options,
  // use PrintDialog which provides handleOptionsChange and handlePrint callbacks.

  return (
    <div>
      {/* Header */}
      <div className="export-header">
        <h1>{title}</h1>
        {description && <div className="description">{description}</div>}
        <div className="meta">
          <span>{sortedSteps.length} items</span>
          <span>•</span>
          <span>{totalDurationFormatted}</span>
          {metadata &&
            Object.entries(metadata).map(([key, value]) => (
              <span key={key}>
                <span>•</span>
                <span>{value}</span>
              </span>
            ))}
        </div>
        {branding && (
          <div className="export-branding">
            {branding.logoUrl && (
              <img
                className="export-branding-logo"
                src={branding.logoUrl}
                alt={branding.name || 'Logo'}
              />
            )}
            {branding.name && <div>{branding.name}</div>}
          </div>
        )}
      </div>

      {/* Steps Grid */}
      <div className="export-grid">
        {sortedSteps.map((step, index) => (
          <div key={step.id} className="export-step">
            <div className="export-step-number">{index + 1}</div>
            <StepRenderer step={step} index={index} options={options} />
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="export-footer">
        {branding?.footerText && <div>{branding.footerText}</div>}
        <div>
          Generated on {new Date().toLocaleDateString()}
          {branding?.name && ` • ${branding.name}`}
        </div>
      </div>
    </div>
  )
}

// Re-export helper function for products
export { formatDuration as formatExportDuration }

// Re-export default options for convenience
export { DEFAULT_EXPORT_OPTIONS }

// ============================================================================
// PRINT DIALOG RENDER PROPS
// ============================================================================

export interface PrintDialogRenderProps<TStep extends BaseStep>
  extends ExportRenderProps<TStep> {
  /** Whether dialog is open */
  open: boolean
  /** Close the dialog */
  onClose: () => void
}

// ============================================================================
// PRINT DIALOG COMPONENT
// ============================================================================

/**
 * PrintDialog - Headless print dialog with options and preview
 *
 * Provides all state and handlers needed for a print dialog.
 * Products provide their own UI through the render function.
 *
 * @example
 * ```tsx
 * <PrintDialog
 *   open={showPrint}
 *   onClose={() => setShowPrint(false)}
 *   title={sequence.name}
 *   steps={steps}
 *   StepRenderer={PoseExportCard}
 * >
 *   {({ options, onOptionsChange, contentRef, print }) => (
 *     <Dialog open={true}>
 *       <DialogContent>
 *         <ExportOptionsForm options={options} onChange={onOptionsChange} />
 *         <PreviewContainer ref={contentRef}>
 *           <ExportEngine {...props} />
 *         </PreviewContainer>
 *       </DialogContent>
 *       <DialogActions>
 *         <Button onClick={print}>Print</Button>
 *       </DialogActions>
 *     </Dialog>
 *   )}
 * </PrintDialog>
 * ```
 */
export function PrintDialog<TStep extends BaseStep>({
  open,
  onClose,
  onPrint,
  title,
  description,
  steps,
  StepRenderer,
  options: initialOptions,
  branding,
  metadata,
  children,
}: PrintDialogProps<TStep> & {
  children?: (props: PrintDialogRenderProps<TStep>) => React.ReactNode
}): React.ReactNode {
  const contentRef = useRef<HTMLDivElement>(null)
  const [options, setOptions] = useState<ExportOptions>({
    ...DEFAULT_EXPORT_OPTIONS,
    ...initialOptions,
  })

  // Sort steps by stepOrder
  const sortedSteps = useMemo(
    () => [...steps].sort((a, b) => a.stepOrder - b.stepOrder),
    [steps]
  )

  // Calculate totals
  const totalDurationSeconds = useMemo(
    () => calculateTotalDuration(sortedSteps),
    [sortedSteps]
  )
  const totalDurationFormatted = formatDuration(totalDurationSeconds)

  // Options change handler
  const handleOptionsChange = useCallback((updates: Partial<ExportOptions>) => {
    setOptions((prev) => ({ ...prev, ...updates }))
  }, [])

  // Print handler
  const handlePrint = useCallback(() => {
    const printContent = contentRef.current
    if (!printContent) return

    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      console.warn('[PrintDialog] Pop-up blocked. Please allow pop-ups for printing.')
      return
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title}</title>
          <style>${generatePrintCSS(options)}</style>
        </head>
        <body>
          ${printContent.innerHTML}
        </body>
      </html>
    `)

    printWindow.document.close()
    printWindow.focus()

    // Wait for images to load before printing
    setTimeout(() => {
      printWindow.print()
      printWindow.close()
      onPrint?.()
    }, 500)
  }, [title, options, onPrint])

  // If using render prop pattern with children
  if (children) {
    if (!open) return null

    return children({
      open,
      onClose,
      options,
      onOptionsChange: handleOptionsChange,
      contentRef,
      print: handlePrint,
      totalDurationFormatted,
      totalDurationSeconds,
      stepCount: sortedSteps.length,
      sortedSteps,
      formatDuration,
    })
  }

  // Default render (headless - just the printable content)
  if (!open) return null

  return (
    <div ref={contentRef}>
      {/* Header */}
      <div className="export-header">
        <h1>{title}</h1>
        {description && <div className="description">{description}</div>}
        <div className="meta">
          <span>{sortedSteps.length} items</span>
          <span>•</span>
          <span>{totalDurationFormatted}</span>
          {metadata &&
            Object.entries(metadata).map(([key, value]) => (
              <span key={key}>
                <span>•</span>
                <span>{value}</span>
              </span>
            ))}
        </div>
        {branding && (
          <div className="export-branding">
            {branding.logoUrl && (
              <img
                className="export-branding-logo"
                src={branding.logoUrl}
                alt={branding.name || 'Logo'}
              />
            )}
            {branding.name && <div>{branding.name}</div>}
          </div>
        )}
      </div>

      {/* Steps Grid */}
      <div className="export-grid">
        {sortedSteps.map((step, index) => (
          <div key={step.id} className="export-step">
            <div className="export-step-number">{index + 1}</div>
            <StepRenderer step={step} index={index} options={options} />
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="export-footer">
        {branding?.footerText && <div>{branding.footerText}</div>}
        <div>
          Generated on {new Date().toLocaleDateString()}
          {branding?.name && ` • ${branding.name}`}
        </div>
      </div>
    </div>
  )
}
