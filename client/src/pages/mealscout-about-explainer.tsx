type ReferenceGroup = {
  title: string;
  summary: string;
  items: string[];
};

const coreIdeas = [
  {
    number: "01",
    title: "The profile is the source",
    text: "A food business maintains one profile for its identity, menu, hours, schedule, location, photos, deals, and available ways to order.",
  },
  {
    number: "02",
    title: "Scout turns facts into discovery",
    text: "Scout helps people search by craving, dish, business, category, or place and then opens the source profile for the full story.",
  },
  {
    number: "03",
    title: "Mobile food needs live context",
    text: "A truck can be real and still not be serving at its usual address. MealScout treats schedules, stops, and current location as first-class information.",
  },
  {
    number: "04",
    title: "Useful proof beats rating theater",
    text: "Recommendations can carry context and photo evidence. Missing or unapproved facts stay missing instead of being filled with guesses.",
  },
  {
    number: "05",
    title: "Businesses control their operation",
    text: "Owners and approved teammates manage the profile and the tools they have permission to use. MealScout does not become another feed to update by hand.",
  },
];

const referenceGroups: ReferenceGroup[] = [
  {
    title: "Discover food",
    summary: "Public tools for deciding what to eat and where to find it.",
    items: [
      "Scout search and discovery by craving, dish, category, business, and place",
      "Compact and expanded map views supported by a readable list experience",
      "Public restaurant, food truck, bar, and other supported food-business profiles",
      "Menus, item details, photos, hours, schedules, locations, and service context when published",
      "Local events, deals, and available ordering paths",
    ],
  },
  {
    title: "Remember and recommend",
    summary: "Customer tools that turn browsing into a useful personal food record.",
    items: [
      "Favorites and saved places for signed-in customers",
      "Recommendations with written context instead of a one-number verdict",
      "Photo-supported recommendations when a customer wants to show what they experienced",
      "Directions, shares, and return paths to the business profile",
      "Order and activity history where the related service is available",
    ],
  },
  {
    title: "Run a food business",
    summary: "A profile-first workspace for owners and approved collaborators.",
    items: [
      "Business overview and profile management",
      "Menu building, item availability, and kitchen or order workflows",
      "Hours, schedules, mobile stops, and Parking Pass bookings",
      "Photos, video, deals, events, audience tools, and sharing",
      "Team permissions, payments, subscriptions, reporting, and settings where enabled",
    ],
  },
  {
    title: "Operate mobile food",
    summary: "Tools for the moving parts that ordinary restaurant directories miss.",
    items: [
      "Food-truck identity, public menu, operating schedule, and current stop context",
      "Bookable Parking Pass host locations with the published dates, terms, and pricing",
      "Trip planning between a start and destination",
      "Discovery of hosts and useful operator stops along a route",
      "Booking and schedule records that feed the truck's operating workflow",
    ],
  },
  {
    title: "Host and organize",
    summary: "Ways for places and organizers to connect with food businesses.",
    items: [
      "Parking Pass listings for approved host spaces",
      "Availability, capacity, booking terms, and location management",
      "Public events and event detail pages",
      "Event opportunities and business participation workflows where offered",
      "Demand and booking context for operating decisions",
    ],
  },
  {
    title: "Protect the truth",
    summary: "The rules that keep the system useful when information is incomplete.",
    items: [
      "The business profile remains the primary published source",
      "Conflicting identity, menu, schedule, or location changes require review or approval",
      "Business-specific teammate permissions limit access to the assigned work",
      "Unavailable features and missing information should be shown plainly",
      "Prices, fees, and booking terms are presented before a paid confirmation",
    ],
  },
];

