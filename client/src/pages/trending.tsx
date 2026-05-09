import { useMemo, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Flame,
  MapPin,
  Radio,
  Sparkles,
  TrendingUp,
  Utensils,
  Video,
} from "lucide-react";
import Navigation from "@/components/navigation";
import { SEOHead } from "@/components/seo-head";

type TrendingItem = {
  id: string;
  name: string;
  description?: string | null;
  priceCents?: number | null;
  imageUrl?: string | null;
  restaurantId: string;
  restaurantName?: string | null;
  restaurantCity?: string | null;
  restaurantState?: string | null;
  cuisineType?: string | null;
  clicks?: number;
  impressions?: number;
  trendScore?: number;
};

type TrendingCuisine = {
  cuisine: string;
  menuItems: number;
  places: number;
  clicks: number;
  impressions: number;
  trendScore: number;
};

type TrendingPlace = {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  cuisineType?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
  businessType?: string | null;
  isFoodTruck?: boolean | null;
  clicks?: number;
  events?: number;
  videoRecommendations?: number;
  trendScore?: number;
};

type TrendingResponse = {
  generatedAt: string;
  windowDays: number;
  cuisines: TrendingCuisine[];
  items: TrendingItem[];
  places: TrendingPlace[];
  signals: Array<{ eventName: string; count: number; lastSeenAt?: string }>;
};

