export type AboutStatus = "available" | "coverage-expanding" | "business-supplied" | "where-enabled" | "expanding";

export type AboutAudience = {
  icon: "search" | "store" | "truck" | "building" | "calendar" | "package";
  eyebrow: string;
  title: string;
  summary: string;
  bullets: string[];
  href: string;
  cta: string;
  status: AboutStatus;
};

export type AboutFeatureGroup = {
  id: string;
  number: string;
  icon:
    | "compass"
    | "store"
    | "utensils"
    | "clock"
    | "briefcase"
    | "truck"
    | "calendar"
    | "share"
    | "package"
    | "chef"
    | "video"
    | "user"
    | "phone"
    | "shield";
  title: string;
  summary: string;
  status: AboutStatus;
  roles: string[];
  items: string[];
  limitation?: string;
  href?: string;
  cta?: string;
};

export const aboutStatusLabels: Record<AboutStatus, string> = {
  available: "Available now",
  "coverage-expanding": "Available now · coverage expanding",
  "business-supplied": "Powered by the business profile",
  "where-enabled": "Available where enabled",
  expanding: "Expanding",
};

export const aboutAudiences: AboutAudience[] = [
  {
    icon: "search",
    eyebrow: "Find food",
    title: "Diners and local food lovers",
    summary:
      "Start with a craving, a dish, a place, or a business. Compare what is actually useful, then open the source profile before deciding.",
    bullets: [
      "Scout search, maps, lists, categories, and city discovery",
      "Menus, photos, schedules, deals, events, and ordering paths",
      "Save, share, recommend, and return to places you care about",
    ],
    href: "/scout",
    cta: "Open Scout",
    status: "coverage-expanding",
  },
  {
    icon: "store",
    eyebrow: "Own your presence",
    title: "Restaurants, bars, caterers, chefs, and food sellers",
    summary:
      "Manage one food-first profile instead of rebuilding the same information across a website, social posts, menus, and disconnected tools.",
    bullets: [
      "Complete self-managed profile with optional setup help",
      "Menu, hours, media, specials, ordering, audience, and team tools",
      "A public home designed to be the one surface you actively maintain",
    ],
    href: "/profile-setup",
    cta: "See profile setup choices",
    status: "coverage-expanding",
  },
  {
    icon: "truck",
    eyebrow: "Keep moving",
    title: "Food trucks and mobile vendors",
    summary:
      "Publish the food, schedule, current stop, and ways to book you. Then connect operating plans to real host opportunities.",
    bullets: [
      "Truck profile, menu, schedule, stops, and current location context",
      "Parking Pass host discovery, route planning, and booking",
      "A schedule that can connect public discovery with confirmed stops",
    ],
    href: "/parking-pass",
    cta: "Explore Parking Pass",
    status: "coverage-expanding",
  },
  {
    icon: "building",
    eyebrow: "Put space to work",
    title: "Hosts and property operators",
    summary:
      "Publish a place for mobile food, define the real terms, and manage when trucks can serve there.",
    bullets: [
      "Location, capacity, dates, availability, terms, and pricing",
      "Booking and blackout controls for each published location",
      "A public opportunity trucks can compare before committing",
    ],
    href: "/for-hosts",
    cta: "See host tools",
    status: "available",
  },
  {
    icon: "calendar",
    eyebrow: "Create the occasion",
    title: "Event organizers and community partners",
    summary:
      "Publish food-centered events and coordinate the businesses, opportunities, and public details connected to them.",
    bullets: [
      "Public event discovery and dedicated event pages",
      "Coordinator tools, opportunities, interest, and participation flows",
      "Clear separation between event coordination and Parking Pass inventory",
    ],
    href: "/for-events",
    cta: "See event tools",
    status: "available",
  },
  {
    icon: "package",
    eyebrow: "Support the operation",
    title: "Suppliers and food-business partners",
    summary:
      "Connect food operators to supplier profiles, catalogs, requests, and ordering tools when that marketplace is enabled.",
    bullets: [
      "Public supplier discovery and supplier profiles",
      "Catalog, request, order, and payment workflows where enabled",
      "A path for supply needs to live closer to the food operation",
    ],
    href: "/suppliers",
    cta: "Browse suppliers",
    status: "where-enabled",
  },
];

