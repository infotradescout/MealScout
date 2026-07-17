import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Link, useLocation, useParams } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
  Upload, Eye, Users, DollarSign,
  Edit3, Save, Trash2, Copy, Calendar, Settings, AlertTriangle, Loader2,
} from "lucide-react";
import BusinessWorkspaceShell from "@/components/business-workspace-shell";
import type { Deal, Restaurant } from "@shared/schema";
import { authUrl } from "@/lib/api";
import { isBarBusinessType, isTruckBusinessType } from "@shared/businessTypes";
import { buildPublicProfilePath } from "@/lib/public-profile-path";

const dealEditSchema = z
  .object({
    title: z.string().min(1, "Special title is required"),
    description: z.string().min(1, "Description is required"),
    dealType: z.enum(["percentage", "fixed"]),
    discountValue: z.string().min(1, "Discount value is required"),
    minOrderAmount: z.string().optional(),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    availableDuringBusinessHours: z.boolean().default(false),
    isOngoing: z.boolean().default(false),
    totalUsesLimit: z.string().optional(),
    perCustomerLimit: z.string().optional(),
    facebookPageUrl: z.string().optional(),
    isActive: z.boolean(),
  })
  .refine((data) => data.isOngoing || Boolean(data.endDate), {
    message: "End date is required unless the special is ongoing",
    path: ["endDate"],
  })
  .refine(
    (data) =>
      data.availableDuringBusinessHours ||
      Boolean(data.startTime && data.endTime),
    {
      message: "Start and end times are required unless business hours are used",
      path: ["startTime"],
    },
  );

type DealEditFormData = z.infer<typeof dealEditSchema>;