const money = (cents?: number | null) =>
  typeof cents === "number" && Number.isFinite(cents)
    ? `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
    : null;

function heatLabel(score?: number | null) {
  const value = Number(score || 0);
  if (value >= 120) return "On fire";
  if (value >= 70) return "Heating up";
  if (value >= 30) return "Moving";
  return "New signal";
}

export default function TrendingPage() {
  const { data, isLoading } = useQuery<TrendingResponse>({
    queryKey: ["/api/public/trending"],
    queryFn: async () => {
      const res = await fetch("/api/public/trending?limit=16&days=14", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load trending");
      return res.json();
    },
    staleTime: 60_000,
  });

  const topCuisine = data?.cuisines?.[0];
  const topItem = data?.items?.[0];
  const topPlace = data?.places?.[0];
  const hasSignals =
    (data?.cuisines?.length || 0) +
      (data?.items?.length || 0) +
      (data?.places?.length || 0) >
    0;

  const signalCopy = useMemo(() => {
    if (!data) return "Reading the local food pulse.";
    const clicks = data.signals.find((s) => s.eventName.includes("click"));
    if (clicks) return `${clicks.count} recent action signals in the mix.`;
    return `Built from the last ${data.windowDays} days of local food movement.`;
  }, [data]);

  return (
    <div className="min-h-screen bg-[#120805] text-orange-50">
      <SEOHead
        title="Trending Local Food - MealScout"
        description="See which local cuisines, dishes, food trucks, restaurants, and menu items are heating up on MealScout."
      />
      <main className="pb-28">
        <section className="relative overflow-hidden px-5 pb-8 pt-8">
          <div
            className="absolute inset-0 opacity-80"
            style={{
              background:
                "radial-gradient(circle at 20% 8%, rgba(255,125,44,0.42), transparent 28%), radial-gradient(circle at 80% 0%, rgba(255,183,67,0.24), transparent 26%), linear-gradient(160deg, #1b0903 0%, #050505 62%, #2a1006 100%)",
            }}
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,145,51,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,145,51,0.12) 1px, transparent 1px)",
              backgroundSize: "34px 34px",
            }}
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-6xl">
            <Link
              href="/scout"
              className="inline-flex items-center gap-2 rounded-full border border-orange-300/25 bg-black/30 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.24em] text-orange-200"
            >
              <Radio className="h-3.5 w-3.5" />
              Local pulse
            </Link>
            <div className="mt-7 grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
              <div>
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-orange-200/80">
                  <Flame className="h-4 w-4 text-orange-300" />
                  Not delivery charts. Actual local food momentum.
                </p>
                <h1 className="max-w-3xl text-5xl font-black uppercase leading-[0.9] tracking-[-0.06em] text-orange-50 sm:text-7xl">
                  What the city is hungry for.
                </h1>
                <p className="mt-5 max-w-2xl text-base leading-7 text-orange-100/72">
                  Cuisines, dishes, trucks, restaurants, and tiny menu signals
                  that are catching fire across MealScout.
                </p>
              </div>
              <div className="rounded-[2rem] border border-orange-300/20 bg-black/35 p-4 shadow-2xl shadow-black/40">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-orange-300/70">
                  Trend engine
                </p>
                <p className="mt-2 text-2xl font-black text-orange-50">
                  {signalCopy}
                </p>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <Metric label="Cuisine" value={topCuisine?.cuisine || "Soon"} />
                  <Metric label="Dish" value={topItem?.name || "Soon"} />
                  <Metric label="Place" value={topPlace?.name || "Soon"} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {isLoading ? (
          <div className="mx-auto max-w-6xl space-y-4 px-5 py-8">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-[2rem] bg-orange-100/8"
              />
            ))}
          </div>
        ) : !hasSignals ? (
          <section className="mx-auto max-w-3xl px-5 py-16 text-center">
            <Sparkles className="mx-auto h-10 w-10 text-orange-300" />
            <h2 className="mt-4 text-3xl font-black">The heat map is waking up.</h2>
            <p className="mt-3 text-orange-100/70">
              As people browse menus, favorite places, click dishes, and post
              recommendations, this page turns into a live local taste report.
            </p>
          </section>
        ) : (
          <div className="mx-auto max-w-6xl space-y-10 px-5 py-8">
            <section>
              <SectionTitle
                eyebrow="Cuisine currents"
                title="Flavors gaining gravity"
                icon={<TrendingUp className="h-5 w-5" />}
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {data?.cuisines?.slice(0, 8).map((cuisine, index) => (
                  <Link
                    key={cuisine.cuisine}
                    href={`/search?q=${encodeURIComponent(cuisine.cuisine)}`}
                    className="group rounded-[1.6rem] border border-orange-300/15 bg-[#1a0c07] p-4 transition hover:-translate-y-0.5 hover:border-orange-300/45"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-orange-300/70">
                        #{index + 1}
                      </span>
                      <ArrowUpRight className="h-4 w-4 text-orange-200/50 group-hover:text-orange-200" />
                    </div>
                    <h3 className="mt-5 text-2xl font-black leading-none">
                      {cuisine.cuisine}
                    </h3>
                    <p className="mt-2 text-xs text-orange-100/62">
                      {cuisine.menuItems} items · {cuisine.places} places
                    </p>
                    <HeatBar value={cuisine.trendScore} />
                  </Link>
                ))}
              </div>
            </section>

            <section>
              <SectionTitle
                eyebrow="Dish radar"
                title="Actual menu items people are touching"
                icon={<Utensils className="h-5 w-5" />}
              />
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data?.items?.slice(0, 9).map((item) => (
                  <Link
                    key={item.id}
                    href={`/restaurant/${item.restaurantId}`}
                    className="group overflow-hidden rounded-[1.8rem] border border-orange-300/15 bg-[#190b06] shadow-xl shadow-black/20 transition hover:border-orange-300/45"
                  >
                    <div className="relative h-40 bg-black/35">
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl}
                          alt=""
                          className="h-full w-full object-cover opacity-85 transition group-hover:scale-105"
                          loading="lazy"
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#190b06] via-transparent to-transparent" />
                      <span className="absolute left-3 top-3 rounded-full bg-orange-300 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-[#1a0d08]">
                        {heatLabel(item.trendScore)}
                      </span>
                      {money(item.priceCents) && (
                        <span className="absolute right-3 top-3 rounded-full bg-black/65 px-2.5 py-1 text-xs font-bold text-orange-100">
                          {money(item.priceCents)}
                        </span>
                      )}
                    </div>
                    <div className="p-4">
                      <h3 className="line-clamp-2 text-lg font-black">
                        {item.name}
                      </h3>
                      <p className="mt-1 truncate text-sm font-semibold text-orange-200/80">
                        {item.restaurantName || "Local spot"}
                      </p>
                      <p className="mt-2 line-clamp-2 text-sm text-orange-100/58">
                        {item.description || item.cuisineType || "Trending locally"}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <section>
              <SectionTitle
                eyebrow="Places with pull"
                title="Businesses creating motion"
                icon={<MapPin className="h-5 w-5" />}
              />
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {data?.places?.slice(0, 10).map((place, index) => (
                  <Link
                    key={place.id}
                    href={`/restaurant/${place.id}`}
                    className="flex items-center gap-4 rounded-[1.5rem] border border-orange-300/15 bg-orange-100/[0.045] p-3 transition hover:border-orange-300/45"
                  >
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-300/12 text-lg font-black text-orange-200">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-lg font-black">{place.name}</h3>
                      <p className="truncate text-sm text-orange-100/60">
                        {[place.cuisineType, place.city, place.state]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {Number(place.videoRecommendations || 0) > 0 && (
                      <span className="hidden items-center gap-1 rounded-full bg-orange-300/12 px-3 py-1 text-xs font-bold text-orange-200 sm:inline-flex">
                        <Video className="h-3.5 w-3.5" />
                        {place.videoRecommendations}
                      </span>
                    )}
                    <span className="rounded-full bg-black/35 px-3 py-1 text-xs font-bold text-orange-100/75">
                      {heatLabel(place.trendScore)}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
      <Navigation />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-orange-100/8 px-3 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-orange-200/48">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-black text-orange-50">{value}</p>
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  icon,
}: {
  eyebrow: string;
  title: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-orange-300/70">
          {icon}
          {eyebrow}
        </p>
        <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] text-orange-50">
          {title}
        </h2>
      </div>
    </div>
  );
}

function HeatBar({ value }: { value?: number | null }) {
  const pct = Math.max(8, Math.min(100, Number(value || 0)));
  return (
    <div className="mt-5 h-2 overflow-hidden rounded-full bg-black/35">
      <div
        className="h-full rounded-full bg-gradient-to-r from-orange-700 via-orange-400 to-amber-200"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
