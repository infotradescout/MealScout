import React, { useState, useEffect, useRef, useReducer } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { VIDEO_FEED_COPY as COPY } from '@/copy/videoFeed.copy';
import ShareButton from '@/components/share-button';

/**
 * Video Feed v1 - COPY + TYPE LOCK
 * - User videos are recommendations, never ads
 * - Restaurant videos are ads, never recommendations
 * - Do not merge UI, copy, or limits
 * - Do not add boosts or payments to user videos
 */

type VideoFeedState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error' };

type VideoFeedEvent =
  | { type: 'LOAD_FEED' }
  | { type: 'LOAD_SUCCESS' }
  | { type: 'LOAD_ERROR' }
  | { type: 'RETRY' };

function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

function videoFeedTransition(state: VideoFeedState, event: VideoFeedEvent): VideoFeedState {
  switch (state.state) {
    case 'idle':
      if (event.type === 'LOAD_FEED') return { state: 'loading' };
      return state;
    case 'loading':
      if (event.type === 'LOAD_SUCCESS') return { state: 'ready' };
      if (event.type === 'LOAD_ERROR') return { state: 'error' };
      return state;
    case 'error':
      if (event.type === 'RETRY') return { state: 'loading' };
      return state;
    case 'ready':
      return state;
    default:
      return assertNever(state as never);
  }
}

interface ApiStory {
  id: string;
  userId?: string;
  restaurantId?: string;
  title: string;
  description?: string;
  duration?: number;
  videoUrl?: string;
  thumbnailUrl?: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  createdAt?: string;
  expiresAt?: string;
  userLiked?: boolean;
  isRecommendation?: boolean;
  __type?: 'ad';
  mediaUrl?: string;
  targetUrl?: string;
  ctaText?: string;
  isHouseAd?: boolean;
  isAffiliate?: boolean;
  affiliateName?: string | null;
}

type UserRecommendationVideo = {
  kind: 'user';
  videoId: string;
  restaurantId?: string;
  isRecommendation: boolean;
  title: string;
  description?: string;
  duration?: number;
  videoUrl: string;
  thumbnailUrl?: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  createdAt?: string;
  userLiked?: boolean;
  expiresAt?: string;
  isGoldenFork?: boolean;
};

type RestaurantAdVideo = {
  kind: 'restaurant';
  videoId: string;
  campaignId: string;
  title: string;
  mediaUrl?: string;
  targetUrl: string;
  ctaText: string;
  isHouseAd?: boolean;
  isAffiliate?: boolean;
  affiliateName?: string | null;
};

type FeedVideoItem = UserRecommendationVideo | RestaurantAdVideo;

interface UserVideoCardProps {
  video: UserRecommendationVideo;
  isVisible: boolean;
}

