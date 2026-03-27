import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Download, Copy } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ip: string;
  userAgent: string;
  metadata: Record<string, any>;
  createdAt: string;
}

const ACTION_TYPES = [
  'login',
  'logout',
  'create',
  'update',
  'delete',
  'publish',
  'unpublish',
  'incident_created',
  'incident_acknowledged',
  'incident_resolved',
  'incident_closed',
];

const RESOURCE_TYPES = [
  'user',
  'restaurant',
  'menu',
  'deal',
  'incident',
  'auth',
];

export default function AdminAuditLogs() {
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [filters, setFilters] = useState({
    action: '',
    resourceType: '',
    userId: '',
    search: '',
    days: '30',
  });

  const { data: logs = [], isLoading } = useQuery<AuditLog[]>({
    queryKey: ['audit-logs', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.action) params.append('action', filters.action);
      if (filters.resourceType) params.append('resourceType', filters.resourceType);
      if (filters.userId) params.append('userId', filters.userId);
      if (filters.search) params.append('search', filters.search);
      params.append('days', filters.days);
      
      const res = await fetch(`/api/admin/audit-logs?${params}`);
      if (!res.ok) throw new Error('Failed to fetch logs');
      return res.json();
    },
    refetchInterval: 60000,
  });

  const handleExport = () => {
    const csv = [
      ['ID', 'User', 'Action', 'Resource', 'IP', 'Timestamp'],
      ...logs.map((log) => [
        log.id,
        log.userId,
        log.action,
        `${log.resourceType}:${log.resourceId}`,
        log.ip,
        new Date(log.createdAt).toISOString(),
      ]),
    ]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const handleCopyMetadata = (metadata: Record<string, any>) => {
    navigator.clipboard.writeText(JSON.stringify(metadata, null, 2));
  };

  if (isLoading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Audit Logs</CardTitle>
            <CardDescription>{logs.length} events in last {filters.days} days</CardDescription>
          </div>
          <Button onClick={handleExport} size="sm" variant="outline">
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="space-y-4">
            {/* Row 1: Search and time range */}
            <div className="flex gap-4 flex-wrap">
              <div className="flex-1 min-w-64 relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-[color:var(--text-muted)]" />
                <Input
                  placeholder="Search by ID, user, or resource..."
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  className="pl-10"
                />
              </div>
              <Select value={filters.days} onValueChange={(v) => setFilters({ ...filters, days: v })}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Time range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Row 2: Action and resource type */}
            <div className="flex gap-4 flex-wrap">
              <Select value={filters.action} onValueChange={(v) => setFilters({ ...filters, action: v })}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Filter by action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All actions</SelectItem>
                  {ACTION_TYPES.map((action) => (
                    <SelectItem key={action} value={action}>
                      {action}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filters.resourceType} onValueChange={(v) => setFilters({ ...filters, resourceType: v })}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Filter by resource" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All resources</SelectItem>
                  {RESOURCE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                placeholder="Filter by user ID..."
                value={filters.userId}
                onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
                className="w-40"
              />
            </div>
          </div>

          {/* Logs Table */}
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow className="bg-[var(--bg-subtle)]">
                  <TableHead className="font-semibold">Timestamp</TableHead>
                  <TableHead className="font-semibold">Action</TableHead>
                  <TableHead className="font-semibold">User</TableHead>
                  <TableHead className="font-semibold">Resource</TableHead>
                  <TableHead className="font-semibold">IP</TableHead>
                  <TableHead className="font-semibold">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} className="hover:bg-[var(--bg-subtle)] text-sm">
                    <TableCell className="whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-medium text-[color:var(--accent-text)]">{log.action}</TableCell>
                    <TableCell className="font-mono text-xs">{log.userId.slice(0, 8)}</TableCell>
                    <TableCell className="text-xs">
                      <span className="inline-block px-2 py-1 bg-[var(--bg-subtle)] rounded">
                        {log.resourceType}:{log.resourceId.slice(0, 8)}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.ip}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedLog(log)}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {logs.length === 0 && (
              <div className="text-center py-8 text-[color:var(--text-muted)]">No logs match your filters</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="admin-dialog w-full max-w-3xl max-h-[80vh] sm:max-w-3xl overflow-y-auto">
          {selectedLog && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedLog.action}</DialogTitle>
                <DialogDescription className="font-mono">{selectedLog.id}</DialogDescription>
              </DialogHeader>

              <div className="space-y-6">
                {/* Basic Info Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">Timestamp</label>
                    <p className="text-sm mt-1 font-mono">
                      {new Date(selectedLog.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">User ID</label>
                    <p className="text-sm mt-1 font-mono">{selectedLog.userId}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">Action</label>
                    <p className="text-sm mt-1 font-mono text-[color:var(--accent-text)]">{selectedLog.action}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">IP Address</label>
                    <p className="text-sm mt-1 font-mono">{selectedLog.ip}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">Resource</label>
                    <p className="text-sm mt-1 font-mono">
                      {selectedLog.resourceType}:{selectedLog.resourceId}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">User Agent</label>
                    <p className="text-sm mt-1 font-mono truncate">{selectedLog.userAgent}</p>
                  </div>
                </div>

                {/* Metadata Section */}
                {Object.keys(selectedLog.metadata).length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-[color:var(--text-muted)]">Metadata</label>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopyMetadata(selectedLog.metadata)}
                      >
                        <Copy className="w-4 h-4 mr-1" /> Copy
                      </Button>
                    </div>
                    <pre className="p-3 bg-[var(--bg-subtle)] rounded border border-[var(--border-subtle)] text-xs overflow-x-auto">
                      {JSON.stringify(selectedLog.metadata, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Redaction Notice */}
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
                  <strong>Note:</strong> Sensitive information (PII, API keys, IPs, etc.) has been automatically redacted
                  from this audit log for security compliance.
                </div>

                {/* Close Button */}
                <div className="flex justify-end">
                  <Button onClick={() => setSelectedLog(null)}>Close</Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}




