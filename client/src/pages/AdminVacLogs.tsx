/**
 * Admin VAC Logs — Verification Assurance Check monitoring page.
 *
 * Displays all `vac:evaluate` audit entries so admins can see:
 *   - Which truck signups were auto-verified vs. held for manual review
 *   - The score and threshold for each evaluation
 *   - A plain-English signal summary per entry
 *
 * Backed by GET /api/admin/vac-logs
 */
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Download,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface VacLogEntry {
  id: string;
  userId: string;
  restaurantId: string;
  timestamp: string;
  score: number | null;
  threshold: number | null;
  autoVerified: boolean;
  outcome: "auto_verified" | "manual_review";
  emailDomain: string | null;
  websiteHost: string | null;
  signalSummary: string;
  rawMetadata: Record<string, any>;
}

interface VacLogsResponse {
  total: number;
  autoVerifiedCount: number;
  manualReviewCount: number;
  logs: VacLogEntry[];
}

export default function AdminVacLogs() {
  const [selectedEntry, setSelectedEntry] = useState<VacLogEntry | null>(null);
  const [filters, setFilters] = useState({
    days: "30",
    outcome: "",
  });

  const { data, isLoading, refetch } = useQuery<VacLogsResponse>({
    queryKey: ["vac-logs", filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("days", filters.days);
      if (filters.outcome) params.append("outcome", filters.outcome);
      const res = await fetch(`/api/admin/vac-logs?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch VAC logs");
      return res.json();
    },
    refetchInterval: 120_000, // refresh every 2 min
  });

  const logs = data?.logs ?? [];

  const handleExport = () => {
    const csv = [
      [
        "ID",
        "User ID",
        "Restaurant ID",
        "Timestamp",
        "Score",
        "Threshold",
        "Outcome",
        "Email Domain",
        "Website Host",
        "Signals",
      ],
      ...logs.map((l) => [
        l.id,
        l.userId,
        l.restaurantId,
        l.timestamp,
        l.score ?? "",
        l.threshold ?? "",
        l.outcome,
        l.emailDomain ?? "",
        l.websiteHost ?? "",
        l.signalSummary,
      ]),
    ]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vac-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">VAC Monitoring</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Verification Assurance Check — auto-verify decisions for truck
              signups
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-1" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="w-4 h-4 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Evaluations</CardDescription>
              <CardTitle className="text-3xl">
                {isLoading ? "—" : (data?.total ?? 0)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card className="border-green-200 dark:border-green-800">
            <CardHeader className="pb-2">
              <CardDescription className="text-green-700 dark:text-green-400">
                Auto-Verified
              </CardDescription>
              <CardTitle className="text-3xl text-green-700 dark:text-green-400">
                {isLoading ? "—" : (data?.autoVerifiedCount ?? 0)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card className="border-amber-200 dark:border-amber-800">
            <CardHeader className="pb-2">
              <CardDescription className="text-amber-700 dark:text-amber-400">
                Held for Manual Review
              </CardDescription>
              <CardTitle className="text-3xl text-amber-700 dark:text-amber-400">
                {isLoading ? "—" : (data?.manualReviewCount ?? 0)}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4 flex flex-wrap gap-3">
            <Select
              value={filters.days}
              onValueChange={(v) => setFilters((f) => ({ ...f, days: v }))}
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Time range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.outcome || "all"}
              onValueChange={(v) =>
                setFilters((f) => ({ ...f, outcome: v === "all" ? "" : v }))
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Outcome" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All outcomes</SelectItem>
                <SelectItem value="auto_verified">Auto-verified</SelectItem>
                <SelectItem value="manual_review">Manual review</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Loading VAC logs…
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <AlertCircle className="w-8 h-8" />
                <p>No VAC evaluations found for this time range.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Restaurant ID</TableHead>
                    <TableHead>Score / Threshold</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Email Domain</TableHead>
                    <TableHead>Signals</TableHead>
                    <TableHead className="text-right">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(entry.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[120px] truncate">
                        {entry.restaurantId || "—"}
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            entry.autoVerified
                              ? "text-green-700 dark:text-green-400 font-semibold"
                              : "text-amber-700 dark:text-amber-400 font-semibold"
                          }
                        >
                          {entry.score ?? "?"} / {entry.threshold ?? "?"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {entry.autoVerified ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Auto-verified
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-amber-400 text-amber-700 dark:text-amber-300 gap-1"
                          >
                            <XCircle className="w-3 h-3" />
                            Manual review
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {entry.emailDomain || "—"}
                      </TableCell>
                      <TableCell className="text-xs max-w-[260px] truncate text-muted-foreground">
                        {entry.signalSummary}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedEntry(entry)}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail dialog */}
      <Dialog
        open={!!selectedEntry}
        onOpenChange={(open) => !open && setSelectedEntry(null)}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>VAC Evaluation Detail</DialogTitle>
            <DialogDescription>
              Full signal breakdown for restaurant{" "}
              <span className="font-mono">{selectedEntry?.restaurantId}</span>
            </DialogDescription>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Score</p>
                  <p className="font-semibold text-lg">
                    {selectedEntry.score ?? "?"} /{" "}
                    {selectedEntry.threshold ?? "?"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Outcome</p>
                  {selectedEntry.autoVerified ? (
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      Auto-verified
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-amber-400 text-amber-700"
                    >
                      Manual review
                    </Badge>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">
                    Email Domain
                  </p>
                  <p className="font-mono">
                    {selectedEntry.emailDomain || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">
                    Website Host
                  </p>
                  <p className="font-mono">
                    {selectedEntry.websiteHost || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">User ID</p>
                  <p className="font-mono text-xs">{selectedEntry.userId}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-1">
                    Evaluated At
                  </p>
                  <p>{new Date(selectedEntry.timestamp).toLocaleString()}</p>
                </div>
              </div>

              <div>
                <p className="text-muted-foreground text-xs mb-2">
                  Signal Breakdown
                </p>
                <div className="rounded-md border p-3 space-y-1.5">
                  {Object.entries(
                    selectedEntry.rawMetadata?.signals ?? {},
                  ).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between"
                    >
                      <span className="text-muted-foreground font-mono text-xs">
                        {key}
                      </span>
                      <span
                        className={
                          value === true
                            ? "text-green-600 dark:text-green-400 font-medium"
                            : value === false
                              ? "text-red-500 dark:text-red-400"
                              : "text-muted-foreground"
                        }
                      >
                        {String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-muted-foreground text-xs mb-2">
                  Raw Metadata
                </p>
                <pre className="rounded-md border bg-muted p-3 text-xs overflow-x-auto">
                  {JSON.stringify(selectedEntry.rawMetadata, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
