import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin } from "lucide-react";
import RestaurantDealsDrawer from "./restaurant-deals-drawer";

interface Deal {
  id: string;
  title: string;
  description: string;
  dealType?: string | null;
  discountValue?: string | null;
  minOrderAmount?: string;
  currentUses?: number;
}

interface Business {
  id: string;
  name: string;
  cuisineType?: string;
  imageUrl?: string;
  distance?: number;
  deals: Deal[];
  isOpen?: boolean;
}

interface BusinessSnapshotProps {
  business: Business;
}

export default function BusinessSnapshot({ business }: BusinessSnapshotProps) {
  const [showDealsDrawer, setShowDealsDrawer] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const formatDiscount = (deal: Deal) => {
    if (!deal.discountValue) {
      return "Limited Time";
    }
    if (deal.dealType === "percentage") {
      return `${deal.discountValue}%`;
    } else {
      return `$${deal.discountValue}`;
    }
  };

  return (
    <div>
      <Card
        ref={cardRef}
        className="card-light rounded-2xl hover:shadow-clean-lg transition-all duration-300 cursor-pointer border border-subtle shadow-clean group overflow-hidden"
        onClick={() => setShowDealsDrawer(true)}
      >
        <CardContent className="p-0">
          {/* Optional Hero Image (Once, Not Per Deal) */}
          {business.imageUrl && (
            <div className="deal-card-media relative h-24 overflow-hidden rounded-t-2xl">
              <img
                src={business.imageUrl}
                alt={business.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            </div>
          )}

          <div className="p-3">
            {/* Business Header (Shown Once) */}
            <div className="mb-3 pb-2.5 border-b border-subtle">
              <div className="flex items-start justify-between mb-1">
                <h3 className="font-bold text-primary text-base leading-tight flex-1">
                  {business.name}
                </h3>
                <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                  {business.deals.length > 1 && (
                    <span className="px-2 py-0.5 bg-[color:var(--bg-surface-muted)] text-secondary text-xs font-semibold rounded-full">
                      {business.deals.length} deals
                    </span>
                  )}
                  {business.isOpen && (
                    <span className="px-2 py-0.5 bg-success-soft text-success text-xs font-medium rounded-full">
                      Open now
                    </span>
                  )}
                </div>
              </div>

              {(business.distance !== undefined || business.cuisineType) && (
                <div className="flex items-center gap-2 text-xs text-secondary">
                  {business.distance !== undefined && (
                    <>
                      <div className="flex items-center gap-0.5">
                        <MapPin className="w-3 h-3" />
                        <span>{business.distance.toFixed(1)} mi</span>
                      </div>
                    </>
                  )}
                  {business.cuisineType && (
                    <>
                      {business.distance !== undefined && <span>•</span>}
                      <span>{business.cuisineType}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Deal Gallery (Compact Rows) */}
            <div className="space-y-2 mb-3">
              {business.deals.slice(0, 3).map((deal) => (
                <div key={deal.id} className="py-1.5">
                  {/* Price Line */}
                  <div className="text-[color:var(--accent-text)] leading-none mb-1">
                    <span className="font-semibold text-base">
                      {formatDiscount(deal)}
                    </span>
                    {deal.discountValue &&
                      (deal.minOrderAmount ? (
                        <span className="text-sm ml-1.5">
                          ${deal.minOrderAmount}+
                        </span>
                      ) : null)}
                  </div>

                  {/* Description */}
                  <p className="text-primary text-sm font-medium mb-1 line-clamp-1">
                    {deal.description}
                  </p>

                  {typeof deal.currentUses === "number" ? (
                    <div className="text-xs text-muted">
                      {deal.currentUses} claimed
                    </div>
                  ) : null}
                </div>
              ))}

              {business.deals.length > 3 && (
                <p className="text-xs text-muted pt-1">
                  +{business.deals.length - 3} more deals
                </p>
              )}
            </div>

            {/* Primary CTA (Business-Level) */}
            <Button
              className="w-full action-primary hover:bg-[color:var(--action-hover)] font-medium h-9"
              onClick={(e) => {
                e.stopPropagation();
                setShowDealsDrawer(true);
              }}
            >
              View All Deals
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Restaurant Deals Drawer */}
      <RestaurantDealsDrawer
        isOpen={showDealsDrawer}
        onClose={() => setShowDealsDrawer(false)}
        restaurantId={business.id}
        restaurantName={business.name}
        initialDealId={business.deals[0]?.id}
      />
    </div>
  );
}
