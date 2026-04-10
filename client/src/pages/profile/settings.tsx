import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowLeft,
  Bell,
  Globe,
  Palette,
  Save,
  Settings,
  Shield,
} from "lucide-react";
import Navigation from "@/components/navigation";
import NotificationSettings from "@/components/notification-settings";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useI18n, type SupportedLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type SettingsPayload = {
  accountSettings: {
    language?: string;
    currency?: string;
    locationServices?: boolean;
    analytics?: boolean;
    marketing?: boolean;
    customDomain?: {
      hostname?: string;
      status?: "unverified" | "verified" | "mismatch" | "error";
      lastCheckedAt?: string;
      expectedTarget?: string;
      diagnostics?: string;
    };
  };
  publicProfileSettings: {
    templatePreset?: "classic" | "story" | "bold" | "minimal";
    theme?: "sunset" | "slate" | "forest" | "amber";
    accentColor?: string;
    fontFamily?: "system" | "serif" | "display" | "mono";
    heroLayout?: "center" | "left" | "split";
    heroTitle?: string;
    heroSubtitle?: string;
    ctaLabel?: string;
    ctaUrl?: string;
    about?: string;
    highlights?: string[];
    featuredLinks?: Array<{ label: string; url: string }>;
    galleryUrls?: string[];
    sectionOrder?: Array<
      | "about"
      | "highlights"
      | "links"
      | "gallery"
      | "contact"
      | "location"
      | "metrics"
    >;
    showAddress?: boolean;
    showContact?: boolean;
    showHours?: boolean;
    hideProfileBadge?: boolean;
  };
  profileLinks?: Array<{
    entity: "restaurant" | "host" | "supplier";
    id: string;
    title: string;
    path: string;
  }>;
  media?: {
    provider?: "cloudinary" | "none" | string;
    configured?: boolean;
  };
};

const SECTION_OPTIONS = [
  "about",
  "location",
  "contact",
  "metrics",
  "highlights",
  "links",
  "gallery",
] as const;
type SectionKey = (typeof SECTION_OPTIONS)[number];

const PREVIEW_THEME_BG: Record<string, string> = {
  sunset: "from-rose-900 to-orange-700",
  slate: "from-slate-900 to-slate-700",
  forest: "from-emerald-900 to-emerald-700",
  amber: "from-amber-900 to-amber-700",
};

