import RoleLandingPage from "@/components/role-landing";
import { roleLandingContent } from "@/content/role-landing";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ForHosts() {
  return (
    <RoleLandingPage
      content={roleLandingContent.hosts}
      discoverySlot={
        <Card className="border shadow-clean-lg">
          <CardContent className="p-6 space-y-3">
            <h2 className="text-xl font-semibold text-[var(--ink-dark)]">
              Non-food business with parking space?
            </h2>
            <p className="text-sm text-[var(--ink-dark-muted)]">
              Offices, retail centers, warehouses, churches, campuses, and
              community lots can qualify as MealScout host locations.
            </p>
            <Link href="/host-location-partner">
              <Button>Request Host Partnership</Button>
            </Link>
          </CardContent>
        </Card>
      }
    />
  );
}



