/**
 * Host Onboarding v1 - COPY LOCK
 * This file is the single source of truth for host onboarding user-facing text.
 * COPY MUST COME FROM this file.
 * DO NOT inline user-facing strings in components.
 * Changes here require product + legal review.
 */

export const HOST_ONBOARDING_COPY = {
  meta: {
    title: "Restaurant Sign Up - MealScout | Grow Your Business",
    description:
      "Join MealScout and reach more customers with targeted local deals. Restaurant owners can create promotional deals, attract new diners, and boost sales. Sign up for free today!",
    keywords:
      "restaurant signup, business registration, restaurant promotions, attract customers, boost restaurant sales, local marketing",
    canonicalUrl: "https://www.mealscout.us/restaurant-signup",
  },

  unauth: {
    headerTitle: "MealScout for Businesses",
    hero: {
      badge: "Step 2 of 2 - Business account",
      title: "Set Up Your Restaurant or Food Truck",
      subtitle:
        "Connect your existing MealScout login, add your business details, and start reaching nearby diners who already use MealScout to find local deals.",
    },
    toggles: {
      signup: "Create Account",
      login: "Sign In",
    },
    oauth: {
      button: "Continue with Google",
    },
    divider: {
      or: "or",
    },
    signupCta: {
      buttonIdle: "Create Restaurant Account",
      buttonPending: "Creating Account...",
    },
    loginCta: {
      buttonIdle: "Sign In to Restaurant Account",
      buttonPending: "Signing In...",
    },
    forgotPassword: "Forgot your password?",
    finalCta: {
      title: "Ready to Get Started?",
      subtitle:
        "Join hundreds of restaurants already using MealScout to grow their business. Set up your first deal in minutes.",
      primaryButton: "Create Restaurant Account",
      secondaryButton: "Login to Existing Account",
    },
  },

  main: {
    backHeaderTitle: "Business Registration",
    authenticatedBanner: {
      title: "Signed in: add a business profile to this account",
      body:
        "You are creating an additional business profile on your existing account. No new account is created.",
      freeLine:
        "Free profile: parking pass + search visibility stay available.",
      paidLine:
        "Paid visibility: feed/maps + deal posting require an active plan after your 30-day trial.",
    },
    hero: {
      badge: "Business profile setup",
      prompt: "Choose your business type",
      restaurant: {
        label: "Restaurant",
        title: "Fill more tables with local diners",
        subtitle:
          "Promote your restaurant to nearby customers searching for a great meal right now.",
        description:
          "Ideal for dine-in, cafes, or quick-serve spots looking to boost traffic.",
      },
      foodTruck: {
        label: "Food Truck",
        title: "Grow your route and get discovered",
        subtitle:
          "Show up on the map, share your schedule, and connect with hungry fans on the go.",
        description:
          "Perfect for mobile kitchens that change locations throughout the week.",
      },
      caterer: {
        label: "Caterer",
        title: "Book more catering without a storefront flow",
        subtitle:
          "Build a catering-ready profile for private events, office meals, parties, and recurring service.",
        description:
          "Perfect for businesses that serve events, prep from a commissary, or travel to customers.",
      },
      privateChef: {
        label: "Private Chef",
        title: "Build a bookable private chef profile",
        subtitle:
          "Showcase your menus, service area, availability, and proof of coverage so customers can book with confidence.",
        description:
          "Designed for chefs who serve private dinners, events, meal prep, tastings, and recurring in-home service.",
      },
      bar: {
        label: "Bar",
        description:
          "Bars and nightlife venues can choose Restaurant and list deals too.",
      },
      action: "Continue as",
    },
  },

  benefits: {
    cards: {
      reachMore: {
        title: "Reach More Customers",
        body: "Target hungry customers within walking distance of your restaurant when they're actively looking for deals.",
        bullets: [
          "Hyper-local targeting",
          "Peak hunger times",
          "Mobile-first audience",
        ],
      },
      fillSlow: {
        title: "Fill Slow Periods",
        body: "Boost revenue during off-peak hours with targeted lunch and dinner deals that bring customers when you need them most.",
        bullets: [
          "Time-based targeting",
          "Flexible deal scheduling",
          "Revenue optimization",
        ],
      },
      trackPerformance: {
        title: "Track Performance",
        body: "Get detailed analytics on your deal performance and optimize your campaigns for maximum ROI and customer acquisition.",
        bullets: ["Real-time analytics", "Customer insights", "ROI tracking"],
      },
    },
    compact: {
      local: {
        title: "Hyper-Local Targeting",
        desc: "Reach workers and customers within a few blocks of your restaurant",
      },
      allDay: {
        title: "All-Day Service",
        desc: "Great deals throughout the day for busy customers",
      },
      track: {
        title: "Track Performance",
        desc: "See how your deals perform and optimize for better results",
      },
    },
  },

  pricing: {
    hero: {
      title: "Free Profile + Premium Trial",
      coreLine:
        "Create your profile for free. Full features are included for 30 days from account creation.",
      originalPrice: "$50",
      monthlyPrice: "$25",
      monthlySuffix: "/month",
      everythingIncludedTitle: "Everything included:",
      everythingIncludedBullets: [
        "Unlimited deals",
        "Edit deals anytime",
        "Performance analytics",
        "Customer targeting",
        "Real-time notifications",
        "Location-based promotion",
        "24/7 support",
        "Cancel anytime",
      ],
    },
    formCard: {
      title: "Free Profile",
      badge: "No payment required to create your profile.",
      freeProfileLine:
        "Profiles stay active for parking pass access and search visibility.",
      trialLine:
        "30-day full-feature trial starts from account creation.",
      paidLine:
        "After trial: $25/month to appear in feed/maps and post deals.",
      originalPrice: "$50",
      monthlyPrice: "$25",
      monthlySuffix: "/month",
      unlimitedTitle: "Unlimited Deals",
      unlimitedBody: "Post as many deals as you want - no limits!",
      everythingIncludedTitle: "Everything included:",
      features: [
        "Unlimited active deals",
        "Random deal display in feeds",
        "Performance analytics",
        "Location-based promotion",
        "Real-time notifications",
        "Cancel anytime",
      ],
    },
  },

  promo: {
    helperText: "Enter promo code for beta access...",
    betaNote: 'Enter "BETA" for free access during beta testing period',
  },

  terms: {
    labelPrefix: "I agree to the",
    termsText: "Terms of Service",
    andText: "and",
    privacyText: "Privacy Policy",
  },

  steps: {
    businessDetails: "Business Details",
    businessVerification: "Business Verification",
  },

  verification: {
    title: "Verify your business to unlock bookings",
    intro:
      "Your account is pending verification. You cannot book parking passes or access premium features until your business is verified. Upload one or more documents below to start the review — most reviews complete within 1 business day.",
    pendingBanner:
      "Verification pending — parking pass bookings are locked until your business is approved.",
    claimRequiredNote:
      "Claims require verification. You can submit documents now to complete your request.",
    bullets: [
      "Filing documents (LLC/Corp/DBA articles or city license)",
      "EIN or tax registration documents",
      "Updated insurance or health department certificates",
    ],
    whyVerify:
      "Verified businesses get a visible trust badge, priority placement on the map, and the ability to book parking pass spots.",
    privateChefTitle: "Verify your private chef business",
    privateChefIntro:
      "Your chef profile can be created now, but bookings and premium visibility unlock after business verification. Upload proof that you are legally operating and commercially insured for the area you serve.",
    privateChefBullets: [
      "Commercial general liability or chef/catering insurance",
      "Business license, DBA, LLC/Corp filing, or local registration",
      "Food handler, food manager, commissary, or health department documents when required locally",
    ],
    privateChefWhyVerify:
      "Verified private chefs earn a visible trust badge, stronger placement in discovery, and cleaner booking confidence for hosts, customers, and event organizers.",
    backButton: "Back to Business Details",
    skipButton: "Skip — I'll verify later",
    submitIdle: "Submit for Review",
    submitPending: "Submitting...",
  },

  validation: {
    restaurant: {
      nameRequired: "Business name is required",
      addressRequired: "Address is required",
      phoneInvalid: "Valid phone number is required",
      businessTypeRequired: "Please select your business type",
      confirmNotFoodTruckRequired:
        "Confirm this is not a mobile food truck before continuing.",
      cuisineRequired: "Cuisine type is required",
      acceptTermsRequired: "You must accept the terms",
    },
    signup: {
      emailInvalid: "Valid email is required",
      firstNameRequired: "First name is required",
      lastNameRequired: "Last name is required",
      phoneInvalid: "Valid phone number is required",
      passwordTooShort:
        "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.",
      confirmPasswordRequired: "Please confirm your password",
      passwordsMismatch: "Passwords don't match",
    },
    login: {
      emailInvalid: "Valid email is required",
      passwordRequired: "Password is required",
    },
  },

  notifications: {
    signup: {
      successTitle: "Success!",
      successDescription: "Account created successfully!",
      errorTitle: "Signup Failed",
      errorDescription: "Failed to create account",
    },
    login: {
      successTitle: "Success!",
      successDescription: "Logged in successfully!",
      errorTitle: "Login Failed",
      errorDescription: "Invalid email or password",
    },
    restaurant: {
      successTitle: "Restaurant Registered!",
      successDescription:
        "Now let's verify your business to build trust with customers.",
      unauthorizedTitle: "Unauthorized",
      unauthorizedDescription: "You are logged out. Logging in again...",
      errorTitle: "Error",
      errorDescription: "Failed to register restaurant",
    },
    verification: {
      successTitle: "Verification Submitted!",
      successDescription:
        "Your documents have been submitted for review. You'll be notified of the decision.",
      errorTitle: "Submission Failed",
      errorDescription: "Failed to submit verification request",
      missingDocsTitle: "Documents Required",
      missingDocsDescription:
        "Please upload at least one business document for verification.",
      skippedTitle: "Verification Skipped",
      skippedDescription:
        "You can submit verification documents later from your dashboard.",
    },
    betaAccess: {
      title: "Beta Access Granted!",
      description:
        "You can now create deals without payment during beta testing.",
    },
  },

  forms: {
    signup: {
      firstNameLabel: "First Name",
      firstNamePlaceholder: "John",
      lastNameLabel: "Last Name",
      lastNamePlaceholder: "Doe",
      emailLabel: "Email",
      emailPlaceholder: "john@restaurant.com",
      phoneLabel: "Phone Number",
      phonePlaceholder: "(555) 123-4567",
      passwordLabel: "Password",
      passwordPlaceholder: "At least 8 characters with strong mix",
      confirmPasswordLabel: "Confirm Password",
      confirmPasswordPlaceholder: "Confirm your password",
    },
    login: {
      emailLabel: "Email",
      emailPlaceholder: "john@restaurant.com",
      passwordLabel: "Password",
      passwordPlaceholder: "Your password",
    },
    restaurant: {
      nameLabel: "Business Name",
      namePlaceholder: "Enter your business name",
      businessTypeLabel: "Business Type",
      businessTypePlaceholder: "Select your business type...",
      businessTypeHelp:
        "Choose the setup that matches how customers find you: mobile, fixed-location, or catering.",
      privateChefBusinessTypeHelp:
        "Choose Private Chef when customers book you personally for dinners, events, meal prep, tastings, or recurring in-home service.",
      stationaryConfirmLabel:
        "I confirm this is a fixed location (not a food truck).",
      stationaryWarning:
        "If this business moves locations, select Food Truck instead.",
      addressLabel: "Business Address",
      addressPlaceholder: "123 Main Street, Chicago, IL",
      catererAddressLabel: "Commissary or Pickup Address",
      catererAddressPlaceholder: "Optional if you serve customers off-site",
      privateChefAddressLabel: "Base Kitchen or Service Area",
      privateChefAddressPlaceholder:
        "Your licensed kitchen, commissary, or primary city served",
      cityLabel: "City",
      cityPlaceholder: "Chicago",
      stateLabel: "State",
      statePlaceholder: "IL",
      phoneLabel: "Phone",
      phonePlaceholder: "(555) 123-4567",
      claimTitle: "Claim an Existing Food Truck",
      claimDescription:
        "If your truck is already listed from a government registry, claim it and verify ownership.",
      claimSearchLabel: "Search by license ID or truck name",
      claimSearchPlaceholder: "Start typing your license ID or truck name",
      claimSearchButton: "Find My Truck",
      claimSelectButton: "Use This Truck",
      claimSelectedLabel: "Selected listing",
      claimClearButton: "Clear Selection",
      claimNoResults: "No matches found. You can continue with manual entry.",
      claimDisclaimer:
        "Claiming requires verification documents that match your license or insurance.",
      cuisineLabel: "Cuisine Type",
      cuisinePlaceholder: "Select cuisine type...",
      promoLabel: "Promo Code",
      promoOptionalSuffix: "(Optional)",
    },
  },

  cta: {
    restaurantSubmit: {
      idle: "Create Free Profile",
      pending: "Creating...",
    },
  },
} as const;

export type HostOnboardingCopy = typeof HOST_ONBOARDING_COPY;
export type HostCopyKey =
  | "pricing.hero.originalPrice"
  | "pricing.hero.monthlyPrice"
  | "pricing.formCard.originalPrice"
  | "pricing.formCard.monthlyPrice"
  | "terms.labelPrefix"
  | "terms.termsText"
  | "terms.privacyText"
  | "validation.restaurant.nameRequired"
  | "validation.restaurant.addressRequired"
  | "validation.restaurant.phoneInvalid"
  | "validation.signup.emailInvalid"
  | "validation.signup.passwordTooShort"
  | "validation.login.emailInvalid"
  | "validation.login.passwordRequired"
  | "notifications.signup.successTitle"
  | "notifications.signup.errorTitle"
  | "notifications.restaurant.successTitle"
  | "notifications.verification.successTitle"
  | "notifications.verification.errorTitle";
