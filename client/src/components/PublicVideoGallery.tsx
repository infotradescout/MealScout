import { useQuery } from "@tanstack/react-query";
import { Heart, MessageCircle, PlayCircle, Share2, Star, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type MediaOwnerType = "user" | "restaurant" | "food_truck" | "host" | "event";

type PublicVideo = {
  id: string;
  title?: string | null;
  description?: string | null;
  fileUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  isFeatured: boolean;
};

type PublicUserVideoRecommendation = {
  id: string;
  title?: string | null;
  description?: string | null;
  fileUrl: string;
  thumbnailUrl?: string | null;
  durationSeconds?: number | null;
  authorName?: string | null;
  createdAt?: string | null;
  likeCount?: number | null;
  commentCount?: number | null;
  shareCount?: number | null;
  storyUrl?: string | null;
};

type PublicVideosResponse = {
  videos: PublicVideo[];
  recommendationVideos?: PublicUserVideoRecommendation[];
};

type Props = {
  ownerType: MediaOwnerType;
  ownerId: string;
  title?: string;
  description?: string;
  hideWhenEmpty?: boolean;
  showUserRecommendations?: boolean;
};

const formatDuration = (seconds?: number | null) => {
  if (!seconds || seconds < 1) return "";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
};

export default function PublicVideoGallery({
  ownerType,
  ownerId,
  title = "Videos",
  description = "Featured videos from this profile.",
  hideWhenEmpty = true,
  showUserRecommendations = true,
}: Props) {
  const { data, isLoading } = useQuery<PublicVideosResponse>({
    queryKey: ["/api/media", ownerType, ownerId, "videos"],
    enabled: Boolean(ownerType && ownerId),
  });

  const videos = data?.videos ?? [];
  const recommendationVideos =
    showUserRecommendations && (ownerType === "restaurant" || ownerType === "food_truck")
      ? data?.recommendationVideos ?? []
      : [];
  const hasAnyVideos = videos.length + recommendationVideos.length > 0;

  if (!isLoading && !hasAnyVideos && hideWhenEmpty) {
    return null;
  }

  return (
    <Card data-testid="public-video-gallery">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="aspect-video animate-pulse rounded-xl bg-muted" />
            <div className="aspect-video animate-pulse rounded-xl bg-muted" />
          </div>
        ) : null}

        {!isLoading && !hasAnyVideos ? (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            No active videos are available yet.
          </div>
        ) : null}

        {videos.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {videos.map((video) => (
              <a
                key={video.id}
                href={video.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-xl border bg-card text-card-foreground transition hover:shadow-md"
                data-testid={`public-video-${video.id}`}
              >
                <div className="relative aspect-video bg-muted">
                  {video.thumbnailUrl ? (
                    <img
                      src={video.thumbnailUrl}
                      alt={video.title || "Profile video"}
                      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <PlayCircle className="h-12 w-12 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/15 opacity-0 transition group-hover:opacity-100">
                    <PlayCircle className="h-12 w-12 text-white drop-shadow" />
                  </div>
                  {video.isFeatured ? (
                    <Badge className="absolute left-2 top-2 gap-1">
                      <Star className="h-3 w-3" /> Featured
                    </Badge>
                  ) : null}
                  {formatDuration(video.durationSeconds) ? (
                    <span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-1 text-xs font-medium text-white">
                      {formatDuration(video.durationSeconds)}
                    </span>
                  ) : null}
                </div>
                <div className="space-y-1 p-4">
                  <h3 className="font-semibold">
                    {video.title || "Profile video"}
                  </h3>
                  {video.description ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {video.description}
                    </p>
                  ) : null}
                </div>
              </a>
            ))}
          </div>
        ) : null}

        {recommendationVideos.length > 0 ? (
          <div className={videos.length > 0 ? "mt-6 border-t pt-6" : ""}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">Community video recommendations</h3>
              <Badge variant="outline">{recommendationVideos.length}</Badge>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {recommendationVideos.map((video) => (
                <a
                  key={video.id}
                  href={video.storyUrl || `/video/${video.id}`}
                  className="group overflow-hidden rounded-xl border bg-card text-card-foreground transition hover:shadow-md"
                  data-testid={`public-recommendation-video-${video.id}`}
                >
                  <div className="relative aspect-video bg-muted">
                    {video.thumbnailUrl ? (
                      <img
                        src={video.thumbnailUrl}
                        alt={video.title || "Food recommendation video"}
                        className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <PlayCircle className="h-12 w-12 text-muted-foreground" />
                      </div>
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/15 opacity-0 transition group-hover:opacity-100">
                      <PlayCircle className="h-12 w-12 text-white drop-shadow" />
                    </div>
                    <Badge className="absolute left-2 top-2 gap-1" variant="secondary">
                      <UserRound className="h-3 w-3" /> Recommendation
                    </Badge>
                    {formatDuration(video.durationSeconds) ? (
                      <span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-1 text-xs font-medium text-white">
                        {formatDuration(video.durationSeconds)}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-2 p-4">
                    <div>
                      <h3 className="font-semibold">
                        {video.title || "Food recommendation"}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Recommended by {video.authorName || "MealScout diner"}
                      </p>
                    </div>
                    {video.description ? (
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {video.description}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Heart className="h-3.5 w-3.5" />
                        {Number(video.likeCount || 0)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle className="h-3.5 w-3.5" />
                        {Number(video.commentCount || 0)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Share2 className="h-3.5 w-3.5" />
                        {Number(video.shareCount || 0)}
                      </span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