export default function DealEdit() {
  const { dealId } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch the deal to edit
  const { data: deal, isLoading: dealLoading, error: dealError } = useQuery<Deal>({
    queryKey: [`/api/deals/${dealId}`],
    enabled: !!dealId && isAuthenticated,
  });

  const { data: restaurants = [], isLoading: restaurantsLoading } = useQuery<
    Restaurant[]
  >({
    queryKey: ["/api/restaurants/my-restaurants"],
    enabled: isAuthenticated,
  });
  const { data: businessAccess } = useQuery<{
    permissions?: {
      manageDeals?: boolean;
      viewAnalytics?: boolean;
    };
  }>({
    queryKey: ["/api/business-access/me"],
    enabled: isAuthenticated,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const selectedBusiness =
    restaurants.find((restaurant) => restaurant.id === deal?.restaurantId) ||
    null;

  const form = useForm<DealEditFormData>({
    resolver: zodResolver(dealEditSchema),
    defaultValues: {
      title: "",
      description: "",
      dealType: "percentage",
      discountValue: "",
      minOrderAmount: "",
      startDate: "",
      endDate: "",
      startTime: "",
      endTime: "",
      availableDuringBusinessHours: false,
      isOngoing: false,
      totalUsesLimit: "",
      perCustomerLimit: "",
      facebookPageUrl: "",
      isActive: true,
    },
  });

  // Update form when deal data is loaded
  useEffect(() => {
    if (deal) {
      const formatDate = (dateString: string) => {
        return new Date(dateString).toISOString().split('T')[0];
      };

      form.reset({
        title: deal.title,
        description: deal.description,
        dealType: deal.dealType as "percentage" | "fixed",
        discountValue: deal.discountValue.toString(),
        minOrderAmount: deal.minOrderAmount?.toString() || "",
        startDate: formatDate(deal.startDate.toString()),
        endDate: deal.endDate ? formatDate(deal.endDate.toString()) : "",
        startTime: deal.startTime || "",
        endTime: deal.endTime || "",
        availableDuringBusinessHours: Boolean(
          deal.availableDuringBusinessHours,
        ),
        isOngoing: Boolean(deal.isOngoing),
        totalUsesLimit: deal.totalUsesLimit?.toString() || "",
        perCustomerLimit: deal.perCustomerLimit?.toString() || "",
        facebookPageUrl: deal.facebookPageUrl || "",
        isActive: Boolean(deal.isActive),
      });

      if (deal.imageUrl) {
        setSelectedImage(deal.imageUrl);
      }
    }
  }, [deal, form]);

  // Track form changes
  useEffect(() => {
    const subscription = form.watch(() => {
      setIsDirty(true);
    });
    return () => subscription.unsubscribe();
  }, [form]);

  const updateDealMutation = useMutation({
    mutationFn: async (data: DealEditFormData) => {
      if (!dealId) {
        throw new Error("Deal ID is required");
      }

      const dealData = {
        ...data,
        discountValue: parseFloat(data.discountValue),
        minOrderAmount: data.minOrderAmount ? parseFloat(data.minOrderAmount) : null,
        totalUsesLimit: data.totalUsesLimit ? parseInt(data.totalUsesLimit) : null,
        perCustomerLimit: data.perCustomerLimit ? parseInt(data.perCustomerLimit) : 1,
        startDate: new Date(data.startDate).toISOString(),
        endDate: data.isOngoing ? null : new Date(data.endDate!).toISOString(),
        startTime: data.availableDuringBusinessHours ? null : data.startTime,
        endTime: data.availableDuringBusinessHours ? null : data.endTime,
        availableDuringBusinessHours: data.availableDuringBusinessHours,
        isOngoing: data.isOngoing,
        imageUrl: selectedImage || deal?.imageUrl,
      };

      return await apiRequest("PATCH", `/api/deals/${dealId}`, dealData);
    },
    onSuccess: () => {
      toast({
        title: "Success!",
        description: "Special updated successfully!",
      });
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: [`/api/deals/${dealId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      if (deal?.restaurantId) {
        queryClient.invalidateQueries({
          queryKey: [
            "/api/owner/restaurants",
            deal.restaurantId,
            "deals",
          ],
        });
        queryClient.invalidateQueries({
          queryKey: [`/api/deals/restaurant/${deal.restaurantId}`],
        });
      }
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
        description: error.message || "Failed to update deal",
        variant: "destructive",
      });
    },
  });

  const deleteDealMutation = useMutation({
    mutationFn: async () => {
      if (!dealId) {
        throw new Error("Deal ID is required");
      }
      return await apiRequest("DELETE", `/api/deals/${dealId}`);
    },
    onSuccess: () => {
      toast({
        title: "Special Deleted",
        description: "The deal has been permanently deleted.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      setLocation(
        deal?.restaurantId
          ? `/restaurant-owner-dashboard?workspace=deals&restaurantId=${encodeURIComponent(deal.restaurantId)}`
          : "/restaurant-owner-dashboard?workspace=deals",
      );
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete deal",
        variant: "destructive",
      });
    },
  });

  const duplicateDealMutation = useMutation({
    mutationFn: async () => {
      if (!deal || !selectedBusiness) {
        throw new Error("No restaurant or deal data available");
      }

      const formData = form.getValues();
      const dealData = {
        ...formData,
        title: `${formData.title} (Copy)`,
        restaurantId: deal.restaurantId,
        discountValue: parseFloat(formData.discountValue),
        minOrderAmount: formData.minOrderAmount ? parseFloat(formData.minOrderAmount) : null,
        totalUsesLimit: formData.totalUsesLimit ? parseInt(formData.totalUsesLimit) : null,
        perCustomerLimit: formData.perCustomerLimit ? parseInt(formData.perCustomerLimit) : 1,
        startDate: new Date(formData.startDate),
        endDate: formData.isOngoing ? null : new Date(formData.endDate!),
        startTime: formData.availableDuringBusinessHours ? null : formData.startTime,
        endTime: formData.availableDuringBusinessHours ? null : formData.endTime,
        availableDuringBusinessHours: formData.availableDuringBusinessHours,
        isOngoing: formData.isOngoing,
        imageUrl: selectedImage || deal.imageUrl,
      };

      const response = await apiRequest("POST", "/api/deals", dealData);
      return response.json();
    },
    onSuccess: (newDeal) => {
      toast({
        title: "Special Duplicated",
        description: "A copy of this deal has been created successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({
        queryKey: [
          "/api/owner/restaurants",
          deal?.restaurantId,
          "deals",
        ],
      });
      setLocation(
        `/deal-edit/${newDeal.id}?restaurantId=${encodeURIComponent(deal!.restaurantId)}`,
      );
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to duplicate deal",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: DealEditFormData) => {
    updateDealMutation.mutate(data);
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please choose an image smaller than 5MB",
          variant: "destructive",
        });
        return;
      }

      if (!file.type.startsWith('image/')) {
        toast({
          title: "Invalid file type",
          description: "Please choose an image file",
          variant: "destructive",
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        setSelectedImage(e.target?.result as string);
        setIsDirty(true);
      };
      reader.readAsDataURL(file);
    }
  };

  if (isLoading || dealLoading || restaurantsLoading) {
    return (
      <div className="max-w-4xl mx-auto bg-[var(--bg-layered)] min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
          <p className="text-muted-foreground">Loading deal...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto bg-[var(--bg-layered)] min-h-screen flex items-center justify-center">
        <Card>
          <CardContent className="p-6">
            <p className="text-center text-muted-foreground mb-4">Please log in to edit deals</p>
            <Button onClick={() => window.location.href = authUrl("/api/auth/google/restaurant")} className="w-full">
              Log In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (dealError || !deal || !selectedBusiness) {
    return (
      <div className="max-w-4xl mx-auto bg-[var(--bg-layered)] min-h-screen flex items-center justify-center">
        <Card>
          <CardContent className="p-6 text-center">
            <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Special Not Found</h2>
            <p className="text-muted-foreground mb-4">
              The deal you're trying to edit doesn't exist or you don't have permission to edit it.
            </p>
            <Link href="/restaurant-owner-dashboard?workspace=deals">
              <Button>Return to deals</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const dealPreviewData = {
    title: form.watch("title") || "Your Special Title",
    description: form.watch("description") || "Your deal description...",
    dealType: form.watch("dealType"),
    discountValue: form.watch("discountValue") || "0",
    minOrderAmount: form.watch("minOrderAmount"),
    facebookPageUrl: form.watch("facebookPageUrl"),
    image: selectedImage,
    isActive: form.watch("isActive"),
  };
  const isOwnerRole =
    user?.userType === "restaurant_owner" ||
    user?.userType === "food_truck" ||
    user?.userType === "admin" ||
    user?.userType === "duper_admin" ||
    user?.userType === "super_admin" ||
    user?.userType === "staff";
  const canManageDeals =
    isOwnerRole || businessAccess?.permissions?.manageDeals === true;
  const workspaceCapabilities = {
    deals: canManageDeals,
    audience:
      isOwnerRole || businessAccess?.permissions?.viewAnalytics === true,
    team: isOwnerRole,
    payments: isOwnerRole,
  };
  const publicEntityType =
    selectedBusiness.isFoodTruck ||
    isTruckBusinessType(selectedBusiness.businessType)
      ? "truck"
      : isBarBusinessType(selectedBusiness.businessType)
        ? "bar"
        : "restaurant";
  const publicProfileHref = buildPublicProfilePath({
    entityType: publicEntityType,
    id: selectedBusiness.id,
    name: selectedBusiness.name,
  });
  const dealsWorkspaceHref = `/restaurant-owner-dashboard?workspace=deals&restaurantId=${encodeURIComponent(selectedBusiness.id)}`;
  const dealEndAt = deal.endDate ? new Date(deal.endDate).getTime() : null;
  const dealStartAt = new Date(deal.startDate).getTime();
  const dealStatus =
    dealEndAt !== null && dealEndAt < Date.now()
      ? "Expired"
      : !deal.isActive
        ? "Paused"
        : dealStartAt > Date.now()
          ? "Scheduled"
          : "Live";

  return (
    <BusinessWorkspaceShell
      activeModule="deals"
      business={selectedBusiness}
      businesses={restaurants}
      onBusinessChange={(businessId) =>
        setLocation(
          `/restaurant-owner-dashboard?workspace=deals&restaurantId=${encodeURIComponent(businessId)}`,
        )
      }
      publicProfileHref={publicProfileHref}
      capabilities={workspaceCapabilities}
      headerActions={
          <div className="flex items-center space-x-2">
            <Badge variant={dealStatus === "Live" ? "default" : "secondary"}>
              {dealStatus}
            </Badge>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => duplicateDealMutation.mutate()}
              disabled={duplicateDealMutation.isPending}
              data-testid="button-duplicate"
            >
              <Copy className="w-4 h-4 mr-2" />
              {duplicateDealMutation.isPending ? "Copying..." : "Duplicate"}
            </Button>
            
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-delete">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Special</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this deal? This action cannot be undone.
                    All existing claims will be invalidated.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteDealMutation.mutate()}
                    className="bg-destructive hover:bg-destructive/90"
                    data-testid="button-confirm-delete"
                  >
                    {deleteDealMutation.isPending
                      ? "Deleting..."
                      : "Delete Special"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
      }
    >

      <div className="mx-auto max-w-6xl px-4 py-5 pb-28 sm:px-6 lg:py-8">
        <section className="mb-6 flex flex-col gap-3 rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 via-background to-amber-50 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">
              {selectedBusiness.name}
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight">Edit special</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Keep the offer, schedule, image, and limits accurate.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm" className="self-start sm:self-auto">
            <Link href={dealsWorkspaceHref}>Done</Link>
          </Button>
        </section>

        <div className="flex flex-col gap-8 lg:flex-row">
        {/* Edit Form */}
        <div className="flex-1 max-w-2xl">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              {/* Basic Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Edit3 className="w-5 h-5 mr-2" />
                    Basic Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Special Title</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Enter deal title..."
                            {...field}
                            data-testid="input-title"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Describe your deal..."
                            className="min-h-[100px]"
                            {...field}
                            data-testid="input-description"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="isActive"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Special Status</FormLabel>
                          <p className="text-sm text-muted-foreground">
                            Make this deal visible to customers
                          </p>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-active"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Pricing */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <DollarSign className="w-5 h-5 mr-2" />
                    Pricing & Discount
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="dealType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Discount Type</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            value={field.value}
                            className="flex space-x-8"
                          >
                            <div className="flex items-center space-x-2" data-testid="radio-percentage">
                              <RadioGroupItem value="percentage" id="percentage" />
                              <Label htmlFor="percentage">Percentage (%)</Label>
                            </div>
                            <div className="flex items-center space-x-2" data-testid="radio-fixed">
                              <RadioGroupItem value="fixed" id="fixed" />
                              <Label htmlFor="fixed">Fixed Amount ($)</Label>
                            </div>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="discountValue"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {form.watch("dealType") === "percentage" ? "Discount Percentage" : "Discount Amount"}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder={form.watch("dealType") === "percentage" ? "25" : "5.00"}
                            {...field}
                            data-testid="input-discount-value"
                          />
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
                        <FormLabel>Minimum Order Amount (Optional)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="20.00"
                            {...field}
                            data-testid="input-min-order"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Schedule */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Calendar className="w-5 h-5 mr-2" />
                    Schedule
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="isOngoing"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-4">
                        <div>
                          <FormLabel className="text-base">Ongoing special</FormLabel>
                          <p className="text-sm text-muted-foreground">
                            Keep it available without an end date.
                          </p>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="startDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Start Date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} data-testid="input-start-date" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {!form.watch("isOngoing") ? (
                      <FormField
                        control={form.control}
                        name="endDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>End Date</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} data-testid="input-end-date" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : null}
                  </div>

                  <FormField
                    control={form.control}
                    name="availableDuringBusinessHours"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-4">
                        <div>
                          <FormLabel className="text-base">Use business hours</FormLabel>
                          <p className="text-sm text-muted-foreground">
                            Make this special available whenever the business is open.
                          </p>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {!form.watch("availableDuringBusinessHours") ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="startTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Start Time</FormLabel>
                          <FormControl>
                            <Input type="time" {...field} data-testid="input-start-time" />
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
                          <FormLabel>End Time</FormLabel>
                          <FormControl>
                            <Input type="time" {...field} data-testid="input-end-time" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {/* Limits */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Users className="w-5 h-5 mr-2" />
                    Usage Limits
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="totalUsesLimit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Total Uses Limit (Optional)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="100"
                              {...field}
                              data-testid="input-total-limit"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="perCustomerLimit"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Per Customer Limit</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="1"
                              {...field}
                              data-testid="input-customer-limit"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Image Upload */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Upload className="w-5 h-5 mr-2" />
                    Special Image
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleImageUpload}
                      accept="image/*"
                      className="hidden"
                      data-testid="input-image-upload"
                    />
                    
                    {selectedImage ? (
                      <div className="relative">
                        <img
                          src={selectedImage}
                          alt="Special"
                          className="w-full h-48 object-cover rounded-lg"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="absolute top-2 right-2"
                          onClick={() => fileInputRef.current?.click()}
                          data-testid="button-change-image"
                        >
                          <Upload className="mr-1.5 h-4 w-4" />
                          Change
                        </Button>
                      </div>
                    ) : (
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                        data-testid="button-upload-image"
                      >
                        <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          Click to upload an image (Max 5MB)
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Facebook Integration */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Settings className="w-5 h-5 mr-2" />
                    Social Media
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="facebookPageUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Facebook Page URL (Optional)</FormLabel>
                        <FormControl>
                          <Input
                            type="url"
                            placeholder="https://facebook.com/yourpage"
                            {...field}
                            data-testid="input-facebook-url"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Actions */}
              <div className="flex space-x-4 sticky bottom-6 bg-background py-4">
                <Button
                  type="submit"
                  disabled={updateDealMutation.isPending || !isDirty}
                  className="flex-1"
                  data-testid="button-save-changes"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {updateDealMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
                
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowPreview(!showPreview)}
                  data-testid="button-preview"
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Preview
                </Button>
              </div>
            </form>
          </Form>
        </div>

        {/* Preview Panel */}
        {showPreview && (
          <div className="lg:w-80 lg:sticky lg:top-24 lg:self-start">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Special Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] overflow-hidden">
                  {dealPreviewData.image && (
                    <img
                      src={dealPreviewData.image}
                      alt={dealPreviewData.title}
                      className="w-full h-32 object-cover"
                    />
                  )}
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-bold text-lg">{dealPreviewData.title}</h3>
                      {dealPreviewData.isActive ? (
                        <Badge className="bg-[color:var(--status-success)]/100">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground text-sm mb-3">
                      {dealPreviewData.description}
                    </p>
                    <div className="flex items-center space-x-2 text-sm">
                      <Badge variant="secondary">
                        {dealPreviewData.dealType === "percentage" 
                          ? `${dealPreviewData.discountValue}% off` 
                          : `$${dealPreviewData.discountValue} off`}
                      </Badge>
                      {dealPreviewData.minOrderAmount && (
                        <span className="text-muted-foreground">
                          Min ${dealPreviewData.minOrderAmount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        </div>
      </div>
    </BusinessWorkspaceShell>
  );
}




