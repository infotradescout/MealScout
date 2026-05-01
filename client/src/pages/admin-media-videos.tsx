import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, ExternalLink, Search, Star, Trash2, Video, XCircle } from "lucide-react";

import MediaVideoManager from "@/components/MediaVideoManager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";

type MediaOwnerType = "user" | "restaurant" | "food_truck" | "host" | "event";
type MediaStatus = "processing" | "active" | "rejected" | "deleted";
type MediaVisibility = "public" | "private" | "business_only";

type MediaAsset = {
  id: string;
  ownerType: MediaOwnerType;
  ownerId: string;
  title?: string | null;
  description?: string | null;
  fileUrl: string;
  status: MediaStatus;
  visibility: MediaVisibility;
  isFeatured: boolean;
  createdAt?: string | null;
};

type PendingMediaResponse = {
  videos: MediaAsset[];
};

const ownerTypeOptions: Array<{ value: MediaOwnerType; label: string }> = [
  { value: "user", label: "User" },
  { value: "restaurant", label: "Restaurant" },
  { value: "food_truck", label: "Food truck" },
  { value: "host", label: "Host" },
  { value: "event", label: "Event" },
];

const ownerTypeLabels = ownerTypeOptions.reduce(
  (labels, option) => ({ ...labels, [option.value]: option.label }),
  {} as Record<MediaOwnerType, string>,
);

const isMediaOwnerType = (value: string | null): value is MediaOwnerType =>
  ownerTypeOptions.some((option) => option.value === value);

export default function AdminMediaVideosPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const initialParams = useMemo(() => {
    const params =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();
    const rawOwnerType = params.get("ownerType");
    return {
      ownerType: isMediaOwnerType(rawOwnerType) ? rawOwnerType : "restaurant",
      ownerId: params.get("ownerId") || "",
    };
  }, []);
  const [ownerType, setOwnerType] = useState<MediaOwnerType>(
    initialParams.ownerType,
  );
  const [ownerId, setOwnerId] = useState(initialParams.ownerId);
  const selectedOwnerId = ownerId.trim();
  const isAdmin =
    user?.userType === "admin" || user?.userType === "super_admin";

  const { data: pendingData, isLoading } = useQuery<PendingMediaResponse>({
    queryKey: ["/api/admin/media/pending"],
    enabled: isAdmin,
  });

  const invalidateMedia = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["/api/admin/media/pending"],
    });
    await queryClient.invalidateQueries({ queryKey: ["/api/media/manage"] });
  };

  const patchMutation = useMutation({
    mutationFn: async ({
      videoId,
      patch,
    }: {
      videoId: string;
      patch: Record<string, unknown>;
    }) => {
      const response = await apiRequest("PATCH", `/api/media/${videoId}`, patch);
      return response.json();
    },
    onSuccess: invalidateMedia,
  });

  const deleteMutation = useMutation({
    mutationFn: async (videoId: string) => {
      const response = await apiRequest("DELETE", `/api/media/${videoId}`);
      return response.json();
    },
    onSuccess: invalidateMedia,
  });

  const pendingVideos = pendingData?.videos ?? [];

  const selectOwner = (video: MediaAsset) => {
    setOwnerType(video.ownerType);
    setOwnerId(video.ownerId);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      params.set("ownerType", video.ownerType);
      params.set("ownerId", video.ownerId);
      window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
    }
  };

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Admin access required</CardTitle>
            <CardDescription>
              Only admins can manage reusable profile and event videos.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div>
        <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium text-muted-foreground">
          <Video className="h-4 w-4" />
          Reusable media
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-normal">
          Admin video media
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Attach, approve, reject, feature, replace, or remove videos for any
          supported owner record.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Choose owner</CardTitle>
          <CardDescription>
            Select an owner type and paste the record ID to manage its videos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-[14rem_1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label>Owner type</Label>
              <Select
                value={ownerType}
                onValueChange={(value) => setOwnerType(value as MediaOwnerType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ownerTypeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-media-owner-id">Owner ID</Label>
              <Input
                id="admin-media-owner-id"
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
                placeholder="Paste user, restaurant, truck, host, or event ID"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (typeof window === "undefined") return;
                const params = new URLSearchParams(window.location.search);
                params.set("ownerType", ownerType);
                params.set("ownerId", selectedOwnerId);
                window.history.replaceState(
                  {},
                  "",
                  `${window.location.pathname}?${params}`,
                );
              }}
              disabled={!selectedOwnerId}
            >
              <Search className="mr-2 h-4 w-4" />
              Load
            </Button>
          </div>
        </CardContent>
      </Card>

      {selectedOwnerId ? (
        <MediaVideoManager
          key={`${ownerType}:${selectedOwnerId}`}
          ownerType={ownerType}
          ownerId={selectedOwnerId}
          title={`${ownerTypeLabels[ownerType]} videos`}
          description="Admin upload and review controls for this owner."
          adminMode
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Pending review</CardTitle>
          <CardDescription>
            Owner uploads waiting for approval before public display.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Loading pending videos...
            </div>
          ) : null}

          {!isLoading && pendingVideos.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No videos are waiting for review.
            </div>
          ) : null}

          {pendingVideos.map((video) => (
            <div
              key={video.id}
              className="rounded-xl border p-4"
              data-testid={`pending-media-video-${video.id}`}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">
                      {video.title || "Untitled video"}
                    </h2>
                    <Badge variant="secondary">{video.status}</Badge>
                    <Badge variant="outline">
                      {ownerTypeLabels[video.ownerType]}
                    </Badge>
                    {video.isFeatured ? (
                      <Badge className="gap-1">
                        <Star className="h-3 w-3" />
                        Featured
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {video.ownerId}
                  </p>
                  {video.description ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {video.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => selectOwner(video)}
                  >
                    Manage owner
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={video.fileUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      View
                    </a>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={patchMutation.isPending}
                    onClick={() =>
                      patchMutation.mutate({
                        videoId: video.id,
                        patch: { status: "active" },
                      })
                    }
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Approve
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={patchMutation.isPending}
                    onClick={() =>
                      patchMutation.mutate({
                        videoId: video.id,
                        patch: {
                          status: "rejected",
                          rejectionReason: "Rejected by admin review.",
                        },
                      })
                    }
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Reject
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(video.id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
