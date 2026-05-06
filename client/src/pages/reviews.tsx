import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import Navigation from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Star,
  ArrowLeft,
  User,
  Calendar,
  AlertCircle,
} from "lucide-react";
import { getOptimizedImageUrl } from "@/lib/images";
import { CriticBadge } from "@/components/award-badges";
import { isCriticAccount } from "@/lib/critic";

interface Review {
  id: string;
  userId: string;
  restaurantId: string;
  rating: number;
  reviewText: string;
  createdAt: string;
  user?: {
    firstName: string;
    lastName: string;
    profileImageUrl?: string;
    accountSettings?: unknown;
    hasGoldenFork?: boolean;
    influenceScore?: number;
  };
}

interface Restaurant {
  id: string;
  name: string;
  cuisineType: string;
  averageRating?: number;
  totalReviews?: number;
}

export default function ReviewsPage() {
  const { restaurantId } = useParams() as { restaurantId: string };
  const [newRating, setNewRating] = useState(0);
  const [newReviewText, setNewReviewText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch restaurant details
  const { data: restaurant } = useQuery<Restaurant>({
    queryKey: [`/api/restaurants/${restaurantId}`],
    enabled: !!restaurantId,
  });

  // Fetch reviews for this restaurant
  const { data: reviews = [], isLoading } = useQuery<Review[]>({
    queryKey: [`/api/reviews/restaurant/${restaurantId}`],
    enabled: !!restaurantId,
  });

  // Submit review mutation
  const submitReviewMutation = useMutation({
    mutationFn: async (reviewData: { rating: number; reviewText: string }) => {
      return await apiRequest("POST", "/api/reviews", {
        ...reviewData,
        restaurantId,
        comment: reviewData.reviewText,
      });
    },
    onSuccess: () => {
      toast({
        title: "Review Posted",
        description: "Thank you for sharing your feedback!",
      });
      setNewRating(0);
      setNewReviewText("");
      setIsSubmitting(false);
      // Invalidate and refetch reviews
      queryClient.invalidateQueries({
        queryKey: [`/api/reviews/restaurant/${restaurantId}`],
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description:
          error.message || "Failed to post review. Please try again.",
        variant: "destructive",
      });
      setIsSubmitting(false);
    },
  });

  const handleSubmitReview = () => {
    if (newRating === 0) {
      toast({
        title: "Rating Required",
        description: "Please select a star rating before submitting.",
        variant: "destructive",
      });
      return;
    }

    if (newReviewText.trim().length < 10) {
      toast({
        title: "Review Too Short",
        description: "Please write at least 10 characters in your review.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    submitReviewMutation.mutate({
      rating: newRating,
      reviewText: newReviewText.trim(),
    });
  };

  const renderStars = (
    rating: number,
    interactive: boolean = false,
    size: "sm" | "md" | "lg" = "md",
  ) => {
    const starSize =
      size === "sm" ? "w-4 h-4" : size === "md" ? "w-5 h-5" : "w-6 h-6";

    return (
      <div className="flex items-center space-x-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => interactive && setNewRating(star)}
            disabled={!interactive}
            className={`${starSize} ${
              interactive
                ? "cursor-pointer hover:scale-110 transition-transform"
                : "cursor-default"
            }`}
            data-testid={`star-${star}`}
          >
            <Star
              className={`w-full h-full ${
                star <= rating
                  ? "fill-[color:var(--status-warning)] text-[color:var(--status-warning)]"
                  : "fill-none text-[color:var(--border-strong)]"
              }`}
            />
          </button>
        ))}
      </div>
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const averageRating =
    reviews.length > 0
      ? (
          reviews.reduce((sum, review) => sum + review.rating, 0) /
          reviews.length
        ).toFixed(1)
      : "0.0";

  return (
    <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen relative pb-20">
      {/* Header */}
      <header className="px-4 sm:px-6 py-6 bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean">
        <div className="flex items-center space-x-4 mb-4">
          <Link href={`/restaurant/${restaurantId}`}>
            <Button variant="ghost" size="sm" className="p-2">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Reviews</h1>
            <p className="text-sm text-muted-foreground">
              {restaurant?.name || "Loading..."}
            </p>
          </div>
        </div>

        {/* Rating Summary */}
        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center space-x-3">
            <div className="text-3xl font-bold text-foreground">
              {averageRating}
            </div>
            <div>
              {renderStars(parseFloat(averageRating), false, "md")}
              <div className="text-sm text-muted-foreground mt-1">
                {reviews.length} review{reviews.length !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="px-4 sm:px-6 py-6 space-y-6">
        {/* Write Review Section */}
        <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
          <CardHeader>
            <CardTitle className="text-lg">Write a Review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Rating Stars */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Your Rating
              </label>
              {renderStars(newRating, true, "lg")}
            </div>

            {/* Review Text */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Your Review
              </label>
              <Textarea
                value={newReviewText}
                onChange={(e) => setNewReviewText(e.target.value)}
                placeholder="Share your experience at this restaurant..."
                className="min-h-24 resize-none"
                maxLength={500}
                data-testid="textarea-review"
              />
              <div className="text-right text-xs text-muted-foreground mt-1">
                {newReviewText.length}/500
              </div>
            </div>

            {/* Submit Button */}
            <Button
              onClick={handleSubmitReview}
              disabled={
                isSubmitting ||
                newRating === 0 ||
                newReviewText.trim().length < 10
              }
              className="w-full"
              data-testid="button-submit-review"
            >
              {isSubmitting ? "Posting..." : "Post Review"}
            </Button>
          </CardContent>
        </Card>

        {/* Reviews List */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            All Reviews ({reviews.length})
          </h2>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Card
                  key={i}
                  className="animate-pulse bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean"
                >
                  <CardContent className="p-4">
                    <div className="flex space-x-3">
                      <div className="w-10 h-10 bg-muted rounded-full" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-muted rounded w-1/2" />
                        <div className="h-3 bg-muted rounded w-1/3" />
                        <div className="h-16 bg-muted rounded" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : reviews.length > 0 ? (
            <div className="space-y-4">
              {reviews.map((review) => (
                <Card
                  key={review.id}
                  className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean"
                >
                  <CardContent className="p-4">
                    <div className="flex space-x-3">
                      {/* User Avatar */}
                      <div className="flex-shrink-0">
                        {review.user?.profileImageUrl ? (
                          <img
                            src={getOptimizedImageUrl(
                              review.user.profileImageUrl,
                              "medium",
                            )}
                            alt="User avatar"
                            className="w-10 h-10 rounded-full object-cover"
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <User className="w-5 h-5 text-primary" />
                          </div>
                        )}
                      </div>

                      {/* Review Content */}
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <div className="flex items-center gap-2 font-semibold text-sm text-foreground">
                              <span>
                                {review.user
                                  ? `${review.user.firstName} ${review.user.lastName}`
                                  : "Anonymous User"}
                              </span>
                              {isCriticAccount(review.user) && (
                                <CriticBadge size="sm" />
                              )}
                            </div>
                            <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                              <Calendar className="w-3 h-3" />
                              <span>{formatDate(review.createdAt)}</span>
                            </div>
                          </div>
                          {renderStars(review.rating, false, "sm")}
                        </div>

                        <p className="text-sm text-foreground leading-relaxed">
                          {review.reviewText}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean">
              <CardContent className="p-8 text-center">
                <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  No Reviews Yet
                </h3>
                <p className="text-muted-foreground text-sm">
                  Be the first to share your experience at this restaurant!
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Navigation />
    </div>
  );
}
