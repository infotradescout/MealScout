import { SEOHead } from "@/components/seo-head";
import { BackHeader } from "@/components/back-header";
import { 
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  HelpCircle,
  Mail,
  Clock,
  Shield,
  Truck,
  Building2,
  CalendarDays,
  Users,
} from "lucide-react";

export default function FAQ() {
  const schemaData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "Who is MealScout for?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "MealScout is built for diners, food trucks, hosts, restaurants, bars, and event coordinators. Each role gets its own tools while keeping everything local and community-driven."
        }
      },
      {
        "@type": "Question",
        "name": "How do parking passes work?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Hosts list locations and available slots. Trucks search, select a slot, and pay to confirm the booking. Payment is required to book and there are no pending holds."
        }
      },
      {
        "@type": "Question",
        "name": "How do events work?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Event coordinators create and manage events. Trucks can request or book based on the event flow. Hosts do not manage events inside parking pass."
        }
      },
      {
        "@type": "Question",
        "name": "Is MealScout free to join?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Yes. Joining is free. Every business receives the complete profile and profile tools under a free trial that does not expire, require a card, convert to a paid plan, or create a monthly bill. Separate orders, deliveries, bookings, and other paid transactions may have charges shown before payment."
        }
      },
      {
        "@type": "Question",
        "name": "How do affiliate links work?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Every user has a dedicated affiliate tag. When you share a MealScout link, your tag is included so referrals are credited to you."
        }
      },
      {
        "@type": "Question",
        "name": "How do I contact support?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "Email support anytime with the page you were on and a short description of the issue."
        }
      }
    ]
  };

  const faqs = [
    {
      category: "Getting Started",
      questions: [
        {
          question: "Who is MealScout built for?",
          answer: "MealScout is for diners, food trucks, hosts, restaurants, bars, and event coordinators. Each role has its own tools and visibility so you stay in control."
        },
        {
          question: "Is it free to join?",
          answer: "Yes. Joining is free for everyone. Every business gets the complete profile and its tools under a free trial with no expiration, no card, and no monthly bill. Separate paid transactions are shown before payment."
        },
        {
          question: "How do I choose my user type?",
          answer: "Pick your role at signup. You can add more roles later if you operate as multiple types."
        },
        {
          question: "How do profiles work?",
          answer: "Business profiles act like mini websites. Keep your details accurate so locals can find and trust you."
        }
      ]
    },
    {
      category: "Food Trucks",
      questions: [
        {
          question: "How do I book a parking pass?",
          answer: "Search locations, choose a date and slot, and pay to confirm. Booking is only created after payment succeeds."
        },
        {
          question: "How do I manage my schedule?",
          answer: "Use your dashboard to add or edit your schedule. You stay in control of where you are and when."
        },
        {
          question: "Can I share my truck link?",
          answer: "Yes. Every shared link includes your affiliate tag, so your referrals are credited."
        },
        {
          question: "Do I need full access to book parking passes?",
          answer: "No monthly profile plan is required. Parking Pass bookings are separate paid transactions, with the charge shown before you confirm."
        }
      ]
    },
    {
      category: "Hosts",
      questions: [
        {
          question: "How do I list parking pass locations?",
          answer: "Add addresses to your host profile. Each address becomes a parking pass location with its own slots."
        },
        {
          question: "How many spots can I list?",
          answer: "Each parking pass location can have multiple spots. You control spot count and availability."
        },
        {
          question: "Can I set blackout dates?",
          answer: "Yes. Blackout dates apply to the specific parking pass location, not your entire account."
        },
        {
          question: "Do hosts pay MealScout?",
          answer: "No. Hosts keep their full fee minus payment processing."
        }
      ]
    },
    {
      category: "Restaurants & Bars",
      questions: [
        {
          question: "What does the business profile include?",
          answer: "Your profile is a mini website: photos, menu highlights, deals, contact info, and visibility in local search."
        },
        {
          question: "What does the free trial include?",
          answer: "The complete business profile and its tools are included. The trial has no expiration, requires no card, and never becomes a monthly bill."
        },
        {
          question: "Can I post deals and promotions?",
          answer: "Yes. Create deals and track performance from your dashboard."
        },
        {
          question: "How do I show up in local discovery?",
          answer: "Complete your profile, stay active, and keep your info accurate."
        }
      ]
    },
    {
      category: "Events",
      questions: [
        {
          question: "Who can create events?",
          answer: "Only event coordinators can create and manage events."
        },
        {
          question: "Can trucks contact coordinators?",
          answer: "Yes. Trucks can reach out to coordinators for event bookings."
        },
        {
          question: "Are events part of parking pass?",
          answer: "No. Events are a separate service with their own flow and pages."
        },
        {
          question: "Can all users view events?",
          answer: "Yes. Everyone can browse events in their area, but actions depend on user type."
        }
      ]
    },
    {
      category: "Accounts & Affiliates",
      questions: [
        {
          question: "How do affiliate links work?",
          answer: "Every user has a dedicated affiliate tag. When you share a MealScout link, your tag is included so referrals are tracked to you."
        },
        {
          question: "Can I edit my affiliate tag?",
          answer: "Yes. You can change the tag in your profile if it’s available and appropriate."
        },
        {
          question: "How do I manage notifications?",
          answer: "Go to Profile → Notifications to control what you receive."
        },
        {
          question: "Can I delete my account?",
          answer: "Yes. Use Profile settings to request deletion. We honor removal requests."
        }
      ]
    },
    {
      category: "Troubleshooting",
      questions: [
        {
          question: "I can’t log in after signup",
          answer: "Refresh the page, then sign in again. If it persists, email support with your email and the time you tried."
        },
        {
          question: "I don’t see any locations or deals nearby",
          answer: "Try a wider search area or check your location permissions."
        },
        {
          question: "A booking didn’t appear",
          answer: "Bookings only appear after successful payment. If payment went through and it’s missing, contact support with the booking details."
        }
      ]
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <SEOHead
        title="Frequently Asked Questions - MealScout Help Center"
        description="Get clear answers about MealScout for diners, trucks, hosts, restaurants, bars, and event coordinators. Local tools, simple flows, full control."
        keywords="MealScout FAQ, food truck FAQ, parking pass FAQ, host booking questions, restaurant listing help, event coordinator support"
        canonicalUrl="https://www.mealscout.us/faq"
        schemaData={schemaData}
      />
      
      <BackHeader
        title="Frequently Asked Questions"
        fallbackHref="/"
        icon={HelpCircle}
        className="bg-[var(--bg-surface)]/95 backdrop-blur-sm border-b border-[var(--border-subtle)]/50 shadow-clean"
      />

      <div className="px-4 py-8 max-w-4xl mx-auto">
        {/* Intro Section */}
        <div className="text-center mb-12">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 rounded-3xl mb-8 flex items-center justify-center mx-auto shadow-clean-lg">
            <HelpCircle className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-[color:var(--text-primary)] mb-6">How Can We Help You?</h1>
          <p className="text-xl text-[color:var(--text-muted)] leading-relaxed max-w-2xl mx-auto">
            Clear, role-based answers so you can move fast and stay in control locally.
          </p>
        </div>

        {/* FAQ Sections */}
        {faqs.map((section, sectionIndex) => (
          <Card key={sectionIndex} className="mb-8 bg-[var(--bg-surface)]/90 backdrop-blur-sm shadow-clean-lg">
            <CardHeader>
              <CardTitle className="text-2xl font-bold text-[color:var(--text-primary)] flex items-center gap-3">
                {section.category === "Getting Started" && <Clock className="w-6 h-6 text-[color:var(--accent-text)]" />}
                {section.category === "Food Trucks" && <Truck className="w-6 h-6 text-orange-600" />}
                {section.category === "Hosts" && <Building2 className="w-6 h-6 text-emerald-600" />}
                {section.category === "Restaurants & Bars" && <Shield className="w-6 h-6 text-purple-600" />}
                {section.category === "Events" && <CalendarDays className="w-6 h-6 text-indigo-600" />}
                {section.category === "Accounts & Affiliates" && <Users className="w-6 h-6 text-pink-600" />}
                {section.category === "Troubleshooting" && <HelpCircle className="w-6 h-6 text-[color:var(--text-muted)]" />}
                {section.category}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                {section.questions.map((faq, faqIndex) => (
                  <AccordionItem key={faqIndex} value={`${sectionIndex}-${faqIndex}`}>
                    <AccordionTrigger className="text-left font-semibold text-[color:var(--text-primary)] hover:text-[color:var(--accent-text)]">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-[color:var(--text-muted)] leading-relaxed">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        ))}

        {/* Contact Section */}
        <div className="bg-gradient-to-r from-blue-500 to-purple-500 rounded-3xl p-8 lg:p-12 text-white text-center">
          <h2 className="text-3xl font-bold mb-6">Still Need Help?</h2>
          <p className="text-xl opacity-90 mb-8 max-w-2xl mx-auto">
            Can’t find the answer you need? Email us and include the page you were on.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/contact">
              <Button size="lg" className="bg-[var(--bg-surface)] text-[color:var(--accent-text)] hover:bg-[var(--bg-subtle)] font-semibold px-8 py-3">
                <Mail className="w-4 h-4 mr-2" />
                Contact Support
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}


