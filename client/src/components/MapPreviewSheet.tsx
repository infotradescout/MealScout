import React, { useState, useRef, useCallback } from "react";
import { MapPin, ChevronDown, X, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MapPreviewSheetProps {
  location: { lat: number; lng: number } | null;
  liveTrucks: any[];
}

export const MapPreviewSheet: React.FC<MapPreviewSheetProps> = ({
  location,
  liveTrucks,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const dragStartY = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (dragStartY.current === null) return;
      const delta = e.changedTouches[0].clientY - dragStartY.current;
      dragStartY.current = null;
      if (delta > 60 && !isExpanded) {
        setIsExpanded(true);
      } else if (delta < -60 && isExpanded) {
        setIsExpanded(false);
      }
    },
    [isExpanded],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragStartY.current = e.clientY;
  }, []);

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (dragStartY.current === null) return;
      const delta = e.clientY - dragStartY.current;
      dragStartY.current = null;
      if (delta > 60 && !isExpanded) {
        setIsExpanded(true);
      } else if (delta < -60 && isExpanded) {
        setIsExpanded(false);
      }
    },
    [isExpanded],
  );

  return (
    <div
      ref={containerRef}
      style={{
        height: isExpanded ? "100dvh" : "25vh",
        transition: "height 0.45s cubic-bezier(0.32, 0.72, 0, 1)",
        position: isExpanded ? "fixed" : "relative",
        inset: isExpanded ? "0" : undefined,
        zIndex: isExpanded ? 50 : 40,
      }}
      className="w-full overflow-hidden bg-[#0a0a0a] border-b border-white/5"
    >
      {/* Map Background */}
      <div
        className="absolute inset-0 bg-cover bg-center grayscale contrast-125 opacity-40 mix-blend-luminosity"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1524661135-423995f22d0b?q=80&w=2070&auto=format&fit=crop')",
        }}
      />

      {/* Dark Overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80" />

      {/* Live Pins */}
      <div className="absolute inset-0 pointer-events-none">
        {location && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="relative">
              <div className="absolute inset-0 animate-ping rounded-full bg-primary/20 scale-150" />
              <div className="relative p-2 rounded-full bg-primary shadow-[0_0_20px_rgba(245,158,11,0.6)]">
                <Navigation className="w-4 h-4 text-black fill-current rotate-45" />
              </div>
            </div>
          </div>
        )}
        {liveTrucks.slice(0, 5).map((truck, i) => (
          <div
            key={truck.id}
            className="absolute"
            style={{
              left: `${40 + i * 10}%`,
              top: `${30 + i * 15}%`,
            }}
          >
            <div className="p-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 shadow-xl">
              <MapPin className="w-3 h-3 text-primary" />
            </div>
          </div>
        ))}
      </div>

      {/* Drag Interaction Layer */}
      <div
        className="absolute inset-0 cursor-grab active:cursor-grabbing select-none"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        {/* Collapsed state: headline + pull indicator */}
        {!isExpanded && (
          <>
            <div className="absolute top-6 left-6 pointer-events-none">
              <h1 className="text-2xl font-serif font-bold text-white tracking-tight">
                Follow The Flavor.
              </h1>
              <p className="text-primary text-[10px] font-medium uppercase tracking-[0.2em] mt-1">
                Discover what's live now
              </p>
            </div>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 opacity-60">
              <div className="w-12 h-1.5 rounded-full bg-white/20" />
              <ChevronDown className="w-4 h-4 text-white animate-bounce" />
            </div>
          </>
        )}

        {/* Expanded state: header + close button */}
        {isExpanded && (
          <div className="absolute top-6 left-6 right-6 flex items-center justify-between pointer-events-auto">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-black/40 backdrop-blur-md border border-white/10">
                <MapPin className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-serif font-bold text-white">
                  Live Signal Map
                </h2>
                <p className="text-primary text-[10px] font-medium uppercase tracking-[0.2em]">
                  Community Powered
                </p>
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setIsExpanded(false)}
              className="rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-white"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
