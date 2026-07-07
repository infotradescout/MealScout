import { type ReactNode, useEffect, useState } from "react";
import type { DishCategoryPhoto } from "@/lib/dishCategoryPhoto";

type PublicProfileHeroAssetInput = {
  entity?: string | null;
  displayName?: string | null;
  spotImageUrl?: string | null;
  coverImageUrl?: string | null;
  logoUrl?: string | null;
  profileImageUrl?: string | null;
  truckPhotoLogo?: string | null;
  imageUrl?: string | null;
};

type ProfileHeroMediaProps = {
  displayName: string;
  coverImageUrl?: string | null;
  logoImageUrl?: string | null;
  theme?: "default" | "truck";
  heightClassName?: string;
  badge?: ReactNode;
  categoryPhoto?: DishCategoryPhoto | null;
};

const normalizeAssetUrl = (value: unknown) => {
  const raw = String(value || "").trim();
  return raw || null;
};

const pickFirstAssetUrl = (...values: Array<unknown>) => {
  for (const value of values) {
    const normalized = normalizeAssetUrl(value);
    if (normalized) return normalized;
  }
  return null;
};

const initialsFor = (name: string) =>
  String(name || "MS")
    .split(" ")
    .map((part) => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const buildPublicProfileHeroAssets = (
  profile: PublicProfileHeroAssetInput,
) => {
  const entity = String(profile.entity || "").trim().toLowerCase();
  const coverImageUrl =
    entity === "host" || entity === "location"
      ? pickFirstAssetUrl(profile.spotImageUrl, profile.coverImageUrl, profile.imageUrl)
      : entity === "supplier"
        ? null
        : pickFirstAssetUrl(profile.coverImageUrl, profile.imageUrl);
  const logoImageUrl = pickFirstAssetUrl(
    profile.logoUrl,
    profile.profileImageUrl,
    profile.truckPhotoLogo,
  );

  return {
    coverImageUrl,
    logoImageUrl,
    initials: initialsFor(String(profile.displayName || "")),
  };
};

export function ProfileHeroMedia({
  displayName,
  coverImageUrl,
  logoImageUrl,
  theme = "default",
  heightClassName = "h-28 md:h-48",
  badge,
  categoryPhoto = null,
}: ProfileHeroMediaProps) {
  const [coverImageFailed, setCoverImageFailed] = useState(false);
  const [logoImageFailed, setLogoImageFailed] = useState(false);

  useEffect(() => {
    setCoverImageFailed(false);
  }, [coverImageUrl]);

  useEffect(() => {
    setLogoImageFailed(false);
  }, [logoImageUrl]);

  const initials = initialsFor(displayName);
  const showCoverImage = Boolean(coverImageUrl && !coverImageFailed);
  const showLogoImage = Boolean(logoImageUrl && !logoImageFailed);
  const containerClassName =
    theme === "truck"
      ? `relative overflow-hidden ${heightClassName} bg-[radial-gradient(circle_at_18%_22%,rgba(251,146,60,0.34),transparent_32%),linear-gradient(145deg,#24130b_0%,#110d0a_52%,#060504_100%)]`
      : `relative overflow-hidden ${heightClassName} bg-[radial-gradient(circle_at_22%_24%,rgba(255,96,35,0.28),transparent_46%),linear-gradient(145deg,#1d100a_0%,#120d09_48%,#0d0a08_100%)]`;
  const avatarShellClassName =
    theme === "truck"
      ? "flex h-24 w-24 items-center justify-center overflow-hidden rounded-3xl border border-orange-200/40 bg-black/35 shadow-[0_18px_44px_rgba(0,0,0,0.34)]"
      : "flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl border border-orange-300/30 bg-black/35 shadow-[0_16px_34px_rgba(0,0,0,0.3)]";
  const avatarTextClassName =
    theme === "truck"
      ? "text-3xl font-black text-orange-100"
      : "text-2xl font-black text-orange-100";

  return (
    <div className={containerClassName}>
      {showCoverImage ? (
        <img
          src={coverImageUrl || undefined}
          alt={`${displayName} cover`}
          loading="eager"
          decoding="async"
          data-testid="public-profile-hero-cover"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setCoverImageFailed(true)}
        />
      ) : categoryPhoto ? (
        <div
          data-testid="public-profile-hero-cover-category-fallback"
          className="absolute inset-0"
        >
          <img
            src={categoryPhoto.image}
            alt=""
            loading="eager"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
            aria-hidden="true"
          />
          <span className="absolute right-3 top-3 rounded-full bg-black/70 px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] text-white/85 ring-1 ring-white/25 backdrop-blur-sm">
            {categoryPhoto.label} · photo coming soon
          </span>
        </div>
      ) : (
        <div
          data-testid="public-profile-hero-cover-fallback"
          className="absolute inset-0 bg-[radial-gradient(circle_at_72%_20%,rgba(255,255,255,0.09),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.06),transparent_38%)]"
        />
      )}

      <div className="absolute inset-0 bg-gradient-to-b from-black/8 via-black/18 to-black/62" />

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
        <div
          data-testid={showLogoImage ? "public-profile-hero-avatar" : "public-profile-hero-avatar-fallback"}
          className={avatarShellClassName}
        >
          {showLogoImage ? (
            <img
              src={logoImageUrl || undefined}
              alt={`${displayName} logo`}
              loading="eager"
              decoding="async"
              className="h-full w-full object-cover"
              onError={() => setLogoImageFailed(true)}
            />
          ) : (
            <span className={avatarTextClassName}>{initials}</span>
          )}
        </div>

        {badge ? <div className="flex flex-wrap justify-end gap-2">{badge}</div> : null}
      </div>
    </div>
  );
}
