import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserAddressSchema } from "@shared/schema";
import { z } from "zod";
import Navigation from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MapPin,
  Plus,
  Home,
  Briefcase,
  MoreHorizontal,
  Trash2,
  Edit,
  Star,
  X,
} from "lucide-react";
import { BackHeader } from "@/components/back-header";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { authUrl } from "@/lib/api";
import type { UserAddress } from "@shared/schema";

const addAddressFormSchema = z.object({
  label: z.string().min(1, "Label is required"),
  type: z.string().min(1, "Type is required"),
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  isDefault: z.boolean().optional().default(false),
});

type AddAddressFormData = z.infer<typeof addAddressFormSchema>;

export default function AddressesPage() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);

  // Fetch user addresses
  const { data: addresses = [], isLoading } = useQuery<UserAddress[]>({
    queryKey: ["/api/user/addresses"],
    enabled: isAuthenticated,
  });

  // Delete address mutation
  const deleteAddressMutation = useMutation({
    mutationFn: (addressId: string) =>
      apiRequest(`/api/user/addresses/${addressId}`, "DELETE"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/addresses"] });
      toast({ title: "Address deleted successfully" });
    },
    onError: (error: any) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = authUrl("/api/auth/google/customer");
        }, 500);
        return;
      }
      toast({ title: "Failed to delete address", variant: "destructive" });
    },
  });

  // Set default address mutation
  const setDefaultMutation = useMutation({
    mutationFn: (addressId: string) =>
      apiRequest(`/api/user/addresses/${addressId}/set-default`, "POST"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/addresses"] });
      toast({ title: "Default address updated" });
    },
    onError: (error: any) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = authUrl("/api/auth/google/customer");
        }, 500);
        return;
      }
      toast({
        title: "Failed to update default address",
        variant: "destructive",
      });
    },
  });

  // Create address mutation
  const createAddressMutation = useMutation({
    mutationFn: (addressData: AddAddressFormData) =>
      apiRequest("/api/user/addresses", "POST", addressData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/addresses"] });
      toast({ title: "Address added successfully" });
      setShowAddForm(false);
      form.reset();
    },
    onError: (error: any) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = authUrl("/api/auth/google/customer");
        }, 500);
        return;
      }
      toast({ title: "Failed to add address", variant: "destructive" });
    },
  });

  const form = useForm<AddAddressFormData>({
    resolver: zodResolver(addAddressFormSchema),
    defaultValues: {
      label: "",
      address: "",
      city: "",
      state: "",
      postalCode: "",
      type: "home",
      isDefault: false,
    },
  });

  const handleDeleteAddress = (addressId: string) => {
    if (confirm("Are you sure you want to delete this address?")) {
      deleteAddressMutation.mutate(addressId);
    }
  };

  const handleSetDefault = (addressId: string) => {
    setDefaultMutation.mutate(addressId);
  };

  const onSubmit = (data: AddAddressFormData) => {
    createAddressMutation.mutate(data);
  };

  if (!isAuthenticated || !user) {
    return (
      <div className="max-w-md mx-auto bg-[var(--bg-app)] min-h-screen relative pb-20">
        <div className="text-center py-12">
          <MapPin className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Sign in required</h2>
          <p className="text-muted-foreground">
            Log in to manage your addresses
          </p>
        </div>
        <Navigation />
      </div>
    );
  }

  const getIcon = (type: string) => {
    switch (type) {
      case "home":
        return <Home className="w-5 h-5" />;
      case "work":
        return <Briefcase className="w-5 h-5" />;
      default:
        return <MapPin className="w-5 h-5" />;
    }
  };

  return (
    <div className="max-w-md mx-auto bg-[var(--bg-app)] min-h-screen relative pb-20">
      <BackHeader
        title="Addresses"
        subtitle="Manage your saved locations"
        fallbackHref="/profile"
        icon={MapPin}
        rightActions={
          <Button size="sm" data-testid="button-add-address">
            <Plus className="w-4 h-4 mr-2" />
            Add
          </Button>
        }
        className="bg-[hsl(var(--background))] border-b border-white/5"
      />

      {/* Content */}
      <div className="px-4 sm:px-6 py-6 space-y-4">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <Card key={i} className="border-0 shadow-clean-lg">
                <CardContent className="p-4">
                  <div className="flex items-start space-x-3">
                    <div className="w-10 h-10 bg-muted rounded-lg animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted rounded animate-pulse" />
                      <div className="h-3 bg-muted rounded animate-pulse w-3/4" />
                      <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          addresses.map((address) => (
            <Card key={address.id} className="border-0 shadow-clean-lg">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mt-1">
                      {getIcon(address.type || "other")}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <h3 className="font-semibold text-foreground">
                          {address.label}
                        </h3>
                        {address.isDefault && (
                          <span className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full font-medium">
                            Default
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-foreground">
                        {address.address}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {address.city}, {address.state} {address.postalCode}
                      </p>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid={`button-address-menu-${address.id}`}
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!address.isDefault && (
                        <DropdownMenuItem
                          onClick={() => handleSetDefault(address.id)}
                          data-testid={`button-set-default-${address.id}`}
                        >
                          <Star className="w-4 h-4 mr-2" />
                          Set as Default
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => handleDeleteAddress(address.id)}
                        className="text-destructive"
                        data-testid={`button-delete-${address.id}`}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))
        )}

        {/* Add New Address Form */}
        {showAddForm ? (
          <Card className="border-0 shadow-clean-lg">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-foreground">
                  Add New Address
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddForm(false)}
                  data-testid="button-close-form"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <div>
                  <Label htmlFor="label">Label</Label>
                  <Input
                    id="label"
                    {...form.register("label")}
                    placeholder="e.g., Home, Work"
                    data-testid="input-address-label"
                  />
                  {form.formState.errors.label && (
                    <p className="text-sm text-destructive mt-1">
                      {form.formState.errors.label.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="type">Type</Label>
                  <Select
                    value={form.watch("type")}
                    onValueChange={(value) => form.setValue("type", value)}
                  >
                    <SelectTrigger data-testid="select-address-type">
                      <SelectValue placeholder="Select address type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="home">Home</SelectItem>
                      <SelectItem value="work">Work</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="address">Street Address</Label>
                  <Input
                    id="address"
                    {...form.register("address")}
                    placeholder="123 Main Street"
                    data-testid="input-street-address"
                  />
                  {form.formState.errors.address && (
                    <p className="text-sm text-destructive mt-1">
                      {form.formState.errors.address.message}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      {...form.register("city")}
                      placeholder="Houma"
                      data-testid="input-city"
                    />
                    {form.formState.errors.city && (
                      <p className="text-sm text-destructive mt-1">
                        {form.formState.errors.city.message}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="state">State</Label>
                    <Input
                      id="state"
                      {...form.register("state")}
                      placeholder="LA"
                      data-testid="input-state"
                    />
                    {form.formState.errors.state && (
                      <p className="text-sm text-destructive mt-1">
                        {form.formState.errors.state.message}
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <Label htmlFor="postalCode">Postal Code</Label>
                  <Input
                    id="postalCode"
                    {...form.register("postalCode")}
                    placeholder="70360"
                    data-testid="input-postal-code"
                  />
                  {form.formState.errors.postalCode && (
                    <p className="text-sm text-destructive mt-1">
                      {form.formState.errors.postalCode.message}
                    </p>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="isDefault"
                    {...form.register("isDefault")}
                    className="rounded border-[var(--border-subtle)]"
                    data-testid="checkbox-is-default"
                  />
                  <Label htmlFor="isDefault" className="text-sm">
                    Set as default address
                  </Label>
                </div>
                <div className="flex space-x-2 pt-2">
                  <Button
                    type="submit"
                    disabled={createAddressMutation.isPending}
                    data-testid="button-save-address"
                  >
                    {createAddressMutation.isPending
                      ? "Saving..."
                      : "Save Address"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAddForm(false)}
                    data-testid="button-cancel-address"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : (
          /* Add New Address Card */
          <Card className="border-2 border-dashed border-muted-foreground/20 bg-muted/10">
            <CardContent className="p-6 text-center">
              <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-3">
                <Plus className="w-6 h-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">
                Add New Address
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Save addresses for faster deal discovery
              </p>
              <Button
                variant="outline"
                onClick={() => setShowAddForm(true)}
                data-testid="button-add-new-address"
              >
                Add Address
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Navigation />
    </div>
  );
}
