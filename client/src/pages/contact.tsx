import { useState } from "react";
import { SEOHead } from "@/components/seo-head";
import { BackHeader } from "@/components/back-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { 
  Mail, 
  MapPin,
  Send,
  HelpCircle,
  Users,
  Building,
  Clock
} from "lucide-react";

export default function Contact() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [ticketDraft, setTicketDraft] = useState({
    subject: "",
    category: "onboarding",
    priority: "normal",
    description: "",
  });
  const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);

  const schemaData = {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    "mainEntity": {
      "@type": "Organization",
      "name": "MealScout",
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "customer service",
        "email": "info.mealscout@gmail.com",
        "availableLanguage": "English"
      }
    }
  };

  const contactMethods = [
    {
      title: "General Support",
      description: "Questions about using MealScout, technical issues, or account help",
      icon: HelpCircle,
      contact: "info.mealscout@gmail.com",
      response: "Within 24 hours",
      color: "bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]"
    },
    {
      title: "Restaurant Partnerships",
      description: "Interested in joining MealScout as a restaurant partner",
      icon: Building,
      contact: "info.mealscout@gmail.com",
      response: "Within 24 hours",
      color: "bg-[color:var(--status-success)]/12 text-[color:var(--status-success)]"
    },
    {
      title: "Press & Media",
      description: "Media inquiries, press releases, and partnership opportunities",
      icon: Users,
      contact: "info.mealscout@gmail.com", 
      response: "Within 24 hours",
      color: "bg-purple-100 text-purple-600"
    }
  ];

  const supportEmail = "info.mealscout@gmail.com";

  const submitSupportTicket = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isAuthenticated) {
      window.location.href = `/login?redirect=${encodeURIComponent("/contact")}`;
      return;
    }

    setIsSubmittingTicket(true);
    try {
      const response = await fetch("/api/support-tickets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ticketDraft),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to create support ticket");
      }
      setTicketDraft({
        subject: "",
        category: "onboarding",
        priority: "normal",
        description: "",
      });
      toast({
        title: "Support ticket sent",
        description: "We added it to the admin queue and will follow up soon.",
      });
    } catch (error: any) {
      toast({
        title: "Could not send ticket",
        description: error?.message || "Please email support instead.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingTicket(false);
    }
  };

  const quickHelp = [
    "How do I get started?",
    "How do parking passes work?",
    "Where do I manage my profile?",
    "How do events work?",
    "How do affiliate links work?",
    "Report a problem"
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-red-50">
      <SEOHead
        title="Contact MealScout - Email Support"
        description="Email MealScout support for help with accounts, parking passes, events, restaurants, bars, and food trucks."
        keywords="contact MealScout, MealScout support email, food truck support, parking pass help, host account help, restaurant onboarding support"
        canonicalUrl="https://www.mealscout.us/contact"
        schemaData={schemaData}
      />
      
      <BackHeader
        title="Contact Us"
        fallbackHref="/"
        icon={Mail}
        className="bg-[hsl(var(--background))/0.94] border-b border-[color:var(--border-subtle)] shadow-clean"
      />

      <div className="px-4 py-8 max-w-6xl mx-auto">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <div className="w-24 h-24 bg-gradient-to-br from-purple-500 via-pink-500 to-red-500 rounded-3xl mb-8 flex items-center justify-center mx-auto shadow-clean-lg">
            <Mail className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-[color:var(--text-primary)] mb-6">
            Email Support
          </h1>
          <p className="text-xl text-[color:var(--text-secondary)] leading-relaxed max-w-3xl mx-auto">
            Have a question or need help? Email us and include the page you were on.
          </p>
        </div>

        {/* Contact Methods */}
        <div className="grid lg:grid-cols-3 gap-8 mb-16">
          {contactMethods.map((method, index) => {
            const IconComponent = method.icon;
            return (
              <Card key={index} className="p-6 bg-[var(--bg-card)] border border-[color:var(--border-subtle)] shadow-clean-lg hover:shadow-clean-lg transition-shadow">
                <CardContent className="p-0 text-center">
                  <div className={`w-16 h-16 ${method.color} rounded-2xl flex items-center justify-center mx-auto mb-6`}>
                    <IconComponent className="w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold text-[color:var(--text-primary)] mb-3">{method.title}</h3>
                  <p className="text-[color:var(--text-secondary)] mb-6 leading-relaxed">{method.description}</p>
                  <div className="space-y-2 mb-6">
                    <div className="flex items-center justify-center space-x-2 text-sm text-[color:var(--text-secondary)]">
                      <Mail className="w-4 h-4" />
                      <span>{method.contact}</span>
                    </div>
                    <div className="flex items-center justify-center space-x-2 text-sm text-[color:var(--text-secondary)]">
                      <Clock className="w-4 h-4" />
                      <span>Response: {method.response}</span>
                    </div>
                  </div>
                  <Button
                    className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
                    onClick={() => {
                      window.location.href = `mailto:${supportEmail}?subject=${encodeURIComponent(method.title)}`;
                    }}
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    Send Email
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-8">
          <Card className="bg-[var(--bg-card)] border border-[color:var(--border-subtle)] shadow-clean-lg">
            <CardHeader>
              <CardTitle className="text-xl font-bold text-[color:var(--text-primary)] flex items-center gap-3">
                <Send className="w-5 h-5 text-[color:var(--accent-text)]" />
                Open a Support Ticket
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitSupportTicket} className="space-y-4">
                {!isAuthenticated && (
                  <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm text-[color:var(--text-secondary)]">
                    Sign in to create a tracked support ticket. You can still email us directly below.
                  </div>
                )}
                {isAuthenticated && user?.email && (
                  <div className="text-xs text-[color:var(--text-secondary)]">
                    We will reply to {user.email}.
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="ticket-subject">Subject</Label>
                  <Input
                    id="ticket-subject"
                    value={ticketDraft.subject}
                    onChange={(event) =>
                      setTicketDraft({ ...ticketDraft, subject: event.target.value })
                    }
                    required
                    minLength={3}
                    maxLength={160}
                    placeholder="I need help with onboarding"
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="ticket-category">Category</Label>
                    <select
                      id="ticket-category"
                      value={ticketDraft.category}
                      onChange={(event) =>
                        setTicketDraft({ ...ticketDraft, category: event.target.value })
                      }
                      className="h-10 rounded-md border border-[color:var(--border-subtle)] bg-[var(--field-bg)] px-3 text-sm"
                    >
                      <option value="onboarding">Onboarding</option>
                      <option value="account">Account</option>
                      <option value="payment">Payment</option>
                      <option value="bug">Bug</option>
                      <option value="feature">Feature request</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ticket-priority">Priority</Label>
                    <select
                      id="ticket-priority"
                      value={ticketDraft.priority}
                      onChange={(event) =>
                        setTicketDraft({ ...ticketDraft, priority: event.target.value })
                      }
                      className="h-10 rounded-md border border-[color:var(--border-subtle)] bg-[var(--field-bg)] px-3 text-sm"
                    >
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ticket-description">What happened?</Label>
                  <Textarea
                    id="ticket-description"
                    value={ticketDraft.description}
                    onChange={(event) =>
                      setTicketDraft({
                        ...ticketDraft,
                        description: event.target.value,
                      })
                    }
                    required
                    minLength={10}
                    maxLength={4000}
                    rows={6}
                    placeholder="Tell us what you were trying to do and where you got stuck."
                  />
                </div>
                <Button
                  type="submit"
                  disabled={isSubmittingTicket}
                  className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {isSubmittingTicket
                    ? "Sending..."
                    : isAuthenticated
                      ? "Send Ticket"
                      : "Sign In to Send Ticket"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="space-y-8">
            {/* Quick Help */}
            <Card className="bg-[var(--bg-card)] border border-[color:var(--border-subtle)] shadow-clean-lg">
              <CardHeader>
                <CardTitle className="text-xl font-bold text-[color:var(--text-primary)] flex items-center gap-3">
                  <HelpCircle className="w-5 h-5 text-[color:var(--accent-text)]" />
                  Quick Help Topics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {quickHelp.map((topic, index) => (
                    <button
                      key={index}
                      className="w-full text-left p-3 rounded-lg bg-[var(--bg-surface)] hover:bg-[color:var(--accent-text)]/10 hover:text-[color:var(--accent-text)] transition-colors text-sm"
                      data-testid={`button-quick-help-${index}`}
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Office Info */}
            <Card className="bg-[var(--bg-card)] border border-[color:var(--border-subtle)] shadow-clean-lg">
              <CardHeader>
                <CardTitle className="text-xl font-bold text-[color:var(--text-primary)] flex items-center gap-3">
                  <MapPin className="w-5 h-5 text-[color:var(--status-success)]" />
                  Our Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start space-x-3">
                  <Mail className="w-5 h-5 text-[color:var(--text-muted)] mt-0.5" />
                  <div>
                    <div className="font-semibold text-[color:var(--text-primary)]">Email</div>
                    <div className="text-[color:var(--text-secondary)]">info.mealscout@gmail.com</div>
                  </div>
                </div>
                
                <div className="flex items-start space-x-3">
                  <MapPin className="w-5 h-5 text-[color:var(--text-muted)] mt-0.5" />
                  <div>
                    <div className="font-semibold text-[color:var(--text-primary)]">Headquarters</div>
                    <div className="text-[color:var(--text-secondary)]">United States</div>
                    <div className="text-[color:var(--text-secondary)]">Serving 25+ Cities</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Response Times */}
            <Card className="bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-clean-lg">
              <CardContent className="p-6 text-center">
                <h3 className="text-xl font-bold mb-4">Typical Response Times</h3>
                <div className="space-y-2 text-sm opacity-90">
                  <div>- General inquiries: within 24 hours</div>
                  <div>- Technical support: within 24 hours</div>
                  <div>- Partnerships: within 24 hours</div>
                  <div>- Press inquiries: within 24 hours</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}



