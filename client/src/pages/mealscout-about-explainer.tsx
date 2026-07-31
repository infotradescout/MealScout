import { useEffect } from "react";
import { Link } from "wouter";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Camera,
  ChefHat,
  ChevronDown,
  Clock3,
  Compass,
  CreditCard,
  ExternalLink,
  Globe2,
  Heart,
  LayoutDashboard,
  MapPin,
  MenuSquare,
  Package,
  PlaySquare,
  Route,
  Search,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Store,
  Tag,
  Truck,
  UserRound,
  UsersRound,
  UtensilsCrossed,
} from "lucide-react";

import {
  aboutAudiences,
  aboutFaqs,
  aboutFeatureGroups,
  aboutGlossary,
  aboutStatusLabels,
  businessWorkspaceModules,
  type AboutStatus,
} from "./mealscout-about-content";

const iconMap: Record<string, LucideIcon> = {
  search: Search,
  store: Store,
  truck: Truck,
  building: Building2,
  calendar: CalendarDays,
  package: Package,
  compass: Compass,
  utensils: UtensilsCrossed,
  clock: Clock3,
  briefcase: BriefcaseBusiness,
  share: Share2,
  chef: ChefHat,
  video: PlaySquare,
  user: UserRound,
  phone: Smartphone,
  shield: ShieldCheck,
};

const profileOutputs = [
  { icon: Search, label: "Scout discovery", copy: "Cravings, dishes, categories, and places" },
  { icon: MenuSquare, label: "Menus", copy: "Items, prices, photos, options, and availability" },
  { icon: Clock3, label: "Place + time", copy: "Hours, schedules, stops, and live context" },
  { icon: ShoppingBag, label: "Ordering", copy: "Pickup and outside paths when enabled" },
  { icon: CalendarDays, label: "Events + deals", copy: "What is happening and what is special" },
  { icon: Share2, label: "Sharing", copy: "Links, QR assets, and referral attribution" },
  { icon: Heart, label: "Customer memory", copy: "Saves, recommendations, and return visits" },
  { icon: LayoutDashboard, label: "Business control", copy: "One workspace behind the public profile" },
];

const dinerJourney = [
  { step: "01", title: "Start with the appetite", copy: "Search a craving, dish, cuisine, business, category, or area." },
  { step: "02", title: "Compare useful context", copy: "See food, distance, schedules, events, deals, and map context." },
  { step: "03", title: "Open the source profile", copy: "Confirm the menu, place, time, photos, and available actions." },
  { step: "04", title: "Act and remember", copy: "Get directions, order, save, recommend, share, or come back later." },
];

const businessJourney = [
  { step: "01", title: "Create, import, or claim", copy: "Establish the business and the owner allowed to control it." },
  { step: "02", title: "Build one complete profile", copy: "Add the food, story, media, hours, schedule, location, and actions." },
  { step: "03", title: "Let the profile travel", copy: "Scout, menus, maps, deals, events, links, and QR paths use that source." },
  { step: "04", title: "Run the work behind it", copy: "Use the business workspace for operations, team access, and enabled services." },
];

function ArrowIcon() {
  return <ArrowRight aria-hidden="true" />;
}

function StatusPill({ status }: { status: AboutStatus }) {
  return (
    <span className="ms-about-status-pill" data-status={status}>
      {aboutStatusLabels[status]}
    </span>
  );
}

function MappedIcon({ name }: { name: string }) {
  const Icon = iconMap[name] || Compass;
  return <Icon aria-hidden="true" />;
}

function SectionHeading({
  id,
  eyebrow,
  title,
  copy,
  inverse = false,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  copy?: string;
  inverse?: boolean;
}) {
  return (
    <div className={`ms-about-section-heading${inverse ? " ms-about-section-heading-inverse" : ""}`}>
      <p className="ms-about-eyebrow">{eyebrow}</p>
      <h2 id={id}>{title}</h2>
      {copy ? <p>{copy}</p> : null}
    </div>
  );
}

