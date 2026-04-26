import { Link, useLocation } from "wouter";
import { Shield, Users, Store, DollarSign, AlertTriangle, Settings } from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useAdminInlineCopy } from "@/components/admin-inline-copy";

const getEntityContext = (path: string) => {
  const segments = path.split("/").filter(Boolean);
  const [root, id] = segments;

  if (root === "restaurant" && id) {
    return { label: "Restaurant Page", id };
  }
  if (root === "deal" && id) {
    return { label: "Deal Page", id };
  }
  if (root === "p" && segments[1] && segments[2]) {
    return { label: `Public ${segments[1]} Profile`, id: segments[2] };
  }

  return null;
};

const getPageControlTarget = (path: string) => {
  const segments = path.split("/").filter(Boolean);
  const [root, second, third] = segments;

  if (root === "deal" && second) {
    return {
      href: `/deal-edit/${encodeURIComponent(second)}`,
      label: "Deal Settings",
    };
  }

  if (root === "restaurant" && second) {
    return {
      href: `/admin/dashboard?tab=restaurants&q=${encodeURIComponent(second)}`,
      label: "Restaurant Settings",
    };
  }

  if (root === "p" && second === "restaurant" && third) {
    return {
      href: `/admin/dashboard?tab=restaurants&q=${encodeURIComponent(third)}`,
      label: "Restaurant Settings",
    };
  }

  if (root === "location" && second) {
    return {
      href: `/admin/dashboard?tab=host-locations&q=${encodeURIComponent(second)}`,
      label: "Location Settings",
    };
  }

  if (root === "p" && second === "host" && third) {
    return {
      href: `/admin/dashboard?tab=host-locations&q=${encodeURIComponent(third)}`,
      label: "Host Settings",
    };
  }

  if (root === "video" && second) {
    return {
      href: "/admin/moderation/videos",
      label: "Video Moderation",
    };
  }

  if (root === "event" && second) {
    return {
      href: "/admin/events",
      label: "Event Settings",
    };
  }

  return {
    href: "/admin/dashboard?tab=overview",
    label: "Page Settings",
  };
};

export default function AdminQuickHeader() {
  const [location] = useLocation();
  const { user, authState } = useAuth();
  const { isEditMode, setIsEditMode } = useAdminInlineCopy();

  if (authState !== "authenticated") return null;

  const userType = String(user?.userType || "").toLowerCase();
  const canSeeAdminHeader =
    userType === "admin" || userType === "super_admin" || userType === "staff";

  if (!canSeeAdminHeader) return null;

  const pathOnly = location.split("?")[0] || "/";
  const context = getEntityContext(pathOnly);
  const pageControl = getPageControlTarget(pathOnly);
  const isAdminSurface = pathOnly.startsWith("/admin");

  return (
    <div className="sticky top-0 z-[70] border-b border-[color:var(--border-subtle)] bg-amber-50/95 backdrop-blur supports-[backdrop-filter]:bg-amber-50/80">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2">
        <div className="hidden items-center gap-2 text-xs font-semibold text-amber-900 sm:flex">
          <Shield className="h-4 w-4" />
          <span>Admin Quick Controls</span>
          {context ? (
            <span className="rounded-full border border-amber-200 bg-white/80 px-2 py-0.5 text-[11px] text-amber-900">
              {context.label}
            </span>
          ) : null}
        </div>

        <div className="flex w-full items-center gap-2 overflow-x-auto whitespace-nowrap">
          <Link href="/admin/dashboard?tab=overview">
            <a className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100">
              <Settings className="h-3.5 w-3.5" />
              Dashboard
            </a>
          </Link>
          <Link href="/admin/dashboard?tab=users">
            <a className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100">
              <Users className="h-3.5 w-3.5" />
              Users
            </a>
          </Link>
          <Link href="/admin/dashboard?tab=restaurants">
            <a className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100">
              <Store className="h-3.5 w-3.5" />
              Restaurants
            </a>
          </Link>
          <Link href="/admin/dashboard?tab=deals">
            <a className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100">
              <DollarSign className="h-3.5 w-3.5" />
              Deals
            </a>
          </Link>
          <Link href="/admin/moderation/queue">
            <a className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100">
              <AlertTriangle className="h-3.5 w-3.5" />
              Moderation
            </a>
          </Link>

          <Link href={pageControl.href}>
            <a className="inline-flex items-center gap-1 rounded-md border border-amber-500 bg-amber-100 px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-200">
              {pageControl.label}
            </a>
          </Link>

          <button
            type="button"
            onClick={() => setIsEditMode(!isEditMode)}
            className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold ${
              isEditMode
                ? "border-emerald-500 bg-emerald-100 text-emerald-900"
                : "border-amber-400 bg-amber-100 text-amber-900"
            }`}
            title="Toggle inline copy edit mode"
          >
            Inline Edit: {isEditMode ? "On" : "Off"}
          </button>

          {!isAdminSurface && context?.id ? (
            <Link href={`/admin/dashboard?tab=users&q=${encodeURIComponent(context.id)}`}>
              <a className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-amber-100 px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-200">
                Open Context in Users
              </a>
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
