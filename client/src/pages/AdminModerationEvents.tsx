import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ModerationEvent {
  id: string;
  eventType: string;
  severity: string;
  status: string;
  reason: string;
  description?: string;
  reportedUserId?: string;
  createdAt: string;
  actionTaken?: string;
}

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case 'low':
      return 'bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]';
    case 'medium':
      return 'bg-[color:var(--status-warning)]/15 text-[color:var(--status-warning)]';
    case 'high':
      return 'bg-[color:var(--status-warning)]/15 text-[color:var(--status-warning)]';
    case 'critical':
      return 'bg-[color:var(--status-error)]/12 text-[color:var(--status-error)]';
    default:
      return 'bg-[var(--bg-subtle)] text-[color:var(--text-primary)]';
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'open':
      return 'bg-[color:var(--status-error)]/12 text-[color:var(--status-error)]';
    case 'under-review':
      return 'bg-[color:var(--status-warning)]/15 text-[color:var(--status-warning)]';
    case 'dismissed':
      return 'bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]';
    case 'action-taken':
      return 'bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]';
    default:
      return 'bg-[var(--bg-subtle)] text-[color:var(--text-primary)]';
  }
};

export default function AdminModerationEvents() {
  const [selectedEvent, setSelectedEvent] = useState<ModerationEvent | null>(null);
  const [filters, setFilters] = useState({ status: '', severity: '' });
  const [action, setAction] = useState('');
  const queryClient = useQueryClient();

  const { data: events = [], isLoading } = useQuery<ModerationEvent[]>({
    queryKey: ['moderation-events', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) params.append('status', filters.status);
      if (filters.severity) params.append('severity', filters.severity);
      const res = await fetch(`/api/admin/moderation-events?${params}`);
      if (!res.ok) throw new Error('Failed to fetch events');
      return res.json();
    },
    refetchInterval: 30000,
  });

  const updateEventMutation = useMutation({
    mutationFn: async (data: { id: string; status: string; action: string }) => {
      const res = await fetch(`/api/admin/moderation-events/${data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: data.status, actionTaken: data.action }),
      });
      if (!res.ok) throw new Error('Failed to update event');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['moderation-events'] });
      setSelectedEvent(null);
      setAction('');
    },
  });

  const handleReviewEvent = (eventId: string, newStatus: string, actionTaken: string) => {
    updateEventMutation.mutate({ id: eventId, status: newStatus, action: actionTaken });
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Moderation Events</CardTitle>
          <CardDescription>{events.length} events</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex gap-4 flex-wrap">
            <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="under-review">Under Review</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
                <SelectItem value="action-taken">Action Taken</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.severity} onValueChange={(v) => setFilters({ ...filters, severity: v })}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter by severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Events Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id} className="hover:bg-[var(--bg-surface)]">
                    <TableCell className="font-medium text-sm">{event.eventType}</TableCell>
                    <TableCell>
                      <Badge className={getSeverityColor(event.severity)}>
                        {event.severity.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(event.status)}>
                        {event.status.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm max-w-xs truncate">{event.reason}</TableCell>
                    <TableCell className="text-sm">
                      {new Date(event.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedEvent(event);
                          setAction(event.actionTaken || '');
                        }}
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedEvent} onOpenChange={() => setSelectedEvent(null)}>
        <DialogContent className="admin-dialog w-full max-w-[95vw] sm:max-w-2xl">
          {selectedEvent && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedEvent.eventType}</DialogTitle>
                <DialogDescription>{selectedEvent.id}</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Event Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">Severity</label>
                    <Badge className={`${getSeverityColor(selectedEvent.severity)} mt-1`}>
                      {selectedEvent.severity.toUpperCase()}
                    </Badge>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">Status</label>
                    <Badge className={`${getStatusColor(selectedEvent.status)} mt-1`}>
                      {selectedEvent.status.toUpperCase()}
                    </Badge>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">Reason</label>
                    <p className="text-sm mt-1">{selectedEvent.reason}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">Created</label>
                    <p className="text-sm mt-1">{new Date(selectedEvent.createdAt).toLocaleString()}</p>
                  </div>
                </div>

                {/* Description */}
                {selectedEvent.description && (
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">Description</label>
                    <p className="text-sm mt-2 p-3 bg-[var(--bg-subtle)] rounded border border-[var(--border-subtle)]">{selectedEvent.description}</p>
                  </div>
                )}

                {/* Review Actions */}
                <div className="space-y-3 p-3 bg-[color:var(--accent-text)]/10 border border-[color:var(--accent-text)]/30 rounded">
                  <label className="text-sm font-medium text-[color:var(--text-muted)]">Take Action</label>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant={action === 'warning' ? 'default' : 'outline'}
                      onClick={() => setAction('warning')}
                    >
                      <AlertTriangle className="w-4 h-4 mr-1" /> Warning
                    </Button>
                    <Button
                      size="sm"
                      variant={action === 'content-removed' ? 'default' : 'outline'}
                      onClick={() => setAction('content-removed')}
                    >
                      <XCircle className="w-4 h-4 mr-1" /> Remove Content
                    </Button>
                    <Button
                      size="sm"
                      variant={action === 'suspension' ? 'default' : 'outline'}
                      onClick={() => setAction('suspension')}
                    >
                      Suspend User
                    </Button>
                    <Button
                      size="sm"
                      variant={action === 'dismissed' ? 'default' : 'outline'}
                      onClick={() => setAction('dismissed')}
                    >
                      <CheckCircle className="w-4 h-4 mr-1" /> Dismiss
                    </Button>
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    onClick={() => setSelectedEvent(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => handleReviewEvent(selectedEvent.id, 'action-taken', action)}
                    disabled={!action || updateEventMutation.isPending}
                  >
                    Confirm Action
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}




