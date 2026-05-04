export const PARKING_PASS_COPY = {
  // Navigation
  nav: {
    location: "Location",
    date: "Date",
    slot: "Slot",
    confirm: "Confirm",
    status: "Status",
  },

  // Screen 1 — Location
  location: {
    title: "Find Parking",
    subtext: "Choose a host location.",
    searchPlaceholder: "Search by area or host name",
    selectCta: "Select Location",
    summary: {
      idle: "Once you tap the button above, we’ll lock in your area for parking options.",
      gpsLocked:
        "GPS locked for this booking session. We’ll use it to rank nearby hosts only.",
      currentAreaLabel: "Current area:",
    },
    systemNote:
      "Parking Pass never edits times or negotiates prices. Once inventory is wired, this list will only show hosts that match your current area and rules.",
    filters: {
      distance: "Distance",
      type: "Type",
      goldPlate: "Gold Plate",
    },
    tags: {
      easyPullIn: "Easy pull-in",
      goodLighting: "Good lighting",
      wideLot: "Wide lot",
    },
  },

  // Screen 2 — Date
  date: {
    title: "Choose a date",
    subtext: "Choose a date for this location.",
    allDayOnlyNotice: "All-Day Only · No 4-hour slots at this location",
    continueCta: "Continue",
  },

  // Screen 3 — Slot
  slot: {
    title: "Choose Your Time",
    subtext: "Pick a parking window and see all fees.",
    bookingTypes: {
      fourHour: "4-hour",
      allDay: "All-day",
      both: "4-hour · All-day",
    },
    fourHourSection: "Available 4-hour Slots",
    allDayLabel: "All-Day Parking",
    allDayBadge: "All-Day Only",
    feeLine: "+ $10 MealScout fee",
    totalLabel: "Total",
    systemTags: {
      lunchRush: "Good for lunch rush",
    },
    reviewCta: "Review & Confirm",
  },

  // Screen 4 — Confirm
  confirm: {
    title: "Review Your Booking",
    pricing: {
      hostPrice: "Host price",
      fee: "MealScout fee",
      total: "Total due now",
    },
    summary: {
      dateLabel: "Date",
      dateValue: "Selected date",
      timeLabel: "Time",
      timeValue: "4-hour or All-day slot",
    },
    rulesHeader: "Host rules",
    rulesItems: [
      "Each host sets power access, noise limits, and cleanup expectations.",
      "These appear here as structured, read-only rules.",
    ],
    bufferTitle: "Buffer",
    bufferNotice: "30-minute buffer after your booking for exit and turnover.",
    offlineTitle: "Offline",
    offlineRule:
      "If GPS is unavailable, your spot is guaranteed for the first 4 hours. After that, rotation may occur.",
    cancellationTitle: "Cancellation",
    cancellation:
      "Cancellations before start return credit only. No cash refunds.",
    legal: "By confirming, you agree to MealScout’s Parking Terms.",
    confirmCta: "Confirm & Book",
    backCta: "Back",
  },

  // Screen 5 — Status
  status: {
    title: "Parking Pass",
    pills: {
      upcoming: "Upcoming",
      active: "Active",
      buffer: "Buffer",
      past: "Past",
    },
    upcoming: {
      bookedAt: "You’re booked at",
      startsIn: "Starts in",
      viewMap: "View on Map",
      directions: "Directions",
      offlineNote: "GPS issues won’t cancel your booking.",
      cancelCta: "Cancel (credit only)",
      cancelConfirm: "You will receive credit only. No cash refunds.",
    },
    active: {
      gpsOk: "On-site · GPS confirmed",
      gpsWeak: "GPS weak · Stay within marked area",
      now: "Now",
      bufferNext: "Buffer",
      reportIssue: "Report an Issue",
    },
    buffer: {
      endedAt: "Your booking ended.",
      exitWindow: "You have 30 minutes to exit.",
    },
    // Dev-only placeholders for UI scaffolding
    dev: {
      placeholders: {
        locationMap:
          "Map + nearby hosts will appear here once parking inventory is connected.",
        dateCalendar: "Calendar placeholder  Wire to date picker component",
        slotList:
          "Slots UI placeholder. Once connected, render <SlotCard /> and <AllDayCard /> instances from host configuration.",
        statusUpcomingCountdown:
          "Countdown and GPS checks appear here once connected.",
        statusActiveGpsDetail: "On-site  GPS confirmed (once wired).",
      },
    },
  },

  // Shared
  shared: {
    close: "Close",
    back: "Back",
    disabled: "Unavailable",
  },
} as const;

export type ParkingPassCopy = typeof PARKING_PASS_COPY;
