import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
  AlertCircle,
  CheckCircle,
  Clock,
  MessageSquare,
  Flag,
} from "lucide-react";

interface ModeratingCase {
  case: {
    id: string;
    caseType: string;
    status: string;
    priority: string;
    reporterId: string;
    restaurantId: string | null;
    recommendationId: string | null;
    assignedModeratorId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  flag: {
    id: string;
    reason: string;
    description: string | null;
    evidenceUrls: string[];
    flaggedAt: string;
  };
  resolution?: {
    outcome: string;
    reasonCode: string;
    moderatorNotes: string | null;
    actionTaken: string | null;
  };
  reporter: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    reporterReputation: number;
  };
}

const statusIcons = {
  pending: <AlertCircle className="h-4 w-4 text-yellow-500" />,
  under_review: <Clock className="h-4 w-4 text-blue-500" />,
  resolved: <CheckCircle className="h-4 w-4 text-green-500" />,
  appealed: <MessageSquare className="h-4 w-4 text-purple-500" />,
};

const priorityColors = {
  urgent: "destructive",
  normal: "secondary",
  low: "outline",
} as const;

export function ModerationQueue() {
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [selectedCase, setSelectedCase] = useState<ModeratingCase | null>(null);

  const { data: queue, isLoading } = useQuery({
    queryKey: ["moderation-queue", statusFilter, priorityFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (priorityFilter !== "all") params.append("priority", priorityFilter);

      const response = await fetch(
        `/api/admin/moderation/queue?${params.toString()}`,
      );
      if (!response.ok) throw new Error("Failed to fetch queue");
      return response.json() as Promise<ModeratingCase[]>;
    },
  });

  const assignMutation = useMutation({
    mutationFn: async (moderatorId: string) => {
      if (!selectedCase) return;
      const response = await fetch(
        `/api/admin/moderation/${selectedCase.case.id}/assign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moderatorId }),
        },
      );
      if (!response.ok) throw new Error("Failed to assign case");
      return response.json();
    },
    onSuccess: () => {
      setSelectedCase(null);
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (payload: {
      outcome: "valid" | "invalid" | "partial";
      reasonCode: string;
      moderatorNotes?: string;
      actionTaken?: string;
    }) => {
      if (!selectedCase) return;
      const response = await fetch(
        `/api/admin/moderation/${selectedCase.case.id}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) throw new Error("Failed to resolve case");
      return response.json();
    },
    onSuccess: () => {
      setSelectedCase(null);
    },
  });

  if (isLoading) {
    return <div className="p-4">Loading moderation queue...</div>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* Queue List */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Moderation Queue</CardTitle>
          <CardDescription>
            {queue?.length || 0} flagged items awaiting review
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="under_review">Under Review</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="appealed">Appealed</SelectItem>
              </SelectContent>
            </Select>

            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter by priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            {queue?.map((item) => (
              <div
                key={item.case.id}
                className={`p-3 border rounded-lg cursor-pointer hover:bg-accent ${
                  selectedCase?.case.id === item.case.id ? "bg-accent" : ""
                }`}
                onClick={() => setSelectedCase(item)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    {statusIcons[item.case.status as keyof typeof statusIcons]}
                    <div className="flex-1">
                      <div className="font-medium text-sm">
                        {item.case.caseType === "recommendation_flag"
                          ? "Recommendation Flag"
                          : "Profile Content Flag"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.flag.reason}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Reporter:{" "}
                        {item.reporter.firstName || item.reporter.lastName
                          ? `${item.reporter.firstName} ${item.reporter.lastName}`
                          : "Anonymous"}{" "}
                        (Reputation: {item.reporter.reporterReputation})
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Badge
                      variant={
                        priorityColors[
                          item.case.priority as keyof typeof priorityColors
                        ]
                      }
                    >
                      {item.case.priority}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Case Details */}
      {selectedCase && (
        <Card>
          <CardHeader>
            <CardTitle>Case Details</CardTitle>
            <CardDescription>
              {selectedCase.case.caseType === "recommendation_flag"
                ? "Recommendation FLAG"
                : "Profile Content FLAG"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Flag Info */}
            <div>
              <h4 className="font-medium text-sm mb-2">Reason</h4>
              <p className="text-sm bg-muted p-2 rounded">
                {selectedCase.flag.reason}
              </p>
            </div>

            {selectedCase.flag.description && (
              <div>
                <h4 className="font-medium text-sm mb-2">Description</h4>
                <p className="text-sm bg-muted p-2 rounded">
                  {selectedCase.flag.description}
                </p>
              </div>
            )}

            {selectedCase.flag.evidenceUrls.length > 0 && (
              <div>
                <h4 className="font-medium text-sm mb-2">Evidence</h4>
                <div className="space-y-1">
                  {selectedCase.flag.evidenceUrls.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline block"
                    >
                      Evidence {i + 1}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Resolution Actions */}
            {selectedCase.case.status === "pending" && (
              <div className="space-y-3 border-t pt-4">
                <Button
                  onClick={() =>
                    resolveMutation.mutate({
                      outcome: "valid",
                      reasonCode: "genuine_violation",
                      moderatorNotes: "Flag upheld - content violates policy",
                      actionTaken: "recommendation_hidden",
                    })
                  }
                  variant="destructive"
                  className="w-full"
                >
                  Uphold Flag
                </Button>
                <Button
                  onClick={() =>
                    resolveMutation.mutate({
                      outcome: "invalid",
                      reasonCode: "reporter_error",
                      moderatorNotes: "Flag dismissed - content complies with policy",
                      actionTaken: "no_action",
                    })
                  }
                  variant="outline"
                  className="w-full"
                >
                  Dismiss Flag
                </Button>
              </div>
            )}

            {selectedCase.resolution && (
              <div className="border-t pt-4">
                <h4 className="font-medium text-sm mb-2">Resolution</h4>
                <Badge className="mb-2">{selectedCase.resolution.outcome}</Badge>
                {selectedCase.resolution.moderatorNotes && (
                  <p className="text-xs bg-muted p-2 rounded">
                    {selectedCase.resolution.moderatorNotes}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default ModerationQueue;
