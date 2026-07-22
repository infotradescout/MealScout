import { SEOHead } from "@/components/seo-head";
import { MealScoutAboutExplainer } from "./mealscout-about-explainer";
import "./mealscout-about.css";

const schemaData = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  name: "About MealScout",
  description:
    "A complete guide to MealScout: local food discovery, business profiles, menus, schedules, deals, events, ordering, recommendations, and Parking Pass.",
  url: "https://www.mealscout.us/about",
  isPartOf: {
    "@type": "WebSite",
    name: "MealScout",
    url: "https://www.mealscout.us",
  },
  about: {
    "@type": "Organization",
    name: "MealScout",
    url: "https://www.mealscout.us",
    logo: "https://www.mealscout.us/brand/mealscout-logo-pin.png",
    email: "support@mealscout.us",
  },
};

export default function About() {
  return (
    <>
      <SEOHead
        title="About MealScout | The Complete Guide to Local Food Discovery"
        description="Learn how MealScout connects diners, food businesses, mobile vendors, hosts, and event organizers through one accurate business profile and Scout discovery."
        canonicalUrl="https://www.mealscout.us/about"
        ogImage="/atmospheric/foodpark-night-hero.jpg"
        schemaData={schemaData}
      />
      <MealScoutAboutExplainer />
    </>
  );
}