export const businessWorkspaceModules = [
  { title: "Overview", text: "See the current business, completion, and operating priorities." },
  { title: "Public profile", text: "Control the public identity, story, contact details, and service context." },
  { title: "Menu", text: "Build categories, items, descriptions, prices, options, photos, and availability." },
  { title: "Availability", text: "Manage hours, live or saved location context, operating windows, and booked-stop visibility." },
  { title: "Photos", text: "Manage approved food, business, and location media." },
  { title: "Deals", text: "Publish specials and time-sensitive offers without rebuilding the profile." },
  { title: "Orders", text: "See pickup orders and move them through the operating workflow where enabled." },
  { title: "Audience", text: "Understand what people do after finding the business." },
  { title: "Team", text: "Invite collaborators and limit each person to the business work they need." },
  { title: "Payments", text: "Manage payment-related business tools and records where enabled." },
  { title: "Settings", text: "Control account, business, notification, and service preferences." },
];

export const aboutFeatureGroups: AboutFeatureGroup[] = [
  {
    id: "scout-discovery",
    number: "01",
    icon: "compass",
    title: "Scout food discovery",
    summary: "Start with the food decision—not a directory alphabet and not a chatbot.",
    status: "coverage-expanding",
    roles: ["Everyone"],
    items: [
      "Search by craving, dish, business, cuisine, category, or place",
      "Browse food-led rails, readable results, and compact map context",
      "Open the full interactive map without leaving the Scout experience",
      "Discover restaurants, trucks, bars, events, deals, and nearby food context",
      "Use city, cuisine, category, and location pages as additional discovery doors",
      "Open the canonical business profile for the complete and current details",
    ],
    href: "/scout",
    cta: "Open Scout",
    limitation: "MealScout is building the broadest useful local-food inventory it can verify. Legitimate restaurants, trucks, bars, caterers, chefs, pop-ups, and food sellers may appear with incomplete or claimable profiles while menus, hours, schedules, and ownership are still being confirmed.",
  },
  {
    id: "public-profiles",
    number: "02",
    icon: "store",
    title: "Public business profiles",
    summary: "The business's maintained public home and the source behind MealScout discovery.",
    status: "business-supplied",
    roles: ["Customers", "Food businesses"],
    items: [
      "Business identity, type, story, contact details, and service context",
      "Menus or product listings with photos, descriptions, prices, and categories",
      "Hours, schedule, address, service area, mobile stops, and live context",
      "Photos, video, featured items, specials, events, and available actions",
      "Directions, saving, sharing, recommendations, and ordering links where available",
      "Food-truck claim intake and owner-approval paths for imported or incomplete records",
    ],
    href: "/profile-setup",
    cta: "Build a MealScout Profile",
  },
  {
    id: "menus-and-orders",
    number: "03",
    icon: "utensils",
    title: "Menus, pickup ordering, and kitchen flow",
    summary: "Take a customer from 'that looks good' to a confirmed pickup order when ordering is enabled.",
    status: "where-enabled",
    roles: ["Customers", "Food businesses", "Kitchen teams"],
    items: [
      "Owner-managed menu categories, items, descriptions, prices, photos, and options",
      "Item availability controls so sold-out or unavailable food does not look orderable",
      "Public online-menu pages connected to the source business profile",
      "Pickup checkout and payment paths for businesses using MealScout ordering",
      "Order confirmation and customer order-history surfaces",
      "Owner order management and kitchen-display workflow for preparing and completing orders",
    ],
    limitation: "Ordering appears only when the business has published an eligible menu and enabled the related service.",
  },
  {
    id: "schedule-and-location",
    number: "04",
    icon: "clock",
    title: "Hours, schedules, stops, and live location",
    summary: "Answer not only where a business belongs, but where and when it is serving.",
    status: "business-supplied",
    roles: ["Customers", "Restaurants", "Food trucks"],
    items: [
      "Published restaurant and bar hours",
      "Food-truck operating schedules and manual stops",
      "Current-stop and live-location context when the operator supplies it",
      "Location pages that show recurring or current truck activity",
      "Parking Pass bookings and event participation connected to operating plans",
      "Clear missing or stale states instead of invented open-now certainty",
    ],
  },
  {
    id: "business-workspace",
    number: "05",
    icon: "briefcase",
    title: "Business workspace",
    summary: "Manage the public profile and its connected operating tools through a business-specific workspace.",
    status: "available",
    roles: ["Owners", "Approved collaborators"],
    items: [
      "Overview, profile, menu, schedule, media, deals, orders, and audience modules",
      "Business-specific team invitations and permission boundaries",
      "Profile access, transaction payments, audience insights, and settings",
      "Profile-completion and source-quality guidance",
      "Food-truck claim intake plus owner review and handoff for existing profiles",
      "One account can participate in more than one business without sharing every permission",
    ],
  },
  {
    id: "parking-pass",
    number: "06",
    icon: "truck",
    title: "Parking Pass and mobile-food operations",
    summary: "Connect trucks to real places to serve—with dates, terms, routes, and booking context.",
    status: "available",
    roles: ["Food trucks", "Hosts"],
    items: [
      "Browse bookable host locations on a map or readable list",
      "Compare published dates, availability, capacity, terms, and pricing",
      "Plan a route between a start and destination",
      "Discover useful host opportunities and travel-support stops along the route",
      "Book an eligible opportunity and record the confirmed stop in the operating flow",
      "Check truck eligibility, stored insurance, inventory, and payment before confirming a booking",
    ],
    limitation: "A listing is not a permit or safety approval. Eligibility, insurance, payment, property rules, and local requirements still apply.",
    href: "/parking-pass",
    cta: "Explore Parking Pass",
  },
  {
    id: "hosts-and-events",
    number: "07",
    icon: "calendar",
    title: "Hosts, events, and local opportunities",
    summary: "Give property operators and organizers a structured way to publish food opportunities.",
    status: "available",
    roles: ["Hosts", "Event organizers", "Food trucks", "Customers"],
    items: [
      "Host profiles and location-specific availability",
      "Multiple spots, capacity, recurring windows, blackout dates, and booking terms",
      "Public event browsing and event detail pages",
      "Event coordinator tools for publishing and managing events",
      "Truck interest, participation, open-call, and booking workflows where offered",
      "Customer-facing event information connected back to the participating businesses",
    ],
    href: "/for-events",
    cta: "See event tools",
  },
  {
    id: "sharing-and-audience",
    number: "08",
    icon: "share",
    title: "Deals, audience, sharing, and referrals",
    summary: "Help good local food travel farther without turning discovery into pay-to-play placement.",
    status: "where-enabled",
    roles: ["Customers", "Food businesses", "Hosts", "Organizers"],
    items: [
      "Business-published specials and deal pages",
      "Saved places, notifications, and return paths for signed-in customers",
      "Context-rich recommendations instead of one-number star verdicts",
      "Shareable business, menu, deal, event, and discovery links",
      "Profile, menu, and specials QR assets with measurable opens",
      "Tracked referral attribution for eligible accounts and campaigns",
      "Audience and activity signals for businesses without purchasing discovery rank",
    ],
    limitation: "Tracked sharing is universal capability state, not a special user role. Tracking alone never guarantees payment; credit and payout depend on the eligible account and active program.",
  },
  {
    id: "supplier-marketplace",
    number: "09",
    icon: "package",
    title: "Supplier marketplace",
    summary: "Bring selected supply work closer to the businesses already running on MealScout.",
    status: "where-enabled",
    roles: ["Food businesses", "Suppliers"],
    items: [
      "Supplier discovery and public supplier profiles",
      "Supplier catalogs and product information",
      "Business supply requests and request items",
      "Supplier orders, order items, and payment state",
      "Shopping lists, demand signals, price watches, and receipt-backed supply tools",
      "Supplier dashboards and buyer permissions when the marketplace is enabled",
    ],
    limitation: "Supplier coverage, catalogs, pricing, payment, pickup, and delivery options vary by market and supplier.",
    href: "/suppliers",
    cta: "Browse suppliers",
  },
  {
    id: "food-work",
    number: "10",
    icon: "chef",
    title: "Food jobs, open resumes, and private chefs",
    summary: "Connect local food businesses, workers, and customers around real food work.",
    status: "available",
    roles: ["Food businesses", "Food workers", "Private chefs", "Customers"],
    items: [
      "Public food-job browsing with role, location, schedule, openings, and published rate context",
      "Business job posting and job-status management for authorized owners",
      "Open worker resumes with roles, service cities, desired rate, and portfolio details",
      "Applications connected to a worker profile and the hiring business",
      "Private-chef discovery and customer request forms",
      "Business-side application decisions and chef lead management",
    ],
    href: "/hiring",
    cta: "Explore food work",
  },
  {
    id: "food-video",
    number: "11",
    icon: "video",
    title: "Food video and visual recommendations",
    summary: "Let people show the food and connect the recommendation back to its source business.",
    status: "available",
    roles: ["Viewers", "Creators", "Food businesses"],
    items: [
      "Public short-form food video feed and video detail pages",
      "Signed-in uploads with title, description, duration, and hashtags",
      "Business and restaurant context displayed when it is present on published media",
      "Creator, restaurant, location, transcript, and sharing context where available",
      "View, like, and share interactions with published engagement context",
      "Readiness, expiration, reporting, and removal states for public media",
    ],
    href: "/video",
    cta: "Watch food videos",
  },
  {
    id: "customer-accounts",
    number: "12",
    icon: "user",
    title: "Customer accounts",
    summary: "Public discovery stays open; accounts add continuity when a customer wants it.",
    status: "available",
    roles: ["Customers"],
    items: [
      "Browse Scout and public profiles without creating an account",
      "Save businesses and return to favorites",
      "Manage profile, addresses, privacy or settings, and notification preferences",
      "See related order and activity history where services are enabled",
      "Recommend, share, and use support or correction paths with an identity behind the action",
      "Carry referral context through signup or sign-in without turning it into a user role",
    ],
  },
  {
    id: "mobile-access",
    number: "13",
    icon: "phone",
    title: "Mobile and installable access",
    summary: "Use the same core MealScout routes in a mobile-first web and app-shell experience.",
    status: "expanding",
    roles: ["Everyone"],
    items: [
      "Responsive Scout, profiles, menus, checkout, events, and Parking Pass routes",
      "Installable web-app entry and mobile-safe account flows",
      "Deep links back to public profiles and attributed shared destinations",
      "Mobile location context when the customer grants permission",
      "Native Android and iOS wrapper foundations",
      "Store, notification, payment, and device-specific readiness continue to be validated separately",
    ],
    limitation: "Mobile web and installable access are broader than independently verified native-store availability.",
    href: "/install",
    cta: "Install MealScout",
  },
  {
    id: "trust-and-support",
    number: "14",
    icon: "shield",
    title: "Truth, recommendations, and support",
    summary: "Keep changing food information useful without hiding uncertainty behind ratings theater.",
    status: "available",
    roles: ["Everyone"],
    items: [
      "Recommendations with written context and optional photo evidence",
      "No star-rating leaderboard presented as objective truth",
      "Missing menus, prices, schedules, and locations remain visibly missing",
      "High-impact identity, menu, location, and media conflicts can require approval",
      "Support, moderation, reporting, and correction systems for public information and participants",
      "Official permits, health rules, property rules, and safety decisions remain with the responsible authorities and operators",
    ],
    href: "/contact",
    cta: "Contact support",
  },
];

