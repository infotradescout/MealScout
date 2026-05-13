import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Navigation from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HelpCircle,
  Mail,
  ExternalLink,
  Search,
  BookOpen,
  Link as LinkIcon,
  MessageSquare,
  Send,
  Ticket,
} from "lucide-react";
import { BackHeader } from "@/components/back-header";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type HelpDocSection = {
  id: string;
  guide: "Universal" | "Owner Add-On" | "Template";
  title: string;
  summary: string;
  steps: string[];
  links: Array<{ label: string; href: string }>;
  status?: "active" | "planned";
};

type SupportTicket = {
  id: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  adminNotes?: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function HelpSupportPage() {
  const docSections: HelpDocSection[] = [
    {
      id: "universal-getting-started",
      guide: "Universal",
      title: "Getting Started",
      summary:
        "Use Scout, Map, Search, Deals, and Events to discover local food quickly.",
      steps: [
        "Open Scout and browse local spots.",
        "Use Map and Search to compare options nearby.",
        "Check Time-Sensitive Specials and Events.",
        "Save or share the best options.",
      ],
      links: [
        { label: "Scout", href: "/scout" },
        { label: "Map", href: "/map" },
        { label: "Search", href: "/search" },
        { label: "Deals", href: "/deals/featured" },
        { label: "Events", href: "/events" },
      ],
    },
    {
      id: "universal-account-login",
      guide: "Universal",
      title: "Account, Verification, and Login",
      summary:
        "Create account, verify your email, log in, and recover access when needed.",
      steps: [
        "Choose your signup path.",
        "Complete email verification.",
        "Log in and continue setup.",
        "Use forgot/reset password if needed.",
      ],
      links: [
        { label: "Sign Up", href: "/customer-signup" },
        { label: "Post Verification", href: "/post-verification" },
        { label: "Log In", href: "/login" },
        { label: "Forgot Password", href: "/forgot-password" },
      ],
    },
    {
      id: "universal-profile-settings",
      guide: "Universal",
      title: "Profile, Notifications, and Settings",
      summary:
        "Manage your personal profile, notifications, settings, and support access.",
      steps: [
        "Open Profile.",
        "Review Notifications and Settings.",
        "Update account preferences.",
        "Use Sign Out when needed.",
      ],
      links: [
        { label: "Profile", href: "/profile" },
        { label: "Notifications", href: "/profile/notifications" },
        { label: "Settings", href: "/profile/settings" },
      ],
    },
    {
      id: "universal-favorites-sharing",
      guide: "Universal",
      title: "Saved, Recommendations, and Sharing",
      summary:
        "Save places, post recommendation content, and share links to local spots.",
      steps: [
        "Save items while browsing.",
        "Open your Saved list.",
        "Use recommendation surfaces.",
        "Share links from Share Hub.",
      ],
      links: [
        { label: "Saved", href: "/favorites" },
        { label: "Video", href: "/video" },
        { label: "Share Hub", href: "/share-hub" },
      ],
    },
    {
      id: "universal-messaging",
      guide: "Universal",
      title: "Messaging Status",
      summary:
        "In-app messaging/chat routes are currently planned and not active.",
      steps: [
        "No dedicated /messages route is currently available.",
        "Use Help & Support for direct assistance.",
        "Use profile and public business details for contact alternatives.",
        "Watch updates for future inbox release.",
      ],
      links: [{ label: "Help & Support", href: "/profile/help" }],
      status: "planned",
    },
    {
      id: "owner-onboarding",
      guide: "Owner Add-On",
      title: "Owner Onboarding",
      summary:
        "Owners should complete universal user flows first, then finish owner setup.",
      steps: [
        "Start with regular user guide flows.",
        "Continue owner setup path.",
        "Resume incomplete setup from role route.",
        "Confirm dashboard access.",
      ],
      links: [
        { label: "Business Signup", href: "/customer-signup?role=business" },
        { label: "Restaurant Signup", href: "/restaurant-signup" },
        { label: "Host Signup", href: "/host-signup" },
        {
          label: "Event Coordinator Dashboard",
          href: "/event-coordinator/dashboard",
        },
      ],
    },
    {
      id: "owner-menu-deals",
      guide: "Owner Add-On",
      title: "Menu and Deals Management",
      summary:
        "Publish menu updates and promotions that stay accurate over time.",
      steps: [
        "Manage menu data in Menu Builder.",
        "Create and edit deals.",
        "Review public menu and deal pages.",
        "Remove stale or expired data quickly.",
      ],
      links: [
        { label: "Menu Builder", href: "/menu-builder" },
        { label: "Create Deal", href: "/deal-creation" },
        { label: "Featured Deals", href: "/deals/featured" },
      ],
    },
    {
      id: "owner-dashboard-payments",
      guide: "Owner Add-On",
      title: "Dashboards, Verification, and Payments",
      summary:
        "Keep business profile health, verification, and payout readiness current.",
      steps: [
        "Open your role dashboard.",
        "Review setup and verification checkpoints.",
        "Confirm payment/payout readiness.",
        "Verify public visibility after updates.",
      ],
      links: [
        { label: "Restaurant Owner Dashboard", href: "/restaurant-owner-dashboard" },
        { label: "Host Dashboard", href: "/host/dashboard" },
        { label: "Payment Methods", href: "/profile/payment" },
        { label: "Post Verification", href: "/post-verification" },
      ],
    },
    {
      id: "template-reuse",
      guide: "Template",
      title: "Reusable Playbook Template",
      summary:
        "Use the template for new user-type guides with universal inheritance first.",
      steps: [
        "Start with inherited universal flows.",
        "Add role-specific add-on flows.",
        "Mark missing features as planned/not currently available.",
        "Validate route and label accuracy before publishing.",
      ],
      links: [{ label: "Help Home", href: "/profile/help" }],
    },
  ];

  const [query, setQuery] = useState("");
  const [ticketDraft, setTicketDraft] = useState({
    subject: "",
    category: "other",
    priority: "normal",
    description: "",
  });
  const [directMessage, setDirectMessage] = useState("");
  const supportEmail = "info.mealscout@gmail.com";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: ticketPayload } = useQuery<{ tickets: SupportTicket[] }>({
    queryKey: ["/api/support/tickets"],
    retry: false,
  });
  const tickets = ticketPayload?.tickets || [];

  const createTicketMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/support/tickets", ticketDraft);
      return res.json();
    },
    onSuccess: () => {
      setTicketDraft({
        subject: "",
        category: "other",
        priority: "normal",
        description: "",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets"] });
      toast({ title: "Ticket sent", description: "Support can now review it." });
    },
    onError: (error) => {
      toast({
        title: "Ticket failed",
        description:
          error instanceof Error ? error.message : "Unable to create ticket.",
        variant: "destructive",
      });
    },
  });

  const directAdminMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/support/message-super-admin", {
        message: directMessage,
      });
      return res.json();
    },
    onSuccess: () => {
      setDirectMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/support/tickets"] });
      toast({
        title: "Message sent",
        description: "It was sent directly to super admin.",
      });
    },
    onError: (error) => {
      toast({
        title: "Message failed",
        description:
          error instanceof Error ? error.message : "Unable to message admin.",
        variant: "destructive",
      });
    },
  });

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSections = docSections.filter((section) => {
    if (!normalizedQuery) return true;
    const target = [
      section.title,
      section.summary,
      section.guide,
      ...section.steps,
      ...section.links.map((link) => link.label),
    ]
      .join(" ")
      .toLowerCase();
    return target.includes(normalizedQuery);
  });

  const grouped = {
    Universal: visibleSections.filter((s) => s.guide === "Universal"),
    "Owner Add-On": visibleSections.filter((s) => s.guide === "Owner Add-On"),
    Template: visibleSections.filter((s) => s.guide === "Template"),
  };

  return (
    <div className="max-w-md lg:max-w-4xl xl:max-w-6xl mx-auto bg-[var(--bg-app)] min-h-screen relative pb-20">
      <BackHeader
        title="Help & Support"
        subtitle="Searchable playbooks and support"
        fallbackHref="/profile"
        icon={HelpCircle}
        className="bg-[hsl(var(--background))] border-b border-white/5"
      />

      <div className="px-4 sm:px-6 py-6 space-y-6">
        <Card className="border-0 shadow-clean-lg">
          <CardContent className="p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-3">
              <BookOpen className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">
                Help Book Index
              </h2>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pages, flows, and steps"
                className="pl-9"
                data-testid="input-help-search"
              />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">Universal Guide</Badge>
              <Badge variant="secondary">Owner Add-On</Badge>
              <Badge variant="secondary">Template</Badge>
              <Badge variant="outline">Indexable Sections: {visibleSections.length}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-clean-lg">
          <CardContent className="p-4 sm:p-5 space-y-3">
            <h2 className="text-base font-semibold text-foreground">Quick Index Links</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              {visibleSections.map((section) => (
                <a
                  key={`toc-${section.id}`}
                  href={`#${section.id}`}
                  className="text-primary hover:underline"
                >
                  {section.guide}: {section.title}
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <Card className="border-0 shadow-clean-lg">
            <CardContent className="p-4 sm:p-5 space-y-4">
              <div className="flex items-center gap-3">
                <Ticket className="w-5 h-5 text-primary" />
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    Open a Support Ticket
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Account, booking, payment, map, hiring, private chef, or bug help.
                  </p>
                </div>
              </div>
              <Input
                value={ticketDraft.subject}
                onChange={(event) =>
                  setTicketDraft((current) => ({
                    ...current,
                    subject: event.target.value,
                  }))
                }
                placeholder="Short subject"
                data-testid="input-support-subject"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Select
                  value={ticketDraft.category}
                  onValueChange={(value) =>
                    setTicketDraft((current) => ({ ...current, category: value }))
                  }
                >
                  <SelectTrigger data-testid="select-support-category">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="account">Account</SelectItem>
                    <SelectItem value="booking">Booking</SelectItem>
                    <SelectItem value="live_location">Live location</SelectItem>
                    <SelectItem value="payment">Payment</SelectItem>
                    <SelectItem value="business_profile">Business profile</SelectItem>
                    <SelectItem value="hiring">Hiring/jobs</SelectItem>
                    <SelectItem value="private_chef">Private chef</SelectItem>
                    <SelectItem value="bug">Bug</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={ticketDraft.priority}
                  onValueChange={(value) =>
                    setTicketDraft((current) => ({ ...current, priority: value }))
                  }
                >
                  <SelectTrigger data-testid="select-support-priority">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                value={ticketDraft.description}
                onChange={(event) =>
                  setTicketDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="What happened? Include the page, truck/business, booking, or order if relevant."
                rows={5}
                data-testid="textarea-support-description"
              />
              <Button
                className="w-full sm:w-auto"
                disabled={createTicketMutation.isPending}
                onClick={() => createTicketMutation.mutate()}
                data-testid="button-create-support-ticket"
              >
                <Send className="w-4 h-4 mr-2" />
                {createTicketMutation.isPending ? "Sending..." : "Send Ticket"}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-clean-lg">
            <CardContent className="p-4 sm:p-5 space-y-4">
              <div className="flex items-center gap-3">
                <MessageSquare className="w-5 h-5 text-primary" />
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    Message Super Admin
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Direct escalation for anything sensitive or urgent.
                  </p>
                </div>
              </div>
              <Textarea
                value={directMessage}
                onChange={(event) => setDirectMessage(event.target.value)}
                placeholder="Write directly to super admin"
                rows={6}
                data-testid="textarea-super-admin-message"
              />
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                disabled={directAdminMutation.isPending}
                onClick={() => directAdminMutation.mutate()}
                data-testid="button-message-super-admin"
              >
                <Send className="w-4 h-4 mr-2" />
                {directAdminMutation.isPending ? "Sending..." : "Send Direct"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="border-0 shadow-clean-lg">
          <CardContent className="p-4 sm:p-5 space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              Your Support History
            </h2>
            {tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tickets yet.
              </p>
            ) : (
              <div className="space-y-2">
                {tickets.slice(0, 6).map((ticket) => (
                  <div
                    key={ticket.id}
                    className="rounded-lg border border-border p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-foreground">
                        {ticket.subject}
                      </p>
                      <div className="flex gap-2">
                        <Badge variant="outline">{ticket.status}</Badge>
                        <Badge variant="secondary">{ticket.priority}</Badge>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ticket.category.replace(/_/g, " ")} ·{" "}
                      {new Date(ticket.createdAt).toLocaleDateString()}
                    </p>
                    {ticket.adminNotes && (
                      <p className="mt-2 rounded-md bg-muted p-2 text-xs text-foreground">
                        {ticket.adminNotes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Contact Us
          </h2>
          <Card className="border-0 shadow-clean-lg">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Mail className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">
                      Email Support
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Send us a detailed message
                    </p>
                    <p className="text-xs text-primary mt-1">
                      Response within 24h
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-email-support"
                  onClick={() => {
                    window.location.href = `mailto:${supportEmail}`;
                  }}
                >
                  Send Email
                </Button>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                {supportEmail}
              </div>
            </CardContent>
          </Card>
        </div>

        {(["Universal", "Owner Add-On", "Template"] as const).map(
          (guideKey) => {
            const sections = grouped[guideKey];
            if (sections.length === 0) return null;
            return (
              <div key={guideKey} className="space-y-3">
                <h2 className="text-lg font-semibold text-foreground">{guideKey}</h2>
                {sections.map((section) => (
                  <Card key={section.id} id={section.id} className="border-0 shadow-clean-lg scroll-mt-24">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-foreground">{section.title}</h3>
                          <p className="text-sm text-muted-foreground mt-1">{section.summary}</p>
                        </div>
                        {section.status === "planned" ? (
                          <Badge variant="outline">Planned / not currently available</Badge>
                        ) : (
                          <Badge variant="secondary">Active</Badge>
                        )}
                      </div>

                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Click-by-click</p>
                        <ol className="list-decimal list-inside space-y-1 text-sm text-foreground">
                          {section.steps.map((step, index) => (
                            <li key={`${section.id}-step-${index}`}>{step}</li>
                          ))}
                        </ol>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {section.links.map((link) => (
                          <Button
                            key={`${section.id}-${link.href}-${link.label}`}
                            asChild
                            variant="outline"
                            size="sm"
                          >
                            <a href={link.href}>
                              <LinkIcon className="w-3.5 h-3.5 mr-2" />
                              {link.label}
                            </a>
                          </Button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            );
          },
        )}

        {visibleSections.length === 0 && (
          <Card className="border-0 shadow-clean-lg">
            <CardContent className="p-4 text-sm text-muted-foreground">
              No matching playbook sections found. Try a broader search term.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold text-foreground mb-3">
              Additional Resources
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">User Guide</span>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="button-user-guide"
                  onClick={() => (window.location.href = "/profile/help#universal-getting-started")}
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">Owner Add-On Guide</span>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="button-owner-guide"
                  onClick={() => (window.location.href = "/profile/help#owner-onboarding")}
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">
                  Terms of Service
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="button-terms"
                  onClick={() => (window.location.href = "/terms-of-service")}
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">Privacy Policy</span>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="button-privacy"
                  onClick={() => (window.location.href = "/privacy-policy")}
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Navigation />
    </div>
  );
}
