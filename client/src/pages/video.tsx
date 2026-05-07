import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import Navigation from "@/components/navigation";
import { VideoFeed } from "@/components/video-feed";
import { VideoUploadModal } from "@/components/video-upload-modal";
import { SEOHead } from "@/components/seo-head";
import { BackHeader } from "@/components/back-header";

export default function VideoPage() {
  const { authState, isAuthenticated, isGuest } = useAuth();
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const handleUploadClick = () => {
    if (isGuest) {
      // Align with Saved Deals behavior: send guests to login
      window.location.href = "/login";
      return;
    }
    setIsUploadOpen(true);
  };

  return (
    <div className="max-w-md mx-auto bg-background min-h-screen relative pb-20">
      <SEOHead
        title="Video Stories - MealScout | Local Food Videos"
        description="Watch and share local food recommendation videos from the MealScout community."
        canonicalUrl="https://www.mealscout.us/video"
      />

      <BackHeader title="Video" fallbackHref="/" />
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-[var(--border-subtle)] px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Video</h1>
        {isAuthenticated && (
          <button
            onClick={handleUploadClick}
            className="px-3 py-1.5 rounded-full text-sm font-medium bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-clean hover:from-orange-600 hover:to-red-600 transition"
          >
            Upload
          </button>
        )}
      </header>

      {/* Guest upload CTA */}
      {authState !== "loading" && isGuest && (
        <div className="px-4 py-3 bg-muted text-xs text-center text-muted-foreground border-b border-border">
          <span>Sign in to upload your own food recommendations.</span>{" "}
          <Link href="/login" className="underline font-medium">
            Sign in
          </Link>
        </div>
      )}

      {/* Feed */}
      <main className="px-0 pt-2 pb-4">
        <VideoFeed onUploadClick={handleUploadClick} />
      </main>

      {/* Upload modal (auth-only) */}
      {isAuthenticated && (
        <VideoUploadModal
          isOpen={isUploadOpen}
          onClose={() => setIsUploadOpen(false)}
        />
      )}

      <Navigation />
    </div>
  );
}