function UserVideoCard({ video, isVisible }: UserVideoCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [liked, setLiked] = useState(!!video.userLiked);
  const [likeCount, setLikeCount] = useState(video.likeCount);
  const [isLoadingLike, setIsLoadingLike] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const watchStartRef = useRef<number>(0);

  useEffect(() => {
    const target = videoRef.current;
    if (!(target instanceof Element) || !isVisible) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            videoRef.current?.play();
          } else {
            videoRef.current?.pause();
          }
        });
      },
      { threshold: 0.5 }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [isVisible]);

  const handlePlay = () => {
    watchStartRef.current = Date.now();
  };

  const handleEnded = async () => {
    const watchDuration = Math.round((Date.now() - watchStartRef.current) / 1000);
    try {
      await fetch(`/api/stories/${video.videoId}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchDuration }),
      });
    } catch (err) {
      console.error('Error recording view:', err);
    }
  };

  const handleLike = async () => {
    setIsLoadingLike(true);
    try {
      const response = await fetch(`/api/stories/${video.videoId}/like`, {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        setLiked(data.liked);
        setLikeCount((prev) => (data.liked ? prev + 1 : Math.max(0, prev - 1)));
      }
    } catch (err) {
      console.error('Error liking story:', err);
    } finally {
      setIsLoadingLike(false);
    }
  };

  const trackShare = async () => {
    try {
      await fetch(`/api/stories/${video.videoId}/share`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.error('Error recording story share:', err);
    }
  };

  return (
    <div className="bg-[var(--bg-card)] text-[color:var(--text-primary)] rounded-lg overflow-hidden mb-4">
      {/* Video */}
      <div className="relative bg-[var(--bg-app)] aspect-[9/16] flex items-center justify-center">
        <video
          ref={videoRef}
          src={video.videoUrl}
          poster={video.thumbnailUrl}
          onPlay={handlePlay}
          onEnded={handleEnded}
          controls
          className="w-full h-full object-cover"
        />
      </div>

      {/* Story Info */}
      <div className="p-4">
        {video.isRecommendation && (
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[color:var(--status-warning)]/15 text-[color:var(--status-warning)] border border-[color:var(--status-warning)]/40">
              {COPY.userVideo.badge}
            </span>
          </div>
        )}
        <h3 className="font-semibold text-lg mb-1">{video.title}</h3>
        {video.description && (
          <p className="text-[color:var(--text-muted)] text-sm mb-3 line-clamp-2">
            {video.description}
          </p>
        )}

        {/* Engagement Stats */}
        <div className="flex gap-4 mb-4 text-sm text-[color:var(--text-muted)]">
          <div>
            Views: {video.viewCount} {COPY.userVideo.engagement.viewsLabel}
          </div>
          <div>
            Comments: {video.commentCount} {COPY.userVideo.engagement.commentsLabel}
          </div>
        </div>

        {/* Interaction Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleLike}
            disabled={isLoadingLike}
            className={`flex-1 py-2 px-4 rounded font-medium transition ${
              liked
                ? 'bg-[color:var(--status-error)]/100 hover:bg-[color:var(--status-error)]'
                : 'bg-[var(--bg-surface-muted)] hover:bg-[var(--bg-surface)]'
            } disabled:opacity-50`}
          >
            {liked ? COPY.userVideo.actions.liked : COPY.userVideo.actions.like} {likeCount > 0 && `(${likeCount})`}
          </button>
          <button
            onClick={() => setShowComments(!showComments)}
            className="flex-1 py-2 px-4 bg-[var(--bg-surface-muted)] hover:bg-[var(--bg-surface)] rounded font-medium transition"
          >
            {COPY.userVideo.actions.comment}
          </button>
        </div>
        <div className="mt-3">
          <ShareButton
            url={`/video/${video.videoId}`}
            title={video.title || "Food recommendation"}
            description={video.description || "Watch this food recommendation on MealScout."}
            size="sm"
            variant="outline"
            className="w-full justify-center"
            onShareAction={trackShare}
          />
        </div>

        {/* Comments Section */}
        {showComments && (
          <div className="mt-4 pt-4 border-t border-[var(--border-strong)]">
            <p className="text-sm text-[color:var(--text-muted)]">{COPY.userVideo.comments.placeholder}</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface RestaurantAdCardProps {
  video: RestaurantAdVideo;
}

function RestaurantAdCard({ video }: RestaurantAdCardProps) {
  return (
    <div className="bg-[var(--bg-card)] text-[color:var(--text-primary)] rounded-lg overflow-hidden mb-4 border border-[var(--border-subtle)]">
      <div className="relative bg-[var(--bg-app)] aspect-[9/16] flex items-center justify-center">
        {video.mediaUrl ? (
          <video
            src={video.mediaUrl}
            className="w-full h-full object-cover"
            muted
            loop
            playsInline
            controls
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full text-[color:var(--text-muted)] text-sm">
            {video.title}
          </div>
        )}
        <div className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-[var(--bg-surface)]/80 text-xs uppercase tracking-wide text-[color:var(--text-secondary)] border border-[var(--border-strong)]">
          {COPY.restaurantAd.badge}
        </div>
      </div>

      <div className="p-4 space-y-2">
        <h3 className="font-semibold text-base">{video.title}</h3>
        {video.affiliateName && (
          <p className="text-xs text-[color:var(--text-muted)]">{video.affiliateName}</p>
        )}
        <div className="pt-2">
          <a
            href={video.targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-[var(--bg-subtle)] text-[color:var(--text-primary)] text-sm font-semibold hover:bg-[var(--bg-surface)] transition"
          >
            {video.ctaText || COPY.restaurantAd.learnMore}
          </a>
        </div>
        <ShareButton
          url={`/video/${video.videoId}`}
          title={video.title || "Food video"}
          description="Watch this video on MealScout."
          size="sm"
          variant="outline"
          className="w-full justify-center"
        />
      </div>
    </div>
  );
}

interface VideoFeedProps {
  onUploadClick?: () => void;
}

export function VideoFeed({ onUploadClick }: VideoFeedProps) {
  const [feedState, dispatch] = useReducer(videoFeedTransition, { state: 'idle' });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ['stories-feed'],
    queryFn: async ({ pageParam = 0 }) => {
      const response = await fetch(`/api/stories/feed?page=${pageParam}`);
      if (!response.ok) throw new Error('Failed to fetch stories');
      return response.json();
    },
    getNextPageParam: (lastPage, pages) =>
      lastPage.hasMore ? pages.length : undefined,
    initialPageParam: 0,
  });

  const observerTarget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === 'pending') {
      dispatch({ type: 'LOAD_FEED' });
    } else if (status === 'success') {
      dispatch({ type: 'LOAD_SUCCESS' });
    } else if (status === 'error') {
      dispatch({ type: 'LOAD_ERROR' });
    }
  }, [status]);

  useEffect(() => {
    const target = observerTarget.current;
    if (!(target instanceof Element)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (feedState.state === 'loading') {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[color:var(--accent-text)]" aria-label={COPY.feed.loading} />
      </div>
    );
  }

  if (feedState.state === 'error') {
    return (
      <div className="p-6 text-center">
        <p className="text-[color:var(--status-error)] mb-4">{COPY.feed.error}</p>
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'RETRY' });
            // Let react-query refetch using its existing behavior
            void fetchNextPage();
          }}
          className="inline-flex items-center px-4 py-2 rounded-md bg-[color:var(--status-error)] text-white text-sm font-medium hover:bg-[color:var(--status-error)] transition"
        >
          {COPY.feed.retry}
        </button>
      </div>
    );
  }

  const stories: ApiStory[] = data?.pages.flatMap((page: any) => page.stories as ApiStory[]) || [];

  const feedItems: FeedVideoItem[] = stories.reduce<FeedVideoItem[]>((acc, item) => {
    if (!item) return acc;

    if (item.__type === 'ad' && item.targetUrl) {
      const adVideo: RestaurantAdVideo = {
        kind: 'restaurant',
        videoId: item.id,
        campaignId: item.id,
        title: item.title,
        mediaUrl: item.mediaUrl,
        targetUrl: item.targetUrl,
        ctaText: item.ctaText || COPY.restaurantAd.ctaDefault,
        isHouseAd: item.isHouseAd,
        isAffiliate: item.isAffiliate,
        affiliateName: item.affiliateName ?? undefined,
      };
      acc.push(adVideo);
      return acc;
    }

    if (item.videoUrl) {
      const userVideo: UserRecommendationVideo = {
        kind: 'user',
        videoId: item.id,
        restaurantId: item.restaurantId,
        isRecommendation: item.isRecommendation ?? false,
        title: item.title,
        description: item.description,
        duration: item.duration,
        videoUrl: item.videoUrl,
        thumbnailUrl: item.thumbnailUrl,
        viewCount: item.viewCount ?? 0,
        likeCount: item.likeCount ?? 0,
        commentCount: item.commentCount ?? 0,
        createdAt: item.createdAt,
        userLiked: item.userLiked,
        expiresAt: item.expiresAt,
      };
      acc.push(userVideo);
    }

    return acc;
  }, []);

  if (feedItems.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-[color:var(--text-muted)] mb-4">{COPY.feed.empty}</p>
        {onUploadClick && (
          <button
            onClick={onUploadClick}
            className="px-6 py-2 bg-[color:var(--accent-text)] text-white rounded-lg hover:bg-[color:var(--accent-text-hover)]"
          >
             {COPY.feed.emptyCta}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      {/* Upload Button */}
      {onUploadClick && (
        <button
          onClick={onUploadClick}
          className="w-full mb-4 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 transition"
        >
           {COPY.feed.uploadCta}
        </button>
      )}

      {/* Stories Feed */}
      {feedItems.map((item) =>
        item.kind === 'user' ? (
          <UserVideoCard key={item.videoId} video={item} isVisible={true} />
        ) : (
          <RestaurantAdCard key={item.videoId} video={item} />
        )
      )}

      {/* Loading indicator */}
      {isFetchingNextPage && (
        <div className="flex justify-center py-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      )}

      {/* Intersection observer target */}
      <div ref={observerTarget} />
    </div>
  );
}


