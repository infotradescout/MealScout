import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Crown,
  Expand,
  Gift,
  Loader2,
  RotateCcw,
  Shuffle,
  Sparkles,
  Upload,
  Volume2,
  VolumeX,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

type WheelEntry = {
  id: string;
  label: string;
};

type Segment = WheelEntry & {
  path: string;
  color: string;
  centerAngle: number;
  text: string;
  labelX: number;
  labelY: number;
  textLength: number;
};

const wheelColors = [
  "#f59e0b",
  "#14b8a6",
  "#ef4444",
  "#2563eb",
  "#f97316",
  "#22c55e",
  "#a855f7",
  "#eab308",
  "#0ea5e9",
  "#fb7185",
];

const fallbackEntries = [
  "Food Truck Fan 01",
  "Food Truck Fan 02",
  "Food Truck Fan 03",
  "Food Truck Fan 04",
  "Food Truck Fan 05",
  "Food Truck Fan 06",
  "Food Truck Fan 07",
  "Food Truck Fan 08",
];

const storageKey = "mealscout-giveaway-wheel-v1";

const normalizeEntry = (value: string) =>
  value
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

const parseCsvRows = (value: string) => {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    const next = value[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
};

const parseEntries = (value: string): WheelEntry[] => {
  const rows = parseCsvRows(value);
  const labels =
    rows.length === 1 && rows[0].length > 1
      ? rows[0]
      : rows.map((row) => row.find((cell) => normalizeEntry(cell)) || "");

  const seen = new Set<string>();
  return labels
    .map((label) => normalizeEntry(label))
    .filter((label) => {
      const key = label.toLowerCase();
      if (!label || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 120)
    .map((label, index) => ({
      id: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}`,
      label,
    }));
};

const fallbackWheelEntries = parseEntries(fallbackEntries.join("\n"));

const truncateLabel = (label: string, max = 18) =>
  label.length > max
    ? `${label.slice(0, Math.max(1, max - 3))}...`
    : label;

const polarPoint = (angle: number, radius = 47) => {
  const radians = (angle * Math.PI) / 180;
  return {
    x: 50 + radius * Math.cos(radians),
    y: 50 + radius * Math.sin(radians),
  };
};

const segmentPath = (startAngle: number, endAngle: number) => {
  const start = polarPoint(startAngle);
  const end = polarPoint(endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M 50 50 L ${start.x.toFixed(3)} ${start.y.toFixed(3)} A 47 47 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`;
};

const randomIndex = (length: number) => {
  if (length <= 1) return 0;
  const browserCrypto = globalThis.crypto;
  if (!browserCrypto?.getRandomValues) {
    return Math.floor(Math.random() * length);
  }
  const buffer = new Uint32Array(1);
  browserCrypto.getRandomValues(buffer);
  return buffer[0] % length;
};

const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

function createSoundDeck() {
  let context: AudioContext | null = null;

  const getContext = () => {
    if (!context) {
      const AudioContextClass =
        window.AudioContext || (window as any).webkitAudioContext;
      context = new AudioContextClass();
    }
    if (context.state === "suspended") void context.resume();
    return context;
  };

  const tone = (
    frequency: number,
    duration: number,
    options: {
      type?: OscillatorType;
      gain?: number;
      when?: number;
      slideTo?: number;
    } = {},
  ) => {
    const audio = getContext();
    const now = options.when ?? audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = options.type || "sine";
    osc.frequency.setValueAtTime(frequency, now);
    if (options.slideTo) {
      osc.frequency.exponentialRampToValueAtTime(options.slideTo, now + duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(options.gain ?? 0.08, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  };

  return {
    arm() {
      getContext();
    },
    tick() {
      tone(980, 0.035, { type: "square", gain: 0.035, slideTo: 620 });
    },
    spinStart() {
      const audio = getContext();
      [220, 330, 440, 660].forEach((freq, index) => {
        tone(freq, 0.11, {
          type: "triangle",
          gain: 0.07,
          when: audio.currentTime + index * 0.045,
        });
      });
    },
    win() {
      const audio = getContext();
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
        tone(freq, 0.22, {
          type: "triangle",
          gain: 0.09,
          when: audio.currentTime + index * 0.12,
        });
      });
      tone(130.81, 0.55, {
        type: "sawtooth",
        gain: 0.035,
        when: audio.currentTime + 0.02,
        slideTo: 196,
      });
    },
  };
}

const soundDeck = typeof window !== "undefined" ? createSoundDeck() : null;

export default function AdminGiveawayWheel() {
  const [title, setTitle] = useState("MealScout Giveaway");
  const [rawList, setRawList] = useState(fallbackEntries.join("\n"));
  const [rotation, setRotation] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);
  const [winner, setWinner] = useState<WheelEntry | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [recordMode, setRecordMode] = useState(false);
  const [showFinale, setShowFinale] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const spinFrameRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(-1);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (typeof parsed.title === "string") setTitle(parsed.title);
      if (typeof parsed.rawList === "string") setRawList(parsed.rawList);
      if (typeof parsed.soundOn === "boolean") setSoundOn(parsed.soundOn);
    } catch {
      // Ignore older local drafts.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ title, rawList, soundOn }),
    );
  }, [rawList, soundOn, title]);

  useEffect(() => {
    return () => {
      if (spinFrameRef.current) cancelAnimationFrame(spinFrameRef.current);
    };
  }, []);

  const entries = useMemo(() => parseEntries(rawList), [rawList]);
  const displayEntries = entries.length ? entries : fallbackWheelEntries;
  const angle = 360 / displayEntries.length;
  const labelMaxLength =
    displayEntries.length <= 8
      ? 18
      : displayEntries.length <= 16
        ? 14
        : displayEntries.length <= 36
          ? 10
          : 7;
  const labelRadius =
    displayEntries.length <= 10 ? 28 : displayEntries.length <= 36 ? 32 : 35;
  const labelFontSize =
    displayEntries.length <= 8
      ? 3.55
      : displayEntries.length <= 16
        ? 2.7
        : displayEntries.length <= 36
          ? 1.95
          : 1.35;
  const labelTextLength = Math.max(
    displayEntries.length <= 16 ? 7 : 4.2,
    Math.min(
      displayEntries.length <= 8 ? 22 : displayEntries.length <= 36 ? 13 : 8,
      ((2 * Math.PI * labelRadius * angle) / 360) * 0.76,
    ),
  );
  const winnerNumber = winner
    ? displayEntries.findIndex((entry) => entry.id === winner.id) + 1
    : null;

  const segments = useMemo<Segment[]>(() => {
    return displayEntries.map((entry, index) => {
      const start = -90 + index * angle;
      const end = start + angle;
      const centerAngle = start + angle / 2;
      const labelPoint = polarPoint(centerAngle, labelRadius);
      const text = truncateLabel(entry.label, labelMaxLength);
      const estimatedTextLength = text.length * labelFontSize * 0.58;
      return {
        ...entry,
        path: segmentPath(start, end),
        color: wheelColors[index % wheelColors.length],
        centerAngle,
        text,
        labelX: labelPoint.x,
        labelY: labelPoint.y,
        textLength: Math.max(labelFontSize * 1.4, Math.min(labelTextLength, estimatedTextLength)),
      };
    });
  }, [
    angle,
    displayEntries,
    labelFontSize,
    labelMaxLength,
    labelRadius,
    labelTextLength,
  ]);

  const bulbs = useMemo(
    () =>
      Array.from({ length: 36 }, (_, index) => {
        const point = polarPoint(-90 + index * 10, 49);
        return { ...point, index };
      }),
    [],
  );

  const spin = () => {
    if (isSpinning || displayEntries.length < 2) return;
    soundDeck?.arm();

    const selectedIndex = randomIndex(displayEntries.length);
    const startRotation = rotation;
    const current = ((startRotation % 360) + 360) % 360;
    const targetNormalized =
      ((-(selectedIndex + 0.5) * angle) % 360 + 360) % 360;
    const delta = (targetNormalized - current + 360) % 360;
    const targetRotation = startRotation + 360 * (7 + randomIndex(4)) + delta;
    const duration = 5600 + randomIndex(900);
    const started = performance.now();

    setWinner(null);
    setShowFinale(false);
    setIsSpinning(true);
    lastTickRef.current = -1;
    if (soundOn) soundDeck?.spinStart();

    const animate = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - started) / duration);
      const eased = easeOutQuart(progress);
      const nextRotation =
        startRotation + (targetRotation - startRotation) * eased;
      setRotation(nextRotation);

      const pointerIndex =
        Math.floor(
          (((-(nextRotation % 360) + 360) % 360) / angle + displayEntries.length) %
            displayEntries.length,
        ) % displayEntries.length;
      if (pointerIndex !== lastTickRef.current) {
        lastTickRef.current = pointerIndex;
        if (soundOn) soundDeck?.tick();
      }

      if (progress < 1) {
        spinFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      setRotation(targetRotation);
      setWinner(displayEntries[selectedIndex]);
      setIsSpinning(false);
      setShowFinale(true);
      if (soundOn) soundDeck?.win();
      window.setTimeout(() => setShowFinale(false), 5200);
    };

    spinFrameRef.current = requestAnimationFrame(animate);
  };

  const shuffleEntries = () => {
    const next = [...displayEntries];
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = randomIndex(i + 1);
      [next[i], next[j]] = [next[j], next[i]];
    }
    setRawList(next.map((entry) => entry.label).join("\n"));
    setWinner(null);
  };

  const resetWheel = () => {
    setRotation(0);
    setWinner(null);
    setShowFinale(false);
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setRawList(text);
    setWinner(null);
    resetWheel();
  };

  const requestFullscreen = () => {
    const root = document.documentElement;
    if (!document.fullscreenElement) {
      void root.requestFullscreen?.();
      return;
    }
    void document.exitFullscreen?.();
  };

  const wheelStyle = {
    transform: `rotate(${rotation}deg)`,
  } satisfies CSSProperties;

  return (
    <div className="ms-giveaway min-h-screen bg-[#0b0a09] text-white">
      <div className="ms-giveaway-bg" />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[430px] flex-col overflow-hidden">
        {!recordMode ? (
          <header className="flex items-center justify-between gap-2 px-4 py-3">
            <Button asChild variant="ghost" className="h-10 px-2 text-white hover:bg-white/10">
              <Link href="/admin/dashboard">
                <ArrowLeft className="h-4 w-4" />
                Admin
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10"
                onClick={() => setSoundOn((value) => !value)}
                aria-label={soundOn ? "Mute sounds" : "Enable sounds"}
              >
                {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/10"
                onClick={requestFullscreen}
                aria-label="Fullscreen"
              >
                <Expand className="h-4 w-4" />
              </Button>
            </div>
          </header>
        ) : null}

        <main className="flex flex-1 flex-col px-4 pb-5">
          <section className="relative flex min-h-[58vh] flex-1 flex-col items-center justify-center py-4">
            <div className="mb-4 text-center">
              <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full border border-amber-300/60 bg-black/45 shadow-[0_0_24px_rgba(245,158,11,0.35)]">
                <img src="/brand/logo-mark-512.png" alt="" className="h-7 w-7" />
              </div>
              <h1 className="text-3xl font-black tracking-normal text-white drop-shadow sm:text-4xl">
                {title || "MealScout Giveaway"}
              </h1>
              <div className="mt-2 flex justify-center">
                <Badge className="border-amber-300/60 bg-amber-400 text-black">
                  {displayEntries.length} entries
                </Badge>
              </div>
            </div>

            <div className="relative w-full max-w-[360px]">
              <div className="ms-giveaway-marquee" aria-hidden="true">
                {bulbs.map((bulb) => (
                  <span
                    key={bulb.index}
                    className="ms-giveaway-bulb"
                    style={
                      {
                        left: `${bulb.x}%`,
                        top: `${bulb.y}%`,
                        animationDelay: `${(bulb.index % 6) * 0.08}s`,
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
              <div className="ms-giveaway-pointer" aria-hidden="true" />
              <div className="ms-giveaway-wheel-shell">
                <svg
                  viewBox="0 0 100 100"
                  className="ms-giveaway-wheel"
                  style={wheelStyle}
                  role="img"
                  aria-label="Giveaway wheel"
                >
                  <defs>
                    <filter id="ms-wheel-shadow" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="2" stdDeviation="1.4" floodOpacity="0.32" />
                    </filter>
                    {segments.map((segment, index) => (
                      <clipPath key={segment.id} id={`ms-giveaway-label-clip-${index}`}>
                        <path d={segment.path} />
                      </clipPath>
                    ))}
                  </defs>
                  <g filter="url(#ms-wheel-shadow)">
                    {segments.map((segment, index) => (
                      <g key={segment.id}>
                        <path
                          d={segment.path}
                          fill={segment.color}
                          stroke="rgba(0,0,0,0.28)"
                          strokeWidth="0.35"
                        />
                        {segment.text ? (
                          <text
                            x={segment.labelX}
                            y={segment.labelY}
                            clipPath={`url(#ms-giveaway-label-clip-${index})`}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize={labelFontSize}
                            fontWeight="900"
                            textLength={segment.textLength}
                            lengthAdjust="spacingAndGlyphs"
                            fill={index % 3 === 1 ? "#061412" : "#0b0a09"}
                            style={{
                              paintOrder: "stroke",
                              stroke: "rgba(255,255,255,0.58)",
                              strokeWidth: displayEntries.length <= 16 ? 0.64 : 0.42,
                            }}
                          >
                            {segment.text}
                          </text>
                        ) : null}
                      </g>
                    ))}
                  </g>
                  <circle cx="50" cy="50" r="10.5" fill="#0b0a09" stroke="#f59e0b" strokeWidth="1.4" />
                  <circle cx="50" cy="50" r="6.2" fill="#f59e0b" />
                  <text
                    x="50"
                    y="52"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize="5"
                    fontWeight="900"
                    fill="#0b0a09"
                  >
                    MS
                  </text>
                </svg>
              </div>
            </div>

            <div className="mt-5 min-h-[88px] w-full">
              {winner ? (
                <div className="ms-giveaway-winner">
                  <Crown className="h-5 w-5 text-amber-300" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase text-amber-200">
                      Winner{winnerNumber ? ` #${winnerNumber}` : ""}
                    </div>
                    <div className="truncate text-2xl font-black text-white">
                      {winner.label}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="ms-giveaway-ready">
                  <Sparkles className="h-5 w-5 text-amber-300" />
                  <span>{isSpinning ? "Spinning" : "Ready"}</span>
                </div>
              )}
            </div>

            {showFinale ? (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                {Array.from({ length: 32 }, (_, index) => (
                  <span
                    key={index}
                    className="ms-giveaway-confetti"
                    style={
                      {
                        left: `${6 + randomIndex(88)}%`,
                        animationDelay: `${index * 0.035}s`,
                        background: wheelColors[index % wheelColors.length],
                      } as CSSProperties
                    }
                  />
                ))}
              </div>
            ) : null}
          </section>

          {!recordMode ? (
            <section className="space-y-3 rounded-lg border border-white/12 bg-black/55 p-3 shadow-2xl backdrop-blur">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="border-white/15 bg-white/10 text-white placeholder:text-white/55"
                  placeholder="Giveaway title"
                />
                <div className="flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3">
                  <span className="text-xs font-semibold text-white/80">Record</span>
                  <Switch checked={recordMode} onCheckedChange={setRecordMode} />
                </div>
              </div>

              <Textarea
                value={rawList}
                onChange={(event) => {
                  setRawList(event.target.value);
                  setWinner(null);
                }}
                className="min-h-[120px] resize-none border-white/15 bg-white/10 text-sm text-white placeholder:text-white/55"
                placeholder={"Name one\nName two\nName three"}
              />

              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.csv,text/plain,text/csv"
                className="hidden"
                onChange={(event) => {
                  void loadFile(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />

              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-white/20 bg-white/10 text-white hover:bg-white/20"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4" />
                  Upload
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-white/20 bg-white/10 text-white hover:bg-white/20"
                  onClick={shuffleEntries}
                  disabled={isSpinning}
                >
                  <Shuffle className="h-4 w-4" />
                  Shuffle
                </Button>
              </div>
            </section>
          ) : (
            <button
              type="button"
              className="mx-auto mb-3 rounded-full border border-white/15 bg-black/30 px-4 py-2 text-xs font-semibold text-white/80"
              onClick={() => setRecordMode(false)}
            >
              Exit record mode
            </button>
          )}

          <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-white/10 bg-black/80 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Button
                type="button"
                size="lg"
                className="h-14 bg-amber-400 text-base font-black text-black hover:bg-amber-300"
                onClick={spin}
                disabled={isSpinning || displayEntries.length < 2}
              >
                {isSpinning ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Gift className="h-5 w-5" />
                )}
                Spin
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-14 w-14 border-white/20 bg-white/10 text-white hover:bg-white/20"
                onClick={resetWheel}
                disabled={isSpinning}
                aria-label="Reset wheel"
              >
                <RotateCcw className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
