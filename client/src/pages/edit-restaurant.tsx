import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Save, Store, UtensilsCrossed } from "lucide-react";
import BusinessProfileImport from "@/components/BusinessProfileImport";
import BusinessPhotoGallery from "@/components/BusinessPhotoGallery";
import MediaVideoManager from "@/components/MediaVideoManager";

import { BackHeader } from "@/components/back-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";

type BusinessType = "restaurant" | "bar" | "food_truck" | "caterer";

type RestaurantProfile = {
  id: string;
  name: string;
  address: string;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  businessType?: BusinessType | string | null;
  cuisineType?: string | null;
  description?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  facebookPageUrl?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
};

type ProfileForm = {
  name: string;
  businessType: BusinessType;
  cuisineType: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  description: string;
  websiteUrl: string;
  instagramUrl: string;
  facebookPageUrl: string;
  logoUrl: string;
  coverImageUrl: string;
};

const emptyForm: ProfileForm = {
  name: "",
  businessType: "restaurant",
  cuisineType: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  description: "",
  websiteUrl: "",
  instagramUrl: "",
  facebookPageUrl: "",
  logoUrl: "",
  coverImageUrl: "",
};

const toForm = (restaurant?: RestaurantProfile | null): ProfileForm => {
  if (!restaurant) return emptyForm;
  const businessType = String(restaurant.businessType || "restaurant");
  return {
    name: restaurant.name || "",
    businessType: ["restaurant", "bar", "food_truck", "caterer"].includes(businessType)
      ? (businessType as BusinessType)
      : "restaurant",
    cuisineType: restaurant.cuisineType || "",
    phone: restaurant.phone || "",
    address: restaurant.address || "",
    city: restaurant.city || "",
    state: restaurant.state || "",
    description: restaurant.description || "",
    websiteUrl: restaurant.websiteUrl || "",
    instagramUrl: restaurant.instagramUrl || "",
    facebookPageUrl: restaurant.facebookPageUrl || "",
    logoUrl: restaurant.logoUrl || "",
    coverImageUrl: restaurant.coverImageUrl || "",
  };
};

