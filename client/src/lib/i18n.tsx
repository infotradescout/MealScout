import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type SupportedLocale = "en" | "es";

const STORAGE_KEY = "mealscout_locale";

type TranslationKey =
  | "nav.food"
  | "nav.map"
  | "nav.parkingPass"
  | "nav.video"
  | "nav.profile"
  | "nav.dashboard"
  | "nav.favorites"
  | "nav.createAccount"
  | "nav.claimTruck"
  | "nav.events"
  | "nav.host"
  | "nav.forRestaurants"
  | "nav.forBars"
  | "nav.staff"
  | "nav.createSpecial"
  | "nav.subscription"
  | "nav.supplies"
  | "nav.report"
  | "nav.admin"
  | "nav.controlCenter"
  | "nav.affiliates"
  | "nav.featuredSpecials"
  | "nav.share"
  | "toast.bugSentTitle"
  | "toast.bugSentDescription"
  | "toast.bugFailedTitle"
  | "toast.bugFailedDescription"
  | "language.switchToSpanish"
  | "language.switchToEnglish";

const translations: Record<SupportedLocale, Record<TranslationKey, string>> = {
  en: {
    "nav.food": "Food",
    "nav.map": "Map",
    "nav.parkingPass": "Parking Pass",
    "nav.video": "Video",
    "nav.profile": "Profile",
    "nav.dashboard": "Dashboard",
    "nav.favorites": "Favorites",
    "nav.createAccount": "Create Account",
    "nav.claimTruck": "Claim Truck",
    "nav.events": "Events",
    "nav.host": "Host",
    "nav.forRestaurants": "For Restaurants",
    "nav.forBars": "For Bars",
    "nav.staff": "Staff",
    "nav.createSpecial": "Create Special",
    "nav.subscription": "Subscription",
    "nav.supplies": "Supplies",
    "nav.report": "Report",
    "nav.admin": "Admin",
    "nav.controlCenter": "Control Center",
    "nav.affiliates": "Affiliates",
    "nav.featuredSpecials": "Featured Specials",
    "nav.share": "Share",
    "toast.bugSentTitle": "Bug report sent!",
    "toast.bugSentDescription": "Thank you for helping us improve MealScout.",
    "toast.bugFailedTitle": "Failed to send report",
    "toast.bugFailedDescription": "Please try again or contact support.",
    "language.switchToSpanish": "Switch language to Spanish",
    "language.switchToEnglish": "Switch language to English",
  },
  es: {
    "nav.food": "Comida",
    "nav.map": "Mapa",
    "nav.parkingPass": "Pase de Estacionamiento",
    "nav.video": "Video",
    "nav.profile": "Perfil",
    "nav.dashboard": "Panel",
    "nav.favorites": "Favoritos",
    "nav.createAccount": "Crear Cuenta",
    "nav.claimTruck": "Reclamar Camion",
    "nav.events": "Eventos",
    "nav.host": "Anfitrion",
    "nav.forRestaurants": "Para Restaurantes",
    "nav.forBars": "Para Bares",
    "nav.staff": "Personal",
    "nav.createSpecial": "Crear Oferta",
    "nav.subscription": "Suscripcion",
    "nav.supplies": "Suministros",
    "nav.report": "Reportar",
    "nav.admin": "Admin",
    "nav.controlCenter": "Centro de Control",
    "nav.affiliates": "Afiliados",
    "nav.featuredSpecials": "Ofertas Destacadas",
    "nav.share": "Compartir",
    "toast.bugSentTitle": "Reporte enviado",
    "toast.bugSentDescription": "Gracias por ayudarnos a mejorar MealScout.",
    "toast.bugFailedTitle": "No se pudo enviar",
    "toast.bugFailedDescription": "Intentalo de nuevo o contacta soporte.",
    "language.switchToSpanish": "Cambiar idioma a espanol",
    "language.switchToEnglish": "Cambiar idioma a ingles",
  },
};

type I18nContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  toggleLocale: () => void;
  t: (key: TranslationKey, fallback?: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const detectInitialLocale = (): SupportedLocale => {
  if (typeof window === "undefined") return "en";

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "es") return stored;

  const browserLanguage = window.navigator.language.toLowerCase();
  return browserLanguage.startsWith("es") ? "es" : "en";
};

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] =
    useState<SupportedLocale>(detectInitialLocale);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, locale);
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
      document.documentElement.setAttribute("data-locale", locale);
    }
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale: setLocaleState,
      toggleLocale: () =>
        setLocaleState((current) => (current === "en" ? "es" : "en")),
      t: (key, fallback) => translations[locale][key] ?? fallback ?? key,
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used within a LocaleProvider");
  }
  return value;
}