export const aboutGlossary = [
  {
    term: "Scout",
    definition:
      "MealScout's search and discovery surface. Scout helps someone move from a craving or place to a relevant business profile; it is not a chatbot.",
  },
  {
    term: "MealScout Profile",
    definition:
      "The public, food-first home a business maintains for its identity, menu, media, place, time, and customer actions.",
  },
  {
    term: "Business workspace",
    definition:
      "The private control surface owners and approved collaborators use to maintain the profile and operate enabled tools.",
  },
  {
    term: "Parking Pass",
    definition:
      "MealScout's subsystem for publishing, discovering, planning, and booking places where mobile food businesses may serve.",
  },
  {
    term: "Host",
    definition:
      "A property or location operator that publishes a real place, availability, terms, and capacity for mobile-food opportunities.",
  },
  {
    term: "Recommendation",
    definition:
      "A person's contextual account of what they recommend. It can include useful written or photo evidence without reducing the experience to stars.",
  },
];

export const aboutFaqs = [
  {
    question: "Is MealScout only for food trucks?",
    answer:
      "No. MealScout supports local food discovery across restaurants, food trucks, bars, caterers, chefs, pop-ups, food sellers, hosts, events, and selected suppliers. Mobile food has extra schedule and Parking Pass needs, but it is one part of the product.",
  },
  {
    question: "Do I need an account to use MealScout?",
    answer:
      "No account is required to browse Scout, public profiles, menus, events, or other public discovery. An account adds saves, preferences, recommendations, order continuity, business tools, and other identity-dependent actions.",
  },
  {
    question: "Is a MealScout Profile supposed to replace my food website?",
    answer:
      "It is designed to become the one public food surface a business actively maintains. It keeps the menu, photos, hours, schedule, location, specials, and customer actions together, while still allowing a business to connect an existing domain or outside ordering path when useful.",
  },
  {
    question: "What does a MealScout Profile cost?",
    answer:
      "The standard self-managed MealScout Profile is free, and its complete profile tools are included under the non-expiring free trial. Optional human setup work is separate. Most simple setups are $100; complex menus, multiple locations, heavy content, advanced branding, or ongoing support may require a custom quote. Separate paid orders, deliveries, bookings, and other transactions can have charges shown before payment. Paying for help never unlocks or restricts profile tools.",
  },
  {
    question: "Does MealScout use star reviews?",
    answer:
      "No. MealScout uses recommendations with context and evidence where useful. A one-number score cannot explain the dish, visit, timing, service, or personal preference behind someone's experience.",
  },
  {
    question: "Does MealScout provide delivery?",
    answer:
      "MealScout supports public menus, pickup ordering, checkout, and outside ordering paths where a business has enabled them. It does not claim that delivery or MealScout ordering is available for every business.",
  },
  {
    question: "How does MealScout keep information current?",
    answer:
      "The business profile is the primary published source. Owners and approved collaborators maintain it, and high-impact conflicting evidence can be held for approval. Completeness still varies by business, so missing information is shown as missing instead of guessed.",
  },
  {
    question: "How are businesses ranked or promoted?",
    answer:
      "Discovery should be driven by relevance, food intent, location, current operating context, and useful evidence—not the purchase of a better organic rank. Paid services do not convert weak relevance into a false recommendation.",
  },
  {
    question: "How broad will MealScout coverage be?",
    answer:
      "As broad as trustworthy local-food discovery allows. MealScout is built for restaurants, food trucks, bars, caterers, chefs, pop-ups, food sellers, hosts, events, and selected suppliers—not only a small verified cohort. Legitimate records are retained and improved, merged when duplicated, or made claimable when incomplete. MealScout does not invent menus, hours, schedules, locations, or ownership to make coverage look complete.",
  },
  {
    question: "What is still growing?",
    answer:
      "Coverage, profile completeness, supplier availability, mobile-store readiness, some ordering and payment connections, and the help library continue to expand. The platform can be available now while verified listings, current menus, schedules, ordering, and transaction activity still vary by business and market.",
  },
];
