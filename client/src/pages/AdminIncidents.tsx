import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiUrl } from "@/lib/api";
import { AlertCircle, CheckCircle, Clock, X, Download, Shield, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

type Severity = 'low' | 'medium' | 'high' | 'critical';
type IncidentStatus = 'new' | 'acknowledged' | 'resolved' | 'closed';

interface Incident {
  id: string;
  ruleId: string;
  severity: Severity;
  status: IncidentStatus;
  userId: string;
  metadata: Record<string, any>;
  createdAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  closedAt?: string;
  closedBy?: string;
  signatureHash: string;
}

interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ip: string;
  userAgent: string;
  timestamp: string;
  metadata: Record<string, any>;
}

const getSeverityColor = (severity: Severity) => {
  switch (severity) {
    case 'low':
      return 'bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]';
    case 'medium':
      return 'bg-yellow-100 text-yellow-800';
    case 'high':
      return 'bg-orange-100 text-orange-800';
    case 'critical':
      return 'bg-[color:var(--status-error)]/12 text-[color:var(--status-error)]';
  }
};

const getSeverityIcon = (severity: Severity) => {
  switch (severity) {
    case 'low':
      return <AlertCircle className="w-4 h-4" />;
    case 'medium':
      return <AlertTriangle className="w-4 h-4" />;
    case 'high':
      return <AlertTriangle className="w-4 h-4" />;
    case 'critical':
      return <Shield className="w-4 h-4" />;
  }
};

const getStatusColor = (status: IncidentStatus) => {
  switch (status) {
    case 'new':
      return 'bg-[color:var(--status-error)]/12 text-[color:var(--status-error)]';
    case 'acknowledged':
      return 'bg-yellow-100 text-yellow-800';
    case 'resolved':
      return 'bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]';
    case 'closed':
      return 'bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]';
  }
};

const getStatusIcon = (status: IncidentStatus) => {
  switch (status) {
    case 'new':
      return <AlertCircle className="w-4 h-4" />;
    case 'acknowledged':
      return <Clock className="w-4 h-4" />;
    case 'resolved':
      return <CheckCircle className="w-4 h-4" />;
    case 'closed':
      return <X className="w-4 h-4" />;
  }
};

