import React, { useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserFlagsHistory } from "@/components/moderation/FlagDialogs";
import {
  TrendingUp,
  AlertCircle,
  CheckCircle,
  HelpCircle,
} from "lucide-react";

export function ReporterReputationPage() {
  const { data: reputation, isLoading } = useQuery({
    queryKey: ["reporter-reputation"],
    queryFn: async () => {
      const response = await fetch("/api/user/reporter-reputation");
      if (!response.ok) throw new Error("Failed to fetch reputation");
      return response.json();
    },
  });

  if (isLoading) {
    return <div className="p-4">Loading reputation...</div>;
  }

  const score = reputation?.score || 100;
  const scorePercent = ((score - 10) / 90) * 100; // Scale from 10-100
  const successRate =
    reputation?.flaggedCount > 0
      ? (reputation?.uptakenCount / reputation?.flaggedCount) * 100
      : 0;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* Main Reputation Card */}
      <Card className="md:col-span-3">
        <CardHeader>
          <CardTitle>Community Trust Score</CardTitle>
          <CardDescription>
            Your reputation affects how other users weigh your contributions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-5xl font-bold">{score}</div>
                <div className="text-muted-foreground">out of 100 maximum</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Good Standing</div>
                <Badge variant={score > 70 ? "default" : "secondary"}>
                  {score > 80
                    ? "Excellent"
                    : score > 60
                      ? "Good"
                      : score > 40
                        ? "Fair"
                        : "Low"}
                </Badge>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-2">
                <span>Reputation Progress</span>
                <span className="text-muted-foreground">{scorePercent.toFixed(0)}%</span>
              </div>
              <Progress value={Math.max(0, scorePercent)} className="h-2" />
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-4">
            <Card className="bg-muted/50">
              <CardContent className="pt-6">
                <div className="text-3xl font-bold">
                  {reputation?.flaggedCount || 0}
                </div>
                <div className="text-xs text-muted-foreground">Reports Filed</div>
              </CardContent>
            </Card>

            <Card className="bg-green-50">
              <CardContent className="pt-6">
                <div className="text-3xl font-bold text-green-600">
                  {reputation?.uptakenCount || 0}
                </div>
                <div className="text-xs text-green-600">Reports Upheld</div>
              </CardContent>
            </Card>

            <Card className="bg-red-50">
              <CardContent className="pt-6">
                <div className="text-3xl font-bold text-red-600">
                  {reputation?.falseFlagCount || 0}
                </div>
                <div className="text-xs text-red-600">False Reports</div>
              </CardContent>
            </Card>

            <Card className="bg-blue-50">
              <CardContent className="pt-6">
                <div className="text-3xl font-bold text-blue-600">
                  {successRate.toFixed(0)}%
                </div>
                <div className="text-xs text-blue-600">Accuracy Rate</div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      {/* How It Works */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>How Reputation Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Valid Report</div>
              <div className="text-muted-foreground">+5 points for reports upheld by moderators</div>
            </div>
          </div>

          <div className="flex gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Invalid Report</div>
              <div className="text-muted-foreground">-10 points for reports dismissed</div>
            </div>
          </div>

          <div className="flex gap-3">
            <HelpCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Partial Report</div>
              <div className="text-muted-foreground">+2 points for reports with mixed validity</div>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded p-3 mt-4">
            <div className="font-medium text-xs text-blue-900 mb-1">
              Anti-Brigading
            </div>
            <div className="text-xs text-blue-700">
              Reports from users with higher reputation scores carry more weight
              in our moderation process.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Guidelines */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reporting Guidelines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <div className="font-medium mb-1">✅ Do Report</div>
            <ul className="text-muted-foreground text-xs space-y-1">
              <li>• Genuinely false information</li>
              <li>• Spam or promotional content</li>
              <li>• Abusive or inappropriate language</li>
              <li>• Off-topic or irrelevant content</li>
            </ul>
          </div>

          <div>
            <div className="font-medium mb-1">❌ Don't Report</div>
            <ul className="text-muted-foreground text-xs space-y-1">
              <li>• Differing opinions</li>
              <li>• Negative but honest reviews</li>
              <li>• Factual disputes without evidence</li>
              <li>• Content you simply dislike</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Flag History */}
      <Card className="md:col-span-3">
        <CardHeader>
          <CardTitle>Your Reports</CardTitle>
          <CardDescription>History of reports you've submitted</CardDescription>
        </CardHeader>
        <CardContent>
          <UserFlagsHistory />
        </CardContent>
      </Card>
    </div>
  );
}

export default ReporterReputationPage;
