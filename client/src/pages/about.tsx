import { SEOHead } from "@/components/seo-head";
import { MealScoutAboutExplainer } from "./mealscout-about-explainer";
import "./mealscout-about.css";

const schemaData = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  name: "About MealScout",
  description:
    "The complete guide to MealScout: profile-first local food discovery, menus, schedules, pickup ordering, business tools, Parking Pass, events, food work, suppliers, sharing, and recommendations.",
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
        title="What Is MealScout? | The Complete Product Guide"
        description="Understand the complete MealScout system in one page: Scout discovery, food business profiles, menus, schedules, pickup ordering, Parking Pass, events, food work, suppliers, sharing, and trust."
        canonicalUrl="https://www.mealscout.us/about"
        ogImage="/atmospheric/foodpark-night-hero.jpg"
        schemaData={schemaData}
      />
      <MealScoutAboutExplainer />
    </>
  );
}
