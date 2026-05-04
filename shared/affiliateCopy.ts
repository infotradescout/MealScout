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
      body: 'People who help shape their local food scene become founding foodies and earn recurring commissions.',
    },

    communityMessage: {
      heading: '🤝 Help shape your local food scene',
      body: 'Submit your favorite restaurants. If they join MealScout, you\'ll earn recurring commission every month they stay active.',
      hint: 'Know a great spot? Recommend it below and help us build something special.',
    },

    fallbackMessage: {
      heading: 'Popular deals nearby',
      subtitle: 'While we build partnerships locally, here are great deals from around the state',
    },

    submitForm: {
      title: 'Recommend a Restaurant',
      subtitle: 'Help us discover your favorite local spots. If they join MealScout, you earn recurring commissions!',
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
      subtitle: 'Earn recurring commission every time someone signs up through your link',
      info: 'First-click attribution: earn 20% every paid month',
    },

    restaurant: {
      title: '🍽️ Recommend this restaurant',
      subtitle: 'Get paid when they become an MealScout partner',
      info: 'Share your unique affiliate link: 20% every paid month',
    },

    page: {
      title: '📱 Share MealScout',
      subtitle: 'Your friends earn money too when they recommend',
      info: 'Every restaurant signup through your link = recurring commission for you both',
    },

    collection: {
      title: '⭐ Share this collection',
      subtitle: 'Earn affiliate commissions on all recommendations',
      info: 'Get paid 20% every paid month from restaurants in this collection',
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
      subtitle: 'Earn recurring commissions by sharing restaurants from MealScout',
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
        description: 'A restaurant owner clicks your link and becomes a paid subscriber',
      },
      step3: {
        icon: '💵',
        title: 'Earn Recurring Commissions',
        description: 'Get 20% every paid month they stay active',
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
      monthly: '20% of each paid month',
    },
  },

  // ===== AFFILIATE BADGE / BADGE MESSAGING =====
  foundingFoodie: {
    title: '🍽️ Founding Foodie',
    description: 'You helped shape your local food scene and earned recurring commissions',
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
Share restaurants on MealScout and earn recurring commissions
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
        'Found a way to share my favorite local restaurants AND earn recurring commissions. Here\'s how →',
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
    intro: 'When a restaurant you refer becomes a paid MealScout partner, you earn recurring commissions.',

    structure: {
      title: 'Commission Structure',
      monthly: {
        label: 'Signup bonus',
        commission: '20% of each paid subscription',
      },
      yearly: {
        label: 'Recurring monthly',
        commission: '20% of each paid month thereafter',
      },
    },

    rules: {
      firstClick: '✔ First-click attribution — whoever referred them first gets the commission',
      paidOnly: '✔ Only paid if restaurant becomes a paid subscriber',
      recurring: '✔ Recurring monthly (stops when they cancel)',
      noFree: '✔ No commission on free tiers',
      noSelfReferral: '✔ Self-referrals are blocked',
    },

    example: {
      title: 'Example',
      scenario:
        'You recommend Joe\'s Pizza. They subscribe for $25 this month. You earn 20% ($5) each paid month they stay subscribed.',
    },
  },

  // ===== INVITE PAGE =====
  invitePage: {
    title: 'Share MealScout & Earn Money',
    subtitle: 'Every restaurant signup through your link earns you recurring commissions.',

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
        description: 'Earn 20% every month from restaurant subscriptions',
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
      title: 'Join founders earning with MealScout',
      testimonial:
        'I\'ve recommended my favorite restaurants and earned over $500 in the first 3 months. It\'s a win-win for restaurants and scouts like us.',
      attribution: '— MealScout Member',
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
        'If someone becomes a paid subscriber through your link, you earn 20% every month.',
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