export function MealScoutAboutExplainer() {
  useEffect(() => {
    const revealLinkedChapter = () => {
      const fragment = window.location.hash.slice(1);
      if (!fragment) return;

      const target = document.getElementById(decodeURIComponent(fragment));
      if (!target || !target.closest(".ms-about")) return;

      if (target instanceof HTMLDetailsElement) {
        target.open = true;
      }

      window.requestAnimationFrame(() => {
        target.scrollIntoView({ block: "start" });
        if (target instanceof HTMLDetailsElement) {
          target.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
        }
      });
    };

    revealLinkedChapter();
    window.addEventListener("hashchange", revealLinkedChapter);
    return () => window.removeEventListener("hashchange", revealLinkedChapter);
  }, []);

  return (
    <main className="ms-about" id="top">
      <nav className="ms-about-jumpbar" aria-label="MealScout guide chapters">
        <span>MealScout guide</span>
        <div>
          <a href="#overview">Overview</a>
          <a href="#people">Who it serves</a>
          <a href="#profiles">Profiles</a>
          <a href="#business">Business tools</a>
          <a href="#mobile-food">Mobile food</a>
          <a href="#complete-guide">Complete guide</a>
          <a href="#answers">Answers</a>
        </div>
      </nav>

      <section className="ms-about-hero" aria-labelledby="about-hero-title">
        <div className="ms-about-hero-copy">
          <p className="ms-about-brand-line">Follow the Flavor</p>
          <h1 id="about-hero-title">
            Local food, easier to find.
            <span>Easier to run.</span>
          </h1>
          <p className="ms-about-lead">
            MealScout connects the decision people make—<strong>what sounds good right now?</strong>—to
            the one food profile a business maintains. Menus, schedules, locations, deals, ordering,
            events, recommendations, and operating tools stay connected instead of becoming another pile
            of pages to update.
          </p>
          <div className="ms-about-actions">
            <Link className="ms-about-button ms-about-button-primary" href="/scout">
              Find food with Scout <ArrowIcon />
            </Link>
            <Link className="ms-about-button ms-about-button-secondary" href="/profile-setup">
              See MealScout Profiles
            </Link>
          </div>
          <div className="ms-about-hero-facts" role="group" aria-label="MealScout at a glance">
            <span><BadgeCheck aria-hidden="true" /> Public discovery starts without an account</span>
            <span><BadgeCheck aria-hidden="true" /> Complete business profiles are free</span>
            <span><BadgeCheck aria-hidden="true" /> No pay-to-play organic ranking</span>
          </div>
        </div>

        <div className="ms-about-hero-visual" role="group" aria-label="Food discovery connected to a business profile">
          <figure className="ms-about-hero-photo ms-about-hero-photo-main">
            <img
              src="/backgrounds/food-truck-day.jpg"
              alt="Customers ordering from a local food truck"
              fetchPriority="high"
            />
          </figure>
          <figure className="ms-about-hero-photo ms-about-hero-photo-food">
            <img src="/atmospheric/craving-bbq.jpg" alt="Barbecue meal ready to serve" />
          </figure>
          <figure className="ms-about-hero-photo ms-about-hero-photo-detail">
            <img src="/atmospheric/craving-seafood.jpg" alt="Colorful seafood dish" />
          </figure>
          <div className="ms-about-example-search">
            <span>Example discovery path</span>
            <strong><Search aria-hidden="true" /> “Barbecue near me”</strong>
            <p>Dish → current context → source profile → action</p>
          </div>
          <div className="ms-about-profile-source-card">
            <img src="/brand/mealscout-logo-pin.png" alt="" />
            <div>
              <small>One managed source</small>
              <strong>The MealScout Profile</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="ms-about-overview" id="overview" aria-labelledby="overview-title">
        <div className="ms-about-overview-number" aria-hidden="true">01</div>
        <div>
          <p className="ms-about-eyebrow">MealScout in one sentence</p>
          <h2 id="overview-title">
            A profile-first local food system for discovery, decisions, and the work behind them.
          </h2>
        </div>
        <p>
          Customers should not need to know a business name before they can find dinner. Businesses
          should not need to republish the same menu, hours, schedule, and specials everywhere. MealScout
          joins those two problems at the profile.
        </p>
      </section>

      <section className="ms-about-system" aria-labelledby="system-title">
        <div className="ms-about-system-inner">
          <SectionHeading
            id="system-title"
            inverse
            eyebrow="How it connects"
            title="One source. Every customer-facing surface."
            copy="The profile is not one more listing in the stack. It is the maintained source that powers discovery and keeps the operating tools connected to what customers see."
          />

          <div className="ms-about-system-map" role="group" aria-label="MealScout profile connection map">
            <div className="ms-about-system-core">
              <img src="/brand/mealscout-logo-pin.png" alt="" />
              <span>Business-managed source</span>
              <strong>MealScout Profile</strong>
              <p>Identity · food · place · time · action</p>
            </div>
            <div className="ms-about-output-grid">
              {profileOutputs.map(({ icon: Icon, label, copy }) => (
                <article key={label}>
                  <Icon aria-hidden="true" />
                  <div><strong>{label}</strong><span>{copy}</span></div>
                </article>
              ))}
            </div>
          </div>

          <div className="ms-about-system-rule">
            <div><span>1</span><strong>The business updates the source</strong></div>
            <ArrowRight aria-hidden="true" />
            <div><span>2</span><strong>MealScout carries it into discovery</strong></div>
            <ArrowRight aria-hidden="true" />
            <div><span>3</span><strong>The customer acts on the profile</strong></div>
          </div>
        </div>
      </section>

      <section className="ms-about-people" id="people" aria-labelledby="people-title">
        <SectionHeading
          id="people-title"
          eyebrow="Who MealScout is for"
          title="One food network. Different jobs."
          copy="MealScout changes its tools to match what someone is trying to do, while keeping the public food information connected."
        />

        <div className="ms-about-audience-grid">
          {aboutAudiences.map((audience) => (
            <article className="ms-about-audience-card" key={audience.title} data-icon={audience.icon}>
              <div className="ms-about-audience-top">
                <span className="ms-about-icon-box"><MappedIcon name={audience.icon} /></span>
                <StatusPill status={audience.status} />
              </div>
              <p className="ms-about-card-eyebrow">{audience.eyebrow}</p>
              <h3>{audience.title}</h3>
              <p>{audience.summary}</p>
              <ul>
                {audience.bullets.map((bullet) => <li key={bullet}><BadgeCheck aria-hidden="true" /> {bullet}</li>)}
              </ul>
              <Link href={audience.href}>{audience.cta} <ArrowIcon /></Link>
            </article>
          ))}
        </div>
      </section>

      <section className="ms-about-journeys" aria-labelledby="journeys-title">
        <div className="ms-about-journeys-head">
          <SectionHeading
            id="journeys-title"
            inverse
            eyebrow="The two core journeys"
            title="The customer gets an answer. The business keeps control."
            copy="These journeys meet at the same profile, so the public experience and the operating truth do not drift apart."
          />
        </div>
        <div className="ms-about-journey-grid">
          <article className="ms-about-journey ms-about-journey-customer">
            <div className="ms-about-journey-label"><Search aria-hidden="true" /> For someone looking for food</div>
            <ol>
              {dinerJourney.map((item) => (
                <li key={item.step}><span>{item.step}</span><div><strong>{item.title}</strong><p>{item.copy}</p></div></li>
              ))}
            </ol>
            <Link href="/scout">Try the customer journey <ArrowIcon /></Link>
          </article>
          <article className="ms-about-journey ms-about-journey-business">
            <div className="ms-about-journey-label"><Store aria-hidden="true" /> For a food business</div>
            <ol>
              {businessJourney.map((item) => (
                <li key={item.step}><span>{item.step}</span><div><strong>{item.title}</strong><p>{item.copy}</p></div></li>
              ))}
            </ol>
            <Link href="/profile-setup">See the business journey <ArrowIcon /></Link>
          </article>
        </div>
      </section>

      <section className="ms-about-profile-section" id="profiles" aria-labelledby="profiles-title">
        <div className="ms-about-profile-copy">
          <p className="ms-about-chapter-number">Chapter 02 · The profile</p>
          <p className="ms-about-eyebrow">The product everything else starts from</p>
          <h2 id="profiles-title">More useful than a stale food website. More alive than a directory listing.</h2>
          <p>
            A MealScout Profile is designed to be the one public food surface a business actively
            maintains. It can still connect an existing domain, social account, or ordering provider,
            but the menu, media, schedule, location, specials, and customer paths no longer need to live
            in separate places with separate upkeep.
          </p>
          <div className="ms-about-profile-capabilities">
            <div><Store aria-hidden="true" /><strong>Identity</strong><span>Name, story, type, contact, and service context</span></div>
            <div><UtensilsCrossed aria-hidden="true" /><strong>Food</strong><span>Menus, products, categories, prices, photos, and options</span></div>
            <div><MapPin aria-hidden="true" /><strong>Place + time</strong><span>Address, hours, schedule, stops, and service area</span></div>
            <div><Camera aria-hidden="true" /><strong>Media</strong><span>Food, business, location, and approved video content</span></div>
            <div><Tag aria-hidden="true" /><strong>Activity</strong><span>Deals, events, featured items, and current opportunities</span></div>
            <div><ExternalLink aria-hidden="true" /><strong>Actions</strong><span>Directions, ordering, saving, sharing, QR, and recommendations</span></div>
          </div>
          <div className="ms-about-profile-states" role="group" aria-label="MealScout Profile source states">
            <article><span>Business managed</span><p>An owner or authorized team controls the published source.</p></article>
            <article><span>Imported or unclaimed</span><p>Public evidence may exist before an owner takes control; claim and confirmation paths remain visible.</p></article>
            <article><span>Incomplete or needs confirmation</span><p>Missing and conflicting details stay qualified until the responsible source supplies or approves them.</p></article>
          </div>
          <div className="ms-about-inline-links">
            <Link className="ms-about-text-link" href="/profile-setup">See the complete profile offer <ArrowIcon /></Link>
            <Link className="ms-about-text-link" href="/claim-business">Claim an existing food truck <ArrowIcon /></Link>
          </div>
        </div>

        <div className="ms-about-profile-offer" role="group" aria-label="MealScout Profile and optional setup services">
          <div className="ms-about-offer-intro">
            <img src="/brand/mealscout-logo-pin.png" alt="" />
            <div><small>MealScout Profile</small><strong>One public home for the whole food business</strong></div>
          </div>
          <article>
            <span>Self-managed</span>
            <h3>Complete profile</h3>
            <strong className="ms-about-price">Free</strong>
            <p>Build and maintain the complete profile with the included MealScout tools.</p>
          </article>
          <article className="ms-about-offer-featured">
            <span>Optional human help</span>
            <h3>Setup service</h3>
            <strong className="ms-about-price">Simple setup: $100</strong>
            <p>Menu organization, copy cleanup, photo placement, mobile polish, and link or domain help.</p>
          </article>
          <article>
            <span>Optional human help</span>
            <h3>Custom setup service</h3>
            <strong className="ms-about-price">Custom quote</strong>
            <p>Large menus, multiple locations, heavy content, advanced branding, or ongoing support.</p>
          </article>
        </div>
      </section>

      <section className="ms-about-menu-orders" aria-labelledby="menu-orders-title">
        <div className="ms-about-menu-image">
          <img loading="lazy" src="/atmospheric/craving-wings.jpg" alt="Prepared wings and sides" />
          <div><span>Customer decision</span><strong>See the food. Know the price. Order when available.</strong></div>
        </div>
        <div className="ms-about-menu-copy">
          <p className="ms-about-chapter-number">Chapter 03 · Menu to kitchen</p>
          <p className="ms-about-eyebrow">A complete operating path</p>
          <h2 id="menu-orders-title">The menu is not a PDF buried in a link.</h2>
          <p>
            Businesses can structure categories, items, descriptions, prices, photos, options, and
            availability. Customers can move from the profile to a public menu and, when the business
            enables MealScout ordering, through pickup checkout and confirmation.
          </p>
          <div className="ms-about-order-flow" role="group" aria-label="Menu and pickup order flow">
            <div><MenuSquare aria-hidden="true" /><span>Business builds the menu</span></div>
            <ArrowRight aria-hidden="true" />
            <div><ShoppingBag aria-hidden="true" /><span>Customer checks out</span></div>
            <ArrowRight aria-hidden="true" />
            <div><ChefHat aria-hidden="true" /><span>Kitchen manages the order</span></div>
          </div>
          <ul className="ms-about-direct-list">
            <li><BadgeCheck aria-hidden="true" /> Item availability keeps unavailable food from looking orderable</li>
            <li><BadgeCheck aria-hidden="true" /> Order status connects customer confirmation to the owner and kitchen flow</li>
            <li><BadgeCheck aria-hidden="true" /> Outside ordering paths can remain connected when MealScout checkout is not enabled</li>
          </ul>
          <StatusPill status="where-enabled" />
        </div>
      </section>

      <section className="ms-about-business" id="business" aria-labelledby="business-title">
        <div className="ms-about-business-intro">
          <SectionHeading
            id="business-title"
            eyebrow="The business workspace"
            title="Everything behind the profile, organized by the job."
            copy="Owners and approved teammates work inside the selected business. Access to one business or module does not silently grant access to every other business or financial surface."
          />
          <div className="ms-about-business-rule">
            <ShieldCheck aria-hidden="true" />
            <div><strong>Business-specific permission</strong><span>Each collaborator sees the work that business authorized.</span></div>
          </div>
        </div>
        <div className="ms-about-module-grid">
          {businessWorkspaceModules.map((module, index) => (
            <article key={module.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{module.title}</h3>
              <p>{module.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ms-about-mobile-food" id="mobile-food" aria-labelledby="mobile-food-title">
        <div className="ms-about-mobile-food-copy">
          <p className="ms-about-chapter-number">Chapter 05 · Mobile food</p>
          <p className="ms-about-eyebrow">Profiles that understand movement</p>
          <h2 id="mobile-food-title">A food truck is not its mailing address.</h2>
          <p>
            Truck discovery needs the menu, schedule, current stop, booked stops, and freshness of that
            information. MealScout treats those as operating facts, then connects them to host and event
            opportunities through Parking Pass.
          </p>
          <div className="ms-about-mobile-facts">
            <div><Clock3 aria-hidden="true" /><strong>Operating schedule</strong><span>Recurring windows, dated stops, and confirmed plans</span></div>
            <div><MapPin aria-hidden="true" /><strong>Current context</strong><span>Live or manual location only when the operator supplies it</span></div>
            <div><Share2 aria-hidden="true" /><strong>Schedule sharing</strong><span>Public paths that keep customers connected to the profile</span></div>
            <div><BadgeCheck aria-hidden="true" /><strong>Freshness matters</strong><span>Stale or missing context should not pretend to be live</span></div>
          </div>
        </div>
        <div className="ms-about-mobile-photo">
          <img loading="lazy" src="/backgrounds/food-truck-day.jpg" alt="A food truck open for service" />
          <div><Truck aria-hidden="true" /><span>Profile + menu + schedule + current stop</span></div>
        </div>
      </section>

      <section className="ms-about-parking" aria-labelledby="parking-title">
        <div className="ms-about-parking-head">
          <SectionHeading
            id="parking-title"
            inverse
            eyebrow="Parking Pass"
            title="Find a place to serve. Know the terms. Plan the route."
            copy="Parking Pass is MealScout's mobile-food operating subsystem—not a generic pin marketplace. It connects a published host opportunity to truck planning, eligibility, payment, booking, and schedule records."
          />
          <Link className="ms-about-button ms-about-button-light" href="/parking-pass">Explore Parking Pass <ArrowIcon /></Link>
        </div>
        <div className="ms-about-parking-grid">
          <article><Building2 aria-hidden="true" /><span>Host publishes</span><h3>The actual opportunity</h3><p>Location, dates, slots, capacity, amenities, photos, blackouts, terms, and pricing.</p></article>
          <article><Search aria-hidden="true" /><span>Truck compares</span><h3>Fit before commitment</h3><p>Map and list discovery, availability, cost, route context, and business needs.</p></article>
          <article><Route aria-hidden="true" /><span>Route planning</span><h3>The trip around the stop</h3><p>Start, destination, host opportunities, and useful travel-support stops along the corridor.</p></article>
          <article><CreditCard aria-hidden="true" /><span>Booking</span><h3>A confirmed operating record</h3><p>Eligibility, insurance, payment, booking status, schedule connection, and host payout state.</p></article>
        </div>
        <p className="ms-about-parking-limit">
          <ShieldCheck aria-hidden="true" /> Parking Pass does not replace permits, health rules,
          property restrictions, suitability checks, or the operator's responsibility to serve lawfully.
        </p>
      </section>

      <section className="ms-about-ecosystem" aria-labelledby="ecosystem-title">
        <SectionHeading
          id="ecosystem-title"
          eyebrow="Beyond the first food decision"
          title="The rest of the local food operation stays connected."
          copy="MealScout includes more than discovery and profiles. These working lanes support the people, places, content, supply, and repeat activity around local food."
        />
        <div className="ms-about-ecosystem-grid">
          <article className="ms-about-ecosystem-events">
            <CalendarDays aria-hidden="true" />
            <p>Hosts + events</p>
            <h3>Publish the place or occasion.</h3>
            <span>Availability, recurring windows, event pages, capacity, truck interest, and participation flows.</span>
            <Link href="/for-events">See event tools <ArrowIcon /></Link>
          </article>
          <article className="ms-about-ecosystem-work">
            <BriefcaseBusiness aria-hidden="true" />
            <p>Food work</p>
            <h3>Jobs, open resumes, and private-chef requests.</h3>
            <span>Businesses post roles, workers publish availability, and customers can request eligible chefs.</span>
            <Link href="/hiring">Explore food work <ArrowIcon /></Link>
          </article>
          <article className="ms-about-ecosystem-supply">
            <Package aria-hidden="true" />
            <p>Suppliers</p>
            <h3>Catalogs, requests, orders, and supply intelligence.</h3>
            <span>Available where the supplier marketplace and related business tools are enabled.</span>
            <Link href="/suppliers">Browse suppliers <ArrowIcon /></Link>
          </article>
          <article className="ms-about-ecosystem-media">
            <PlaySquare aria-hidden="true" />
            <p>Food stories + sharing</p>
            <h3>Show the food and connect it back to the source.</h3>
            <span>Video recommendations, profile-native sharing, QR assets, saved places, and tracked referral paths.</span>
            <Link href="/video">Watch food videos <ArrowIcon /></Link>
          </article>
        </div>
      </section>

      <section className="ms-about-trust" aria-labelledby="trust-title">
        <div>
          <p className="ms-about-eyebrow">Trust without rating theater</p>
          <h2 id="trust-title">Useful evidence. Clear limits. No invented certainty.</h2>
          <p>
            Food information changes fast. A useful product admits that instead of turning old or
            incomplete data into a confident-looking score.
          </p>
        </div>
        <div className="ms-about-trust-grid">
          <article><BadgeCheck aria-hidden="true" /><h3>Recommendations carry context</h3><p>People can explain what they recommend and add photo evidence when useful.</p></article>
          <article><Clock3 aria-hidden="true" /><h3>Freshness stays visible</h3><p>Schedules, locations, menus, and availability need a real source and time context.</p></article>
          <article><ShieldCheck aria-hidden="true" /><h3>Important conflicts can pause</h3><p>Identity, menu, location, and media changes can require owner or administrative approval.</p></article>
          <article><UsersRound aria-hidden="true" /><h3>Authority stays scoped</h3><p>Customers contribute experience; businesses control their records; teammates receive limited access.</p></article>
        </div>
        <div className="ms-about-not-list">
          <strong>MealScout is not</strong>
          <span>a chatbot</span>
          <span>a star-rating leaderboard</span>
          <span>a pay-to-play organic rank</span>
          <span>a promise that every profile is complete</span>
          <span>a substitute for official rules or permits</span>
        </div>
      </section>

      <section className="ms-about-guide" id="complete-guide" aria-labelledby="guide-title">
        <div className="ms-about-guide-intro">
          <p className="ms-about-eyebrow">Complete product guide</p>
          <h2 id="guide-title">Every major MealScout lane, grouped for future help.</h2>
          <p>
            Each chapter names the people it serves, what the capability does, and whether it is
            broadly available, powered by business data, conditional, or still expanding.
          </p>
          <div className="ms-about-status-legend" role="group" aria-label="Feature status legend">
            <StatusPill status="available" />
            <StatusPill status="business-supplied" />
            <StatusPill status="where-enabled" />
            <StatusPill status="expanding" />
          </div>
        </div>

        <div className="ms-about-guide-list">
          {aboutFeatureGroups.map((group, index) => (
            <details id={group.id} key={group.id} open={index < 2}>
              <summary>
                <span className="ms-about-guide-number">{group.number}</span>
                <span className="ms-about-guide-icon"><MappedIcon name={group.icon} /></span>
                <span className="ms-about-guide-title"><strong>{group.title}</strong><small>{group.summary}</small></span>
                <StatusPill status={group.status} />
                <ChevronDown className="ms-about-guide-chevron" aria-hidden="true" />
              </summary>
              <div className="ms-about-guide-body">
                <div className="ms-about-role-list" role="group" aria-label={`People served by ${group.title}`}>
                  <strong>For</strong>{group.roles.map((role) => <span key={role}>{role}</span>)}
                </div>
                <ul>
                  {group.items.map((item) => <li key={item}><BadgeCheck aria-hidden="true" /><span>{item}</span></li>)}
                </ul>
                {group.limitation ? <p className="ms-about-limitation"><ShieldCheck aria-hidden="true" /> {group.limitation}</p> : null}
                {group.href && group.cta ? <Link className="ms-about-guide-link" href={group.href}>{group.cta} <ArrowIcon /></Link> : null}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="ms-about-answers" id="answers" aria-labelledby="answers-title">
        <div className="ms-about-glossary">
          <p className="ms-about-eyebrow">Plain-language glossary</p>
          <h2>Know the system words.</h2>
          <dl>
            {aboutGlossary.map((item) => (
              <div key={item.term}><dt>{item.term}</dt><dd>{item.definition}</dd></div>
            ))}
          </dl>
        </div>
        <div className="ms-about-faq">
          <p className="ms-about-eyebrow">Common questions</p>
          <h2 id="answers-title">The answers a first-time visitor needs.</h2>
          <div>
            {aboutFaqs.map((item, index) => (
              <details key={item.question} open={index === 0}>
                <summary><strong>{item.question}</strong><ChevronDown aria-hidden="true" /></summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
          <Link className="ms-about-text-link" href="/contact">Still need an answer? Contact MealScout <ArrowIcon /></Link>
        </div>
      </section>

      <section className="ms-about-status" aria-labelledby="today-title">
        <div>
          <p className="ms-about-eyebrow">What to expect today</p>
          <h2 id="today-title">A real product with visible boundaries.</h2>
        </div>
        <article data-status="available"><BadgeCheck aria-hidden="true" /><span>Available now</span><p>Core public discovery, profiles, business workspaces, events, food work, video, and Parking Pass have active product surfaces.</p></article>
        <article data-status="business-supplied"><Store aria-hidden="true" /><span>Business supplied</span><p>Menus, prices, hours, schedules, live stops, deals, media, and ordering depth depend on what the business has published.</p></article>
        <article data-status="where-enabled"><LayoutDashboard aria-hidden="true" /><span>Where enabled</span><p>Pickup ordering, supplier tools, transaction payments, referrals, and some operating connections depend on the business, market, and active service. Profile access does not depend on a monthly plan.</p></article>
        <article data-status="expanding"><Globe2 aria-hidden="true" /><span>Still expanding</span><p>Coverage, profile completeness, mobile-store readiness, supplier reach, connections, and this help foundation continue to grow.</p></article>
      </section>

      <section className="ms-about-start" aria-labelledby="start-title">
        <img src="/brand/mealscout-logo-pin.png" alt="" />
        <p className="ms-about-brand-line">Follow the Flavor</p>
        <h2 id="start-title">Start with the part of MealScout you need.</h2>
        <div className="ms-about-start-grid">
          <Link href="/scout"><Search aria-hidden="true" /><span>For hungry people</span><strong>Open Scout</strong><ArrowIcon /></Link>
          <Link href="/profile-setup"><Store aria-hidden="true" /><span>For food businesses</span><strong>Build your profile</strong><ArrowIcon /></Link>
          <Link href="/parking-pass"><Truck aria-hidden="true" /><span>For trucks + hosts</span><strong>Open Parking Pass</strong><ArrowIcon /></Link>
          <Link href="/for-events"><CalendarDays aria-hidden="true" /><span>For the local scene</span><strong>See event tools</strong><ArrowIcon /></Link>
        </div>
      </section>

      <footer className="ms-about-footer">
        <Link className="ms-about-footer-brand" href="/">
          <img src="/brand/mealscout-logo-pin.png" alt="" />
          <span>MealScout</span>
        </Link>
        <p>Local food discovery built from the profile outward.</p>
        <nav aria-label="About footer">
          <Link href="/contact">Contact</Link>
          <a href="#answers">Answers</a>
          <Link href="/privacy-policy">Privacy</Link>
          <a href="#top">Back to top ↑</a>
        </nav>
      </footer>
    </main>
  );
}
