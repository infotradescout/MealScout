import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PlayCircle, Star, Trash2, Upload, Video } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";

type MediaOwnerType = "user" | "restaurant" | "food_truck" | "host" | "event";
type MediaStatus = "processing" | "active" | "rejected" | "deleted";
type MediaVisibility = "public" | "private" | "business_only";

type MediaAsset = {
  id: string;
  ownerType: MediaOwnerType;
  ownerId: string;
  mediaType: "video";
  title?: string | null;
  description?: string | null;
  fileUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  status: MediaStatus;
  visibility: MediaVisibility;
  isFeatured: boolean;
  rejectionReason?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type ManagedVideosResponse = {
  videos: MediaAsset[];
};

type Props = {
  ownerType: MediaOwnerType;
  ownerId: string;
  title?: string;
  description?: string;
  adminMode?: boolean;
};

const statusVariant = (status: MediaStatus) => {
  if (status === "active") return "default";
  if (status === "processing") return "secondary";
  if (status === "rejected") return "destructive";
  return "outline";
};

const formatDuration = (seconds?: number | null) => {
  if (!seconds || seconds < 1) return "";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
};

async function uploadVideo(formData: FormData) {
  const response = await fetch(apiUrl("/api/media/videos"), {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || "Video upload failed");
  }

  return response.json();
}

export default function MediaVideoManager({
  ownerType,
  ownerId,
  title = "Profile videos",
  description = "Upload, review, feature, replace, or delete videos for this profile.",
  adminMode = false,
}: Props) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    visibility: "public" as MediaVisibility,
    isFeatured: false,
    status: adminMode ? ("active" as MediaStatus) : ("processing" as MediaStatus),
  });

  const queryKey = ["/api/media/manage", ownerType, ownerId, "videos"];
  const { data, isLoading } = useQuery<ManagedVideosResponse>({
    queryKey,
    enabled: Boolean(ownerType && ownerId),
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const file = fileInputRef.current?.files?.[0];
      if (!file) throw new Error("Choose a video first");

      const payload = new FormData();
      payload.append("video", file);
      payload.append("ownerType", ownerType);
      payload.append("ownerId", ownerId);
      payload.append("title", form.title);
      payload.append("description", form.description);
      payload.append("visibility", form.visibility);
      payload.append("isFeatured", String(form.isFeatured));
      if (adminMode) payload.append("status", form.status);

      return uploadVideo(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      if (fileInputRef.current) fileInputRef.current.value = "";
      setForm((current) => ({
        ...current,
        title: "",
        description: "",
        isFeatured: false,
      }));
      toast({
        title: "Video uploaded",
        description: adminMode
          ? "The video was attached to this record."
          : "The video was uploaded and is waiting for review.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Video upload failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const patchVideoMutation = useMutation({
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error: Error) => {
      toast({
        title: "Video update failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (videoId: string) => {
      const response = await apiRequest("DELETE", `/api/media/${videoId}`);
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      toast({ title: "Video removed" });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not remove video",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const videos = data?.videos ?? [];

  return (
    <Card data-testid="media-video-manager">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="media-video-file">Video file</Label>
            <Input
              id="media-video-file"
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              data-testid="input-media-video-file"
            />
            <p className="text-xs text-muted-foreground">
              Supported formats: MP4, MOV, WebM. Default max size: 100MB.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="media-video-title">Title</Label>
            <Input
              id="media-video-title"
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="Intro, menu preview, event promo"
              data-testid="input-media-video-title"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="media-video-description">Description</Label>
            <Textarea
              id="media-video-description"
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              rows={3}
              data-testid="textarea-media-video-description"
            />
          </div>
          <div className="space-y-2">
            <Label>Visibility</Label>
            <Select
              value={form.visibility}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  visibility: value as MediaVisibility,
                }))
              }
            >
              <SelectTrigger data-testid="select-media-video-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public</SelectItem>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="business_only">Business only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {adminMode ? (
            <div className="space-y-2">
              <Label>Initial status</Label>
              <Select
                value={form.status}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    status: value as MediaStatus,
                  }))
                }
              >
                <SelectTrigger data-testid="select-media-video-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="processing">Processing/review</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isFeatured}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  isFeatured: event.target.checked,
                }))
              }
            />
            Mark as featured video
          </label>
          <Button
            type="button"
            onClick={() => uploadMutation.mutate()}
            disabled={uploadMutation.isPending}
            data-testid="button-upload-media-video"
          >
            <Upload className="mr-2 h-4 w-4" />
            {uploadMutation.isPending ? "Uploading..." : "Upload video"}
          </Button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">Attached videos</h3>
            <span className="text-sm text-muted-foreground">
              {isLoading ? "Loading..." : `${videos.length} video${videos.length === 1 ? "" : "s"}`}
            </span>
          </div>

          {videos.length === 0 && !isLoading ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No videos attached yet. Missing video does not block profile creation.
            </div>
          ) : null}

          {videos.map((video) => (
            <div
              key={video.id}
              className="grid gap-4 rounded-xl border p-4 md:grid-cols-[180px_1fr]"
              data-testid={`media-video-row-${video.id}`}
            >
              <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
                {video.thumbnailUrl ? (
                  <img
                    src={video.thumbnailUrl}
                    alt={video.title || "Video thumbnail"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <PlayCircle className="h-10 w-10 text-muted-foreground" />
                  </div>
                )}
                {video.isFeatured ? (
                  <Badge className="absolute left-2 top-2 gap-1">
                    <Star className="h-3 w-3" /> Featured
                  </Badge>
                ) : null}
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold">
                      {video.title || "Untitled video"}
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      {[video.visibility, formatDuration(video.durationSeconds)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={statusVariant(video.status) as any}>
                      {video.status}
                    </Badge>
                    <Button asChild size="sm" variant="outline">
                      <a href={video.fileUrl} target="_blank" rel="noreferrer">
                        View
                      </a>
                    </Button>
                  </div>
                </div>

                {video.description ? (
                  <p className="text-sm text-muted-foreground">
                    {video.description}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {!video.isFeatured ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        patchVideoMutation.mutate({
                          videoId: video.id,
                          patch: { isFeatured: true },
                        })
                      }
                    >
                      <Star className="mr-2 h-4 w-4" /> Feature
                    </Button>
                  ) : null}

                  {adminMode && video.status !== "active" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        patchVideoMutation.mutate({
                          videoId: video.id,
                          patch: { status: "active" },
                        })
                      }
                    >
                      Approve
                    </Button>
                  ) : null}

                  {adminMode && video.status !== "rejected" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        patchVideoMutation.mutate({
                          videoId: video.id,
                          patch: {
                            status: "rejected",
                            rejectionReason: "Rejected by admin review.",
                          },
                        })
                      }
                    >
                      Reject
                    </Button>
                  ) : null}

                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => deleteMutation.mutate(video.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
