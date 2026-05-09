import { Link } from "wouter";
import {
  CalendarDays,
  ChefHat,
  MapPin,
  Store,
  Truck,
  User,
  Warehouse,
} from "lucide-react";
import { SEOHead } from "@/components/seo-head";

const roles = [
  {
    title: "Diner",
    description: "Find trucks, restaurants, deals, and local food moments.",
    href: "/customer-signup",
    icon: User,
  },
  {
    title: "Food Truck",
    description: "Claim or create your truck profile and start showing up locally.",
    href: "/restaurant-signup?businessType=food_truck&claim=1",
    icon: Truck,
  },
  {
    title: "Chef / Restaurant",
    description: "Build your local profile, menus, deals, and customer presence.",
    href: "/restaurant-signup",
    icon: ChefHat,
  },
  {
    title: "Host",
    description: "Offer places where food trucks can park, serve, and build routes.",
    href: "/host-signup",
    icon: MapPin,
  },
  {
    title: "Event Organizer",
    description: "Post events and open calls for local food trucks.",
    href: "/event-signup",
    icon: CalendarDays,
  },
  {
    title: "Supplier",
    description: "Sell products and supplies to restaurants and food trucks.",
    href: "/customer-signup?role=supplier",
    icon: Warehouse,
  },
];

export default function SignupRole() {
  return (
    <main className="min-h-[100dvh] bg-[#08090b] px-5 py-8 text-white">
      <SEOHead
        title="Choose your MealScout role"
        description="Choose how you want to use MealScout as a diner, food truck, chef, restaurant, host, event organizer, or supplier."
      />

      <section className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-xl flex-col justify-center">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 self-start text-sm font-bold text-white/65 hover:text-white"
        >
          <span aria-hidden="true">←</span>
          Back
        </Link>

        <div className="mb-7 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-400 text-black shadow-[0_0_28px_rgba(245,158,11,0.32)]">
            <Store className="h-7 w-7" aria-hidden="true" />
          </div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-amber-300/80">
            MealScout signup
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">
            Choose your role
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm font-semibold leading-6 text-white/58">
            Pick the path that fits how you show up in the local food scene.
          </p>
        </div>

        <div className="grid gap-3">
          {roles.map((role) => {
            const Icon = role.icon;
            return (
              <Link
                key={role.title}
                href={role.href}
                className="group flex items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4 text-left shadow-[0_18px_60px_rgba(0,0,0,0.22)] transition hover:border-amber-300/45 hover:bg-amber-300/[0.08]"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-black/35 text-amber-300 ring-1 ring-white/10 group-hover:bg-amber-300 group-hover:text-black">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-black">{role.title}</span>
                  <span className="mt-1 block text-sm font-medium leading-5 text-white/55">
                    {role.description}
                  </span>
                </span>
                <span className="text-2xl text-amber-300" aria-hidden="true">
                  ›
                </span>
              </Link>
            );
          })}
        </div>

        <p className="mt-6 text-center text-sm font-medium text-white/45">
          Already have an account?{" "}
          <Link href="/login" className="font-black text-amber-300">
            Log in
          </Link>
        </p>
      </section>
    </main>
  );
}
