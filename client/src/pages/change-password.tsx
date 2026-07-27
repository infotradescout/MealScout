import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
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
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, CheckCircle, Lock } from "lucide-react";
import { PASSWORD_REGEX, PASSWORD_REQUIREMENTS } from "@/utils/passwordPolicy";

export default function ChangePassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, refetch } = useAuth();
  const [formData, setFormData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const changePassword = useMutation({
    mutationFn: async (data: { oldPassword: string; newPassword: string }) => {
      return await apiRequest("POST", "/api/auth/change-password", data);
    },
    onSuccess: async () => {
      toast({
        title: "Password Changed",
        description:
          "Your password has been successfully changed. You can now continue using the app.",
      });

      // Refetch user to clear the requiresPasswordReset flag
      await refetch();

      // Redirect based on user type
      setTimeout(() => {
        if (user?.userType === "restaurant_owner") {
          setLocation("/restaurant-owner-dashboard");
        } else if (
          user?.userType === "admin" ||
          user?.userType === "duper_admin" ||
          user?.userType === "super_admin" ||
          user?.userType === "staff"
        ) {
          setLocation("/admin");
        } else {
          setLocation("/scout");
        }
      }, 1000);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description:
          error.message || "Failed to change password. Please try again.",
        variant: "destructive",
      });
    },
  });

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};

    if (!formData.currentPassword) {
      newErrors.currentPassword = "Current password is required";
    }

    if (!formData.newPassword) {
      newErrors.newPassword = "New password is required";
    } else if (!PASSWORD_REGEX.test(formData.newPassword)) {
      newErrors.newPassword = PASSWORD_REQUIREMENTS;
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = "Please confirm your password";
    } else if (formData.newPassword !== formData.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    changePassword.mutate({
      oldPassword: formData.currentPassword,
      newPassword: formData.newPassword,
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 to-red-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
              <Lock className="w-6 h-6 text-orange-600" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">
            Change Your Password
          </CardTitle>
          <CardDescription>
            You're using a temporary password. Please create a new password to
            continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-yellow-800">
              For your security, you must change your temporary password before
              accessing the app.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={formData.currentPassword}
                onChange={(e) =>
                  setFormData({ ...formData, currentPassword: e.target.value })
                }
                placeholder="Enter your temporary password"
              />
              {errors.currentPassword && (
                <p className="text-sm text-[color:var(--status-error)]">
                  {errors.currentPassword}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={formData.newPassword}
                onChange={(e) =>
                  setFormData({ ...formData, newPassword: e.target.value })
                }
                placeholder="At least 8 characters"
              />
              {errors.newPassword && (
                <p className="text-sm text-[color:var(--status-error)]">
                  {errors.newPassword}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={(e) =>
                  setFormData({ ...formData, confirmPassword: e.target.value })
                }
                placeholder="Re-enter your new password"
              />
              {errors.confirmPassword && (
                <p className="text-sm text-[color:var(--status-error)]">
                  {errors.confirmPassword}
                </p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={changePassword.isPending}
            >
              {changePassword.isPending
                ? "Changing Password..."
                : "Change Password"}
            </Button>
          </form>

          {changePassword.isSuccess && (
            <div className="mt-4 p-3 bg-[color:var(--status-success)]/10 border border-[color:var(--status-success)]/30 rounded-lg flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-[color:var(--status-success)]" />
              <p className="text-sm text-[color:var(--status-success)]">
                Password changed successfully! Redirecting...
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

