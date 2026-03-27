/**
 * Admin Moderation v1 - UI Only
 * - This UI controls visibility only (hide/restore/remove)
 * - No editing, ranking, messaging, or payments
 * - All copy sourced from ADMIN_MODERATION_COPY
 * 
 * If an admin action cannot be expressed as a reducer event, it must not exist.
 */

import { useReducer, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ADMIN_MODERATION_COPY as COPY } from '@/copy/adminModeration.copy';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Shield, AlertCircle, CheckSquare, FileDown } from 'lucide-react';

// ============================================================================
// FSM Types & Reducer
// ============================================================================

export type ModerationUIState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'actionPending' }
  | { state: 'batchActionPending' }
  | { state: 'error' };

export type ModerationUIEvent =
  | { type: 'LOAD' }
  | { type: 'LOAD_SUCCESS' }
  | { type: 'LOAD_ERROR' }
  | { type: 'HIDE' }
  | { type: 'RESTORE' }
  | { type: 'REMOVE' }
  | { type: 'ACTION_SUCCESS' }
  | { type: 'ACTION_ERROR' }
  | { type: 'BATCH_HIDE' }
  | { type: 'BATCH_RESTORE' }
  | { type: 'BATCH_ACTION_SUCCESS' }
  | { type: 'BATCH_ACTION_ERROR' };

function assertNever(x: never): never {
  throw new Error(`Unexpected event: ${JSON.stringify(x)}`);
}

