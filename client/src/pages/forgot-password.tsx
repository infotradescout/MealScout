import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { Link } from "wouter";
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
import { Mail, KeyRound, CheckCircle } from "lucide-react";
import { SEOHead } from "@/components/seo-head";

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPassword() {
  const { toast } = useToast();
  const [isSubmitted, setIsSubmitted] = useState(false);

  const form = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const forgotPasswordMutation = useMutation({
    mutationFn: async (data: ForgotPasswordFormData) => {
      return await apiRequest("POST", "/api/auth/forgot-password", data);
    },
    onSuccess: () => {
      setIsSubmitted(true);
      toast({
        title: "Reset link sent!",
        description:
          "If an account with that email exists, a password reset link has been sent.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description:
          error.message || "Unable to send reset link. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ForgotPasswordFormData) => {
    forgotPasswordMutation.mutate(data);
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
        <BackHeader
          title="Password Reset"
          fallbackHref="/login"
          icon={KeyRound}
          className="bg-[var(--bg-surface)]/95 backdrop-blur-sm border-b border-[var(--border-subtle)]/50 shadow-clean"
        />

        <div className="px-4 sm:px-6 py-12 max-w-md mx-auto">
          <Card className="bg-[var(--bg-surface)]/95 backdrop-blur-sm shadow-clean-lg border-0">
            <CardContent className="p-8 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-green-600 rounded-full mx-auto mb-6 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-[color:var(--text-primary)] mb-4">
                Check Your Email
              </h2>
              <p className="text-[color:var(--text-muted)] text-center mb-6">
                If an account with that email exists, we've sent you a password
                reset link.
              </p>
              <p className="text-sm text-[color:var(--text-muted)] mb-6">
                Didn't receive the email? Check your spam folder or try again in
                a few minutes.
              </p>
              <div className="space-y-4">
                <Button
                  onClick={() => {
                    setIsSubmitted(false);
                    form.reset();
                  }}
                  variant="outline"
                  className="w-full"
                  data-testid="button-try-again"
                >
                  Try Different Email
                </Button>
                <Link href="/login">
                  <Button className="w-full" data-testid="button-back-to-login">
                    Back to Login
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <SEOHead
        title="Forgot Password - MealScout | Reset Your Password"
        description="Reset your MealScout password. Enter your email address and we'll send you a secure link to create a new password and regain access to your account."
        keywords="forgot password, reset password, password recovery, account recovery"
        canonicalUrl="https://www.mealscout.us/forgot-password"
        noIndex={true}
      />
      <h1 className="sr-only">Forgot your MealScout password</h1>
      <BackHeader
        title="Reset Password"
        fallbackHref="/login"
        icon={KeyRound}
        className="bg-[var(--bg-surface)]/95 backdrop-blur-sm border-b border-[var(--border-subtle)]/50 shadow-clean"
      />

      <div className="px-4 sm:px-6 py-12 max-w-md mx-auto">
        <Card className="bg-[var(--bg-surface)]/95 backdrop-blur-sm shadow-clean-lg border-0">
          <CardHeader className="text-center pb-2">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-400 to-[color:var(--accent-text-hover)] rounded-full mx-auto mb-4 flex items-center justify-center">
              <KeyRound className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold text-[color:var(--text-primary)]">
              Forgot Your Password?
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 sm:px-8 pb-8">
            <p className="text-[color:var(--text-muted)] text-center mb-6">
              No worries! Enter your email address below and we'll send you a
              link to reset your password.
            </p>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-6"
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[color:var(--text-secondary)] font-medium">
                        Email Address
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[color:var(--text-muted)] w-5 h-5" />
                          <Input
                            {...field}
                            type="email"
                            placeholder="Enter your email address"
                            className="pl-10 py-3 border-[var(--border-subtle)] focus:border-blue-500 focus:ring-blue-500"
                            disabled={forgotPasswordMutation.isPending}
                            data-testid="input-email"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full py-3 bg-gradient-to-r from-[color:var(--accent-text)] to-[color:var(--accent-text-hover)] hover:from-[color:var(--accent-text-hover)] hover:to-[color:var(--accent-text-hover)] text-white font-semibold rounded-lg shadow-clean-lg hover:shadow-clean-lg transition-all duration-200"
                  disabled={forgotPasswordMutation.isPending}
                  data-testid="button-send-reset-link"
                >
                  {forgotPasswordMutation.isPending ? (
                    <div className="flex items-center space-x-2">
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      <span>Sending...</span>
                    </div>
                  ) : (
                    "Send Reset Link"
                  )}
                </Button>
              </form>
            </Form>

            <div className="mt-6 text-center">
              <p className="text-sm text-[color:var(--text-muted)]">
                Remember your password?{" "}
                <Link href="/login">
                  <span
                    className="text-[color:var(--accent-text)] hover:text-[color:var(--accent-text)] font-medium cursor-pointer"
                    data-testid="link-back-to-login"
                  >
                    Back to Login
                  </span>
                </Link>
              </p>
            </div>

            {/* Security info */}
            <div className="mt-6 pt-4 border-t border-[var(--border-subtle)]">
              <div className="flex items-center justify-center space-x-4 text-xs text-[color:var(--text-muted)]">
                <div className="flex items-center space-x-1">
                  <svg
                    className="w-3 h-3 text-[color:var(--status-success)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  <span>Secure</span>
                </div>
                <div className="flex items-center space-x-1">
                  <svg
                    className="w-3 h-3 text-[color:var(--status-success)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>Link expires in 1 hour</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
