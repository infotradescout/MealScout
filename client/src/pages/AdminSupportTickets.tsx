import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, MessageSquare, Clock, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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

interface SupportTicket {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  userId: string;
  createdAt: string;
  description: string;
  adminNotes?: string;
}

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case 'critical':
      return 'bg-[color:var(--status-error)]/12 text-[color:var(--status-error)]';
    case 'high':
      return 'bg-orange-100 text-orange-800';
    case 'normal':
      return 'bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]';
    case 'low':
      return 'bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]';
    default:
      return 'bg-[var(--bg-subtle)] text-[color:var(--text-primary)]';
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'open':
      return 'bg-[color:var(--status-error)]/12 text-[color:var(--status-error)]';
    case 'in-progress':
      return 'bg-yellow-100 text-yellow-800';
    case 'resolved':
      return 'bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]';
    case 'closed':
      return 'bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]';
    default:
      return 'bg-[var(--bg-subtle)] text-[color:var(--text-primary)]';
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'open':
      return <AlertCircle className="w-4 h-4" />;
    case 'in-progress':
      return <Clock className="w-4 h-4" />;
    case 'resolved':
      return <CheckCircle className="w-4 h-4" />;
    case 'closed':
      return <CheckCircle className="w-4 h-4" />;
    default:
      return null;
  }
};

export default function AdminSupportTickets() {
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [filters, setFilters] = useState({ status: 'all', priority: 'all' });
  const [adminNotes, setAdminNotes] = useState('');
  const queryClient = useQueryClient();

  const { data: tickets = [], isLoading } = useQuery<SupportTicket[]>({
    queryKey: ['support-tickets', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status !== 'all') params.append('status', filters.status);
      if (filters.priority !== 'all') params.append('priority', filters.priority);
      const res = await fetch(`/api/admin/support-tickets?${params}`);
      if (!res.ok) throw new Error('Failed to fetch tickets');
      return res.json();
    },
    refetchInterval: 30000,
  });

  const updateTicketMutation = useMutation({
    mutationFn: async (data: { id: string; status: string; notes: string }) => {
      const res = await fetch(`/api/admin/support-tickets/${data.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: data.status, adminNotes: data.notes }),
      });
      if (!res.ok) throw new Error('Failed to update ticket');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
      setSelectedTicket(null);
      setAdminNotes('');
    },
  });

  const handleStatusChange = (ticketId: string, newStatus: string) => {
    updateTicketMutation.mutate({ id: ticketId, status: newStatus, notes: adminNotes });
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Support Tickets</CardTitle>
          <CardDescription>{tickets.length} tickets</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex gap-4 flex-wrap">
            <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in-progress">In Progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.priority} onValueChange={(v) => setFilters({ ...filters, priority: v })}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter by priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Tickets Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <TableRow key={ticket.id} className="hover:bg-[var(--bg-surface)]">
                    <TableCell className="font-medium">{ticket.subject}</TableCell>
                    <TableCell className="text-sm">{ticket.category}</TableCell>
                    <TableCell>
                      <Badge className={getPriorityColor(ticket.priority)}>
                        {ticket.priority.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(ticket.status)}>
                        {getStatusIcon(ticket.status)}
                        <span className="ml-1">{ticket.status.toUpperCase()}</span>
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {new Date(ticket.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedTicket(ticket);
                          setAdminNotes(ticket.adminNotes || '');
                        }}
                      >
                        View
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
      <Dialog open={!!selectedTicket} onOpenChange={() => setSelectedTicket(null)}>
        <DialogContent className="admin-dialog w-full max-w-[95vw] sm:max-w-2xl">
          {selectedTicket && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedTicket.subject}</DialogTitle>
                <DialogDescription>{selectedTicket.id}</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Ticket Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">Category</label>
                    <p className="text-sm mt-1">{selectedTicket.category}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">Priority</label>
                    <Badge className={`${getPriorityColor(selectedTicket.priority)} mt-1`}>
                      {selectedTicket.priority.toUpperCase()}
                    </Badge>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">Status</label>
                    <Badge className={`${getStatusColor(selectedTicket.status)} mt-1`}>
                      {selectedTicket.status.toUpperCase()}
                    </Badge>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">Created</label>
                    <p className="text-sm mt-1">{new Date(selectedTicket.createdAt).toLocaleString()}</p>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="text-sm font-medium text-[color:var(--text-muted)]">Description</label>
                  <p className="text-sm mt-2 p-3 bg-[var(--bg-subtle)] rounded border">{selectedTicket.description}</p>
                </div>

                {/* Admin Notes */}
                <div>
                  <label className="text-sm font-medium text-[color:var(--text-muted)]">Admin Notes</label>
                  <Textarea
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    placeholder="Add internal notes..."
                    className="mt-2 min-h-24"
                  />
                </div>

                {/* Status Update */}
                <div>
                  <label className="text-sm font-medium text-[color:var(--text-muted)]">Update Status</label>
                  <div className="flex gap-2 mt-2">
                    {selectedTicket.status === 'open' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handleStatusChange(selectedTicket.id, 'in-progress')}
                          disabled={updateTicketMutation.isPending}
                        >
                          Mark In Progress
                        </Button>
                      </>
                    )}
                    {selectedTicket.status === 'in-progress' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handleStatusChange(selectedTicket.id, 'resolved')}
                          disabled={updateTicketMutation.isPending}
                        >
                          Mark Resolved
                        </Button>
                      </>
                    )}
                    {selectedTicket.status === 'resolved' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handleStatusChange(selectedTicket.id, 'closed')}
                          disabled={updateTicketMutation.isPending}
                        >
                          Close Ticket
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAdminNotes('');
                        setSelectedTicket(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}