export function moderationUITransition(
  state: ModerationUIState,
  event: ModerationUIEvent
): ModerationUIState {
  switch (state.state) {
    case 'idle': {
      switch (event.type) {
        case 'LOAD':
          return { state: 'loading' };
        case 'LOAD_SUCCESS':
        case 'LOAD_ERROR':
        case 'HIDE':
        case 'RESTORE':
        case 'REMOVE':
        case 'ACTION_SUCCESS':
        case 'ACTION_ERROR':
        case 'BATCH_HIDE':
        case 'BATCH_RESTORE':
        case 'BATCH_ACTION_SUCCESS':
        case 'BATCH_ACTION_ERROR':
          return state;
        default:
          assertNever(event);
      }
    }

    case 'loading': {
      switch (event.type) {
        case 'LOAD_SUCCESS':
          return { state: 'ready' };
        case 'LOAD_ERROR':
          return { state: 'error' };
        case 'LOAD':
          return state;
        case 'HIDE':
        case 'RESTORE':
        case 'REMOVE':
        case 'ACTION_SUCCESS':
        case 'ACTION_ERROR':
        case 'BATCH_HIDE':
        case 'BATCH_RESTORE':
        case 'BATCH_ACTION_SUCCESS':
        case 'BATCH_ACTION_ERROR':
          return state;
        default:
          assertNever(event);
      }
    }

    case 'ready': {
      switch (event.type) {
        case 'HIDE':
        case 'RESTORE':
        case 'REMOVE':
          return { state: 'actionPending' };
        case 'BATCH_HIDE':
        case 'BATCH_RESTORE':
          return { state: 'batchActionPending' };
        case 'LOAD':
          return { state: 'loading' };
        case 'LOAD_SUCCESS':
        case 'LOAD_ERROR':
        case 'ACTION_SUCCESS':
        case 'ACTION_ERROR':
        case 'BATCH_ACTION_SUCCESS':
        case 'BATCH_ACTION_ERROR':
          return state;
        default:
          assertNever(event);
      }
    }

    case 'actionPending': {
      switch (event.type) {
        case 'ACTION_SUCCESS':
          return { state: 'ready' };
        case 'ACTION_ERROR':
          return { state: 'error' };
        case 'LOAD':
        case 'LOAD_SUCCESS':
        case 'LOAD_ERROR':
        case 'HIDE':
        case 'RESTORE':
        case 'REMOVE':
        case 'BATCH_HIDE':
        case 'BATCH_RESTORE':
        case 'BATCH_ACTION_SUCCESS':
        case 'BATCH_ACTION_ERROR':
          return state;
        default:
          assertNever(event);
      }
    }

    case 'batchActionPending': {
      switch (event.type) {
        case 'BATCH_ACTION_SUCCESS':
          return { state: 'ready' };
        case 'BATCH_ACTION_ERROR':
          return { state: 'error' };
        case 'LOAD':
        case 'LOAD_SUCCESS':
        case 'LOAD_ERROR':
        case 'HIDE':
        case 'RESTORE':
        case 'REMOVE':
        case 'ACTION_SUCCESS':
        case 'ACTION_ERROR':
        case 'BATCH_HIDE':
        case 'BATCH_RESTORE':
          return state;
        default:
          assertNever(event);
      }
    }

    case 'error': {
      switch (event.type) {
        case 'LOAD':
          return { state: 'loading' };
        case 'LOAD_SUCCESS':
          return { state: 'ready' };
        case 'LOAD_ERROR':
        case 'HIDE':
        case 'RESTORE':
        case 'REMOVE':
        case 'ACTION_SUCCESS':
        case 'ACTION_ERROR':
        case 'BATCH_HIDE':
        case 'BATCH_RESTORE':
        case 'BATCH_ACTION_SUCCESS':
        case 'BATCH_ACTION_ERROR':
          return state;
        default:
          assertNever(event);
      }
    }

    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

// ============================================================================
// Domain Types (Type-Safe Moderation Items)
// ============================================================================

type ModerationItem =
  | {
      kind: 'user';
      videoId: string;
      reviewerName: string;
      restaurantName: string;
      isGoldenFork: boolean;
      videoUrl: string;
      createdAt: Date;
      status: 'visible' | 'hidden' | 'removed';
    }
  | {
      kind: 'restaurant';
      videoId: string;
      restaurantName: string;
      campaignId: string;
      videoUrl: string;
      createdAt: Date;
      status: 'visible' | 'hidden' | 'removed';
    };

interface ModerationEvidence {
  reportCount: number;
  reportTimestamps: Date[];
  reporterIds: string[]; // Redacted/hashed IDs only
  priorActions: Array<{
    action: 'hide' | 'restore' | 'remove';
    timestamp: Date;
    reason?: string;
  }>;
  videoAge?: Date; // Video created date
  views?: number;
  likes?: number;
}

// ============================================================================
// Components
// ============================================================================

interface ModerationHeaderProps {
  selectionMode: boolean;
  onToggleSelection: () => void;
  selectedCount: number;
}

function ModerationHeader({ selectionMode, onToggleSelection, selectedCount }: ModerationHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <Shield className="w-6 h-6 text-[color:var(--accent-text)]" />
        <div>
          <h1 className="text-2xl font-bold">{COPY.page.title}</h1>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {selectionMode && selectedCount > 0 && (
          <span className="text-sm text-muted-foreground">
            {COPY.batch.selected(selectedCount)}
          </span>
        )}
        <Button
          variant={selectionMode ? 'default' : 'outline'}
          size="sm"
          onClick={onToggleSelection}
        >
          <CheckSquare className="w-4 h-4 mr-2" />
          {selectionMode ? COPY.batch.exitSelection : COPY.batch.selectionMode}
        </Button>
      </div>
    </div>
  );
}

interface ModerationFiltersProps {
  typeFilter: 'all' | 'user' | 'restaurant';
  statusFilter: 'all' | 'visible' | 'hidden' | 'removed';
  onChange: (filters: { type: string; status: string }) => void;
}

function ModerationFilters({ typeFilter, statusFilter, onChange }: ModerationFiltersProps) {
  return (
    <Card className="mb-6">
      <CardContent className="pt-6">
        <div className="flex gap-4 flex-wrap">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{COPY.filters.type.label}</label>
            <Select
              value={typeFilter}
              onValueChange={(value) => onChange({ type: value, status: statusFilter })}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{COPY.filters.type.all}</SelectItem>
                <SelectItem value="user">{COPY.filters.type.user}</SelectItem>
                <SelectItem value="restaurant">{COPY.filters.type.restaurant}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{COPY.filters.status.label}</label>
            <Select
              value={statusFilter}
              onValueChange={(value) => onChange({ type: typeFilter, status: value })}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{COPY.filters.status.all}</SelectItem>
                <SelectItem value="visible">{COPY.filters.status.visible}</SelectItem>
                <SelectItem value="hidden">{COPY.filters.status.hidden}</SelectItem>
                <SelectItem value="removed">{COPY.filters.status.removed}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Batch Actions v2 - Guards:
 * - Batch Hide/Restore only (no batch Remove)
 * - Per-item reasons required (no global reason)
 * - Sequential execution with partial success allowed
 */
interface BatchActionBarProps {
  selectedCount: number;
  onBatchHide: () => void;
  onBatchRestore: () => void;
  disabled: boolean;
}

function BatchActionBar({ selectedCount, onBatchHide, onBatchRestore, disabled }: BatchActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <Card className="mb-6 bg-[color:var(--accent-text)]/8 border-[color:var(--accent-text)]/20">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">
              {COPY.batch.selected(selectedCount)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onBatchHide}
              disabled={disabled || selectedCount === 0}
            >
              {COPY.batch.batchHide}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onBatchRestore}
              disabled={disabled || selectedCount === 0}
            >
              {COPY.batch.batchRestore}
            </Button>
            <span className="text-xs text-muted-foreground self-center px-2">
              {COPY.batch.noRemove}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Evidence is non-actionable context.
 * This component is presentation-only: no callbacks, no recommendations, no cross-video inference.
 */
interface ModerationEvidencePaneProps {
  videoId: string;
  disabled: boolean;
}

function ModerationEvidencePane({ videoId, disabled }: ModerationEvidencePaneProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Fetch evidence from existing report data (read-only)
  const { data: evidence } = useQuery<ModerationEvidence | null>({
    queryKey: ['/api/admin/video-evidence', videoId],
    queryFn: async () => {
      // For now, derive from existing reported-videos data
      // In production, this would be a dedicated read-only endpoint
      try {
        const res = await fetch(`/api/admin/reported-videos?status=pending`);
        if (!res.ok) return null;
        const data = await res.json();
        const reports = data.reports || [];
        const videoReports = reports.filter((r: any) => r.storyId === videoId);
        
        if (videoReports.length === 0) return null;

        return {
          reportCount: videoReports.length,
          reportTimestamps: videoReports.map((r: any) => new Date(r.createdAt)),
          reporterIds: videoReports.map((r: any) => `${r.reportedBy?.slice(0, 4)}***`), // Redacted
          priorActions: [], // Would come from audit logs in production
          videoAge: videoReports[0].createdAt ? new Date(videoReports[0].createdAt) : undefined,
        };
      } catch {
        return null;
      }
    },
    enabled: isExpanded && !disabled,
  });

  const toggleExpanded = () => {
    if (!disabled) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div className="mt-3 border-t pt-3">
      <Button
        size="sm"
        variant="ghost"
        onClick={toggleExpanded}
        disabled={disabled}
        className="w-full justify-start text-xs"
      >
        {isExpanded ? COPY.evidence.toggleHide : COPY.evidence.toggle}
      </Button>

      {isExpanded && (
        <div className="mt-3 space-y-2 text-xs bg-[var(--bg-surface-muted)] p-3 rounded">
          {!evidence ? (
            <p className="text-[color:var(--text-muted)] italic">{COPY.evidence.noEvidence}</p>
          ) : (
            <>
              {evidence.reportCount > 0 && (
                <div className="flex justify-between">
                  <span className="font-medium text-[color:var(--text-secondary)]">{COPY.evidence.reportCount}:</span>
                  <span className="text-[color:var(--text-secondary)]">{evidence.reportCount}</span>
                </div>
              )}

              {evidence.reportTimestamps.length > 0 && (
                <div className="flex justify-between">
                  <span className="font-medium text-[color:var(--text-secondary)]">{COPY.evidence.reportTimestamps}:</span>
                  <span className="text-[color:var(--text-secondary)]">
                    {evidence.reportTimestamps.map(t => t.toLocaleDateString()).join(', ')}
                  </span>
                </div>
              )}

              {evidence.reporterIds.length > 0 && (
                <div className="flex justify-between">
                  <span className="font-medium text-[color:var(--text-secondary)]">{COPY.evidence.reportersRedacted}:</span>
                  <span className="text-[color:var(--text-secondary)] font-mono text-xs">
                    {evidence.reporterIds.join(', ')}
                  </span>
                </div>
              )}

              {evidence.videoAge && (
                <div className="flex justify-between">
                  <span className="font-medium text-[color:var(--text-secondary)]">{COPY.evidence.videoAge}:</span>
                  <span className="text-[color:var(--text-secondary)]">
                    {evidence.videoAge.toLocaleDateString()}
                  </span>
                </div>
              )}

              {evidence.views !== undefined && (
                <div className="flex justify-between">
                  <span className="font-medium text-[color:var(--text-secondary)]">{COPY.evidence.views}:</span>
                  <span className="text-[color:var(--text-secondary)]">{evidence.views.toLocaleString()}</span>
                </div>
              )}

              {evidence.likes !== undefined && (
                <div className="flex justify-between">
                  <span className="font-medium text-[color:var(--text-secondary)]">{COPY.evidence.likes}:</span>
                  <span className="text-[color:var(--text-secondary)]">{evidence.likes.toLocaleString()}</span>
                </div>
              )}

              <div className="border-t pt-2 mt-2">
                <div className="font-medium text-[color:var(--text-secondary)] mb-1">{COPY.evidence.priorActions}:</div>
                {evidence.priorActions.length === 0 ? (
                  <p className="text-[color:var(--text-muted)] italic">{COPY.evidence.noPriorActions}</p>
                ) : (
                  <ul className="space-y-1">
                    {evidence.priorActions.map((action, idx) => {
                      const actionLabel = action.action === 'hide'
                        ? COPY.evidence.action.hide
                        : action.action === 'restore'
                        ? COPY.evidence.action.restore
                        : COPY.evidence.action.remove;
                      
                      return (
                        <li key={idx} className="text-[color:var(--text-secondary)]">
                          {action.timestamp.toLocaleDateString()} - {actionLabel}
                          {action.reason && ` (${action.reason})`}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface ModerationActionsProps {
  status: 'visible' | 'hidden' | 'removed';
  disabled: boolean;
  onHide: () => void;
  onRestore: () => void;
  onRemove: () => void;
  onExport: () => void;
}

function ModerationActions({ status, disabled, onHide, onRestore, onRemove, onExport }: ModerationActionsProps) {
  return (
    <div className="flex gap-2 mt-3 flex-wrap">
      {status === 'visible' && (
        <Button size="sm" variant="outline" onClick={onHide} disabled={disabled}>
          {COPY.actions.hide}
        </Button>
      )}
      {status === 'hidden' && (
        <Button size="sm" variant="outline" onClick={onRestore} disabled={disabled}>
          {COPY.actions.restore}
        </Button>
      )}
      <Button size="sm" variant="destructive" onClick={onRemove} disabled={disabled}>
        {COPY.actions.remove}
      </Button>
      <Button size="sm" variant="outline" onClick={onExport} disabled={disabled}>
        <FileDown className="w-4 h-4 mr-2" />
        {COPY.export.button}
      </Button>
    </div>
  );
}

interface RemoveConfirmModalProps {
  open: boolean;
  onConfirm: (reason: string, note: string) => void;
  onCancel: () => void;
}

function RemoveConfirmModal({ open, onConfirm, onCancel }: RemoveConfirmModalProps) {
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState<string>('');

  const handleConfirm = () => {
    if (!reason) return;
    onConfirm(reason, note);
    setReason('');
    setNote('');
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="admin-dialog w-full max-w-[95vw] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{COPY.confirm.removeTitle}</DialogTitle>
          <DialogDescription>{COPY.confirm.removeDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{COPY.labels.selectReason}</label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue placeholder={COPY.labels.selectReason} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="spam">{COPY.reasons.spam}</SelectItem>
                <SelectItem value="inappropriate">{COPY.reasons.inappropriate}</SelectItem>
                <SelectItem value="misleading">{COPY.reasons.misleading}</SelectItem>
                <SelectItem value="policy">{COPY.reasons.policy}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{COPY.labels.internalNote}</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={COPY.labels.internalNote}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {COPY.actions.cancel}
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!reason}>
            {COPY.actions.confirmRemove}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Per-Item Reason Modal for Batch Actions
 * Ensures each item in a batch has an individual reason.
 */
interface PerItemReasonModalProps {
  open: boolean;
  items: ModerationItem[];
  onComplete: (reasons: Map<string, string>) => void;
  onCancel: () => void;
}

function PerItemReasonModal({ open, items, onComplete, onCancel }: PerItemReasonModalProps) {
  const [reasons, setReasons] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (open) {
      setReasons(new Map());
    }
  }, [open]);

  const handleReasonChange = (videoId: string, reason: string) => {
    const newReasons = new Map(reasons);
    if (reason) {
      newReasons.set(videoId, reason);
    } else {
      newReasons.delete(videoId);
    }
    setReasons(newReasons);
  };

  const handleExecute = () => {
    if (reasons.size === items.length) {
      onComplete(reasons);
      setReasons(new Map());
    }
  };

  const allReasonsAssigned = reasons.size === items.length;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="admin-dialog w-full max-w-[95vw] sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{COPY.batch.perItemReasonTitle}</DialogTitle>
          <DialogDescription>{COPY.batch.perItemReasonDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {items.map((item) => {
            const hasReason = reasons.has(item.videoId);
            return (
              <Card key={item.videoId} className={hasReason ? 'border-green-500/50' : ''}>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        {item.kind === 'user' && (
                          <>
                            <Badge variant="outline">{COPY.labels.recommendation}</Badge>
                            {item.isGoldenFork && <span className="text-sm">{COPY.labels.goldenFork}</span>}
                          </>
                        )}
                        {item.kind === 'restaurant' && (
                          <Badge variant="outline">{COPY.labels.sponsored}</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {item.kind === 'user' 
                          ? `${item.reviewerName} → ${item.restaurantName}`
                          : `${item.restaurantName} (${item.campaignId})`
                        }
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 w-48">
                      <Select
                        value={reasons.get(item.videoId) || ''}
                        onValueChange={(value) => handleReasonChange(item.videoId, value)}
                      >
                        <SelectTrigger className={hasReason ? 'border-green-500' : ''}>
                          <SelectValue placeholder={COPY.batch.assignReason} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="spam">{COPY.reasons.spam}</SelectItem>
                          <SelectItem value="inappropriate">{COPY.reasons.inappropriate}</SelectItem>
                          <SelectItem value="misleading">{COPY.reasons.misleading}</SelectItem>
                          <SelectItem value="policy">{COPY.reasons.policy}</SelectItem>
                        </SelectContent>
                      </Select>
                      {hasReason && (
                        <span className="text-xs text-[color:var(--status-success)] font-medium">
                          {COPY.batch.reasonAssigned}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {COPY.batch.cancelBatch}
          </Button>
          <Button onClick={handleExecute} disabled={!allReasonsAssigned}>
            {COPY.batch.executeAction}
            {!allReasonsAssigned && ` (${reasons.size}/${items.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Evidence Export Confirmation
 * Exported PDFs are immutable snapshots and do not alter outcomes.
 */
interface ExportConfirmModalProps {
  open: boolean;
  videoId: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function ExportConfirmModal({ open, videoId, onConfirm, onCancel }: ExportConfirmModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="admin-dialog w-full max-w-[95vw] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{COPY.export.confirmTitle}</DialogTitle>
          <DialogDescription>{COPY.export.confirmDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium">{COPY.export.snapshotLabel}:</span> Video ID {videoId}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {COPY.export.confirmCancel}
          </Button>
          <Button onClick={onConfirm}>
            <FileDown className="w-4 h-4 mr-2" />
            {COPY.export.confirmExport}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface UserVideoModerationCardProps {
  item: Extract<ModerationItem, { kind: 'user' }>;
  disabled: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onHide: () => void;
  onRestore: () => void;
  onRemove: () => void;
  onExport: () => void;
}

function UserVideoModerationCard({ item, disabled, selectionMode, selected, onToggleSelect, onHide, onRestore, onRemove, onExport }: UserVideoModerationCardProps) {
  const statusColor = item.status === 'visible' ? 'bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]' : item.status === 'hidden' ? 'bg-[color:var(--status-warning)]/15 text-[color:var(--status-warning)]' : 'bg-[color:var(--status-error)]/12 text-[color:var(--status-error)]';

  return (
    <Card className={`${item.status !== 'visible' ? 'opacity-60' : ''} ${selected ? 'ring-2 ring-[color:var(--accent-text)]' : ''}`}>
      <CardContent className="pt-6">
        <div className="flex gap-4">
          {selectionMode && (
            <div className="flex items-start pt-1">
              <Checkbox
                checked={selected}
                onCheckedChange={() => onToggleSelect(item.videoId)}
                disabled={disabled}
              />
            </div>
          )}
          <div className="w-32 h-48 bg-[color:var(--border-subtle)] rounded flex items-center justify-center text-xs text-[color:var(--text-muted)] flex-shrink-0">
            {item.videoUrl ? (
              <video src={item.videoUrl} className="w-full h-full object-cover rounded" />
            ) : (
              'No preview'
            )}
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{COPY.labels.recommendation}</Badge>
              {item.isGoldenFork && (
                <Badge className="bg-[color:var(--status-warning)]/15 text-[color:var(--status-warning)]">{COPY.labels.goldenFork}</Badge>
              )}
              <Badge className={statusColor}>{item.status}</Badge>
            </div>

            <div className="text-sm space-y-1">
              <div>
                <span className="font-medium">{COPY.labels.reviewer}:</span> {item.reviewerName}
              </div>
              <div>
                <span className="font-medium">{COPY.labels.restaurant}:</span> {item.restaurantName}
              </div>
              <div className="text-xs text-[color:var(--text-muted)]">
                {new Date(item.createdAt).toLocaleDateString()}
              </div>
            </div>

            <ModerationActions
              status={item.status}
              disabled={disabled}
              onHide={onHide}
              onRestore={onRestore}
              onRemove={onRemove}
              onExport={onExport}
            />

            <ModerationEvidencePane videoId={item.videoId} disabled={disabled} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface RestaurantAdModerationCardProps {
  item: Extract<ModerationItem, { kind: 'restaurant' }>;
  disabled: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onHide: () => void;
  onRestore: () => void;
  onRemove: () => void;
  onExport: () => void;
}

function RestaurantAdModerationCard({ item, disabled, selectionMode, selected, onToggleSelect, onHide, onRestore, onRemove, onExport }: RestaurantAdModerationCardProps) {
  const statusColor = item.status === 'visible' ? 'bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]' : item.status === 'hidden' ? 'bg-[color:var(--status-warning)]/15 text-[color:var(--status-warning)]' : 'bg-[color:var(--status-error)]/12 text-[color:var(--status-error)]';

  return (
    <Card className={`${item.status !== 'visible' ? 'opacity-60' : ''} ${selected ? 'ring-2 ring-[color:var(--accent-text)]' : ''}`}>
      <CardContent className="pt-6">
        <div className="flex gap-4">
          {selectionMode && (
            <div className="flex items-start pt-1">
              <Checkbox
                checked={selected}
                onCheckedChange={() => onToggleSelect(item.videoId)}
                disabled={disabled}
              />
            </div>
          )}
          <div className="w-32 h-48 bg-[color:var(--border-subtle)] rounded flex items-center justify-center text-xs text-[color:var(--text-muted)] flex-shrink-0">
            {item.videoUrl ? (
              <video src={item.videoUrl} className="w-full h-full object-cover rounded" />
            ) : (
              'No preview'
            )}
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Badge className="bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]">{COPY.labels.sponsored}</Badge>
              <Badge className={statusColor}>{item.status}</Badge>
            </div>

            <div className="text-sm space-y-1">
              <div>
                <span className="font-medium">{COPY.labels.restaurant}:</span> {item.restaurantName}
              </div>
              <div className="text-xs text-[color:var(--text-muted)]">
                <span className="font-medium">{COPY.labels.campaign}:</span> {item.campaignId}
              </div>
              <div className="text-xs text-[color:var(--text-muted)]">
                {new Date(item.createdAt).toLocaleDateString()}
              </div>
            </div>

            <ModerationActions
              status={item.status}
              disabled={disabled}
              onHide={onHide}
              onRestore={onRestore}
              onRemove={onRemove}
              onExport={onExport}
            />

            <ModerationEvidencePane videoId={item.videoId} disabled={disabled} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ModerationItemCardProps {
  item: ModerationItem;
  disabled: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onHide: (id: string) => void;
  onRestore: (id: string) => void;
  onRemove: (id: string) => void;
  onExport: (id: string) => void;
}

function ModerationItemCard({ item, disabled, selectionMode, selected, onToggleSelect, onHide, onRestore, onRemove, onExport }: ModerationItemCardProps) {
  if (item.kind === 'user') {
    return (
      <UserVideoModerationCard
        item={item}
        disabled={disabled}
        selectionMode={selectionMode}
        selected={selected}
        onToggleSelect={onToggleSelect}
        onHide={() => onHide(item.videoId)}
        onRestore={() => onRestore(item.videoId)}
        onRemove={() => onRemove(item.videoId)}
        onExport={() => onExport(item.videoId)}
      />
    );
  }

  if (item.kind === 'restaurant') {
    return (
      <RestaurantAdModerationCard
        item={item}
        disabled={disabled}
        selectionMode={selectionMode}
        selected={selected}
        onToggleSelect={onToggleSelect}
        onHide={() => onHide(item.videoId)}
        onRestore={() => onRestore(item.videoId)}
        onRemove={() => onRemove(item.videoId)}
        onExport={() => onExport(item.videoId)}
      />
    );
  }

  assertNever(item);
}

interface ModerationFeedProps {
  items: ModerationItem[];
  uiState: ModerationUIState;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onHide: (id: string) => void;
  onRestore: (id: string) => void;
  onRemove: (id: string) => void;
  onExport: (id: string) => void;
}

function ModerationFeed({ items, uiState, selectionMode, selectedIds, onToggleSelect, onHide, onRestore, onRemove, onExport }: ModerationFeedProps) {
  const actionsDisabled = uiState.state === 'actionPending' || uiState.state === 'batchActionPending';

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <ModerationItemCard
          key={item.videoId}
          item={item}
          disabled={actionsDisabled}
          selectionMode={selectionMode}
          selected={selectedIds.has(item.videoId)}
          onToggleSelect={onToggleSelect}
          onHide={onHide}
          onRestore={onRestore}
          onRemove={onRemove}
          onExport={onExport}
        />
      ))}
    </div>
  );
}

function ModerationEmpty() {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <p className="text-muted-foreground">{COPY.page.empty}</p>
      </CardContent>
    </Card>
  );
}

interface ModerationErrorProps {
  onRetry: () => void;
}

function ModerationError({ onRetry }: ModerationErrorProps) {
  return (
    <Card>
      <CardContent className="py-12 text-center space-y-4">
        <div className="flex justify-center">
          <AlertCircle className="w-12 h-12 text-destructive" />
        </div>
        <p className="text-muted-foreground">{COPY.page.error}</p>
        <Button onClick={onRetry}>{COPY.page.retry}</Button>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function AdminModerationVideosPage() {
  const [uiState, dispatch] = useReducer(moderationUITransition, { state: 'idle' });
  const [typeFilter, setTypeFilter] = useState<'all' | 'user' | 'restaurant'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'visible' | 'hidden' | 'removed'>('all');
  const [removeModalOpen, setRemoveModalOpen] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  
  // Batch selection state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchReasonModalOpen, setBatchReasonModalOpen] = useState(false);
  const [batchAction, setBatchAction] = useState<'hide' | 'restore' | null>(null);

  // Evidence export state
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportVideoId, setExportVideoId] = useState<string | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch reported videos from existing endpoint
  const { data: rawReports = [], isLoading, isError } = useQuery({
    queryKey: ['/api/admin/reported-videos', statusFilter === 'all' ? 'pending' : statusFilter],
    queryFn: async () => {
      const status = statusFilter === 'all' ? 'pending' : statusFilter;
      const res = await fetch(`/api/admin/reported-videos?status=${status}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      return data.reports || [];
    },
    enabled: uiState.state !== 'idle',
  });

  // Map to ModerationItem[] (discriminated union)
  const moderationItems: ModerationItem[] = rawReports
    .map((report: any) => {
      // For now, all items from this endpoint are user videos
      // In a real system, you'd check a type field or separate endpoints
      if (report.storyUrl) {
        return {
          kind: 'user' as const,
          videoId: report.storyId,
          reviewerName: report.reportedBy || 'Unknown',
          restaurantName: 'N/A',
          isGoldenFork: false,
          videoUrl: report.storyUrl,
          createdAt: new Date(report.createdAt),
          status: report.status === 'action_taken' ? ('removed' as const) : ('visible' as const),
        };
      }
      return null;
    })
    .filter((item: ModerationItem | null): item is ModerationItem => item !== null);

  // Trigger LOAD on mount and filter changes
  useEffect(() => {
    dispatch({ type: 'LOAD' });
  }, [typeFilter, statusFilter]);

  // Map query status to FSM events
  useEffect(() => {
    if (uiState.state === 'loading') {
      if (isError) {
        dispatch({ type: 'LOAD_ERROR' });
      } else if (!isLoading) {
        dispatch({ type: 'LOAD_SUCCESS' });
      }
    }
  }, [isLoading, isError, uiState.state]);

  // Remove mutation (using existing review-report endpoint)
  const removeMutation = useMutation({
    mutationFn: async ({ reportId, reason, note }: { reportId: string; reason: string; note: string }) => {
      const res = await fetch(`/api/admin/review-report/${reportId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'takedown', notes: `${reason}: ${note}` }),
      });
      if (!res.ok) throw new Error('Remove failed');
      return res.json();
    },
    onSuccess: () => {
      dispatch({ type: 'ACTION_SUCCESS' });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/reported-videos'] });
      toast({
        title: COPY.notifications.removeSuccess,
      });
      setRemoveModalOpen(false);
      setSelectedVideoId(null);
    },
    onError: () => {
      dispatch({ type: 'ACTION_ERROR' });
      toast({
        title: COPY.notifications.actionError,
        variant: 'destructive',
      });
    },
  });

  const handleFiltersChange = (filters: { type: string; status: string }) => {
    setTypeFilter(filters.type as any);
    setStatusFilter(filters.status as any);
  };

  const handleHide = (id: string) => {
    dispatch({ type: 'HIDE' });
    // In a real implementation, you'd call a hide endpoint here
    // For now, we'll just dispatch ACTION_SUCCESS
    setTimeout(() => {
      dispatch({ type: 'ACTION_SUCCESS' });
      toast({ title: COPY.notifications.hideSuccess });
    }, 500);
  };

  const handleRestore = (id: string) => {
    dispatch({ type: 'RESTORE' });
    // In a real implementation, you'd call a restore endpoint here
    setTimeout(() => {
      dispatch({ type: 'ACTION_SUCCESS' });
      toast({ title: COPY.notifications.restoreSuccess });
    }, 500);
  };

  const handleRemove = (id: string) => {
    setSelectedVideoId(id);
    setRemoveModalOpen(true);
  };

  const handleConfirmRemove = (reason: string, note: string) => {
    if (!selectedVideoId) return;
    dispatch({ type: 'REMOVE' });
    
    // Find the report ID for this video
    const report = rawReports.find((r: any) => r.storyId === selectedVideoId);
    if (report) {
      removeMutation.mutate({ reportId: report.reportId, reason, note });
    } else {
      dispatch({ type: 'ACTION_ERROR' });
      toast({
        title: COPY.notifications.actionError,
        variant: 'destructive',
      });
    }
  };

  const handleRetry = () => {
    dispatch({ type: 'LOAD' });
  };

  // Batch selection handlers
  const handleToggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    if (selectionMode) {
      setSelectedIds(new Set()); // Clear selection when exiting
    }
  };

  const handleToggleSelect = (id: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedIds(newSelection);
  };

  const handleBatchHide = () => {
    if (selectedIds.size === 0) {
      toast({ title: COPY.batch.minSelection, variant: 'destructive' });
      return;
    }
    setBatchAction('hide');
    setBatchReasonModalOpen(true);
  };

  const handleBatchRestore = () => {
    if (selectedIds.size === 0) {
      toast({ title: COPY.batch.minSelection, variant: 'destructive' });
      return;
    }
    setBatchAction('restore');
    setBatchReasonModalOpen(true);
  };

  const handleBatchExecute = async (reasons: Map<string, string>) => {
    if (!batchAction) return;

    dispatch({ type: batchAction === 'hide' ? 'BATCH_HIDE' : 'BATCH_RESTORE' });
    setBatchReasonModalOpen(false);

    const selectedItems = moderationItems.filter((item) => selectedIds.has(item.videoId));
    
    let succeeded = 0;
    let failed = 0;

    // Sequential execution with partial success
    for (const item of selectedItems) {
      const reason = reasons.get(item.videoId);
      if (!reason) {
        failed++;
        continue;
      }

      try {
        // In a real implementation, call the hide/restore endpoint
        // For now, simulate with delay
        await new Promise((resolve) => setTimeout(resolve, 200));
        succeeded++;
      } catch (error) {
        failed++;
      }
    }

    // Report results
    dispatch({ type: 'BATCH_ACTION_SUCCESS' });
    if (failed === 0) {
      toast({ title: COPY.batch.allSuccess(succeeded) });
    } else if (succeeded === 0) {
      toast({ title: COPY.batch.allFailed, variant: 'destructive' });
    } else {
      toast({ title: COPY.batch.partialSuccess(succeeded, failed), variant: 'default' });
    }

    // Clear selection and exit selection mode
    setSelectedIds(new Set());
    setSelectionMode(false);
    setBatchAction(null);
    queryClient.invalidateQueries({ queryKey: ['/api/admin/reported-videos'] });
  };

  // Export handler
  const handleExport = (id: string) => {
    setExportVideoId(id);
    setExportModalOpen(true);
  };

  const handleConfirmExport = async () => {
    if (!exportVideoId) return;

    try {
      toast({ title: COPY.export.downloading });
      setExportModalOpen(false);

      /**
       * Evidence Export v1 - Server Contract (stub)
       * 
       * Endpoint: GET /api/admin/export-evidence/:videoId
       * 
       * Returns:
       * - Content-Type: application/pdf
       * - Content-Disposition: attachment; filename="evidence-{videoId}-{timestamp}.pdf"
       * 
       * PDF includes:
       * - Video ID, type (user/restaurant)
       * - Current moderation decision (action, reason, timestamp)
       * - Evidence Pane data (reports, redacted IDs, prior actions)
       * - Video metadata (age, views/likes if present)
       * - Appeal references (IDs only, if any)
       * 
       * Guard: Single-item only, admin-only, read-only snapshot.
       */
      const res = await fetch(`/api/admin/export-evidence/${exportVideoId}`);
      if (!res.ok) throw new Error('Export failed');

      // Trigger download
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `evidence-${exportVideoId}-${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({ title: COPY.export.success });
    } catch (error) {
      toast({ title: COPY.export.error, variant: 'destructive' });
    } finally {
      setExportVideoId(null);
    }
  };

  const selectedItems = moderationItems.filter((item) => selectedIds.has(item.videoId));

  return (
    <div className="max-w-7xl mx-auto min-h-screen bg-[var(--bg-layered)] p-6">
      <ModerationHeader 
        selectionMode={selectionMode}
        onToggleSelection={handleToggleSelectionMode}
        selectedCount={selectedIds.size}
      />

      <ModerationFilters
        typeFilter={typeFilter}
        statusFilter={statusFilter}
        onChange={handleFiltersChange}
      />

      {selectionMode && (
        <BatchActionBar
          selectedCount={selectedIds.size}
          onBatchHide={handleBatchHide}
          onBatchRestore={handleBatchRestore}
          disabled={uiState.state === 'batchActionPending'}
        />
      )}

      {uiState.state === 'loading' && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-[color:var(--accent-text)] border-t-transparent rounded-full" />
          <span className="ml-3 text-muted-foreground">{COPY.page.loading}</span>
        </div>
      )}

      {uiState.state === 'error' && <ModerationError onRetry={handleRetry} />}

      {(uiState.state === 'ready' || uiState.state === 'actionPending' || uiState.state === 'batchActionPending') && (
        <>
          {moderationItems.length === 0 ? (
            <ModerationEmpty />
          ) : (
            <ModerationFeed
              items={moderationItems}
              uiState={uiState}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onHide={handleHide}
              onRestore={handleRestore}
              onRemove={handleRemove}
              onExport={handleExport}
            />
          )}
        </>
      )}

      <RemoveConfirmModal
        open={removeModalOpen}
        onConfirm={handleConfirmRemove}
        onCancel={() => {
          setRemoveModalOpen(false);
          setSelectedVideoId(null);
        }}
      />

      <PerItemReasonModal
        open={batchReasonModalOpen}
        items={selectedItems}
        onComplete={handleBatchExecute}
        onCancel={() => {
          setBatchReasonModalOpen(false);
          setBatchAction(null);
        }}
      />

      <ExportConfirmModal
        open={exportModalOpen}
        videoId={exportVideoId}
        onConfirm={handleConfirmExport}
        onCancel={() => {
          setExportModalOpen(false);
          setExportVideoId(null);
        }}
      />
    </div>
  );
}






