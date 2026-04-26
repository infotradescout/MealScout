import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FlagProfileContentDialog } from "@/components/moderation/FlagDialogs";
import {
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle,
  Shield,
} from "lucide-react";

interface RestaurantTrustStats {
  restaurantId: string;
  totalFlags: number;
  flagsUpheld: number;
  flagsDismissed: number;
  flagsPartial: number;
  profileAccuracyScore: number; // 0-100
  activeDisputes: number;
  resolvedDisputes: number;
  lastFlagDate?: string;
  trend: "improving" | "declining" | "stable";
  scoreBreakdown?: {
    verificationBaseline?: number;
    ownerAttachmentBonus?: number;
    moderationPenalty?: number;
    rawScore?: number;
  };
}

export function RestaurantTrustPanel({
  restaurantId,
}: {
  restaurantId: string;
}) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["restaurant-trust", restaurantId],
    retry: false,
    queryFn: async () => {
      const response = await fetch(
        `/api/restaurants/${restaurantId}/trust-stats`,
      );
      if (!response.ok) return null;
      return response.json() as Promise<RestaurantTrustStats>;
    },
  });

  if (isLoading) {
    return <div className="p-4">Loading trust information...</div>;
  }

  if (!stats) {
    return null;
  }

  const accuracyPercent = stats.profileAccuracyScore;
  const upheldPercent =
    stats.totalFlags > 0 ? (stats.flagsUpheld / stats.totalFlags) * 100 : 0;

  const getTrendIcon = () => {
    if (stats.trend === "improving") {
      return <TrendingUp className="h-4 w-4 text-green-500" />;
    } else if (stats.trend === "declining") {
      return <TrendingDown className="h-4 w-4 text-red-500" />;
    } else {
      return <Shield className="h-4 w-4 text-blue-500" />;
    }
  };

  const getTrustLevel = () => {
    if (accuracyPercent >= 81) return "Local Legends";
    if (accuracyPercent >= 61) return "Hot Spot";
    if (accuracyPercent >= 41) return "Average";
    if (accuracyPercent >= 21) return "On The Rise";
    return "Underdog";
  };

  const getTrustBadgeVariant = (): "default" | "secondary" | "destructive" | "outline" => {
    if (accuracyPercent >= 81) return "default";
    if (accuracyPercent >= 61) return "secondary";
    if (accuracyPercent >= 41) return "outline";
    if (accuracyPercent >= 21) return "outline";
    return "destructive";
  };

  const getTrustBadgeClassName = () => {
    if (accuracyPercent >= 81) return "";
    if (accuracyPercent >= 61) return "";
    if (accuracyPercent >= 41) return "border-amber-300 text-amber-700";
    if (accuracyPercent >= 21) return "border-orange-300 text-orange-700";
    return "";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Community Trust Profile
          </CardTitle>
          <CardDescription>
            Based on community feedback and moderation decisions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Main Trust Score */}
          <div className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-4xl font-bold">{accuracyPercent}%</div>
                <div className="text-sm text-muted-foreground">
                  Profile Accuracy Score
                </div>
              </div>
              <div className="flex items-center gap-2">
                {getTrendIcon()}
                <Badge
                  variant={getTrustBadgeVariant()}
                  className={getTrustBadgeClassName()}
                >
                  {getTrustLevel()}
                </Badge>
              </div>
            </div>
            <Progress value={accuracyPercent} className="h-2" />
          </div>

          {/* Stats Grid */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Flagged Content */}
            <Card className="bg-muted/50">
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Community Flags</span>
                    <span className="text-2xl font-bold">
                      {stats.totalFlags}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-green-600">Upheld</span>
                      <span className="font-medium">
                        {stats.flagsUpheld} ({upheldPercent.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-blue-600">Dismissed</span>
                      <span className="font-medium">{stats.flagsDismissed}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-yellow-600">Partial</span>
                      <span className="font-medium">{stats.flagsPartial}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Disputes */}
            <Card className="bg-muted/50">
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">Active Disputes</span>
                      <span className="text-xl font-bold">
                        {stats.activeDisputes}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">Resolved</span>
                      <span className="text-xl font-bold">
                        {stats.resolvedDisputes}
                      </span>
                    </div>

                    {stats.lastFlagDate && (
                      <div className="flex justify-between pt-2 border-t">
                        <span className="text-muted-foreground">
                          Last Flag
                        </span>
                        <span className="text-xs">
                          {new Date(stats.lastFlagDate).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Info Boxes */}
          {upheldPercent > 30 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This business has several upheld community flags. Profile
                information may be inaccurate. Use caution when relying on
                listed details.
              </AlertDescription>
            </Alert>
          )}

          {stats.activeDisputes > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {stats.activeDisputes} community flag
                {stats.activeDisputes > 1 ? "s" : ""} currently under review.
                We'll update information as disputes are resolved.
              </AlertDescription>
            </Alert>
          )}

          {accuracyPercent >= 95 && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-900">
                This business maintains excellent profile accuracy as verified
                by community moderation.
              </AlertDescription>
            </Alert>
          )}

          {/* Report Section */}
          <div className="border-t pt-4">
            <div className="text-sm">
              <p className="font-medium mb-2">
                Found inaccurate information?
              </p>
              <p className="text-muted-foreground text-xs mb-3">
                Help keep the community informed by reporting profile issues.
                Our moderators review reports for policy compliance.
              </p>
              <FlagProfileContentDialog restaurantId={restaurantId} />
            </div>
          </div>

          {/* Explanation */}
          <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm">
            <p className="font-medium text-blue-900 mb-2">
              What This Score Means
            </p>
            <ul className="text-xs text-blue-800 space-y-1">
              <li>
                ✓ Community Verification Score (CVS) rates listing reliability on a 0-100 scale.
              </li>
              <li>
                ✓ Verified and active businesses start with a baseline; reliability bonuses and moderation penalties adjust that baseline.
              </li>
              <li>
                ✓ Upheld moderation outcomes reduce score more than active (still-open) disputes.
              </li>
              <li>
                ✓ This is not a simple "flags received" count; final score reflects review outcomes over time.
              </li>
              <li>
                ✓ Higher score means the community can trust the listing details more.
              </li>
            </ul>
            <div className="mt-3 border-t border-blue-200 pt-3">
              <p className="text-xs font-medium text-blue-900 mb-1">Tier Guide</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs text-blue-800">
                <span>1-20: Underdog</span>
                <span>21-40: On The Rise</span>
                <span>41-60: Average</span>
                <span>61-80: Hot Spot</span>
                <span>81-100: Local Legends</span>
              </div>
            </div>
            {stats.scoreBreakdown ? (
              <div className="mt-3 border-t border-blue-200 pt-3 text-xs text-blue-800">
                Baseline {stats.scoreBreakdown.verificationBaseline ?? 0}
                {" + Bonus "}
                {stats.scoreBreakdown.ownerAttachmentBonus ?? 0}
                {" - Penalty "}
                {stats.scoreBreakdown.moderationPenalty ?? 0}
                {" = Raw "}
                {stats.scoreBreakdown.rawScore ?? accuracyPercent}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function RestaurantTrustBadge({ restaurantId }: { restaurantId: string }) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["restaurant-trust-badge", restaurantId],
    retry: false,
    queryFn: async () => {
      const response = await fetch(
        `/api/restaurants/${restaurantId}/trust-stats`,
      );
      if (!response.ok) return null;
      return response.json() as Promise<RestaurantTrustStats>;
    },
  });

  if (isLoading || !stats) return null;

  const getTrustColor = () => {
    if (stats.profileAccuracyScore >= 81) return "text-green-600";
    if (stats.profileAccuracyScore >= 61) return "text-blue-600";
    if (stats.profileAccuracyScore >= 41) return "text-yellow-600";
    if (stats.profileAccuracyScore >= 21) return "text-orange-600";
    return "text-red-600";
  };

  return (
    <div className="flex items-center gap-1">
      <Shield className={`h-4 w-4 ${getTrustColor()}`} />
      <span className="text-xs font-medium">{stats.profileAccuracyScore}%</span>
    </div>
  );
}