export default function SettingsPage() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const { locale, setLocale } = useI18n();
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [verifyingDomain, setVerifyingDomain] = useState(false);
  const [dragSection, setDragSection] = useState<SectionKey | null>(null);

  const { data, isLoading, refetch } = useQuery<SettingsPayload>({
    queryKey: ["/api/settings/me"],
    enabled: isAuthenticated,
    queryFn: async () => {
      const res = await fetch("/api/settings/me", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
  });

  const [general, setGeneral] = useState({
    language: "english",
    currency: "usd",
    locationServices: true,
    analytics: true,
    marketing: false,
    customDomainHost: "",
  });
  const [profile, setProfile] = useState({
    templatePreset: "classic" as "classic" | "story" | "bold" | "minimal",
    theme: "sunset" as "sunset" | "slate" | "forest" | "amber",
    accentColor: "#f97316",
    fontFamily: "system" as "system" | "serif" | "display" | "mono",
    heroLayout: "left" as "center" | "left" | "split",
    heroTitle: "",
    heroSubtitle: "",
    ctaLabel: "",
    ctaUrl: "",
    about: "",
    highlights: "",
    featuredLinks: "",
    galleryUrls: "",
    sectionOrder: "about,location,contact,metrics,highlights,links,gallery",
    showAddress: true,
    showContact: true,
    showHours: true,
    hideProfileBadge: false,
  });

  const hydratedRef = useRef(false);

  const languageSettingFromLocale = (value: SupportedLocale) =>
    value === "es" ? "spanish" : "english";
  const localeFromLanguageSetting = (value: string): SupportedLocale =>
    value === "spanish" ? "es" : "en";

  useEffect(() => {
    if (!data || hydratedRef.current) return;
    const a = data.accountSettings || {};
    const p = data.publicProfileSettings || {};
    setGeneral({
      language: a.language || languageSettingFromLocale(locale),
      currency: a.currency || "usd",
      locationServices: a.locationServices ?? true,
      analytics: a.analytics ?? true,
      marketing: a.marketing ?? false,
      customDomainHost: a.customDomain?.hostname || "",
    });
    setProfile({
      templatePreset: (p.templatePreset as any) || "classic",
      theme: (p.theme as any) || "sunset",
      accentColor: p.accentColor || "#f97316",
      fontFamily: (p.fontFamily as any) || "system",
      heroLayout: (p.heroLayout as any) || "left",
      heroTitle: p.heroTitle || "",
      heroSubtitle: p.heroSubtitle || "",
      ctaLabel: p.ctaLabel || "",
      ctaUrl: p.ctaUrl || "",
      about: p.about || "",
      highlights: Array.isArray(p.highlights) ? p.highlights.join("\n") : "",
      featuredLinks: Array.isArray(p.featuredLinks)
        ? p.featuredLinks.map((l) => `${l.label}|${l.url}`).join("\n")
        : "",
      galleryUrls: Array.isArray(p.galleryUrls) ? p.galleryUrls.join("\n") : "",
      sectionOrder: Array.isArray(p.sectionOrder)
        ? p.sectionOrder.join(",")
        : "about,location,contact,metrics,highlights,links,gallery",
      showAddress: p.showAddress ?? true,
      showContact: p.showContact ?? true,
      showHours: p.showHours ?? true,
      hideProfileBadge: p.hideProfileBadge ?? false,
    });
    if (a.language) {
      setLocale(localeFromLanguageSetting(a.language));
    }
    hydratedRef.current = true;
  }, [data, locale, setLocale]);

  if (!isAuthenticated || !user) {
    return (
      <div className="max-w-3xl mx-auto bg-[var(--bg-app)] min-h-screen relative pb-20">
        <div className="text-center py-12">
          <Settings className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Sign in required</h2>
          <p className="text-muted-foreground">
            Log in to access your settings
          </p>
        </div>
        <Navigation />
      </div>
    );
  }

  const saveGeneral = async () => {
    setSavingGeneral(true);
    try {
      const res = await fetch("/api/settings/me", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountSettings: {
            language: general.language,
            currency: general.currency,
            locationServices: general.locationServices,
            analytics: general.analytics,
            marketing: general.marketing,
            customDomain: {
              hostname: general.customDomainHost || "",
              status: data?.accountSettings?.customDomain?.status,
              lastCheckedAt: data?.accountSettings?.customDomain?.lastCheckedAt,
              expectedTarget:
                data?.accountSettings?.customDomain?.expectedTarget,
              diagnostics: data?.accountSettings?.customDomain?.diagnostics,
            },
          },
        }),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      toast({ title: "Saved", description: "General settings updated." });
      await refetch();
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error?.message || "Unable to save general settings.",
        variant: "destructive",
      });
    } finally {
      setSavingGeneral(false);
    }
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const parsedHighlights = profile.highlights
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean);
      const parsedGallery = profile.galleryUrls
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean);
      const parsedLinks = profile.featuredLinks
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [label, url] = line.split("|").map((s) => s.trim());
          return { label: label || url, url: url || label };
        })
        .filter((row) => row.label && row.url);
      const parsedSectionOrder = profile.sectionOrder
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)
        .filter((v) =>
          [
            "about",
            "highlights",
            "links",
            "gallery",
            "contact",
            "location",
            "metrics",
          ].includes(v),
        ) as Array<
        | "about"
        | "highlights"
        | "links"
        | "gallery"
        | "contact"
        | "location"
        | "metrics"
      >;

      const res = await fetch("/api/settings/me", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicProfileSettings: {
            templatePreset: profile.templatePreset,
            theme: profile.theme,
            accentColor: profile.accentColor,
            fontFamily: profile.fontFamily,
            heroLayout: profile.heroLayout,
            heroTitle: profile.heroTitle,
            heroSubtitle: profile.heroSubtitle,
            ctaLabel: profile.ctaLabel,
            ctaUrl: profile.ctaUrl,
            about: profile.about,
            highlights: parsedHighlights,
            featuredLinks: parsedLinks,
            galleryUrls: parsedGallery,
            sectionOrder: parsedSectionOrder,
            showAddress: profile.showAddress,
            showContact: profile.showContact,
            showHours: profile.showHours,
            hideProfileBadge: profile.hideProfileBadge,
          },
        }),
      });
      if (!res.ok) throw new Error("Failed to save profile studio changes");
      toast({ title: "Saved", description: "Public profile studio updated." });
      await refetch();
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error?.message || "Unable to save profile settings.",
        variant: "destructive",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const applyPreset = (preset: "classic" | "story" | "bold" | "minimal") => {
    const baseByPreset: Record<
      typeof preset,
      {
        theme: "sunset" | "slate" | "forest" | "amber";
        fontFamily: "system" | "serif" | "display" | "mono";
        heroLayout: "center" | "left" | "split";
        accentColor: string;
      }
    > = {
      classic: {
        theme: "sunset",
        fontFamily: "system",
        heroLayout: "left",
        accentColor: "#f97316",
      },
      story: {
        theme: "forest",
        fontFamily: "serif",
        heroLayout: "split",
        accentColor: "#10b981",
      },
      bold: {
        theme: "amber",
        fontFamily: "display",
        heroLayout: "center",
        accentColor: "#f59e0b",
      },
      minimal: {
        theme: "slate",
        fontFamily: "system",
        heroLayout: "left",
        accentColor: "#64748b",
      },
    };
    const next = baseByPreset[preset];
    setProfile((prev) => ({
      ...prev,
      templatePreset: preset,
      theme: next.theme,
      fontFamily: next.fontFamily,
      heroLayout: next.heroLayout,
      accentColor: next.accentColor,
    }));
  };

  const uploadGalleryImage = async (file: File) => {
    setUploadingGallery(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/settings/public-profile/gallery", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const payload = await res.json();
      const urls = Array.isArray(payload?.galleryUrls)
        ? payload.galleryUrls
        : [];
      setProfile((prev) => ({ ...prev, galleryUrls: urls.join("\n") }));
      toast({ title: "Uploaded", description: "Image added to gallery." });
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error?.message || "Unable to upload image.",
        variant: "destructive",
      });
    } finally {
      setUploadingGallery(false);
    }
  };

  const verifyCustomDomain = async () => {
    const hostname = String(general.customDomainHost || "")
      .trim()
      .toLowerCase();
    if (!hostname) {
      toast({
        title: "Domain required",
        description: "Enter a custom domain first.",
        variant: "destructive",
      });
      return;
    }
    setVerifyingDomain(true);
    try {
      const res = await fetch("/api/settings/custom-domain/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(payload?.message || "Domain verification failed");
      toast({
        title:
          payload?.status === "verified"
            ? "Domain verified"
            : "Domain check complete",
        description:
          payload?.status === "verified"
            ? `DNS is correctly pointing to ${payload?.expectedTarget || "the platform"}`
            : payload?.diagnostics || "DNS is not yet aligned.",
      });
      await refetch();
    } catch (error: any) {
      toast({
        title: "Verification failed",
        description: error?.message || "Unable to verify domain.",
        variant: "destructive",
      });
    } finally {
      setVerifyingDomain(false);
    }
  };

  const getSectionOrderList = (): SectionKey[] => {
    const parsed = profile.sectionOrder
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter((v): v is SectionKey =>
        (SECTION_OPTIONS as readonly string[]).includes(v),
      );
    const deduped = Array.from(new Set(parsed));
    for (const key of SECTION_OPTIONS) {
      if (!deduped.includes(key)) deduped.push(key);
    }
    return deduped;
  };

  const reorderSections = (from: SectionKey, to: SectionKey) => {
    if (from === to) return;
    const list = getSectionOrderList();
    const fromIdx = list.indexOf(from);
    const toIdx = list.indexOf(to);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...list];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, from);
    setProfile((prev) => ({ ...prev, sectionOrder: next.join(",") }));
  };

  const resolvedPreviewTheme = profile.theme || "sunset";
  const resolvedPreviewFontClass =
    profile.fontFamily === "serif"
      ? "font-serif"
      : profile.fontFamily === "mono"
        ? "font-mono"
        : profile.fontFamily === "display"
          ? "font-[Georgia]"
          : "font-sans";
  const previewSections = getSectionOrderList();
  const previewHighlights = profile.highlights
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 6);
  const previewLinks = profile.featuredLinks
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((line) => {
      const [label, url] = line.split("|").map((s) => s.trim());
      return { label: label || url || "Link", url: url || label || "#" };
    });
  const previewGallery = profile.galleryUrls
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 6);

  return (
    <div className="max-w-3xl mx-auto bg-[var(--bg-app)] min-h-screen relative pb-20">
      <header className="px-4 sm:px-6 py-6 bg-[hsl(var(--background))] border-b border-white/5">
        <div className="flex items-center mb-2">
          <Link href="/profile">
            <Button variant="ghost" size="sm" className="mr-3 -ml-2">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex items-center">
            <Settings className="w-6 h-6 text-primary mr-3" />
            <h1 className="text-xl font-bold text-foreground">
              Settings + Profile Studio
            </h1>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Build your public profile into a mini website and control account
          preferences.
        </p>
      </header>

      <div className="px-4 sm:px-6 py-6">
        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
            <TabsTrigger value="profile">
              <Palette className="mr-1 hidden h-4 w-4 sm:block" />
              Studio
            </TabsTrigger>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="notifications">
              <Bell className="mr-1 hidden h-4 w-4 sm:block" />
              Alerts
            </TabsTrigger>
            <TabsTrigger value="privacy">
              <Shield className="mr-1 hidden h-4 w-4 sm:block" />
              Privacy
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Live Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={`overflow-hidden rounded-lg border ${resolvedPreviewFontClass}`}
                >
                  <div
                    className={`bg-gradient-to-br ${PREVIEW_THEME_BG[resolvedPreviewTheme] || PREVIEW_THEME_BG.sunset} p-6 text-white`}
                  >
                    {!profile.hideProfileBadge ? (
                      <p className="mb-2 text-xs uppercase tracking-wide text-white/80">
                        Public Profile
                      </p>
                    ) : null}
                    <h3
                      className={`text-2xl font-bold ${profile.heroLayout === "center" ? "text-center" : "text-left"}`}
                    >
                      {profile.heroTitle ||
                        (data?.profileLinks?.[0]?.title ??
                          "Your Business Name")}
                    </h3>
                    {(profile.heroSubtitle || "").trim() ? (
                      <p
                        className={`mt-2 text-sm text-white/85 ${profile.heroLayout === "center" ? "text-center" : "text-left"}`}
                      >
                        {profile.heroSubtitle}
                      </p>
                    ) : null}
                    {(profile.ctaLabel || "").trim() ? (
                      <div
                        className={`mt-3 ${profile.heroLayout === "center" ? "text-center" : ""}`}
                      >
                        <span className="inline-flex rounded border border-white/40 bg-white/10 px-3 py-1 text-xs">
                          {profile.ctaLabel}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-4 p-4">
                    {previewSections.map((section) => {
                      if (section === "about") {
                        if (!profile.about.trim()) return null;
                        return (
                          <div key={section}>
                            <p className="text-sm text-muted-foreground">
                              {profile.about}
                            </p>
                          </div>
                        );
                      }
                      if (section === "highlights") {
                        if (!previewHighlights.length) return null;
                        return (
                          <div key={section}>
                            <p className="mb-1 text-xs uppercase text-muted-foreground">
                              Highlights
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {previewHighlights.map((h, i) => (
                                <span
                                  key={`${h}-${i}`}
                                  className="rounded border px-2 py-1 text-xs"
                                  style={{
                                    borderColor: profile.accentColor,
                                    color: profile.accentColor,
                                  }}
                                >
                                  {h}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      }
                      if (section === "links") {
                        if (!previewLinks.length) return null;
                        return (
                          <div key={section}>
                            <p className="mb-1 text-xs uppercase text-muted-foreground">
                              Links
                            </p>
                            <div className="grid gap-2">
                              {previewLinks.map((link, i) => (
                                <div
                                  key={`${link.url}-${i}`}
                                  className="rounded border px-2 py-1 text-xs"
                                >
                                  {link.label}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      }
                      if (section === "gallery") {
                        if (!previewGallery.length) return null;
                        return (
                          <div key={section}>
                            <p className="mb-1 text-xs uppercase text-muted-foreground">
                              Gallery
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                              {previewGallery.map((url, i) => (
                                <img
                                  key={`${url}-${i}`}
                                  src={url}
                                  alt={`Preview ${i + 1}`}
                                  className="h-16 w-full rounded object-cover"
                                  loading="lazy"
                                />
                              ))}
                            </div>
                          </div>
                        );
                      }
                      if (section === "contact") {
                        if (!profile.showContact) return null;
                        return (
                          <p
                            key={section}
                            className="text-xs text-muted-foreground"
                          >
                            Contact section enabled
                          </p>
                        );
                      }
                      if (section === "location") {
                        if (!profile.showAddress) return null;
                        return (
                          <p
                            key={section}
                            className="text-xs text-muted-foreground"
                          >
                            Address section enabled
                          </p>
                        );
                      }
                      if (section === "metrics") {
                        return (
                          <p
                            key={section}
                            className="text-xs text-muted-foreground"
                          >
                            Metrics section enabled
                          </p>
                        );
                      }
                      return null;
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Public Profile Studio</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <Label>Template preset</Label>
                    <Select
                      value={profile.templatePreset}
                      onValueChange={(value: any) => applyPreset(value)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="classic">Classic</SelectItem>
                        <SelectItem value="story">Story</SelectItem>
                        <SelectItem value="bold">Bold</SelectItem>
                        <SelectItem value="minimal">Minimal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => applyPreset("classic")}
                    >
                      Classic
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => applyPreset("story")}
                    >
                      Story
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => applyPreset("bold")}
                    >
                      Bold
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label>Theme</Label>
                    <Select
                      value={profile.theme}
                      onValueChange={(value: any) =>
                        setProfile((prev) => ({ ...prev, theme: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sunset">Sunset</SelectItem>
                        <SelectItem value="slate">Slate</SelectItem>
                        <SelectItem value="forest">Forest</SelectItem>
                        <SelectItem value="amber">Amber</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Accent color</Label>
                    <Input
                      value={profile.accentColor}
                      onChange={(e) =>
                        setProfile((prev) => ({
                          ...prev,
                          accentColor: e.target.value,
                        }))
                      }
                      placeholder="#f97316"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label>Font style</Label>
                    <Select
                      value={profile.fontFamily}
                      onValueChange={(value: any) =>
                        setProfile((prev) => ({ ...prev, fontFamily: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="system">System</SelectItem>
                        <SelectItem value="serif">Serif</SelectItem>
                        <SelectItem value="display">Display</SelectItem>
                        <SelectItem value="mono">Mono</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Hero layout</Label>
                    <Select
                      value={profile.heroLayout}
                      onValueChange={(value: any) =>
                        setProfile((prev) => ({ ...prev, heroLayout: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="left">Left</SelectItem>
                        <SelectItem value="center">Center</SelectItem>
                        <SelectItem value="split">Split</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Hero title</Label>
                  <Input
                    value={profile.heroTitle}
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        heroTitle: e.target.value,
                      }))
                    }
                    placeholder="Your headline"
                  />
                </div>
                <div>
                  <Label>Hero subtitle</Label>
                  <Input
                    value={profile.heroSubtitle}
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        heroSubtitle: e.target.value,
                      }))
                    }
                    placeholder="Short one-liner"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label>CTA label</Label>
                    <Input
                      value={profile.ctaLabel}
                      onChange={(e) =>
                        setProfile((prev) => ({
                          ...prev,
                          ctaLabel: e.target.value,
                        }))
                      }
                      placeholder="Book now"
                    />
                  </div>
                  <div>
                    <Label>CTA URL</Label>
                    <Input
                      value={profile.ctaUrl}
                      onChange={(e) =>
                        setProfile((prev) => ({
                          ...prev,
                          ctaUrl: e.target.value,
                        }))
                      }
                      placeholder="https://..."
                    />
                  </div>
                </div>

                <div>
                  <Label>About</Label>
                  <Textarea
                    value={profile.about}
                    onChange={(e) =>
                      setProfile((prev) => ({ ...prev, about: e.target.value }))
                    }
                    rows={5}
                    placeholder="Tell visitors what makes your business special."
                  />
                </div>

                <div>
                  <Label>Highlights (one per line)</Label>
                  <Textarea
                    value={profile.highlights}
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        highlights: e.target.value,
                      }))
                    }
                    rows={4}
                    placeholder={
                      "Fresh made daily\nFamily-owned\nAvailable for events"
                    }
                  />
                </div>

                <div>
                  <Label>Featured links (one per line: label|url)</Label>
                  <Textarea
                    value={profile.featuredLinks}
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        featuredLinks: e.target.value,
                      }))
                    }
                    rows={4}
                    placeholder={
                      "Menu|https://example.com/menu\nCatering|https://example.com/catering"
                    }
                  />
                </div>

                <div>
                  <Label>Gallery image URLs (one per line)</Label>
                  <Textarea
                    value={profile.galleryUrls}
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        galleryUrls: e.target.value,
                      }))
                    }
                    rows={4}
                    placeholder={
                      "https://.../image1.jpg\nhttps://.../image2.jpg"
                    }
                  />
                  <div className="mt-2">
                    <Input
                      type="file"
                      accept="image/*"
                      disabled={uploadingGallery}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadGalleryImage(file);
                        event.currentTarget.value = "";
                      }}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Upload directly to your profile gallery (max 12 images).
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Active upload provider:{" "}
                      {data?.media?.provider || "unknown"}{" "}
                      {data?.media?.configured
                        ? "(configured)"
                        : "(not configured)"}
                    </p>
                  </div>
                </div>

                <div>
                  <Label>Section order</Label>
                  <div className="mt-2 space-y-2 rounded-md border p-3">
                    {getSectionOrderList().map((section) => (
                      <div
                        key={section}
                        draggable
                        onDragStart={() => setDragSection(section)}
                        onDragOver={(event) => {
                          event.preventDefault();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (dragSection)
                            reorderSections(dragSection, section);
                          setDragSection(null);
                        }}
                        onDragEnd={() => setDragSection(null)}
                        className={`flex cursor-move items-center justify-between rounded border px-3 py-2 text-sm ${
                          dragSection === section ? "opacity-50" : ""
                        }`}
                      >
                        <span className="font-medium capitalize">
                          {section}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Drag to reorder
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <Label>Show address</Label>
                    <Switch
                      checked={profile.showAddress}
                      onCheckedChange={(checked) =>
                        setProfile((prev) => ({
                          ...prev,
                          showAddress: checked,
                        }))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <Label>Show contact</Label>
                    <Switch
                      checked={profile.showContact}
                      onCheckedChange={(checked) =>
                        setProfile((prev) => ({
                          ...prev,
                          showContact: checked,
                        }))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <Label>Show hours</Label>
                    <Switch
                      checked={profile.showHours}
                      onCheckedChange={(checked) =>
                        setProfile((prev) => ({ ...prev, showHours: checked }))
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <Label>Hide profile badge</Label>
                  <Switch
                    checked={profile.hideProfileBadge}
                    onCheckedChange={(checked) =>
                      setProfile((prev) => ({
                        ...prev,
                        hideProfileBadge: checked,
                      }))
                    }
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={saveProfile}
                    disabled={
                      savingProfile || isLoading || !hydratedRef.current
                    }
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {savingProfile ? "Saving..." : "Save Profile Studio"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Your Public Links</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Array.isArray(data?.profileLinks) &&
                data.profileLinks.length > 0 ? (
                  data.profileLinks.map((row) => (
                    <div
                      key={`${row.entity}-${row.id}`}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div>
                        <p className="text-sm font-medium">{row.title}</p>
                        <p className="text-xs text-muted-foreground">
                          /{row.path.replace(/^\//, "")}
                        </p>
                      </div>
                      <a
                        href={row.path}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        <Button variant="outline" size="sm">
                          <Globe className="w-4 h-4 mr-2" />
                          Open
                        </Button>
                      </a>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Create a restaurant, host, or supplier profile to generate
                    public links.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="general" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Regional Preferences</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Language</Label>
                  <Select
                    value={general.language}
                    onValueChange={(value) => {
                      setGeneral((prev) => ({ ...prev, language: value }));
                      setLocale(localeFromLanguageSetting(value));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="english">English</SelectItem>
                      <SelectItem value="spanish">Spanish</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Currency</Label>
                  <Select
                    value={general.currency}
                    onValueChange={(value) =>
                      setGeneral((prev) => ({ ...prev, currency: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="usd">USD</SelectItem>
                      <SelectItem value="eur">EUR</SelectItem>
                      <SelectItem value="gbp">GBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2 flex justify-end">
                  <Button
                    onClick={saveGeneral}
                    disabled={
                      savingGeneral || isLoading || !hydratedRef.current
                    }
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {savingGeneral ? "Saving..." : "Save General Settings"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Custom Domain</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Your domain</Label>
                  <Input
                    value={general.customDomainHost}
                    onChange={(e) =>
                      setGeneral((prev) => ({
                        ...prev,
                        customDomainHost: e.target.value,
                      }))
                    }
                    placeholder="profile.yourdomain.com"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Add a CNAME from your domain to the target shown after
                    verification.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={verifyCustomDomain}
                    disabled={verifyingDomain}
                  >
                    {verifyingDomain ? "Verifying..." : "Verify DNS"}
                  </Button>
                  <Button
                    onClick={saveGeneral}
                    disabled={
                      savingGeneral || isLoading || !hydratedRef.current
                    }
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Save Domain
                  </Button>
                </div>
                {data?.accountSettings?.customDomain?.hostname ? (
                  <div className="rounded-md border p-3 text-sm">
                    <p>
                      <span className="font-medium">Status:</span>{" "}
                      {String(
                        data.accountSettings.customDomain.status ||
                          "unverified",
                      )}
                    </p>
                    {data.accountSettings.customDomain.expectedTarget ? (
                      <p className="mt-1 text-muted-foreground">
                        Expected target:{" "}
                        {data.accountSettings.customDomain.expectedTarget}
                      </p>
                    ) : null}
                    {data.accountSettings.customDomain.diagnostics ? (
                      <p className="mt-1 text-muted-foreground">
                        {data.accountSettings.customDomain.diagnostics}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications">
            <NotificationSettings />
          </TabsContent>

          <TabsContent value="privacy" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Privacy Controls</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Location Services</p>
                    <p className="text-sm text-muted-foreground">
                      Enable nearby discovery and map context
                    </p>
                  </div>
                  <Switch
                    checked={general.locationServices}
                    onCheckedChange={(checked) =>
                      setGeneral((prev) => ({
                        ...prev,
                        locationServices: checked,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Analytics</p>
                    <p className="text-sm text-muted-foreground">
                      Help improve product quality and performance
                    </p>
                  </div>
                  <Switch
                    checked={general.analytics}
                    onCheckedChange={(checked) =>
                      setGeneral((prev) => ({ ...prev, analytics: checked }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Marketing Communications</p>
                    <p className="text-sm text-muted-foreground">
                      Receive product updates and offers
                    </p>
                  </div>
                  <Switch
                    checked={general.marketing}
                    onCheckedChange={(checked) =>
                      setGeneral((prev) => ({ ...prev, marketing: checked }))
                    }
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={saveGeneral}
                    disabled={
                      savingGeneral || isLoading || !hydratedRef.current
                    }
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {savingGeneral ? "Saving..." : "Save Privacy Settings"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Navigation />
    </div>
  );
}