export default function EditRestaurantPage() {
  const { restaurantId } = useParams<{ restaurantId: string }>();
  const { toast } = useToast();
  const { user } = useAuth();
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const focusedOnceRef = useRef(false);
  const fieldRefs = {
    name: useRef<HTMLInputElement>(null),
    address: useRef<HTMLInputElement>(null),
    city: useRef<HTMLInputElement>(null),
    state: useRef<HTMLInputElement>(null),
    phone: useRef<HTMLInputElement>(null),
    cuisineType: useRef<HTMLInputElement>(null),
    description: useRef<HTMLTextAreaElement>(null),
    websiteUrl: useRef<HTMLInputElement>(null),
    logoUrl: useRef<HTMLInputElement>(null),
  };

  const restaurantsQuery = useQuery<RestaurantProfile[]>({
    queryKey: ["/api/restaurants/my-restaurants"],
  });

  const isStaffOrAdmin =
    user?.userType === "staff" ||
    user?.userType === "admin" ||
    user?.userType === "super_admin";
  const canAdminManageMedia =
    user?.userType === "admin" || user?.userType === "super_admin";

  const adminRestaurantQuery = useQuery<RestaurantProfile | null>({
    queryKey: ["/api/restaurants", restaurantId, "admin-edit-fallback"],
    enabled: Boolean(isStaffOrAdmin && restaurantId),
    retry: false,
    queryFn: async () => {
      const response = await fetch(
        `/api/restaurants/${encodeURIComponent(String(restaurantId || ""))}`,
        { credentials: "include" },
      );
      if (!response.ok) return null;
      return (await response.json()) as RestaurantProfile;
    },
  });

  const restaurant = useMemo(
    () => {
      const ownedOrCollaborator = (restaurantsQuery.data ?? []).find(
        (item) => item.id === String(restaurantId || ""),
      );
      if (ownedOrCollaborator) return ownedOrCollaborator;
      if (isStaffOrAdmin && adminRestaurantQuery.data) return adminRestaurantQuery.data;
      return null;
    },
    [restaurantsQuery.data, restaurantId, isStaffOrAdmin, adminRestaurantQuery.data],
  );

  useEffect(() => {
    if (restaurant) {
      setForm(toForm(restaurant));
    }
  }, [restaurant]);

  useEffect(() => {
    if (!restaurant || focusedOnceRef.current || typeof window === "undefined") {
      return;
    }
    const focus = new URLSearchParams(window.location.search).get("focus");
    const target =
      focus === "businessType" ? fieldRefs.name.current : fieldRefs[focus as keyof typeof fieldRefs]?.current;
    if (target) {
      focusedOnceRef.current = true;
      target.focus();
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [restaurant, fieldRefs]);

  const updateField =
    (field: keyof ProfileForm) =>
    (value: string) => {
      setForm((current) => ({ ...current, [field]: value }));
    };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "PATCH",
        `/api/restaurants/${encodeURIComponent(String(restaurantId))}/profile`,
        form,
      );
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["/api/restaurants/my-restaurants"],
        }),
        queryClient.invalidateQueries({
          queryKey: [
            `/api/restaurants/${restaurantId}/onboarding/completion`,
          ],
        }),
      ]);
      toast({
        title: "Business profile saved",
        description: "Your public business details are up to date.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Unable to save profile",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    saveMutation.mutate();
  };

  if (restaurantsQuery.isLoading || (isStaffOrAdmin && adminRestaurantQuery.isLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-layered)]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!restaurant) {
    return (
      <div className="min-h-screen bg-[var(--bg-layered)]">
        <BackHeader title="Business Profile" fallbackHref="/dashboard" icon={Store} />
        <main className="mx-auto max-w-2xl px-4 py-8">
          <Card>
            <CardHeader>
              <CardTitle>Business not found</CardTitle>
              <CardDescription>
                This business is not accessible from your current account context.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/restaurant-signup">
                <Button>Register a Business</Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-layered)]">
      <BackHeader
        title="Business Profile"
        subtitle={restaurant.name}
        fallbackHref="/restaurant-owner-dashboard"
        icon={Store}
        rightActions={
          <Button
            form="business-profile-form"
            type="submit"
            disabled={saveMutation.isPending}
            data-testid="button-save-business-profile"
          >
            <Save className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        }
      />

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        {/* Quick Profile Import — fill your profile from Google/Facebook */}
        <BusinessProfileImport
          entityType="restaurant"
          entityId={restaurant.id}
          entityName={restaurant.name}
          entityAddress={restaurant.address}
          entityCity={restaurant.city || undefined}
          entityState={restaurant.state || undefined}
          onImportComplete={() => {
            // Refetch restaurant data so the form updates with imported data
            queryClient.invalidateQueries({ queryKey: ["/api/restaurants/my-restaurants"] });
          }}
        />

        <form id="business-profile-form" onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <UtensilsCrossed className="h-5 w-5 text-primary" />
                Core Details
              </CardTitle>
              <CardDescription>
                Required fields for discovery, checkout, and owner onboarding.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="business-name">Business name</Label>
                <Input
                  id="business-name"
                  ref={fieldRefs.name}
                  value={form.name}
                  onChange={(event) => updateField("name")(event.target.value)}
                  required
                  data-testid="input-business-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="business-type">Business type</Label>
                <Select
                  value={form.businessType}
                  onValueChange={(value) => updateField("businessType")(value)}
                >
                  <SelectTrigger id="business-type" data-testid="select-business-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="restaurant">Restaurant</SelectItem>
                    <SelectItem value="bar">Bar</SelectItem>
                    <SelectItem value="caterer">Caterer</SelectItem>
                    <SelectItem value="food_truck">Food truck</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="business-cuisine">Cuisine/category</Label>
                <Input
                  id="business-cuisine"
                  ref={fieldRefs.cuisineType}
                  value={form.cuisineType}
                  onChange={(event) => updateField("cuisineType")(event.target.value)}
                  placeholder="Seafood, tacos, coffee, bakery"
                  data-testid="input-business-cuisine"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="business-phone">Phone</Label>
                <Input
                  id="business-phone"
                  ref={fieldRefs.phone}
                  value={form.phone}
                  onChange={(event) => updateField("phone")(event.target.value)}
                  inputMode="tel"
                  data-testid="input-business-phone"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="business-address">Address or service area</Label>
                <Input
                  id="business-address"
                  ref={fieldRefs.address}
                  value={form.address}
                  onChange={(event) => updateField("address")(event.target.value)}
                  required
                  data-testid="input-business-address"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="business-city">City</Label>
                <Input
                  id="business-city"
                  ref={fieldRefs.city}
                  value={form.city}
                  onChange={(event) => updateField("city")(event.target.value)}
                  required
                  data-testid="input-business-city"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="business-state">State</Label>
                <Input
                  id="business-state"
                  ref={fieldRefs.state}
                  value={form.state}
                  onChange={(event) => updateField("state")(event.target.value)}
                  required
                  data-testid="input-business-state"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="business-description">Description</Label>
                <Textarea
                  id="business-description"
                  ref={fieldRefs.description}
                  value={form.description}
                  onChange={(event) => updateField("description")(event.target.value)}
                  rows={5}
                  data-testid="textarea-business-description"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Public Links</CardTitle>
              <CardDescription>
                Optional URLs shown on customer-facing profile surfaces.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="business-website">Website</Label>
                <Input
                  id="business-website"
                  ref={fieldRefs.websiteUrl}
                  value={form.websiteUrl}
                  onChange={(event) => updateField("websiteUrl")(event.target.value)}
                  placeholder="https://example.com"
                  inputMode="url"
                  data-testid="input-business-website"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="business-instagram">Instagram</Label>
                <Input
                  id="business-instagram"
                  value={form.instagramUrl}
                  onChange={(event) => updateField("instagramUrl")(event.target.value)}
                  placeholder="https://instagram.com/yourbusiness"
                  inputMode="url"
                  data-testid="input-business-instagram"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="business-facebook">Facebook</Label>
                <Input
                  id="business-facebook"
                  value={form.facebookPageUrl}
                  onChange={(event) => updateField("facebookPageUrl")(event.target.value)}
                  placeholder="https://facebook.com/yourbusiness"
                  inputMode="url"
                  data-testid="input-business-facebook"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="business-logo">Logo URL</Label>
                <Input
                  id="business-logo"
                  ref={fieldRefs.logoUrl}
                  value={form.logoUrl}
                  onChange={(event) => updateField("logoUrl")(event.target.value)}
                  placeholder="https://..."
                  inputMode="url"
                  data-testid="input-business-logo"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="business-cover">Cover image URL</Label>
                <Input
                  id="business-cover"
                  value={form.coverImageUrl}
                  onChange={(event) => updateField("coverImageUrl")(event.target.value)}
                  placeholder="https://..."
                  inputMode="url"
                  data-testid="input-business-cover"
                />
              </div>
            </CardContent>
          </Card>

        </form>

        {/* Photo Gallery — manage business photos */}
        <BusinessPhotoGallery
          entityType="restaurant"
          entityId={restaurant.id}
          maxPhotos={50}
          canEdit={true}
        />

        <MediaVideoManager
          ownerType={restaurant.businessType === "food_truck" ? "food_truck" : "restaurant"}
          ownerId={restaurant.id}
          title="Business videos"
          description="Upload featured profile videos for this business. Public pages only show active, public videos after review."
          adminMode={canAdminManageMedia}
        />

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Link href={`/menu-builder/${restaurant.id}`}>
              <Button type="button" variant="outline" className="w-full sm:w-auto">
                Open Menu Builder
              </Button>
            </Link>
            <Button
              type="submit"
              form="business-profile-form"
              disabled={saveMutation.isPending}
              className="w-full sm:w-auto"
              data-testid="button-save-business-profile-bottom"
            >
              <Save className="mr-2 h-4 w-4" />
              {saveMutation.isPending ? "Saving..." : "Save Profile"}
            </Button>
          </div>
      </main>
    </div>
  );
}
