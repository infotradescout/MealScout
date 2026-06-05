import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Shield, Eye, EyeOff, ArrowLeft, Lock } from "lucide-react";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { toast } = useToast();

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const response = await apiRequest("POST", "/api/auth/login", { email, password });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.user?.userType === 'admin') {
        toast({
          title: "Admin Login Successful",
          description: `Welcome back, ${data.user.firstName || 'Admin'}!`,
        });
        // Redirect to admin dashboard
        window.location.href = "/admin/dashboard";
      } else {
        toast({
          title: "Access Denied",
          description: "This account does not have admin privileges.",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid email or password",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast({
        title: "Missing Information",
        description: "Please enter both email and password",
        variant: "destructive",
      });
      return;
    }
    loginMutation.mutate({ email, password });
  };

  return (
    <div className="min-h-screen bg-[var(--bg-layered)] relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-9rem] right-[-7rem] w-[24rem] h-[24rem] rounded-full bg-[color:var(--action-primary)]/15 blur-3xl" />
        <div className="absolute bottom-[-12rem] left-[-6rem] w-[26rem] h-[26rem] rounded-full bg-[color:var(--accent)]/20 blur-3xl" />
      </div>

      <div className="relative z-10 min-h-screen px-4 py-8 flex items-center justify-center">
        <div className="w-full max-w-4xl grid gap-6 md:grid-cols-[1.1fr_1fr]">
          <section className="hidden md:flex rounded-3xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)]/85 backdrop-blur p-8 flex-col justify-between shadow-clean-lg">
            <div className="space-y-5">
              <span className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-semibold text-[color:var(--text-secondary)]">
                <Shield className="h-3.5 w-3.5 text-[color:var(--action-primary)]" />
                Admin Console
              </span>
              <h1 className="text-3xl font-black leading-tight tracking-tight text-[color:var(--text-primary)]">
                Secure access to platform controls.
              </h1>
              <p className="text-sm text-[color:var(--text-secondary)] leading-relaxed max-w-sm">
                Use your admin credentials to manage trust, operations, and data integrity.
                Standard user accounts are blocked from this surface.
              </p>
            </div>
            <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <p className="text-xs text-[color:var(--text-secondary)]">
                If you are not staff, return to the public app and continue through standard login.
              </p>
            </div>
          </section>

          <section className="rounded-3xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)]/95 backdrop-blur shadow-clean-lg p-6 sm:p-8">
            <div className="flex items-center justify-between mb-6">
              <a
                href="/"
                className="inline-flex items-center gap-2 text-xs font-semibold text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to app
              </a>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-surface)] border border-[color:var(--border-subtle)] px-2.5 py-1 text-[10px] font-semibold text-[color:var(--text-secondary)]">
                <Lock className="h-3 w-3" />
                Restricted
              </span>
            </div>

            <div className="space-y-3 text-center mb-7">
              <div className="mx-auto h-14 w-14 rounded-2xl bg-[color:var(--action-primary)]/15 border border-[color:var(--action-primary)]/30 flex items-center justify-center">
                <Shield className="h-7 w-7 text-[color:var(--action-primary)]" />
              </div>
              <h2 className="text-2xl font-black tracking-tight text-[color:var(--text-primary)]">Admin Sign In</h2>
              <p className="text-sm text-[color:var(--text-secondary)]">
                Sign in with your privileged account credentials.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="email" className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">
                  Admin Email
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                  disabled={loginMutation.isPending}
                  data-testid="input-admin-email"
                  className="h-11 rounded-xl border-[color:var(--border-subtle)] bg-[var(--field-bg)]"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--text-secondary)]">
                  Admin Password
                </label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                    disabled={loginMutation.isPending}
                    data-testid="input-admin-password"
                    className="h-11 rounded-xl border-[color:var(--border-subtle)] bg-[var(--field-bg)] pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors"
                    data-testid="button-toggle-password"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loginMutation.isPending}
                data-testid="button-admin-login"
                className="w-full h-11 font-semibold rounded-xl action-primary hover:bg-[color:var(--action-hover)]"
              >
                {loginMutation.isPending ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-current border-r-transparent animate-spin" />
                    Signing In...
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Sign In as Admin
                  </span>
                )}
              </Button>
            </form>

            <div className="mt-5 text-center">
              <Link href="/forgot-password">
                <span
                  className="text-sm font-medium text-[color:var(--accent-text)] hover:text-[color:var(--accent-text-hover)] cursor-pointer"
                  data-testid="link-forgot-password"
                  data-recovery-action="navigate-only"
                >
                  Forgot your password?
                </span>
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}



