import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const GOLD = {
  base: "#c58a1a", // warm, slightly desaturated gold
  light: "#e3c26a",
  dark: "#9c6a12",
};

const CRITIC_AMBER = {
  base: "#d97706",
  light: "#fbbf24",
  dark: "#92400e",
};

export const GoldenForkIcon = ({ className = "" }: { className?: string }) => (
  <svg
    viewBox="0 0 64 64"
    role="img"
    aria-hidden="true"
    className={className}
    fill="none"
  >
    <defs>
      <linearGradient id="goldenForkGradient" x1="0" y1="0" x2="0" y2="64">
        <stop offset="0%" stopColor={GOLD.light} />
        <stop offset="55%" stopColor={GOLD.base} />
        <stop offset="100%" stopColor={GOLD.dark} />
      </linearGradient>
    </defs>
    {/* Subtle medallion glow behind the fork */}
    <circle cx="32" cy="32" r="20" fill={GOLD.light} fillOpacity={0.18} />
    {/* Eating fork: three rounded tines and a tapered handle */}
    <g
      stroke="url(#goldenForkGradient)"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Tines */}
      <path d="M24 10v10" />
      <path d="M32 10v10" />
      <path d="M40 10v10" />
      {/* Bridge under tines */}
      <path d="M22 20h20" />
      {/* Neck into handle */}
      <path d="M32 20v11" />
      {/* Gently curved tapered handle */}
      <path d="M28 31c0 6 1 9 1 15 0 3 1.5 6 3 8 1.5-2 3-5 3-8 0-6 1-9 1-15" />
    </g>
  </svg>
);

export const GoldenPlateIcon = ({ className = "" }: { className?: string }) => (
  <svg
    viewBox="0 0 64 64"
    role="img"
    aria-hidden="true"
    className={className}
    fill="none"
  >
    <circle cx="32" cy="32" r="26" fill={GOLD.dark} />
    <circle cx="32" cy="32" r="22" fill={GOLD.base} />
    <circle
      cx="32"
      cy="32"
      r="16"
      fill={GOLD.base}
      stroke={GOLD.light}
      strokeWidth={2}
    />
  </svg>
);

interface GoldenForkBadgeProps {
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  influenceScore?: number;
}

export function GoldenForkBadge({
  size = "md",
  showLabel = false,
  influenceScore,
}: GoldenForkBadgeProps) {
  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-6 w-6",
  };

  const badge = (
    <div className="inline-flex items-center gap-1 text-yellow-800">
      <GoldenForkIcon className={sizeClasses[size]} />
      {showLabel && (
        <span className="text-sm font-semibold" style={{ color: GOLD.base }}>
          Golden Fork
        </span>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            <p className="font-bold" style={{ color: GOLD.base }}>
              Golden Fork Food Reviewer
            </p>
            <p className="text-xs text-[color:var(--text-muted)]">
              Awarded to influential food reviewers
            </p>
            {influenceScore !== undefined && (
              <p className="text-xs text-[color:var(--text-muted)] mt-1">
                Influence Score: {influenceScore}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface CriticBadgeProps {
  size?: "sm" | "md";
  showLabel?: boolean;
}

export function CriticBadge({
  size = "sm",
  showLabel = true,
}: CriticBadgeProps) {
  const badge = (
    <span
      className={`inline-flex items-center rounded-full border font-semibold ${
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"
      }`}
      style={{
        borderColor: "rgba(217,119,6,0.35)",
        backgroundColor: "rgba(251,191,36,0.16)",
        color: CRITIC_AMBER.dark,
      }}
    >
      {showLabel ? "Critic" : "C"}
    </span>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            <p className="font-bold" style={{ color: CRITIC_AMBER.base }}>
              MealScout Critic
            </p>
            <p className="text-xs text-[color:var(--text-muted)]">
              Trusted local reviewer with a curated truck queue.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface GoldenPlateBadgeProps {
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  count?: number;
  year?: string;
}

export function GoldenPlateBadge({
  size = "md",
  showLabel = false,
  count,
  year,
}: GoldenPlateBadgeProps) {
  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-6 w-6",
  };

  const badge = (
    <div className="inline-flex items-center gap-1 text-yellow-800">
      <GoldenPlateIcon className={sizeClasses[size]} />
      {showLabel && (
        <span className="text-sm font-semibold" style={{ color: GOLD.dark }}>
          Golden Plate{count && count > 1 ? ` x${count}` : ""}
        </span>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            <p className="font-bold" style={{ color: GOLD.dark }}>
              Golden Plate Winner
            </p>
            <p className="text-xs text-[color:var(--text-muted)]">
              Earned by restaurants through community consensus
            </p>
            {year && <p className="text-xs text-[color:var(--text-muted)] mt-1">Year: {year}</p>}
            {count && count > 1 && (
              <p className="text-xs text-[color:var(--text-muted)] mt-1">{count}x Champion</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