export default function AdminIncidents() {
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [filter, setFilter] = useState<{
    status?: IncidentStatus;
    severity?: Severity;
    search?: string;
  }>({});
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const { data: incidents = [], isLoading, refetch } = useQuery<Incident[]>({
    queryKey: ['incidents'],
    queryFn: async () => {
      const res = await fetch(apiUrl('/api/incidents'), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch incidents');
      return res.json();
    },
    refetchInterval: 10000, // Refresh every 10s
  });

  const filteredIncidents = useMemo(() => {
    let result = incidents;

    if (filter.status) {
      result = result.filter(i => i.status === filter.status);
    }
    if (filter.severity) {
      result = result.filter(i => i.severity === filter.severity);
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      result = result.filter(i =>
        i.id.toLowerCase().includes(search) ||
        i.ruleId.toLowerCase().includes(search)
      );
    }

    return result.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [incidents, filter]);

  const stats = useMemo(() => {
    return {
      total: incidents.length,
      new: incidents.filter(i => i.status === 'new').length,
      acknowledged: incidents.filter(i => i.status === 'acknowledged').length,
      resolved: incidents.filter(i => i.status === 'resolved').length,
      critical: incidents.filter(i => i.severity === 'critical').length,
    };
  }, [incidents]);

  const handleViewDetails = async (incident: Incident) => {
    setSelectedIncident(incident);
    try {
      const res = await fetch(apiUrl(`/api/incidents/${incident.id}/audit-logs`), { credentials: 'include' });
      if (res.ok) {
        const logs = await res.json();
        setAuditLogs(logs);
      }
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
    }
  };

  const handleStatusChange = async (incidentId: string, newStatus: IncidentStatus) => {
    try {
      const res = await fetch(apiUrl(`/api/incidents/${incidentId}/status`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
        credentials: 'include',
      });
      if (res.ok) {
        refetch();
        setSelectedIncident(null);
      }
    } catch (error) {
      console.error('Failed to update incident status:', error);
    }
  };

  const handleDownloadReport = async (incidentId: string) => {
    try {
      const res = await fetch(apiUrl(`/api/incidents/${incidentId}/report`), { credentials: 'include' });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `incident-${incidentId}.md`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Failed to download report:', error);
    }
  };

  const handleVerifySignature = async (incident: Incident) => {
    try {
      const res = await fetch(`/api/incidents/${incident.id}/verify-signature`);
      const result = await res.json();
      alert(result.valid ? '✅ Signature verified - no tampering detected' : '❌ Signature invalid - incident may have been modified');
    } catch (error) {
      console.error('Failed to verify signature:', error);
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Security Operations Center</h1>
        <p className="text-[color:var(--text-muted)]">Monitor and manage incidents in real-time</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Incidents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">New</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[color:var(--status-error)]">{stats.new}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Acknowledged</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{stats.acknowledged}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Resolved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[color:var(--accent-text)]">{stats.resolved}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Critical</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[color:var(--status-error)]">{stats.critical}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4 flex-wrap">
          <Input
            placeholder="Search by ID or rule..."
            value={filter.search || ''}
            onChange={(e) => setFilter({ ...filter, search: e.target.value })}
            className="w-48"
          />
          <Select
            value={filter.status || ''}
            onValueChange={(value) =>
              setFilter({ ...filter, status: (value as IncidentStatus) || undefined })
            }
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={filter.severity || ''}
            onValueChange={(value) =>
              setFilter({ ...filter, severity: (value as Severity) || undefined })
            }
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Incidents Table */}
      <Card>
        <CardHeader>
          <CardTitle>Incidents</CardTitle>
          <CardDescription>{filteredIncidents.length} incidents</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Incident ID</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIncidents.map((incident) => (
                    <TableRow key={incident.id} className="hover:bg-[var(--bg-surface)]">
                      <TableCell className="font-mono text-xs">{incident.id.slice(0, 8)}</TableCell>
                      <TableCell className="text-sm">{incident.ruleId}</TableCell>
                      <TableCell>
                        <Badge className={getSeverityColor(incident.severity)}>
                          {incident.severity.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(incident.status)}>
                          {incident.status.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(incident.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleViewDetails(incident)}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedIncident} onOpenChange={() => setSelectedIncident(null)}>
        <DialogContent className="admin-dialog w-full max-w-2xl max-h-[80vh] sm:max-w-2xl overflow-y-auto">
          {selectedIncident && (
            <>
              <DialogHeader>
                <DialogTitle>Incident Details</DialogTitle>
                <DialogDescription>{selectedIncident.id}</DialogDescription>
              </DialogHeader>

              <Tabs defaultValue="overview" className="w-full">
                <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                  <TabsTrigger value="audit">Audit</TabsTrigger>
                  <TabsTrigger value="signature">Signature</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-[color:var(--text-muted)]">Severity</label>
                      <Badge className={getSeverityColor(selectedIncident.severity)}>
                        {selectedIncident.severity.toUpperCase()}
                      </Badge>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-[color:var(--text-muted)]">Status</label>
                      <Badge className={getStatusColor(selectedIncident.status)}>
                        {selectedIncident.status.toUpperCase()}
                      </Badge>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-[color:var(--text-muted)]">Rule ID</label>
                      <p className="text-sm font-mono">{selectedIncident.ruleId}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-[color:var(--text-muted)]">Created By</label>
                      <p className="text-sm">{selectedIncident.userId}</p>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">Metadata</label>
                    <pre className="bg-[var(--bg-subtle)] p-3 rounded text-xs overflow-auto max-h-40">
                      {JSON.stringify(selectedIncident.metadata, null, 2)}
                    </pre>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">Actions</label>
                    <div className="flex gap-2">
                      {selectedIncident.status === 'new' && (
                        <Button
                          size="sm"
                          onClick={() => handleStatusChange(selectedIncident.id, 'acknowledged')}
                        >
                          Acknowledge
                        </Button>
                      )}
                      {selectedIncident.status === 'acknowledged' && (
                        <Button
                          size="sm"
                          onClick={() => handleStatusChange(selectedIncident.id, 'resolved')}
                        >
                          Resolve
                        </Button>
                      )}
                      {selectedIncident.status === 'resolved' && (
                        <Button
                          size="sm"
                          onClick={() => handleStatusChange(selectedIncident.id, 'closed')}
                        >
                          Close
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadReport(selectedIncident.id)}
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Report
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleVerifySignature(selectedIncident)}
                      >
                        <Shield className="w-4 h-4 mr-1" />
                        Verify
                      </Button>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="timeline" className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-start gap-4">
                      <div className="text-sm font-medium text-[color:var(--text-muted)] w-24">Created</div>
                      <div>
                        <p className="text-sm">{new Date(selectedIncident.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                    {selectedIncident.acknowledgedAt && (
                      <div className="flex items-start gap-4">
                        <div className="text-sm font-medium text-[color:var(--text-muted)] w-24">Acknowledged</div>
                        <div>
                          <p className="text-sm">{new Date(selectedIncident.acknowledgedAt).toLocaleString()}</p>
                          <p className="text-xs text-[color:var(--text-muted)]">by {selectedIncident.acknowledgedBy}</p>
                        </div>
                      </div>
                    )}
                    {selectedIncident.resolvedAt && (
                      <div className="flex items-start gap-4">
                        <div className="text-sm font-medium text-[color:var(--text-muted)] w-24">Resolved</div>
                        <div>
                          <p className="text-sm">{new Date(selectedIncident.resolvedAt).toLocaleString()}</p>
                          <p className="text-xs text-[color:var(--text-muted)]">by {selectedIncident.resolvedBy}</p>
                        </div>
                      </div>
                    )}
                    {selectedIncident.closedAt && (
                      <div className="flex items-start gap-4">
                        <div className="text-sm font-medium text-[color:var(--text-muted)] w-24">Closed</div>
                        <div>
                          <p className="text-sm">{new Date(selectedIncident.closedAt).toLocaleString()}</p>
                          <p className="text-xs text-[color:var(--text-muted)]">by {selectedIncident.closedBy}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="audit" className="space-y-4">
                  <div className="overflow-x-auto">
                    <Table className="text-xs">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Action</TableHead>
                          <TableHead>User</TableHead>
                          <TableHead>IP</TableHead>
                          <TableHead>Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auditLogs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell>{log.action}</TableCell>
                            <TableCell className="font-mono">{log.userId.slice(0, 8)}</TableCell>
                            <TableCell className="font-mono">{log.ip}</TableCell>
                            <TableCell>{new Date(log.timestamp).toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="signature" className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-[color:var(--text-muted)]">Signature Hash</label>
                    <p className="text-xs font-mono break-all bg-[var(--bg-subtle)] p-3 rounded mt-1">
                      {selectedIncident.signatureHash}
                    </p>
                  </div>
                  <div className="text-xs text-[color:var(--text-muted)] bg-[color:var(--accent-text)]/10 p-3 rounded">
                    <p className="font-medium mb-1">✅ Cryptographic Signature</p>
                    <p>This incident is signed with HMAC-SHA256. Any modification to the incident record will invalidate the signature.</p>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}




