/**
 * OwnerOnboardingChecklist
 *
 * Owner-facing setup progress widget. Hits GET /api/owner/onboarding and
 * shows the 6-step checklist with a progress bar and a clear next-step CTA.
 *
 * Auto-hides once everything is done, so it's not noise for established owners.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CheckCircle2, Circle, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { apiUrl } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface OnboardingStep {
  id: string;
  label: string;
  done: boolean;
  href: string;
  cta: string;
  why: string;
}

interface OnboardingResponse {
  completed: number;
  total: number;
  percent: number;
  allDone: boolean;
  nextStep: OnboardingStep | null;
  steps: OnboardingStep[];
  counts: { restaurants: number; menus: number; items: number };
}

const DISMISS_KEY = "ms-onboarding-dismissed-complete";

export default function OwnerOnboardingChecklist() {
  const [collapsed, setCollapsed] = useState(false);

  const { data, isLoading } = useQuery<OnboardingResponse>({
    queryKey: ["owner-onboarding"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/owner/onboarding"), {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  if (isLoading || !data) return null;

  // Auto-hide once everything is done and user has dismissed the celebration.
  if (data.allDone && localStorage.getItem(DISMISS_KEY) === "1") {
    return null;
  }

  if (data.allDone) {
    return (
      <Card className="mb-6 border-emerald-300 bg-emerald-50/40">
        <CardContent className="py-4 flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-semibold text-emerald-900">
              You're all set up!
            </div>
            <div className="text-sm text-emerald-800">
              {data.counts.menus} menu{data.counts.menus === 1 ? "" : "s"} •{" "}
              {data.counts.items} item{data.counts.items === 1 ? "" : "s"} live.
              Customers can now find you.
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              localStorage.setItem(DISMISS_KEY, "1");
              setCollapsed(true);
            }}
          >
            <X className="w-4 h-4" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (collapsed) return null;

  const next = data.nextStep;

  return (
    <Card className="mb-6 border-orange-300 bg-orange-50/30">
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div>
            <div className="font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-orange-500" />
              Get set up — {data.completed} of {data.total} done
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {next ? next.why : "Finish the last steps to go live."}
            </div>
          </div>
          {next && (
            <Link href={next.href}>
              <Button size="sm">{next.cta}</Button>
            </Link>
          )}
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-orange-100 rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-orange-500 transition-all"
            style={{ width: `${data.percent}%` }}
          />
        </div>

        {/* Step list */}
        <ul className="space-y-1">
          {data.steps.map((step) => (
            <li
              key={step.id}
              className="flex items-center gap-2 text-sm"
            >
              {step.done ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
              <span
                className={
                  step.done
                    ? "line-through text-muted-foreground"
                    : "font-medium"
                }
              >
                {step.label}
              </span>
              {!step.done && (
                <Link
                  href={step.href}
                  className="text-xs text-orange-600 hover:underline ml-auto"
                >
                  {step.cta} →
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
