import ShareHub from "@/components/share-hub";
import { BackHeader } from "@/components/back-header";
import { SEOHead } from "@/components/seo-head";
import { useAuth } from "@/hooks/useAuth";

export default function ShareHubPage() {
  const { user, isAuthenticated } = useAuth();
  const userType = String(user?.userType || "");

  const mode =
    userType === "admin" || userType === "super_admin"
      ? "admin"
      : userType === "staff"
        ? "staff"
        : "user";

  const description =
    mode === "user"
      ? "Copy a link, send a text, or share MealScout in one tap."
      : "Fast links and messages for outreach, referrals, and launch ops.";
  const schemaData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Share MealScout",
    description:
      "Share MealScout food discovery, video, map, food truck, restaurant, host, and event links.",
    url: "https://www.mealscout.us/share-hub",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: [
        "Food Map",
        "Video Feed",
        "Add a Food Truck",
        "Add a Restaurant",
        "Host a Truck",
        "Book a Truck",
      ].map((name, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name,
      })),
    },
  };

  return (
    <div className="min-h-screen pb-28">
      <SEOHead
        title="Share MealScout | Food Truck, Restaurant, Video and Map Links"
        description="Share MealScout with customers, food truck owners, restaurants, hosts, and event organizers. Copy links, send messages, or open the food map and video feed."
        canonicalUrl="https://www.mealscout.us/share-hub"
        schemaData={schemaData}
      />
      <BackHeader title="Share" fallbackHref="/" />
      <main className="mx-auto w-full max-w-5xl px-4 py-5">
        <ShareHub
          mode={mode}
          title="Share MealScout"
          description={description}
          enableAffiliateLookup={isAuthenticated}
        />
      </main>
    </div>
  );
}
