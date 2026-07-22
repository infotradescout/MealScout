import { useState, useRef, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Link, useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Upload,
  X,
  Eye,
  Sparkles,
  Clock,
  Users,
  DollarSign,
  Loader2,
} from "lucide-react";
import BusinessWorkspaceShell from "@/components/business-workspace-shell";
import { initFacebookSDK, postToFacebook } from "@/lib/facebook";
import { authUrl } from "@/lib/api";
import type { Restaurant } from "@shared/schema";
import { isBarBusinessType, isTruckBusinessType } from "@shared/businessTypes";
import { buildPublicProfilePath } from "@/lib/public-profile-path";
import {
  getScopedBusinessPermissions,
  isScopedBusinessOwner,
  type BusinessAccessContext,
} from "@/lib/business-access";

const dealSchema = z
  .object({
    title: z.string().min(1, "Special title is required"),
    description: z.string().min(1, "Description is required"),
    dealType: z.enum(["percentage", "fixed"]),
    discountValue: z.string().min(1, "Discount value is required"),
    minOrderAmount: z.string().optional(),
    imageUrl: z.string().min(1, "Special image is required"),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    availableDuringBusinessHours: z.boolean().default(false),
    isOngoing: z.boolean().default(false),
    totalUsesLimit: z.string().optional(),
    perCustomerLimit: z.string().optional(),
    facebookPageUrl: z.string().optional(),
  })
  .refine(
    (data) => {
      // If not ongoing, endDate is required
      if (!data.isOngoing && !data.endDate) {
        return false;
      }
      return true;
    },
    {
      message: "End date is required for non-ongoing deals",
      path: ["endDate"],
    },
  )
  .refine(
    (data) => {
      // If not available during business hours, times are required
      if (
        !data.availableDuringBusinessHours &&
        (!data.startTime || !data.endTime)
      ) {
        return false;
      }
      return true;
    },
    {
      message: "Times are required unless available during business hours",
      path: ["startTime"],
    },
  );

type DealFormData = z.infer<typeof dealSchema>;

type SocialAutopostSettings = {
  platforms: {
    facebook: boolean;
    instagram: boolean;
    x: boolean;
  };
  triggers: {
    schedule: boolean;
    booking: boolean;
    live: boolean;
    deal: boolean;
  };
  promptBeforePost: boolean;
};

const defaultSocialAutopostSettings: SocialAutopostSettings = {
  platforms: { facebook: true, instagram: true, x: true },
  triggers: { schedule: true, booking: true, live: true, deal: true },
  promptBeforePost: true,
};

