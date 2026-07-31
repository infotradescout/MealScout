/**
 * MealScout Affiliate System - Marketing Copy & Templates
 * 
 * Comprehensive messaging for all touchpoints:
 * - Empty state messaging
 * - Share dialogs
 * - Dashboard tiles
 * - Email/SMS/Social templates
 * - Invite copy
 */

export const COPY = {
  // ===== EMPTY COUNTY EXPERIENCE =====
  emptyCounty: {
    title: '📍 There are no MealScout restaurant partners in your area yet.',
    subtitle: 'Help us discover great local spots.',
    cta: 'Recommend a restaurant',

    earlyMessage: {
      heading: '🔥 You\'re early — MealScout is just starting in your area.',
      body: 'People who help shape their local food scene can track referrals and eligible paid booking activity.',
    },

    communityMessage: {
      heading: '🤝 Help shape your local food scene',
      body: 'Submit your favorite restaurants. Your referral stays attached if the business joins MealScout.',
      hint: 'Know a great spot? Recommend it below and help us build something special.',
    },

    fallbackMessage: {
      heading: 'Popular deals nearby',
      subtitle: 'While we build partnerships locally, here are great deals from around the state',
    },

    submitForm: {
      title: 'Recommend a Restaurant',
      subtitle: 'Help us discover your favorite local spots and keep credit for the referral.',
      fields: {
        name: 'Restaurant Name',
        address: 'Address',
        website: 'Website (optional)',
        phone: 'Phone (optional)',
        category: 'Category',
        description: 'Why do you love this place?',
      },
      submit: 'Submit Recommendation',
      success: 'Thanks! Our team will review and contact the restaurant owner.',
    },
  },

  // ===== AFFILIATE SYSTEM - SHARE DIALOG =====
  shareDialog: {
    deal: {
      title: '💰 Share this deal',
      subtitle: 'Keep referral credit when someone signs up through your link',
      info: 'First-click attribution keeps the original referral attached',
    },

    restaurant: {
      title: '🍽️ Recommend this restaurant',
      subtitle: 'Get paid when they become an MealScout partner',
      info: 'Share your unique link to keep referral credit',
    },

    page: {
      title: '📱 Share MealScout',
      subtitle: 'Your friends earn money too when they recommend',
      info: 'Every business signup through your link stays attributed to you',
    },

    collection: {
      title: '⭐ Share this collection',
      subtitle: 'Earn affiliate commissions on all recommendations',
      info: 'Eligible paid booking activity from attributed businesses appears in your ledger',
    },

    search: {
      title: '🔍 Share search results',
      subtitle: 'Get paid for recommendations that convert',
      info: 'Your unique link tracks signups and earns commissions',
    },
  },

  // ===== AFFILIATE DASHBOARD MESSAGING =====
  dashboard: {
    header: {
      title: 'Affiliate Dashboard',
      subtitle: 'Track referrals and eligible paid booking commissions',
    },

    cards: {
      totalEarned: {
        label: 'Total Earned',
        hint: 'All time',
      },
      available: {
        label: 'Available Balance',
        hint: 'Ready to withdraw',
        button: 'Withdraw now',
        buttonDisabled: 'Minimum $5',
      },
      pending: {
        label: 'Pending Commissions',
        hint: 'Next 30 days',
      },
      conversionRate: {
        label: 'Conversion Rate',
        hint: 'Signups from your links',
      },
    },

    tabs: {
      overview: 'Overview',
      links: 'My Links',
      commissions: 'Commissions',
      withdrawals: 'Withdrawals',
    },

    howItWorks: {
      title: 'How You Earn',
      step1: {
        icon: '📤',
        title: 'Share a Link',
        description: 'Share any restaurant, deal, or collection from MealScout',
      },
      step2: {
        icon: '📈',
        title: 'Someone Signs Up',
        description: 'A business owner clicks your link and creates or claims a profile',
      },
      step3: {
        icon: '💵',
        title: 'Earn Eligible Commissions',
        description: 'Eligible paid booking fees credited to your referral appear in your ledger',
      },
    },

    stats: {
      activeLinks: {
        title: 'Active Links',
        hint: 'Tracking URLs you\'ve shared',
      },
      totalClicks: {
        title: 'Total Clicks',
        hint: 'People visited your link',
      },
      conversions: {
        title: 'Conversions',
        hint: 'Restaurant signups attributed',
      },
    },

    commissionTiers: {
      monthly: 'No monthly profile-subscription commissions',
    },
  },

  // ===== AFFILIATE BADGE / BADGE MESSAGING =====
  foundingFoodie: {
    title: '🍽️ Founding Foodie',
    description: 'You helped shape your local food scene and built verified referral activity',
    requirements: [
      'Submitted 3+ restaurant recommendations',
      'Earned $50+ in affiliate commissions',
      'Referred 2+ restaurants that became paid partners',
    ],
    perks: [
      'Special badge on your profile',
      '5% bonus commission for 3 months',
      'Early access to features',
      'Founding member status',
    ],
  },

  // ===== SHARE TEMPLATES =====
  shareTemplates: {
    email: {
      subject: (name: string) => `Check out ${name} — killer deals on MealScout`,
      body: (name: string, url: string) =>
        `Hey!

Found this amazing spot on MealScout:

${name}

Here's a link with the best deals:
${url}

Let me know what you think! And if you find other great restaurants, you can earn money by sharing them too.

-
Share restaurants on MealScout and keep credit for your referrals
${url}`,
    },

    sms: {
      template: (name: string, code: string) =>
        `Just found ${name} on MealScout with incredible deals 🔥 Use my link or enter code ${code}`,
    },

    facebook: {
      title: (name: string) => `Just discovered ${name} on MealScout`,
      description: 'Amazing local food spot with killer deals 🍔',
      hashtags: '#MealScout #LocalFood #Deals',
    },

    twitter: {
      template: (name: string, code: string) =>
        `Just found ${name} on @MealScout with incredible deals 🔥 Use code ${code}`,
      hashtags: '#MealScout #LocalFood #FoodDeals',
    },

    whatsapp: {
      template: (name: string, url: string) =>
        `Hey! You gotta check out ${name} on MealScout. Here's the link: ${url} 🍽️`,
    },

    linkedin: {
      title: 'Discover how I\'m earning with MealScout',
      description:
        'Found a way to share my favorite local restaurants and keep credit for my referrals. Here\'s how →',
    },
  },

  // ===== WITHDRAWAL / CASH OUT =====
  withdrawal: {
    title: 'Request a Withdrawal',
    subtitle: 'Turn your commissions into cash or store credit',
    minimum: 'Minimum withdrawal: $5',
    methods: {
      bankTransfer: 'Bank Transfer (3-5 business days)',
      paypal: 'PayPal (1-2 hours)',
      storeCredit: 'Store Credit (Instant – spend at partner restaurants)',
    },
    processing: 'Your withdrawal will be processed within 5 business days.',
    fees: 'No fees for withdrawals over $5.',
  },

  // ===== COMMISSION DETAILS =====
  commissionInfo: {
    title: 'How Commissions Work',
    intro: 'MealScout tracks the business referrals attached to your links. Eligible paid booking activity appears in your commission ledger.',

    structure: {
      title: 'Commission Structure',
      monthly: {
        label: 'Profile signup',
        commission: 'Referral attribution is recorded; the profile itself has no monthly charge',
      },
      yearly: {
        label: 'Eligible paid activity',
        commission: 'The configured share of eligible booking fees is recorded in your ledger',
      },
    },

    rules: {
      firstClick: '✔ First-click attribution — whoever referred them first gets the commission',
      paidOnly: '✔ Profile signups do not create a monthly charge or commission',
      recurring: '✔ Eligible booking commissions are recorded per paid activity',
      noFree: '✔ No profile feature is gated by payment',
      noSelfReferral: '✔ Self-referrals are blocked',
    },

    example: {
      title: 'Example',
      scenario:
        'You recommend Joe\'s Pizza and the owner creates a profile through your link. The referral stays attached, and any eligible paid booking commission is recorded in your ledger.',
    },
  },

  // ===== INVITE PAGE =====
  invitePage: {
    title: 'Share MealScout & Earn Money',
    subtitle: 'Every business signup through your link stays attributed to you.',

    mainCTA: 'Get your unique affiliate link',

    features: [
      {
        icon: '🍔',
        title: 'Share restaurants',
        description: 'Find great local spots and share them with friends',
      },
      {
        icon: '💰',
        title: 'Earn commissions',
        description: 'Track eligible commissions from attributed paid booking activity',
      },
      {
        icon: '📈',
        title: 'Track earnings',
        description: 'Monitor clicks, signups, and commissions in real-time',
      },
      {
        icon: '💳',
        title: 'Cash out anytime',
        description: 'Withdraw to bank, PayPal, or spend at partner restaurants',
      },
    ],

    socialProof: {
      title: 'Build your local referral record',
      testimonial:
        'Share businesses you trust, keep the original referral attached, and see eligible earnings in one ledger.',
      attribution: 'MealScout affiliate tracking',
    },
  },

  // ===== ONBOARDING / FIRST-TIME MESSAGING =====
  onboarding: {
    step1: {
      title: '🎯 You\'re now an affiliate',
      description: 'Every link you share automatically tracks your referrals.',
    },
    step2: {
      title: '📤 Share a restaurant or deal',
      description: 'Click the share button on any restaurant, deal, or collection.',
    },
    step3: {
      title: '💵 Earn when they sign up',
      description:
        'If a business joins through your link, the referral stays attached and eligible paid activity can be credited to you.',
    },
    step4: {
      title: '💸 Withdraw or spend credits',
      description: 'Cash out via bank transfer, PayPal, or spend at partner restaurants.',
    },
  },

  // ===== ERROR / INFO MESSAGES =====
  messages: {
    linkCopied: '✓ Link copied!',
    shareFailed: 'Failed to generate link. Try again.',
    withdrawalMinimum: 'Minimum withdrawal is $5',
    insufficientBalance: 'Insufficient balance',
    withdrawalRequested: 'Withdrawal requested. You\'ll receive funds within 5 business days.',
    submissionReceived: 'Thanks! We\'ll review and reach out to the restaurant.',
    alreadySubmitted: 'This restaurant has already been submitted.',
  },

  // ===== DEVELOPMENT PLACEHOLDERS =====
  dev: {
    placeholders: {
      locationMap: 'Map of parking hosts in your area (coming soon)',
      dateCalendar: 'Calendar for date selection (coming soon)',
      slotList: 'Available time slots (coming soon)',
      statusUpcomingCountdown: 'Countdown to your parking slot',
      statusActiveGpsDetail: 'GPS directions to parking spot',
    },
  },
};

export default COPY;
