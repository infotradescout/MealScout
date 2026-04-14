import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useEffect } from "react";
import Navigation from "@/components/navigation";
import { BackHeader } from "@/components/back-header";
import { VideoTranscript } from "@/components/video-transcript";
import { MinimalFAQ } from "@/components/seo-faq";
import { SEOHead } from "@/components/seo-head";
import { generateVideoSchema } from "@/lib/schema-helpers";
import { extractUuidFromSlug, makeEntitySlug } from "@/lib/seo-slug";
import { Video, MapPin, User, Calendar, Heart, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ShareButton from "@/components/share-button";

export default function VideoDetailPage() {
  const params = useParams() as Record<string, string | undefined>;
  const videoParam = params.id || params.slug || "";
  const videoId = extractUuidFromSlug(videoParam) || videoParam;

  const { data: video, isLoading } = useQuery({
    queryKey: ["/api/stories", videoId],
    enabled: !!videoId,
  });

  const restaurantId =
    (video as any)?.restaurantId ?? (video as any)?.story?.restaurantId ?? null;

  const { data: restaurant } = useQuery({
    queryKey: ["/api/restaurants", restaurantId],
    enabled: !!restaurantId,
  });

  // Track video view
  useEffect(() => {
    if (videoId && video && !isLoading) {
      fetch(`/api/stories/${videoId}/view`, {
        method: "POST",
        credentials: "include",
      }).catch(() => {
        // Silent fail - view tracking shouldn't interrupt UX
      });
    }
  }, [videoId, video, isLoading]);

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
        <div className="animate-pulse p-6 space-y-4">
          <div className="w-full h-96 bg-muted rounded-2xl"></div>
          <div className="h-8 bg-muted rounded w-3/4"></div>
          <div className="h-4 bg-muted rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!video) {
    return (
      <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
        <div className="text-center py-12">
          <h2 className="text-xl font-bold mb-4">Video not found</h2>
          <Link href="/video">
            <Button>Back to Videos</Button>
          </Link>
        </div>
        <Navigation />
      </div>
    );
  }

  const videoData = ((video as any)?.story ?? video) as any;
  const restaurantData = restaurant as any;
  const videoTitle = videoData.title || "Food Recommendation";
  const videoDescription =
    videoData.description ||
    `Watch ${videoTitle} - a local food recommendation on MealScout`;
  const creatorName =
    videoData.creatorName ||
    videoData.username ||
    (video as any)?.creator?.username ||
    (videoData.user && (videoData.user.firstName || videoData.user.lastName)
      ? `${videoData.user.firstName || ""} ${
          videoData.user.lastName || ""
        }`.trim()
      : "MealScout Creator");
  const restaurantName = restaurantData?.name || "";
  const location = restaurantData?.address || "";

  const canonicalSlug = makeEntitySlug(videoTitle, videoData.id || videoId);
  const canonicalPath = `/video/${canonicalSlug}`;

  const expiresAtMs = videoData.expiresAt
    ? new Date(videoData.expiresAt).getTime()
    : Number.NaN;
  const noIndex = Boolean(
    videoData.deletedAt ||
      videoData.status !== "ready" ||
      videoData.isApproved === false ||
      (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) ||
      !videoData.videoUrl ||
      !videoData.transcriptSource,
  );

  // Generate VideoObject schema
  const videoSchema = generateVideoSchema({
    id: videoData.id,
    title: videoTitle,
    description: videoDescription,
    thumbnailUrl: videoData.thumbnailUrl,
    videoUrl: videoData.videoUrl,
    uploadDate: videoData.createdAt,
    duration: videoData.duration,
    transcript: videoData.transcript,
    creatorName,
  });

  // FAQ items specific to this video
  const faqItems = [
    {
      question: `What is this video about?`,
      answer: `This video is a ${
        videoData.duration
      }-second food recommendation featuring ${
        restaurantName || "local food"
      }. ${videoDescription}`,
    },
    {
      question: `Where can I find this food?`,
      answer: location
        ? `You can find this at ${restaurantName} located at ${location}. Check MealScout for current deals and hours.`
        : `This is a personal food recommendation. Check the video for details about where to find this dish.`,
    },
    {
      question: `How do I watch more food videos?`,
      answer: `Browse the MealScout Video tab to discover food recommendations from local users. You can filter by cuisine type, location, and trending videos.`,
    },
  ];

  return (
    <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
      <SEOHead
        title={`${videoTitle} ${
          restaurantName ? `at ${restaurantName}` : ""
        } - Video | MealScout`}
        description={videoDescription}
        keywords={`${videoTitle}, ${videoData.cuisine || "food"} video, ${
          restaurantName || "food recommendation"
        }, local food`}
        canonicalUrl={`https://www.mealscout.us${canonicalPath}`}
        schemaData={videoSchema}
        noIndex={noIndex}
      />

      <BackHeader
        title="Video"
        fallbackHref="/video"
        icon={Video}
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
      />

      {/* Video Player */}
      <div className="relative w-full bg-black aspect-[9/16]">
        {videoData.videoUrl ? (
          <video
            src={videoData.videoUrl}
            poster={videoData.thumbnailUrl}
            controls
            className="w-full h-full object-contain"
            playsInline
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white">
            <div className="text-center">
              <Video className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-sm">Video not available</p>
            </div>
          </div>
        )}
      </div>

      {/* Video Info */}
      <div className="px-4 sm:px-6 py-6 space-y-6">
        {/* Title and Description */}
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {videoTitle}
          </h1>
          {videoData.description && (
            <p className="text-[color:var(--text-secondary)] leading-relaxed">
              {videoData.description}
            </p>
          )}
          <div className="mt-3">
            <ShareButton
              url={canonicalPath}
              title={videoTitle}
              description={videoDescription}
              size="sm"
              variant="outline"
              className="w-full justify-center"
              onShareAction={async () => {
                try {
                  await fetch(`/api/stories/${videoId}/share`, {
                    method: "POST",
                    credentials: "include",
                  });
                } catch {
                  // no-op
                }
              }}
            />
          </div>
        </div>

        {/* Metadata */}
        <div className="flex flex-wrap gap-2">
          {videoData.cuisine && (
            <Badge variant="secondary">{videoData.cuisine}</Badge>
          )}
          {videoData.hashtags &&
            videoData.hashtags.length > 0 &&
            videoData.hashtags.map((tag: string) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
        </div>

        {/* Creator & Restaurant */}
        <div className="space-y-3">
          <div className="flex items-center space-x-2 text-sm text-[color:var(--text-secondary)]">
            <User className="w-4 h-4" />
            <span>{creatorName}</span>
          </div>
          {restaurantName && (
            <div className="flex items-center space-x-2 text-sm text-[color:var(--text-secondary)]">
              <MapPin className="w-4 h-4" />
              <Link
                href={`/restaurant/${videoData.restaurantId}`}
                className="hover:text-primary"
              >
                {restaurantName}
              </Link>
            </div>
          )}
          <div className="flex items-center space-x-2 text-sm text-[color:var(--text-secondary)]">
            <Calendar className="w-4 h-4" />
            <span>{new Date(videoData.createdAt).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Engagement */}
        <div className="flex items-center space-x-4 pt-4 border-t border-[color:var(--border-subtle)]">
          <Button variant="outline" size="sm">
            <Heart className="w-4 h-4 mr-2" />
            {videoData.likeCount || 0}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                await fetch(`/api/stories/${videoId}/share`, {
                  method: "POST",
                  credentials: "include",
                });
              } catch {
                // no-op
              }
            }}
          >
            <Share2 className="w-4 h-4 mr-2" />
            Share
          </Button>
        </div>

        {/* Transcript - Hidden by default, crawlable */}
        {videoData.transcript && (
          <VideoTranscript
            transcript={videoData.transcript}
            language={videoData.transcriptLanguage || "en"}
            className="mt-6"
          />
        )}

        {/* Restaurant CTA */}
        {restaurantData && (
          <div className="bg-[linear-gradient(110deg,rgba(255,77,46,0.08),rgba(245,158,11,0.08))] p-4 rounded-xl border border-[color:var(--border-subtle)]">
            <h3 className="font-semibold mb-2">{restaurantName}</h3>
            <p className="text-sm text-[color:var(--text-secondary)] mb-3">
              {location}
            </p>
            <Link href={`/restaurant/${videoData.restaurantId}`}>
              <Button className="w-full">View Restaurant & Deals</Button>
            </Link>
          </div>
        )}

        {/* FAQ Section - SEO optimized, minimal UI */}
        <div className="pt-8 border-t border-[color:var(--border-subtle)]">
          <MinimalFAQ items={faqItems} title="About This Video" />
        </div>
      </div>

      <Navigation />
    </div>
  );
}
