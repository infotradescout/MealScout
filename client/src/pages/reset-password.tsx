import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { BackHeader } from "@/components/back-header";
import {
  KeyRound,
  Eye,
  EyeOff,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import { SEOHead } from "@/components/seo-head";
import { PASSWORD_REGEX, PASSWORD_REQUIREMENTS } from "@/utils/passwordPolicy";

const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(1, PASSWORD_REQUIREMENTS)
      .regex(PASSWORD_REGEX, PASSWORD_REQUIREMENTS),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  // Extract token from URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenParam = urlParams.get("token");
    setToken(tokenParam);
  }, []);

  const form = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  // Validate token on mount
  const {
    data: tokenValidation,
    isLoading: isValidatingToken,
    error: tokenError,
  } = useQuery<{
    valid: boolean;
    error?: string;
  }>({
    queryKey: ["/api/auth/reset-password/validate", token],
    queryFn: async () => {
      if (!token) throw new Error("No token provided");
      const response = await fetch(
        `/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`,
      );
      return response.json();
    },
    enabled: !!token,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (data: ResetPasswordFormData) => {
      if (!token) throw new Error("No token provided");
      return await apiRequest("POST", "/api/auth/reset-password", {
        token,
        password: data.password,
      });
    },
    onSuccess: () => {
      toast({
        title: "Password Reset Successful!",
        description:
          "Your password has been updated. Please log in with your new password.",
      });
      setLocation("/login");
    },
    onError: (error: any) => {
      toast({
        title: "Reset Failed",
        description:
          error.message ||
          "Unable to reset password. Please try again or request a new reset link.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ResetPasswordFormData) => {
    resetPasswordMutation.mutate(data);
  };

  // Get password strength info
  const password = form.watch("password");
  const getPasswordStrength = (password: string) => {
    if (!password) return { level: 0, text: "", color: "gray" };
    if (password.length < 6)
      return { level: 1, text: "Too short", color: "red" };
    if (password.length < 8) return { level: 2, text: "Weak", color: "orange" };
    if (
      password.length < 12 &&
      /[A-Z]/.test(password) &&
      /[0-9]/.test(password)
    )
      return { level: 3, text: "Good", color: "blue" };
    if (
      password.length >= 12 &&
      /[A-Z]/.test(password) &&
      /[0-9]/.test(password) &&
      /[^A-Za-z0-9]/.test(password)
    )
      return { level: 4, text: "Strong", color: "green" };
    return { level: 2, text: "Weak", color: "orange" };
  };

  const passwordStrength = getPasswordStrength(password);
  const strengthTextClass =
    passwordStrength.color === "red"
      ? "text-[color:var(--status-error)]"
      : passwordStrength.color === "orange"
        ? "text-amber-300"
        : passwordStrength.color === "blue"
          ? "text-[color:var(--accent-text)]"
          : passwordStrength.color === "green"
            ? "text-emerald-300"
            : "text-[color:var(--text-muted)]";

  // Show loading state while validating token
  if (!token) {
    return (
      <div className="min-h-screen bg-[var(--bg-layered)]">
        <BackHeader
          title="Reset Password"
          fallbackHref="/forgot-password"
          icon={KeyRound}
          className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
        />

        <div className="px-4 sm:px-6 py-12 max-w-md mx-auto">
          <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean-lg">
            <CardContent className="p-8 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-red-400 to-red-600 rounded-full mx-auto mb-6 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-[color:var(--text-primary)] mb-4">
                Invalid Reset Link
              </h2>
              <p className="text-[color:var(--text-secondary)] mb-6">
                This password reset link is invalid or missing. Please request a
                new one.
              </p>
              <Link href="/forgot-password">
                <Button
                  className="w-full"
                  data-testid="button-request-new-link"
                >
                  Request New Reset Link
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isValidatingToken) {
    return (
      <div className="min-h-screen bg-[var(--bg-layered)] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-[color:var(--action-primary)] border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-[color:var(--text-secondary)]">
            Validating reset link...
          </p>
        </div>
      </div>
    );
  }

  // Show error if token is invalid
  if (tokenError || (tokenValidation && !tokenValidation.valid)) {
    return (
      <div className="min-h-screen bg-[var(--bg-layered)]">
        <BackHeader
          title="Reset Password"
          fallbackHref="/forgot-password"
          icon={KeyRound}
          className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
        />

        <div className="px-4 sm:px-6 py-12 max-w-md mx-auto">
          <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean-lg">
            <CardContent className="p-8 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-red-400 to-red-600 rounded-full mx-auto mb-6 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-[color:var(--text-primary)] mb-4">
                Link Expired
              </h2>
              <p className="text-[color:var(--text-secondary)] mb-6">
                This password reset link has expired or has already been used.
                Please request a new one.
              </p>
              <Link href="/forgot-password">
                <Button
                  className="w-full"
                  data-testid="button-request-new-link"
                >
                  Request New Reset Link
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-layered)]">
      <SEOHead
        title="Reset Password - MealScout | Create New Password"
        description="Create a new password for your MealScout account. Choose a strong, secure password to protect your account and access exclusive food deals."
        keywords="reset password, new password, password change, account security"
        canonicalUrl="https://www.mealscout.us/reset-password"
        noIndex={true}
      />
      <h1 className="sr-only">Reset your MealScout password</h1>
      <BackHeader
        title="Reset Password"
        fallbackHref="/forgot-password"
        icon={KeyRound}
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
      />

      <div className="px-4 sm:px-6 py-12 max-w-md mx-auto">
        <Card className="bg-[var(--bg-card)] border-[color:var(--border-subtle)] shadow-clean-lg">
          <CardHeader className="text-center pb-2">
            <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-green-600 rounded-full mx-auto mb-4 flex items-center justify-center">
              <KeyRound className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold text-[color:var(--text-primary)]">
              Create New Password
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 sm:px-8 pb-8">
            <p className="text-[color:var(--text-secondary)] text-center mb-6">
              Choose a strong password for your account.
            </p>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
              >
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[color:var(--text-primary)] font-medium">
                        New Password
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            type={showPassword ? "text" : "password"}
                            placeholder="Enter new password"
                            className="pr-10 py-3 border-[color:var(--border-subtle)] bg-[var(--field-bg)] focus:border-[color:var(--action-primary)] focus:ring-[color:var(--action-primary)]"
                            disabled={resetPasswordMutation.isPending}
                            data-testid="input-password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                            data-testid="button-toggle-password"
                          >
                            {showPassword ? (
                              <EyeOff className="w-5 h-5" />
                            ) : (
                              <Eye className="w-5 h-5" />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                      {password && (
                        <div className="mt-2">
                          <div className="flex items-center space-x-2">
                            <div className="flex-1 bg-[var(--bg-subtle)] rounded-full h-2">
                              <div
                                className={`h-2 rounded-full transition-all duration-300 ${
                                  passwordStrength.level === 1
                                    ? "w-1/4 bg-[color:var(--status-error)]"
                                    : passwordStrength.level === 2
                                      ? "w-2/4 bg-orange-500"
                                      : passwordStrength.level === 3
                                        ? "w-3/4 bg-[color:var(--accent-text)]/100"
                                        : passwordStrength.level === 4
                                          ? "w-full bg-[color:var(--status-success)]/100"
                                          : "w-0"
                                }`}
                              />
                            </div>
                            <span
                              className={`text-xs font-medium ${strengthTextClass}`}
                            >
                              {passwordStrength.text}
                            </span>
                          </div>
                        </div>
                      )}
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[color:var(--text-primary)] font-medium">
                        Confirm New Password
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            type={showConfirmPassword ? "text" : "password"}
                            placeholder="Confirm new password"
                            className="pr-10 py-3 border-[color:var(--border-subtle)] bg-[var(--field-bg)] focus:border-[color:var(--action-primary)] focus:ring-[color:var(--action-primary)]"
                            disabled={resetPasswordMutation.isPending}
                            data-testid="input-confirm-password"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setShowConfirmPassword(!showConfirmPassword)
                            }
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                            data-testid="button-toggle-confirm-password"
                          >
                            {showConfirmPassword ? (
                              <EyeOff className="w-5 h-5" />
                            ) : (
                              <Eye className="w-5 h-5" />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full py-3 action-primary hover:bg-[color:var(--action-hover)] text-[color:var(--action-primary-text)] font-semibold rounded-lg shadow-clean transition-all duration-200"
                  disabled={resetPasswordMutation.isPending}
                  data-testid="button-reset-password"
                >
                  {resetPasswordMutation.isPending ? (
                    <div className="flex items-center space-x-2">
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      <span>Updating Password...</span>
                    </div>
                  ) : (
                    "Update Password"
                  )}
                </Button>
              </form>
            </Form>

            {/* Security tips */}
            <div className="mt-6 pt-4 border-t border-[color:var(--border-subtle)]">
              <h4 className="text-sm font-medium text-[color:var(--text-primary)] mb-2">
                Password Tips:
              </h4>
              <ul className="text-xs text-[color:var(--text-secondary)] space-y-1">
                <li className="flex items-center space-x-1">
                  <span className="w-1 h-1 bg-[color:var(--text-muted)] rounded-full" />
                  <span>Use at least 8 characters</span>
                </li>
                <li className="flex items-center space-x-1">
                  <span className="w-1 h-1 bg-[color:var(--text-muted)] rounded-full" />
                  <span>Include uppercase and lowercase letters</span>
                </li>
                <li className="flex items-center space-x-1">
                  <span className="w-1 h-1 bg-[color:var(--text-muted)] rounded-full" />
                  <span>Add numbers and special characters</span>
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
