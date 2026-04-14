import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AlertCircle, Flag, CheckCircle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

const flagReasons = {
  spam: "Spam or Duplicate",
  inappropriate: "Inappropriate Content",
  misleading: "Misleading Information",
  fake: "Not a Genuine Recommendation",
  off_topic: "Off Topic",
  abuse: "Abusive Language",
};

const profileFlagReasons = {
  false_info: "False Information",
  inappropriate: "Inappropriate Content",
  misleading: "Misleading Presentation",
  policy_violation: "Policy Violation",
  spam: "Spam",
  abuse: "Abusive Content",
};

export function FlagRecommendationDialog({
  recommendationId,
  trigger,
}: {
  recommendationId: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [description, setDescription] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const { toast } = useToast();

  const flagMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/recommendations/${recommendationId}/flag`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason,
            description: description || undefined,
            evidenceUrls: evidenceUrl ? [evidenceUrl] : [],
          }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to flag recommendation");
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Thank you",
        description:
          "Your report has been submitted for review. We appreciate your help keeping the community safe.",
      });
      setOpen(false);
      setReason("");
      setDescription("");
      setEvidenceUrl("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="text-red-500">
            <Flag className="h-4 w-4 mr-2" />
            Report
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report Recommendation</DialogTitle>
          <DialogDescription>
            Help us maintain a trusted community by reporting problematic
            content.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Why are you reporting this?</label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(flagReasons).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">Additional details (optional)</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide context..."
              className="h-24"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Evidence URL (optional)</label>
            <Input
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
              placeholder="https://example.com/proof"
              type="url"
            />
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-700">
            <AlertCircle className="h-4 w-4 inline mr-2" />
            False reports may reduce your reputation score.
          </div>

          <Button
            onClick={() => flagMutation.mutate()}
            disabled={!reason || flagMutation.isPending}
            className="w-full"
          >
            {flagMutation.isPending ? "Submitting..." : "Submit Report"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FlagProfileContentDialog({
  restaurantId,
  trigger,
}: {
  restaurantId: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [contentType, setContentType] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [description, setDescription] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const { toast } = useToast();

  const flagMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/restaurants/${restaurantId}/flag-content`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentType,
            reason,
            description: description || undefined,
            evidenceUrls: evidenceUrl ? [evidenceUrl] : [],
          }),
        },
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to flag content");
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Thank you",
        description:
          "Your report has been submitted for review. We appreciate your help keeping the community safe.",
      });
      setOpen(false);
      setContentType("");
      setReason("");
      setDescription("");
      setEvidenceUrl("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="text-red-500">
            <Flag className="h-4 w-4 mr-2" />
            Report Content
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report Business Profile Content</DialogTitle>
          <DialogDescription>
            Help us ensure accurate business information.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">What type of content?</label>
            <Select value={contentType} onValueChange={setContentType}>
              <SelectTrigger>
                <SelectValue placeholder="Select content type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="profile_description">Description</SelectItem>
                <SelectItem value="hours">Operating Hours</SelectItem>
                <SelectItem value="location">Location</SelectItem>
                <SelectItem value="contact">Contact Info</SelectItem>
                <SelectItem value="images">Images</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">Why are you reporting this?</label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(profileFlagReasons).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">Additional details (optional)</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's incorrect or problematic..."
              className="h-24"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Evidence URL (optional)</label>
            <Input
              value={evidenceUrl}
              onChange={(e) => setEvidenceUrl(e.target.value)}
              placeholder="https://example.com/proof"
              type="url"
            />
          </div>

          <Button
            onClick={() => flagMutation.mutate()}
            disabled={!contentType || !reason || flagMutation.isPending}
            className="w-full"
          >
            {flagMutation.isPending ? "Submitting..." : "Submit Report"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function UserFlagsHistory() {
  const { data: flags, isLoading } = useQuery({
    queryKey: ["user-flags"],
    queryFn: async () => {
      const response = await fetch("/api/user/flags");
      if (!response.ok) throw new Error("Failed to fetch flags");
      return response.json();
    },
  });

  if (isLoading) {
    return <div>Loading your reports...</div>;
  }

  if (!flags || flags.length === 0) {
    return <div className="text-muted-foreground">No reports yet.</div>;
  }

  return (
    <div className="space-y-3">
      {flags.map((item: any) => (
        <div key={item.flag.id} className="p-3 border rounded-lg">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-medium text-sm">{item.flag.reason}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(item.flag.createdAt).toLocaleDateString()}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {item.resolution ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-xs">{item.resolution.outcome}</span>
                </>
              ) : (
                <span className="text-xs text-blue-500">Pending Review</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
