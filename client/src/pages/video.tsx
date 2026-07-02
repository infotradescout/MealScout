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
      window.location.href = "/login";
      return;
    }
    setIsUploadOpen(true);
  };

  return (
    <div className="max-w-md mx-auto bg-background min-h-screen relative pb-24">
      <SEOHead
        title="Video Feed - MealScout"
        description="Community-powered video recommendations for local food."
        canonicalUrl="https://www.mealscout.us/video"
      />

      <header className="sticky top-0 z-50 bg-black/40 backdrop-blur-xl border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex flex-col">
          <h1 className="text-xl font-serif font-bold text-white tracking-tight">Video Feed</h1>
          <p className="text-primary text-[10px] font-bold uppercase tracking-[0.2em]">Community Powered</p>
        </div>
        {isAuthenticated && (
          <button
            onClick={handleUploadClick}
            className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest bg-primary text-black shadow-[0_0_20px_rgba(245,158,11,0.4)] hover:scale-105 transition-all"
          >
            Share
          </button>
        )}
      </header>

      {/* Guest upload CTA - Atmospheric */}
      {authState !== "loading" && isGuest && (
        <div className="mx-6 mt-4 p-4 rounded-2xl bg-white/5 border border-white/10 text-[10px] text-center text-white/40 uppercase tracking-widest font-bold">
          <span>Sign in to share recommendations.</span>{" "}
          <Link href="/login" className="text-primary underline">
            Sign in
          </Link>
        </div>
      )}

      {/* Feed */}
      <main className="px-0 pt-2">
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