const statusColumns = [
  {
    label: "Available now",
    tone: "ready",
    text: "Scout, public profiles, menus, schedules, events, deals, recommendations, customer saves, business workspaces, and Parking Pass are active MealScout surfaces.",
  },
  {
    label: "Business supplied",
    tone: "depends",
    text: "Menu depth, prices, hours, live stops, ordering, deals, and media vary by business. MealScout shows what has actually been published.",
  },
  {
    label: "Still expanding",
    tone: "growing",
    text: "Business and city coverage, profile completeness, operator connections, and this future help library will continue to grow without pretending unfinished work is complete.",
  },
];

function ArrowIcon() {
  return <span aria-hidden="true">↗</span>;
}

function CheckIcon() {
  return <span className="ms-about-check" aria-hidden="true">✓</span>;
}

export function MealScoutAboutExplainer() {
  return (
    <main className="ms-about">
      <section className="ms-about-hero" id="top">
        <div className="ms-about-hero-copy">
          <p className="ms-about-eyebrow">MealScout, explained</p>
          <h1>One food profile.<br />Everywhere people discover it.</h1>
          <p className="ms-about-lead">
            MealScout helps people decide what to eat and helps food businesses
            keep that decision grounded in current information. A business
            maintains one profile. Scout turns the profile into local discovery.
          </p>
          <div className="ms-about-actions">
            <a className="ms-about-button ms-about-button-primary" href="/scout">
              Find food with Scout <ArrowIcon />
            </a>
            <a className="ms-about-button ms-about-button-secondary" href="/restaurant-signup">
              Create or claim a business
            </a>
          </div>
          <p className="ms-about-quiet-note">
            No account is needed to start exploring public discovery and profiles.
          </p>
        </div>

        <div className="ms-about-hero-visual" aria-label="A collection of food and food truck scenes">
          <figure className="ms-about-photo ms-about-photo-wide">
            <img src="/backgrounds/food-truck-day.jpg" alt="A food truck serving customers outdoors" />
            <figcaption><span>Live context</span> Where food is serving today</figcaption>
          </figure>
          <figure className="ms-about-photo">
            <img src="/atmospheric/craving-tacos.jpg" alt="Fresh tacos ready to serve" />
            <figcaption><span>Cravings</span> Search the food, not just the name</figcaption>
          </figure>
          <div className="ms-about-hero-card">
            <span className="ms-about-hero-card-mark">M</span>
            <strong>Profile first</strong>
            <p>Menu, schedule, location, media, deals, and ordering flow from one managed source.</p>
          </div>
        </div>
      </section>

      <section className="ms-about-intro" aria-labelledby="plain-language-title">
        <p className="ms-about-kicker">The plain-language version</p>
        <h2 id="plain-language-title">
          MealScout is a local food discovery and business information system.
        </h2>
        <p>
          It is built for the question people actually ask—“What sounds good,
          and where can I get it?”—and for the businesses that need menus,
          schedules, locations, and opportunities to stay connected behind that answer.
        </p>
      </section>

      <section className="ms-about-principles" aria-label="Five things to remember">
        <div className="ms-about-section-heading">
          <p className="ms-about-kicker">If you remember five things</p>
          <h2>This is the MealScout model.</h2>
        </div>
        <div className="ms-about-principle-grid">
          {coreIdeas.map((idea) => (
            <article className="ms-about-principle" key={idea.number}>
              <span>{idea.number}</span>
              <h3>{idea.title}</h3>
              <p>{idea.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ms-about-flow" id="how-it-works" aria-labelledby="flow-title">
        <div className="ms-about-section-heading ms-about-section-heading-light">
          <p className="ms-about-kicker">How the system works</p>
          <h2 id="flow-title">Two sides, one shared source of truth.</h2>
          <p>Diners get a simpler answer. Businesses keep control of the information behind it.</p>
        </div>
        <div className="ms-about-flow-grid">
          <article className="ms-about-path ms-about-path-diner">
            <div className="ms-about-path-label">For someone looking for food</div>
            <ol>
              <li><span>1</span><div><strong>Open Scout</strong><p>Start with a craving, dish, business, category, or area.</p></div></li>
              <li><span>2</span><div><strong>Compare useful context</strong><p>See relevant profiles, menu highlights, schedules, events, deals, and map context.</p></div></li>
              <li><span>3</span><div><strong>Open the profile</strong><p>Check the full menu, published hours or stop, photos, service details, and available actions.</p></div></li>
              <li><span>4</span><div><strong>Act when ready</strong><p>Get directions, save, recommend, share, or order when that option is available.</p></div></li>
            </ol>
            <a href="/scout">Try Scout <ArrowIcon /></a>
          </article>

          <article className="ms-about-path ms-about-path-business">
            <div className="ms-about-path-label">For a food business</div>
            <ol>
              <li><span>1</span><div><strong>Create or claim the profile</strong><p>Establish the business identity and the people allowed to manage it.</p></div></li>
              <li><span>2</span><div><strong>Maintain the operation</strong><p>Publish menu details, hours, stops, media, deals, events, and ordering availability.</p></div></li>
              <li><span>3</span><div><strong>Let information flow outward</strong><p>The profile supplies public discovery instead of creating separate facts for every surface.</p></div></li>
              <li><span>4</span><div><strong>Manage the work</strong><p>Use the workspace for orders, audience, team permissions, payments, reports, and settings as enabled.</p></div></li>
            </ol>
            <a href="/restaurant-signup">Create or claim a business <ArrowIcon /></a>
          </article>
        </div>
      </section>

      <section className="ms-about-chapter ms-about-scout" id="scout" aria-labelledby="scout-title">
        <div className="ms-about-chapter-copy">
          <p className="ms-about-chapter-number">Chapter 01</p>
          <p className="ms-about-kicker">Scout discovery</p>
          <h2 id="scout-title">Start with what sounds good.</h2>
          <p>
            Scout is MealScout’s discovery surface. It is search and exploration,
            not a chatbot. It brings together current profile information so a
            customer can move from an idea—tacos, coffee, late-night, a truck
            nearby—to a business that may satisfy it.
          </p>
          <ul className="ms-about-check-list">
            <li><CheckIcon /> Search by dish, craving, business, category, or place</li>
            <li><CheckIcon /> Browse food-led discovery without knowing a business name</li>
            <li><CheckIcon /> Use the map or readable result lists for location context</li>
            <li><CheckIcon /> Open the public profile before making a decision</li>
          </ul>
          <a className="ms-about-text-link" href="/scout">Explore Scout <ArrowIcon /></a>
        </div>
        <div className="ms-about-scout-demo" aria-label="Example of a MealScout discovery path">
          <div className="ms-about-search-pill"><span>⌕</span> What are you craving?</div>
          <div className="ms-about-demo-chips"><span>Tacos</span><span>Food trucks</span><span>Open now</span></div>
          <article>
            <img src="/atmospheric/craving-bbq.jpg" alt="Barbecue platter" />
            <div><small>Menu match</small><strong>Start with the dish</strong><p>Then check the profile for today’s details.</p></div>
          </article>
          <p className="ms-about-demo-footnote">A discovery result is a doorway, not a replacement for the source profile.</p>
        </div>
      </section>

      <section className="ms-about-chapter ms-about-profile" id="profiles" aria-labelledby="profile-title">
        <div className="ms-about-profile-board">
          <div className="ms-about-profile-photo">
            <img src="/atmospheric/craving-seafood.jpg" alt="A colorful seafood dish" />
            <span>Food-led, not form-led</span>
          </div>
          <div className="ms-about-profile-card">
            <div className="ms-about-profile-brand-row">
              <img src="/brand/mealscout-logo-pin.png" alt="" />
              <div><small>Business profile</small><strong>One maintained identity</strong></div>
            </div>
            <div className="ms-about-profile-lines"><span></span><span></span><span></span></div>
            <div className="ms-about-profile-tags"><span>Menu</span><span>Schedule</span><span>Deals</span><span>Photos</span></div>
          </div>
        </div>
        <div className="ms-about-chapter-copy">
          <p className="ms-about-chapter-number">Chapter 02</p>
          <p className="ms-about-kicker">The business profile</p>
          <h2 id="profile-title">The page people see is also the system businesses maintain.</h2>
          <p>
            A MealScout profile is more than a listing. It is the published home
            for a restaurant, food truck, bar, or other supported food business.
            The profile can hold the practical details a customer needs and supply
            those details to discovery elsewhere in MealScout.
          </p>
          <div className="ms-about-mini-grid">
            <div><strong>Identity</strong><span>Name, type, story, contact, and service context</span></div>
            <div><strong>Food</strong><span>Menus, items, prices, descriptions, and photos</span></div>
            <div><strong>Place & time</strong><span>Address, hours, schedule, stops, and service area</span></div>
            <div><strong>Ways to act</strong><span>Directions, deals, ordering, saving, sharing, and recommending</span></div>
          </div>
        </div>
      </section>

      <section className="ms-about-chapter ms-about-business" id="businesses" aria-labelledby="business-title">
        <div className="ms-about-chapter-copy">
          <p className="ms-about-chapter-number">Chapter 03</p>
          <p className="ms-about-kicker">The business workspace</p>
          <h2 id="business-title">Manage the operation behind the profile.</h2>
          <p>
            Owners and approved collaborators work from a business-specific
            workspace. The exact modules depend on the business type, enabled
            services, and each teammate’s permissions.
          </p>
          <div className="ms-about-workspace-list">
            <span>Overview</span><span>Profile</span><span>Menu</span><span>Schedule</span>
            <span>Media</span><span>Deals</span><span>Orders</span><span>Audience</span>
            <span>Team</span><span>Payments</span><span>Reports</span><span>Settings</span>
          </div>
          <p className="ms-about-callout">
            <strong>Permission rule:</strong> being allowed to help with one
            business or one kind of work does not grant control over every business module.
          </p>
        </div>
        <div className="ms-about-workspace-visual" aria-label="Business workspace concept">
          <div className="ms-about-workspace-top"><span></span><strong>Business workspace</strong><em>Published</em></div>
          <div className="ms-about-workspace-body">
            <aside><span className="active"></span><span></span><span></span><span></span><span></span></aside>
            <div className="ms-about-workspace-content">
              <small>Profile completeness</small>
              <strong>Keep the source current</strong>
              <div className="ms-about-progress"><i></i></div>
              <div className="ms-about-workspace-cards"><span></span><span></span><span></span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="ms-about-parking" id="parking" aria-labelledby="parking-title">
        <div className="ms-about-parking-image">
          <img src="/backgrounds/food-truck-night.png" alt="Food trucks serving at an evening gathering" />
        </div>
        <div className="ms-about-parking-copy">
          <p className="ms-about-chapter-number">Chapter 04</p>
          <p className="ms-about-kicker">Mobile food & Parking Pass</p>
          <h2 id="parking-title">Food trucks need more than a pin on a map.</h2>
          <p>
            Parking Pass connects mobile food businesses with published host
            opportunities. Hosts can offer spaces with dates, availability,
            capacity, terms, and pricing. Trucks can explore, plan, and book the
            opportunities that fit their operation.
          </p>
          <div className="ms-about-parking-steps">
            <div><span>Host</span><p>Publishes an available place and its terms.</p></div>
            <div><span>Truck</span><p>Compares the real opportunity and plans the route.</p></div>
            <div><span>Booking</span><p>Records the confirmed stop in the operating workflow.</p></div>
          </div>
          <p className="ms-about-fine-print">
            MealScout does not replace permits, property rules, health requirements,
            or the operator’s responsibility to confirm that a stop is lawful and suitable.
          </p>
          <a className="ms-about-button ms-about-button-cream" href="/parking-pass">Explore Parking Pass <ArrowIcon /></a>
        </div>
      </section>

      <section className="ms-about-trust" id="trust" aria-labelledby="trust-title">
        <div className="ms-about-section-heading">
          <p className="ms-about-kicker">Trust without theater</p>
          <h2 id="trust-title">Useful evidence. Clear limits. No invented certainty.</h2>
          <p>
            Food information changes. Businesses move, menus sell out, hours shift,
            and old data can look current when it is not. MealScout is designed to
            expose those limits instead of hiding them behind a score.
          </p>
        </div>
        <div className="ms-about-trust-grid">
          <article><span>01</span><h3>Recommendations need context</h3><p>People can explain what they recommend and add photo evidence when useful.</p></article>
          <article><span>02</span><h3>Missing means missing</h3><p>If a menu, price, schedule, or location has not been published, MealScout should not guess it.</p></article>
          <article><span>03</span><h3>Conflicts require judgment</h3><p>High-impact identity and operating changes can be held for owner or administrative approval.</p></article>
          <article><span>04</span><h3>The business remains accountable</h3><p>Owners control their published profile, while customers still decide what evidence is useful to them.</p></article>
        </div>
        <div className="ms-about-not-grid">
          <strong>MealScout is not…</strong>
          <span>a chatbot</span>
          <span>a star-rating leaderboard</span>
          <span>a substitute for official safety or permit checks</span>
          <span>a promise that every profile is complete</span>
        </div>
      </section>

      <section className="ms-about-status" aria-labelledby="status-title">
        <div className="ms-about-section-heading">
          <p className="ms-about-kicker">What to expect today</p>
          <h2 id="status-title">A live product, with honest boundaries.</h2>
        </div>
        <div className="ms-about-status-grid">
          {statusColumns.map((column) => (
            <article key={column.label} className={`ms-about-status-${column.tone}`}>
              <span>{column.label}</span>
              <p>{column.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ms-about-reference" id="reference" aria-labelledby="reference-title">
        <div className="ms-about-reference-intro">
          <p className="ms-about-kicker">Complete feature reference</p>
          <h2 id="reference-title">The whole system, grouped by the job it does.</h2>
          <p>
            This reference is the foundation for MealScout’s future help section.
            Open any group for the practical capabilities behind it.
          </p>
        </div>
        <div className="ms-about-reference-list">
          {referenceGroups.map((group, index) => (
            <details key={group.title} open={index === 0}>
              <summary>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{group.title}</strong><small>{group.summary}</small></div>
                <i aria-hidden="true">+</i>
              </summary>
              <ul>{group.items.map((item) => <li key={item}><CheckIcon /> {item}</li>)}</ul>
            </details>
          ))}
        </div>
      </section>

      <section className="ms-about-start" id="start" aria-labelledby="start-title">
        <img src="/brand/mealscout-logo-pin.png" alt="" />
        <p className="ms-about-kicker">Choose your next step</p>
        <h2 id="start-title">Find food, run your profile, or put a place to work.</h2>
        <div className="ms-about-start-grid">
          <a href="/scout"><span>For diners</span><strong>Open Scout</strong><ArrowIcon /></a>
          <a href="/restaurant-signup"><span>For food businesses</span><strong>Create or claim a profile</strong><ArrowIcon /></a>
          <a href="/parking-pass"><span>For trucks and hosts</span><strong>Explore Parking Pass</strong><ArrowIcon /></a>
          <a href="/events"><span>For local activity</span><strong>Browse events</strong><ArrowIcon /></a>
        </div>
      </section>

      <footer className="ms-about-footer">
        <a className="ms-about-brand" href="/">
          <img src="/brand/mealscout-logo-pin.png" alt="" />
          <span>MealScout</span>
        </a>
        <p>Local food discovery built from the profile outward.</p>
        <div><a href="/contact">Contact</a><a href="/faq">FAQ</a><a href="/privacy-policy">Privacy</a><a href="#top">Back to top ↑</a></div>
      </footer>
    </main>
  );
}