export default function DealCreation() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dealSharePrompt, setDealSharePrompt] = useState<{
    message: string;
    link: string;
    selectedPlatforms: {
      facebook: boolean;
      instagram: boolean;
      x: boolean;
    };
  } | null>(null);
  const [isSharingDeal, setIsSharingDeal] = useState(false);

  const { data: restaurants = [], isLoading: loadingRestaurants } = useQuery<
    Restaurant[]
  >({
    queryKey: ["/api/restaurants/my-restaurants"],
    enabled: isAuthenticated,
  });
  const requestedRestaurantId = new URLSearchParams(search).get("restaurantId");
  const selectedBusiness =
    restaurants.find((restaurant) => restaurant.id === requestedRestaurantId) ||
    restaurants[0] ||
    null;
  const dealsWorkspaceHref = selectedBusiness
    ? `/restaurant-owner-dashboard?workspace=deals&restaurantId=${encodeURIComponent(selectedBusiness.id)}`
    : "/restaurant-owner-dashboard?workspace=deals";
  const selectedEntityType = selectedBusiness
    ? selectedBusiness.isFoodTruck ||
      isTruckBusinessType(selectedBusiness.businessType)
      ? "truck"
      : isBarBusinessType(selectedBusiness.businessType)
        ? "bar"
        : "restaurant"
    : "restaurant";
  const publicProfileHref = selectedBusiness
    ? buildPublicProfilePath({
        entityType: selectedEntityType,
        id: selectedBusiness.id,
        name: selectedBusiness.name,
      })
    : null;
  const handleWorkspaceBusinessChange = (businessId: string) => {
    setLocation(`/deal-creation?restaurantId=${encodeURIComponent(businessId)}`);
  };

  const socialSettings = useMemo<SocialAutopostSettings>(() => {
    const existing = (selectedBusiness?.socialAutopostSettings ||
      {}) as Partial<SocialAutopostSettings>;
    return {
      ...defaultSocialAutopostSettings,
      ...existing,
      platforms: {
        ...defaultSocialAutopostSettings.platforms,
        ...(existing.platforms || {}),
      },
      triggers: {
        ...defaultSocialAutopostSettings.triggers,
        ...(existing.triggers || {}),
      },
    };
  }, [selectedBusiness]);

  const { data: businessAccess } = useQuery<BusinessAccessContext>({
    queryKey: ["/api/business-access/me"],
    enabled: isAuthenticated,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Fetch current deal count for limits
  const { data: currentDeals } = useQuery({
    queryKey: ["/api/deals/my-active"],
    enabled:
      isAuthenticated && Array.isArray(restaurants) && restaurants.length > 0,
  });

  const DEAL_DRAFT_KEY = "mealscout:deal-creation-draft";

  const dealDefaultValues = useMemo<DealFormData>(() => {
    const base: DealFormData = {
      title: "",
      description: "",
      dealType: "percentage",
      discountValue: "",
      minOrderAmount: "0",
      imageUrl: "",
      startDate: new Date().toISOString().split("T")[0],
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      startTime: "11:00",
      endTime: "15:00",
      availableDuringBusinessHours: false,
      isOngoing: false,
      totalUsesLimit: "",
      perCustomerLimit: "1",
      facebookPageUrl: "",
    };

    if (typeof window === "undefined") return base;

    try {
      const stored = window.localStorage.getItem(DEAL_DRAFT_KEY);
      if (!stored) return base;
      const parsed = JSON.parse(stored) as Partial<DealFormData>;
      // Do not restore imageUrl from storage to avoid huge base64 blobs
      delete (parsed as any).imageUrl;
      return { ...base, ...parsed };
    } catch {
      return base;
    }
  }, []);

  const form = useForm<DealFormData>({
    resolver: zodResolver(dealSchema),
    defaultValues: dealDefaultValues,
  });

  const handleDealShareToggle = (
    platform: keyof SocialAutopostSettings["platforms"],
  ) => {
    setDealSharePrompt((current) => {
      if (!current) return current;
      return {
        ...current,
        selectedPlatforms: {
          ...current.selectedPlatforms,
          [platform]: !current.selectedPlatforms[platform],
        },
      };
    });
  };

  const handleDealShareMessage = (message: string) => {
    setDealSharePrompt((current) =>
      current ? { ...current, message } : current,
    );
  };

  const handleDealSharePost = async (payload?: {
    message: string;
    link: string;
    selectedPlatforms: {
      facebook: boolean;
      instagram: boolean;
      x: boolean;
    };
  }) => {
    const activePrompt = payload ?? dealSharePrompt;
    if (!activePrompt) return;
    setIsSharingDeal(true);
    try {
      const shouldClear = !payload;
      let shared = false;
      if (activePrompt.selectedPlatforms.facebook) {
        await initFacebookSDK();
        await postToFacebook({
          message: activePrompt.message,
          link: activePrompt.link,
        });
        shared = true;
      }
      if (activePrompt.selectedPlatforms.x) {
        const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
          activePrompt.message,
        )}&url=${encodeURIComponent(activePrompt.link)}`;
        window.open(shareUrl, "_blank", "width=600,height=500");
        shared = true;
      }
      if (activePrompt.selectedPlatforms.instagram) {
        const copyText = `${activePrompt.message} ${activePrompt.link}`.trim();
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(copyText);
        }
        window.open("https://www.instagram.com/", "_blank");
        shared = true;
      }
      if (shared) {
        toast({
          title: "Share opened",
          description: "Finish the post in the new window.",
        });
      }
      if (shouldClear) {
        setDealSharePrompt(null);
        setLocation(dealsWorkspaceHref);
      }
    } catch (error) {
      toast({
        title: "Share failed",
        description:
          error instanceof Error ? error.message : "Unable to share.",
        variant: "destructive",
      });
    } finally {
      setIsSharingDeal(false);
    }
  };

  // Persist deal draft so restaurant owners can resume creation later
  useEffect(() => {
    const subscription = form.watch((value) => {
      try {
        const { imageUrl, ...rest } = value;
        window.localStorage.setItem(DEAL_DRAFT_KEY, JSON.stringify(rest));
      } catch {
        // ignore
      }
    });
    return () => subscription.unsubscribe();
  }, [form]);

  const createDealMutation = useMutation({
    mutationFn: async (data: DealFormData) => {
      if (!selectedBusiness) {
        throw new Error(
          "No restaurant found. Please register a restaurant first.",
        );
      }

      const dealData = {
        ...data,
        restaurantId: selectedBusiness.id,
        discountValue: parseFloat(data.discountValue),
        minOrderAmount: data.minOrderAmount
          ? parseFloat(data.minOrderAmount)
          : null,
        totalUsesLimit: data.totalUsesLimit
          ? parseInt(data.totalUsesLimit)
          : null,
        perCustomerLimit: data.perCustomerLimit
          ? parseInt(data.perCustomerLimit)
          : 1,
        startDate: new Date(data.startDate),
        endDate: data.isOngoing ? null : new Date(data.endDate!),
        startTime: data.availableDuringBusinessHours ? null : data.startTime,
        endTime: data.availableDuringBusinessHours ? null : data.endTime,
        availableDuringBusinessHours: data.availableDuringBusinessHours,
        isOngoing: data.isOngoing,
      };

      const response = await apiRequest("POST", "/api/deals", dealData);
      return response.json();
    },
    onSuccess: (created: any) => {
      toast({
        title: "Success!",
        description: "Deal created successfully!",
      });
      try {
        window.localStorage.removeItem(DEAL_DRAFT_KEY);
      } catch {
        // ignore
      }
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({
        queryKey: [
          "/api/owner/restaurants",
          selectedBusiness?.id,
          "deals",
        ],
      });
      const hasTrigger = socialSettings.triggers.deal;
      const selectedPlatforms = { ...socialSettings.platforms };
      const hasPlatforms =
        selectedPlatforms.facebook ||
        selectedPlatforms.instagram ||
        selectedPlatforms.x;
      if (hasTrigger && hasPlatforms) {
        const dealId = created?.id || created?.deal?.id;
        const link = dealId
          ? `${window.location.origin}/deal/${dealId}`
          : window.location.origin;
        const dealTitle = form.getValues("title") || "New deal";
        const restaurantName = selectedBusiness?.name || "your business";
        const message = `New deal at ${restaurantName}: ${dealTitle}. Check it out on MealScout.`;
        if (!socialSettings.promptBeforePost) {
          void handleDealSharePost({ message, link, selectedPlatforms });
          setLocation(dealsWorkspaceHref);
          return;
        }
        setDealSharePrompt({ message, link, selectedPlatforms });
        return;
      }
      setLocation(dealsWorkspaceHref);
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = authUrl("/api/auth/google/restaurant");
        }, 500);
        return;
      }

      toast({
        title: "Error",
        description: error.message || "Failed to create deal",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: DealFormData) => {
    if (!canManageDeals) {
      toast({
        title: "Permission required",
        description:
          "Your account does not have permission to publish specials.",
        variant: "destructive",
      });
      return;
    }
    // Server-side validation still enforces ownership and publishing rules.
    createDealMutation.mutate(data);
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Check file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please choose an image smaller than 5MB",
          variant: "destructive",
        });
        return;
      }

      // Check file type
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Invalid file type",
          description: "Please choose an image file",
          variant: "destructive",
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const imageData = e.target?.result as string;
        setSelectedImage(imageData);
        form.setValue("imageUrl", imageData); // Set form value for validation
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setSelectedImage(null);
    form.setValue("imageUrl", ""); // Clear form value
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const dealPreviewData = {
    title: form.watch("title") || "Your Special Title",
    description:
      form.watch("description") || "Your deal description will appear here...",
    dealType: form.watch("dealType"),
    discountValue: form.watch("discountValue") || "0",
    minOrderAmount: form.watch("minOrderAmount"),
    facebookPageUrl: form.watch("facebookPageUrl"),
    image: selectedImage,
  };

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen flex items-center justify-center">
        <Card>
          <CardContent className="p-6">
            <p className="text-center text-muted-foreground mb-4">
              Please log in to create specials
            </p>
            <Button
              onClick={() =>
                (window.location.href = authUrl("/api/auth/google/restaurant"))
              }
              className="w-full"
            >
              Log In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loadingRestaurants) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-layered)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading businesses" />
      </div>
    );
  }

  if (restaurants.length === 0 || !selectedBusiness) {
    return (
      <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen flex items-center justify-center">
        <Card>
          <CardContent className="p-6 text-center">
            <i className="fas fa-store text-muted-foreground text-3xl mb-4"></i>
            <p className="text-muted-foreground mb-4">
              You need to register a business first
            </p>
            <Link href="/restaurant-signup">
              <Button className="w-full">Register Business</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isAdminOrStaff =
    user &&
    (user.userType === "admin" ||
      user.userType === "duper_admin" ||
      user.userType === "super_admin" ||
      user.userType === "staff");
  const scopedBusinessPermissions = getScopedBusinessPermissions(
    businessAccess,
    selectedBusiness.id,
  );
  const ownsSelectedBusiness = isScopedBusinessOwner(
    businessAccess,
    selectedBusiness.id,
  );
  const canManageDeals =
    Boolean(isAdminOrStaff) ||
    ownsSelectedBusiness ||
    scopedBusinessPermissions.manageDeals;
  const canManageBusinessProfile =
    Boolean(isAdminOrStaff) ||
    ownsSelectedBusiness ||
    scopedBusinessPermissions.manageProfile;
  const hasFullBusinessControl = Boolean(isAdminOrStaff) || ownsSelectedBusiness;
  const workspaceCapabilities = {
    overview: canManageBusinessProfile,
    profile: canManageBusinessProfile,
    menu: canManageBusinessProfile,
    availability:
      hasFullBusinessControl || scopedBusinessPermissions.manageParkingPass,
    media: canManageBusinessProfile,
    deals: canManageDeals,
    audience:
      hasFullBusinessControl || scopedBusinessPermissions.viewAnalytics,
    work: hasFullBusinessControl || scopedBusinessPermissions.manageParkingPass,
    team: hasFullBusinessControl,
    payments: hasFullBusinessControl,
    settings: canManageBusinessProfile,
  };
  if (!canManageDeals) {
    return (
      <BusinessWorkspaceShell
        activeModule="deals"
        business={selectedBusiness}
        businesses={restaurants}
        onBusinessChange={handleWorkspaceBusinessChange}
        publicProfileHref={publicProfileHref}
        capabilities={workspaceCapabilities}
      >
        <div className="mx-auto flex min-h-[70vh] max-w-lg items-center px-4 py-10">
          <Card className="w-full border-amber-200 bg-amber-50">
            <CardContent className="p-6 text-center">
              <h2 className="text-lg font-bold text-amber-950">Permission required</h2>
              <p className="mt-2 text-sm text-amber-900/80">
                Ask the business owner to grant you permission to manage deals.
              </p>
              <Button asChild variant="outline" className="mt-5">
                <Link href={dealsWorkspaceHref}>Return to deals</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </BusinessWorkspaceShell>
    );
  }

  return (
    <BusinessWorkspaceShell
      activeModule="deals"
      business={selectedBusiness}
      businesses={restaurants}
      onBusinessChange={handleWorkspaceBusinessChange}
      publicProfileHref={publicProfileHref}
      capabilities={workspaceCapabilities}
      headerActions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
            data-testid="button-preview"
          >
            <Eye className="w-4 h-4 mr-2" />
            {showPreview ? "Hide" : "Preview"}
          </Button>
      }
    >

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 pb-28 sm:px-6 lg:py-8">
        <section className="flex flex-col gap-3 rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 via-background to-amber-50 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">
              {selectedBusiness.name}
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight">Create a special</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Set the offer, photo, dates, and claim limits customers will see.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm" className="self-start sm:self-auto">
            <Link href={dealsWorkspaceHref}>Cancel</Link>
          </Button>
        </section>

        {/* Live Preview */}
        {showPreview && (
          <div className="mb-6">
            <div className="flex items-center space-x-2 mb-3">
              <Sparkles className="w-4 h-4 text-[color:var(--accent-text)]" />
              <h3 className="text-sm font-semibold text-foreground">
                Live Preview
              </h3>
              <Badge variant="secondary" className="text-xs">
                How customers see it
              </Badge>
            </div>

            <Card className="overflow-hidden border-0 shadow-clean-lg rounded-2xl bg-[var(--bg-card)]">
              <div className="relative">
                {dealPreviewData.image ? (
                  <img
                    src={dealPreviewData.image}
                    alt="Deal preview"
                    className="w-full h-36 object-cover"
                  />
                ) : (
                  <div className="w-full h-36 bg-[linear-gradient(110deg,rgba(255,77,46,0.12),rgba(245,158,11,0.12))] flex items-center justify-center">
                    <div className="text-center">
                      <Upload className="w-8 h-8 text-[color:var(--accent-text)] mx-auto mb-1" />
                      <p className="text-xs text-[color:var(--text-secondary)] font-medium">
                        Add a photo to see how your deal pops in the feed
                      </p>
                    </div>
                  </div>
                )}

                <div className="absolute bottom-2 right-2 bg-[linear-gradient(110deg,rgba(255,77,46,0.9),rgba(245,158,11,0.9))] text-white px-2 py-1 rounded-md text-sm font-bold shadow-clean">
                  {dealPreviewData.dealType === "percentage"
                    ? `${dealPreviewData.discountValue}% OFF`
                    : `$${dealPreviewData.discountValue} OFF`}
                </div>
              </div>

              <CardContent className="p-3">
                <h4 className="font-semibold text-sm text-foreground mb-1 line-clamp-1">
                  {dealPreviewData.title}
                </h4>
                <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                  {dealPreviewData.description}
                </p>

                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-3 text-muted-foreground">
                    <div className="flex items-center space-x-1">
                      <Clock className="w-3 h-3" />
                      <span>Limited time</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Users className="w-3 h-3" />
                      <span>Limited uses</span>
                    </div>
                  </div>

                  {dealPreviewData.minOrderAmount && (
                    <div className="flex items-center space-x-1 text-muted-foreground">
                      <DollarSign className="w-3 h-3" />
                      <span>Min ${dealPreviewData.minOrderAmount}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-6 bg-[var(--bg-card)]/90 border border-[color:var(--border-subtle)] rounded-2xl px-4 py-5 shadow-clean"
          >
            {/* Deal Image - REQUIRED */}
            <FormField
              control={form.control}
              name="imageUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    Special Photo <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <div>
                      {selectedImage ? (
                        <div className="relative rounded-lg overflow-hidden">
                          <img
                            src={selectedImage}
                            alt="Deal preview"
                            className="w-full h-48 object-cover"
                          />
                          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                            <div className="flex space-x-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                onClick={() => fileInputRef.current?.click()}
                                data-testid="button-change-photo"
                              >
                                <Upload className="w-4 h-4 mr-1" />
                                Change
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={removeImage}
                                data-testid="button-remove-photo"
                              >
                                <X className="w-4 h-4 mr-1" />
                                Remove
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          className="border-2 border-dashed border-destructive/50 rounded-lg p-8 text-center bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors"
                        >
                          <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                          <p
                            className="text-sm font-semibold text-foreground mb-1"
                            data-testid="text-photo-prompt"
                          >
                            Add a mouth-watering photo of your deal{" "}
                            <span className="text-destructive">*</span>
                          </p>
                          <p className="text-xs text-muted-foreground mb-3">
                            JPG, PNG up to 5MB (Required)
                          </p>
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            data-testid="button-upload-photo"
                          >
                            Upload Photo
                          </Button>
                        </div>
                      )}

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                        data-testid="input-file-upload"
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Quick Templates */}
            <div>
              <Label className="block text-sm font-medium text-foreground mb-2">
                Quick Start Templates
              </Label>
              <div className="grid grid-cols-1 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start text-xs h-auto py-2"
                  onClick={() => {
                    form.setValue("title", "Happy Hour Special");
                    form.setValue(
                      "description",
                      "Enjoy discounted drinks and appetizers during our happy hour! Perfect for after-work relaxation.",
                    );
                    form.setValue("dealType", "percentage");
                    form.setValue("discountValue", "25");
                    form.setValue("startTime", "16:00");
                    form.setValue("endTime", "18:00");
                  }}
                  data-testid="template-happy-hour"
                >
                  <Clock className="w-3 h-3 mr-2" />
                  Happy Hour Special (25% off drinks)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start text-xs h-auto py-2"
                  onClick={() => {
                    form.setValue("title", "Lunch Combo Deal");
                    form.setValue(
                      "description",
                      "Get a main dish, side, and drink for one great price during lunch hours!",
                    );
                    form.setValue("dealType", "fixed");
                    form.setValue("discountValue", "5");
                    form.setValue("minOrderAmount", "15");
                    form.setValue("startTime", "11:00");
                    form.setValue("endTime", "15:00");
                  }}
                  data-testid="template-lunch-combo"
                >
                  <DollarSign className="w-3 h-3 mr-2" />
                  Lunch Combo ($5 off)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start text-xs h-auto py-2"
                  onClick={() => {
                    form.setValue("title", "Family Night Special");
                    form.setValue(
                      "description",
                      "Perfect for families! Kids eat free with adult entree purchase on weekends.",
                    );
                    form.setValue("dealType", "percentage");
                    form.setValue("discountValue", "30");
                    form.setValue("perCustomerLimit", "2");
                  }}
                  data-testid="template-family-night"
                >
                  <Users className="w-3 h-3 mr-2" />
                  Family Night (30% off)
                </Button>
              </div>
            </div>

            {/* Deal Details */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel data-testid="label-deal-title">
                    Special Title
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Buy One Get One Free Meal Special"
                      {...field}
                      data-testid="input-deal-title"
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground mt-1">
                    Keep it short and exciting! Max 50 characters.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel data-testid="label-description">
                    Special Description
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe your deal in detail. What's included? Any restrictions?"
                      rows={3}
                      {...field}
                      data-testid="textarea-description"
                    />
                  </FormControl>
                  <div className="flex justify-between items-center mt-1">
                    <p className="text-xs text-muted-foreground">
                      Be specific about what customers get!
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {field.value?.length || 0}/200
                    </span>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Special Type */}
            <FormField
              control={form.control}
              name="dealType"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel data-testid="label-deal-type">
                    Special Type
                  </FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="grid grid-cols-2 gap-3"
                    >
                      <div className="flex items-center space-x-3 p-3 border border-input rounded-lg cursor-pointer hover:bg-muted/50">
                        <RadioGroupItem
                          value="percentage"
                          id="percentage"
                          data-testid="radio-percentage"
                        />
                        <Label htmlFor="percentage" className="cursor-pointer">
                          <p
                            className="font-medium text-sm"
                            data-testid="text-percentage-title"
                          >
                            Percentage Off
                          </p>
                          <p
                            className="text-xs text-muted-foreground"
                            data-testid="text-percentage-desc"
                          >
                            e.g., 20% off
                          </p>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-3 p-3 border border-input rounded-lg cursor-pointer hover:bg-muted/50">
                        <RadioGroupItem
                          value="fixed"
                          id="fixed"
                          data-testid="radio-fixed"
                        />
                        <Label htmlFor="fixed" className="cursor-pointer">
                          <p
                            className="font-medium text-sm"
                            data-testid="text-fixed-title"
                          >
                            Fixed Amount
                          </p>
                          <p
                            className="text-xs text-muted-foreground"
                            data-testid="text-fixed-desc"
                          >
                            e.g., $5 off
                          </p>
                        </Label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="discountValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel data-testid="label-discount-value">
                      Discount Value
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type="number"
                          placeholder="25"
                          {...field}
                          data-testid="input-discount-value"
                        />
                        <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                          {form.watch("dealType") === "percentage" ? "%" : "$"}
                        </span>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="minOrderAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel data-testid="label-min-order">
                      Min. Order
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                          $
                        </span>
                        <Input
                          type="number"
                          placeholder="15.00"
                          className="pl-8"
                          {...field}
                          data-testid="input-min-order"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Timing */}
            <div>
              <Label
                className="block text-sm font-medium text-foreground mb-3"
                data-testid="label-availability"
              >
                When is this deal available?
              </Label>

              {/* Checkboxes for business hours and ongoing */}
              <div className="space-y-3 mb-4">
                <FormField
                  control={form.control}
                  name="isOngoing"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="checkbox-ongoing"
                        />
                      </FormControl>
                      <FormLabel className="!mt-0 cursor-pointer">
                        Ongoing deal (no expiration date)
                      </FormLabel>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="availableDuringBusinessHours"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(checked) => {
                            const isChecked = checked === true; // Checkbox can return boolean | "indeterminate"
                            field.onChange(isChecked);

                            if (isChecked) {
                              // Clear time fields when business hours is enabled
                              form.setValue("startTime", "", {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                              form.setValue("endTime", "", {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                            } else {
                              // Restore defaults when unchecked
                              form.setValue("startTime", "11:00", {
                                shouldDirty: true,
                              });
                              form.setValue("endTime", "15:00", {
                                shouldDirty: true,
                              });
                            }
                          }}
                          data-testid="checkbox-business-hours"
                        />
                      </FormControl>
                      <FormLabel className="!mt-0 cursor-pointer">
                        Available anytime during business hours
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel
                          className="text-xs text-muted-foreground"
                          data-testid="label-start-date"
                        >
                          Start Date
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            {...field}
                            data-testid="input-start-date"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="endDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel
                          className="text-xs text-muted-foreground"
                          data-testid="label-end-date"
                        >
                          End Date{" "}
                          {!form.watch("isOngoing") && (
                            <span className="text-destructive">*</span>
                          )}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="date"
                            {...field}
                            disabled={form.watch("isOngoing")}
                            data-testid="input-end-date"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="startTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel
                          className="text-xs text-muted-foreground"
                          data-testid="label-start-time"
                        >
                          Available From{" "}
                          {!form.watch("availableDuringBusinessHours") && (
                            <span className="text-destructive">*</span>
                          )}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="time"
                            {...field}
                            disabled={form.watch(
                              "availableDuringBusinessHours",
                            )}
                            data-testid="input-start-time"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="endTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel
                          className="text-xs text-muted-foreground"
                          data-testid="label-end-time"
                        >
                          Available Until{" "}
                          {!form.watch("availableDuringBusinessHours") && (
                            <span className="text-destructive">*</span>
                          )}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="time"
                            {...field}
                            disabled={form.watch(
                              "availableDuringBusinessHours",
                            )}
                            data-testid="input-end-time"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </div>

            {/* Limits */}
            <div>
              <Label
                className="block text-sm font-medium text-foreground mb-2"
                data-testid="label-deal-limits"
              >
                Special Limits
              </Label>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="totalUsesLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Total uses (optional)"
                          {...field}
                          data-testid="input-total-uses"
                        />
                      </FormControl>
                      <p
                        className="text-xs text-muted-foreground mt-1"
                        data-testid="text-total-uses-help"
                      >
                        Leave blank for unlimited
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="perCustomerLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Per customer limit"
                          {...field}
                          data-testid="input-per-customer"
                        />
                      </FormControl>
                      <p
                        className="text-xs text-muted-foreground mt-1"
                        data-testid="text-per-customer-help"
                      >
                        Max uses per person
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Facebook Integration */}
            <Card className="bg-gradient-to-r from-blue-50 to-indigo-50">
              <CardContent className="p-4">
                <h3
                  className="font-semibold text-foreground text-sm mb-2"
                  data-testid="text-facebook-title"
                >
                  Social Media Integration
                </h3>
                <p
                  className="text-muted-foreground text-xs mb-4"
                  data-testid="text-facebook-desc"
                >
                  Connect your Facebook page to automatically post specials and
                  tag @MealScout
                </p>
                {!canManageBusinessProfile && (
                  <p className="text-xs text-amber-700 mb-3">
                    Your team role can publish specials, but profile/social
                    links are view-only without profile access.
                  </p>
                )}

                <FormField
                  control={form.control}
                  name="facebookPageUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          type="url"
                          placeholder="https://facebook.com/your-restaurant-page"
                          {...field}
                          disabled={!canManageBusinessProfile}
                          data-testid="input-facebook-url"
                        />
                      </FormControl>
                      <p
                        className="text-xs text-muted-foreground mt-1"
                        data-testid="text-facebook-help"
                      >
                        Link your Facebook page to cross-post specials
                        automatically
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Your draft saves automatically on this device.
              </p>
              <Button
                type="submit"
                className="px-6 py-3"
                disabled={createDealMutation.isPending || !canManageDeals}
                data-testid="button-publish-deal"
              >
                {createDealMutation.isPending
                  ? "Publishing..."
                  : "Publish Special"}
              </Button>
            </div>
          </form>
        </Form>
      </div>

      <Dialog
        open={!!dealSharePrompt}
        onOpenChange={(open) => {
          if (!open) {
            setDealSharePrompt(null);
            setLocation(dealsWorkspaceHref);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Share your new deal</DialogTitle>
            <DialogDescription>
              Choose where to post this update. You can edit the message before
              sharing.
            </DialogDescription>
          </DialogHeader>
          {dealSharePrompt && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea
                  value={dealSharePrompt.message}
                  onChange={(event) =>
                    handleDealShareMessage(event.target.value)
                  }
                />
                <p className="text-xs text-[color:var(--text-muted)]">
                  Link: {dealSharePrompt.link}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Post to</Label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      { key: "facebook", label: "Facebook" },
                      { key: "instagram", label: "Instagram" },
                      { key: "x", label: "X" },
                    ] as const
                  ).map((platform) => (
                    <label
                      key={platform.key}
                      className="flex items-center gap-2 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-surface-muted)] px-3 py-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={
                          dealSharePrompt.selectedPlatforms[platform.key]
                        }
                        onChange={() => handleDealShareToggle(platform.key)}
                      />
                      {platform.label}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-[color:var(--text-muted)]">
                  Instagram will open with the caption copied to your clipboard.
                </p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDealSharePrompt(null);
                setLocation(dealsWorkspaceHref);
              }}
            >
              Skip
            </Button>
            <Button
              type="button"
              onClick={() => void handleDealSharePost()}
              disabled={isSharingDeal}
            >
              {isSharingDeal ? "Sharing..." : "Post update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BusinessWorkspaceShell>
  );
}
