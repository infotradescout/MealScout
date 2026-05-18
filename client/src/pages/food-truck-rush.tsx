import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { CalendarCheck, MapPin, Play, RotateCcw, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";

type GameState = "ready" | "playing" | "finished";
type Lane = 0 | 1 | 2;
type StreakMode = "increment" | "unchanged";
type GameObjectKind =
  | "normal"
  | "vip"
  | "restock"
  | "host"
  | "rush"
  | "roadblock"
  | "permit"
  | "badReview"
  | "soldOut";

type GameObject = {
  id: string;
  kind: GameObjectKind;
  lane: Lane;
  spawnedAt: number;
  expiresAt: number;
};

type GameObjectDefinition = {
  label: string;
  icon: string;
  points?: number;
  penalty?: number;
  missPenalty?: number;
  streak: StreakMode;
  successMessage?: string;
  missedMessage?: string;
  hazard?: boolean;
};

type Rank = {
  name: string;
  copy: string;
};

const GAME_SECONDS = 45;

const lanes = [
  { id: 0, title: "Customers", short: "Left", tone: "bg-emerald-500" },
  { id: 1, title: "Prep / Inventory", short: "Center", tone: "bg-sky-500" },
  { id: 2, title: "Operations / Event", short: "Right", tone: "bg-orange-500" },
] as const satisfies ReadonlyArray<{
  id: Lane;
  title: string;
  short: string;
  tone: string;
}>;

const objectDefinitions: Record<GameObjectKind, GameObjectDefinition> = {
  normal: {
    label: "Normal Customer",
    icon: "🌮",
    points: 10,
    missPenalty: 10,
    streak: "increment",
    successMessage: "Customer signal served",
    missedMessage: "Signal lost",
  },
  vip: {
    label: "VIP Customer",
    icon: "⭐",
    points: 25,
    missPenalty: 10,
    streak: "increment",
    successMessage: "VIP served",
    missedMessage: "Signal lost",
  },
  restock: {
    label: "Restock",
    icon: "📦",
    points: 20,
    streak: "unchanged",
    successMessage: "Restock complete",
    missedMessage: "Restock window closed",
  },
  host: {
    label: "Host Request",
    icon: "📍",
    points: 30,
    missPenalty: 10,
    streak: "increment",
    successMessage: "Host request handled",
    missedMessage: "Host request missed",
  },
  rush: {
    label: "Rush Bonus",
    icon: "🔥",
    points: 40,
    streak: "increment",
    successMessage: "Rush bonus claimed",
    missedMessage: "Rush bonus missed",
  },
  roadblock: {
    label: "Roadblock",
    icon: "🚧",
    penalty: 15,
    streak: "unchanged",
    hazard: true,
  },
  permit: {
    label: "Permit Issue",
    icon: "🧾",
    points: 15,
    missPenalty: 25,
    streak: "unchanged",
    successMessage: "Permit issue resolved",
    missedMessage: "Permit issue ignored",
  },
  badReview: {
    label: "Bad Review",
    icon: "😡",
    penalty: 10,
    streak: "unchanged",
    hazard: true,
  },
  soldOut: {
    label: "Sold Out",
    icon: "❌",
    points: 10,
    missPenalty: 20,
    streak: "unchanged",
    successMessage: "Sold out fixed",
    missedMessage: "Sold out ignored",
  },
};

const ranks: Array<{ min: number; rank: Rank }> = [
  {
    min: 750,
    rank: {
      name: "MealScout Legend",
      copy: "MealScout Legend — elite rush. You owned the event.",
    },
  },
  {
    min: 500,
    rank: {
      name: "Festival Favorite",
      copy: "Festival Favorite — this truck is pulling a crowd.",
    },
  },
  {
    min: 300,
    rank: {
      name: "Rush Ready",
      copy: "Rush Ready — strong run. You can handle a busy event.",
    },
  },
  {
    min: 150,
    rank: {
      name: "Local Favorite",
      copy: "Local Favorite — solid shift. The line is starting to notice.",
    },
  },
  {
    min: 0,
    rank: {
      name: "Rookie Vendor",
      copy: "Rookie Vendor — warm-up run. Try again and build your streak.",
    },
  },
];

const easyWeights: Array<[GameObjectKind, number]> = [
  ["normal", 7],
  ["vip", 1.5],
  ["restock", 2],
  ["host", 1],
  ["rush", 0.8],
  ["roadblock", 0.4],
  ["permit", 0.4],
  ["badReview", 0.2],
  ["soldOut", 0.4],
];

const moderateWeights: Array<[GameObjectKind, number]> = [
  ["normal", 6],
  ["vip", 2],
  ["restock", 2],
  ["host", 1.8],
  ["rush", 1.3],
  ["roadblock", 0.9],
  ["permit", 0.8],
  ["badReview", 0.6],
  ["soldOut", 0.8],
];

const lateWeights: Array<[GameObjectKind, number]> = [
  ["normal", 5],
  ["vip", 2.2],
  ["restock", 1.7],
  ["host", 2.2],
  ["rush", 1.8],
  ["roadblock", 1.4],
  ["permit", 1.2],
  ["badReview", 0.9],
  ["soldOut", 1.2],
];

function getRank(score: number) {
  return (
    ranks.find((entry) => score >= entry.min)?.rank ??
    ranks[ranks.length - 1].rank
  );
}

function clampLane(lane: number): Lane {
  return Math.max(0, Math.min(2, lane)) as Lane;
}

function chooseWeightedKind(weights: Array<[GameObjectKind, number]>) {
  const totalWeight = weights.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * totalWeight;

  for (const [kind, weight] of weights) {
    roll -= weight;
    if (roll <= 0) return kind;
  }

  return weights[0][0];
}

function pickLane(kind: GameObjectKind): Lane {
  const roll = Math.random();

  if (kind === "normal" || kind === "vip")
    return roll < 0.7 ? 0 : clampLane(Math.floor(Math.random() * 3));
  if (kind === "restock" || kind === "soldOut")
    return roll < 0.75 ? 1 : clampLane(Math.floor(Math.random() * 3));
  if (kind === "host" || kind === "permit")
    return roll < 0.75 ? 2 : clampLane(Math.floor(Math.random() * 3));
  return clampLane(Math.floor(Math.random() * 3));
}

function getDifficulty(elapsedSeconds: number) {
  if (elapsedSeconds < 10) {
    return {
      spawnEvery: 1650,
      travelMs: 5200,
      maxActive: 2,
      weights: easyWeights,
    };
  }

  if (elapsedSeconds < 25) {
    return {
      spawnEvery: 1225,
      travelMs: 4550,
      maxActive: 3,
      weights: moderateWeights,
    };
  }

  return {
    spawnEvery: 925,
    travelMs: 3900,
    maxActive: 4,
    weights: lateWeights,
  };
}

function createGameObject(
  elapsedSeconds: number,
  now: number,
  id: number,
): GameObject {
  const difficulty = getDifficulty(elapsedSeconds);
  const kind = chooseWeightedKind(difficulty.weights);
  const travelJitter = Math.floor(Math.random() * 450);

  return {
    id: `${now}-${id}`,
    kind,
    lane: pickLane(kind),
    spawnedAt: now,
    expiresAt: now + difficulty.travelMs + travelJitter,
  };
}

function FoodTruckRush() {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  const [gameState, setGameState] = useState<GameState>("ready");
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_SECONDS);
  const [playerLane, setPlayerLane] = useState<Lane>(1);
  const [activeObjects, setActiveObjects] = useState<GameObject[]>([]);
  const [lastMessage, setLastMessage] = useState("Ready for the rush.");
  const [now, setNow] = useState(() => Date.now());

  const activeObjectsRef = useRef<GameObject[]>([]);
  const startTimeRef = useRef(0);
  const endTimeRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const objectIdRef = useRef(0);
  const playerLaneRef = useRef<Lane>(1);
  const streakRef = useRef(0);

  const rank = useMemo(() => getRank(score), [score]);

  const syncActiveObjects = useCallback((objects: GameObject[]) => {
    activeObjectsRef.current = objects;
    setActiveObjects(objects);
  }, []);

  const changeScore = useCallback((delta: number) => {
    setScore((currentScore) => Math.max(0, currentScore + delta));
  }, []);

  const resetStreak = useCallback(() => {
    streakRef.current = 0;
    setStreak(0);
  }, []);

  const addServedStreak = useCallback(() => {
    const nextStreak = streakRef.current + 1;
    streakRef.current = nextStreak;
    setStreak(nextStreak);
    return nextStreak > 0 && nextStreak % 5 === 0 ? 50 : 0;
  }, []);

  const applyPenalty = useCallback(
    (message: string, penalty: number, shouldResetStreak: boolean) => {
      changeScore(-penalty);
      if (shouldResetStreak) resetStreak();
      setLastMessage(`${message} -${penalty}`);
    },
    [changeScore, resetStreak],
  );

  const handleExpiredObject = useCallback(
    (object: GameObject) => {
      const definition = objectDefinitions[object.kind];

      if (object.kind === "roadblock") {
        if (object.lane === playerLaneRef.current) {
          applyPenalty("Roadblock hit", definition.penalty ?? 15, true);
        } else {
          setLastMessage("Route clear");
        }
        return;
      }

      if (object.kind === "badReview") {
        if (object.lane === playerLaneRef.current) {
          applyPenalty("Bad review", definition.penalty ?? 10, true);
        } else {
          setLastMessage("Bad review avoided");
        }
        return;
      }

      if (definition.missPenalty) {
        applyPenalty(
          definition.missedMessage ?? `${definition.label} missed`,
          definition.missPenalty,
          object.kind !== "permit",
        );
        return;
      }

      setLastMessage(definition.missedMessage ?? `${definition.label} missed`);
    },
    [applyPenalty],
  );

  const handleInteract = useCallback(() => {
    if (gameState !== "playing") return;

    const objectsInLane = activeObjectsRef.current
      .filter((object) => object.lane === playerLaneRef.current)
      .sort((first, second) => first.expiresAt - second.expiresAt);

    if (objectsInLane.length === 0) {
      setLastMessage("Nothing to serve in this lane");
      return;
    }

    const target = objectsInLane[0];
    const definition = objectDefinitions[target.kind];
    syncActiveObjects(
      activeObjectsRef.current.filter((object) => object.id !== target.id),
    );

    if (definition.hazard) {
      applyPenalty(
        target.kind === "roadblock" ? "Roadblock hit" : "Bad review",
        definition.penalty ?? 10,
        true,
      );
      return;
    }

    const points = definition.points ?? 0;
    const bonus = definition.streak === "increment" ? addServedStreak() : 0;
    changeScore(points + bonus);
    setLastMessage(
      `${definition.successMessage ?? `${definition.label} handled`} +${points}${
        bonus ? " | Streak bonus +50" : ""
      }`,
    );
  }, [
    addServedStreak,
    applyPenalty,
    changeScore,
    gameState,
    syncActiveObjects,
  ]);

  const setLane = useCallback((lane: Lane) => {
    playerLaneRef.current = lane;
    setPlayerLane(lane);
  }, []);

  const movePlayer = useCallback(
    (direction: -1 | 1) => {
      setLane(clampLane(playerLaneRef.current + direction));
    },
    [setLane],
  );

  const startGame = useCallback(() => {
    const startTime = Date.now();

    startTimeRef.current = startTime;
    endTimeRef.current = startTime + GAME_SECONDS * 1000;
    lastSpawnRef.current = startTime - 900;
    objectIdRef.current = 0;
    playerLaneRef.current = 1;
    streakRef.current = 0;

    setScore(0);
    setStreak(0);
    setTimeLeft(GAME_SECONDS);
    setPlayerLane(1);
    setNow(startTime);
    setLastMessage("Rush signal live. Serve fast.");
    syncActiveObjects([]);
    setGameState("playing");
  }, [syncActiveObjects]);

  const finishGame = useCallback(() => {
    setGameState("finished");
    setTimeLeft(0);
    setLastMessage("Rush complete.");
    syncActiveObjects([]);
  }, [syncActiveObjects]);

  useEffect(() => {
    if (gameState !== "playing") return;

    const intervalId = window.setInterval(() => {
      const currentTime = Date.now();
      const elapsedSeconds = (currentTime - startTimeRef.current) / 1000;
      const secondsLeft = Math.max(
        0,
        Math.ceil((endTimeRef.current - currentTime) / 1000),
      );

      setNow(currentTime);
      setTimeLeft(secondsLeft);

      if (currentTime >= endTimeRef.current) {
        finishGame();
        return;
      }

      const difficulty = getDifficulty(elapsedSeconds);
      const expiredObjects = activeObjectsRef.current.filter(
        (object) => currentTime >= object.expiresAt,
      );
      let nextObjects = activeObjectsRef.current.filter(
        (object) => currentTime < object.expiresAt,
      );

      expiredObjects.forEach(handleExpiredObject);

      if (
        currentTime - lastSpawnRef.current >= difficulty.spawnEvery &&
        nextObjects.length < difficulty.maxActive
      ) {
        objectIdRef.current += 1;
        nextObjects = [
          ...nextObjects,
          createGameObject(elapsedSeconds, currentTime, objectIdRef.current),
        ];
        lastSpawnRef.current = currentTime;
      }

      syncActiveObjects(nextObjects);
    }, 100);

    return () => window.clearInterval(intervalId);
  }, [finishGame, gameState, handleExpiredObject, syncActiveObjects]);

  useEffect(() => {
    if (gameState !== "playing") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if (key === "arrowleft" || key === "a") {
        event.preventDefault();
        movePlayer(-1);
        return;
      }

      if (key === "arrowright" || key === "d") {
        event.preventDefault();
        movePlayer(1);
        return;
      }

      if (key === " " || key === "enter") {
        event.preventDefault();
        handleInteract();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gameState, handleInteract, movePlayer]);

  const isAdminUser =
    !authLoading &&
    !!user &&
    ["admin", "duper_admin", "super_admin"].includes(
      String(user.userType ?? ""),
    );

  useEffect(() => {
    if (!authLoading && !isAdminUser) setLocation("/");
  }, [authLoading, isAdminUser, setLocation]);

  if (authLoading || !isAdminUser) {
    return (
      <div className="min-h-[100dvh] bg-[#0d0f14] flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const progressPercent = ((GAME_SECONDS - timeLeft) / GAME_SECONDS) * 100;

  return (
    <main className="min-h-[100dvh] bg-[#0d0f14] px-4 pb-28 pt-6 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <section className="flex flex-col gap-3 rounded-lg border border-zinc-700/60 bg-zinc-900 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-400">
              MealScout Rush Signal
            </p>
            <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">
              Food Truck Rush
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-medium text-zinc-400 sm:text-base">
              Serve customers. Dodge problems. Build your streak.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-80">
            <div className="rounded-lg border border-sky-500/30 bg-zinc-800 px-3 py-2">
              <p className="text-xs font-semibold text-zinc-400">
                Score
              </p>
              <p className="text-2xl font-black text-amber-400">{score}</p>
            </div>
            <div className="rounded-lg border border-sky-500/30 bg-zinc-800 px-3 py-2">
              <p className="text-xs font-semibold text-zinc-400">
                Timer
              </p>
              <p className="text-2xl font-black text-zinc-100">{timeLeft}s</p>
            </div>
            <div className="rounded-lg border border-sky-500/30 bg-zinc-800 px-3 py-2">
              <p className="text-xs font-semibold text-zinc-400">
                Streak
              </p>
              <p className="text-2xl font-black text-amber-400">{streak}</p>
            </div>
          </div>
        </section>

        {gameState === "ready" && (
          <Card className="overflow-hidden rounded-lg border-subtle bg-[color:var(--bg-card)]">
            <CardContent className="grid gap-6 p-6 md:grid-cols-[1fr_0.85fr] md:items-center">
              <div>
                <div className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-lg bg-orange-100 text-4xl ring-1 ring-orange-200">
                  🚚
                </div>
                <h2 className="text-2xl font-black sm:text-3xl">
                  Food Truck Rush
                </h2>
                <p className="mt-3 max-w-xl text-base font-medium text-[color:var(--text-secondary)]">
                  Serve customers. Dodge problems. Build your streak.
                </p>
                <Button
                  className="mt-6 w-full sm:w-auto"
                  size="lg"
                  onClick={startGame}
                >
                  <Play aria-hidden="true" />
                  Start Game
                </Button>
              </div>
              <div className="grid gap-3 rounded-lg border border-subtle bg-white/70 p-4 text-sm font-semibold text-[color:var(--text-secondary)]">
                <div className="flex items-center justify-between gap-3">
                  <span>Customers</span>
                  <span className="rounded-md bg-emerald-100 px-2 py-1 text-emerald-800">
                    Serve
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Prep / Inventory</span>
                  <span className="rounded-md bg-sky-100 px-2 py-1 text-sky-800">
                    Restock
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Operations / Event</span>
                  <span className="rounded-md bg-orange-100 px-2 py-1 text-orange-800">
                    Handle
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {gameState === "playing" && (
          <section className="grid gap-4 lg:grid-cols-[1fr_18rem]">
            <div className="rounded-lg border border-subtle bg-[color:var(--bg-card)] p-4 shadow-clean">
              <div
                className="mb-4 h-2 overflow-hidden rounded-full bg-slate-200"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-[color:var(--action-primary)] transition-[width] duration-200"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="grid min-h-[360px] grid-cols-3 gap-2 sm:min-h-[430px] sm:gap-3">
                {lanes.map((lane) => {
                  const laneObjects = activeObjects.filter(
                    (object) => object.lane === lane.id,
                  );

                  return (
                    <div
                      key={lane.id}
                      className={`relative overflow-hidden rounded-lg border border-subtle bg-white/72 transition ring-offset-2 ${
                        playerLane === lane.id
                          ? "ring-2 ring-[color:var(--action-primary)]"
                          : ""
                      }`}
                    >
                      <div className="absolute inset-x-2 top-2 z-10 flex items-center gap-2 rounded-md bg-white/85 px-2 py-1 text-[11px] font-bold text-[color:var(--text-secondary)] shadow-sm sm:text-xs">
                        <span
                          className={`h-2 w-2 rounded-full ${lane.tone}`}
                          aria-hidden="true"
                        />
                        <span className="truncate">{lane.title}</span>
                      </div>

                      <div className="absolute inset-x-1 bottom-20 top-12 rounded-md border border-dashed border-slate-300/80" />

                      {laneObjects.map((object) => {
                        const definition = objectDefinitions[object.kind];
                        const objectProgress = Math.min(
                          1,
                          Math.max(
                            0,
                            (now - object.spawnedAt) /
                              (object.expiresAt - object.spawnedAt),
                          ),
                        );
                        const topPosition = 12 + objectProgress * 66;

                        return (
                          <div
                            key={object.id}
                            className={`absolute left-1/2 z-20 w-[calc(100%-0.75rem)] -translate-x-1/2 rounded-lg border px-2 py-2 text-center shadow-sm transition-[top] duration-100 ${
                              definition.hazard
                                ? "border-red-200 bg-red-50 text-red-950"
                                : "border-emerald-200 bg-white text-slate-950"
                            }`}
                            style={{ top: `${topPosition}%` }}
                          >
                            <div
                              className="text-2xl leading-none sm:text-3xl"
                              aria-hidden="true"
                            >
                              {definition.icon}
                            </div>
                            <div className="mt-1 truncate text-[10px] font-black uppercase tracking-wide sm:text-xs">
                              {definition.label}
                            </div>
                          </div>
                        );
                      })}

                      {playerLane === lane.id && (
                        <div className="absolute inset-x-2 bottom-3 z-30 rounded-lg border border-orange-200 bg-orange-50 px-2 py-2 text-center shadow-md">
                          <div
                            className="text-3xl leading-none"
                            aria-hidden="true"
                          >
                            🚚
                          </div>
                          <div className="mt-1 text-[10px] font-black uppercase tracking-wide text-orange-900">
                            Truck
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <aside className="flex flex-col gap-3">
              <div className="rounded-lg border border-subtle bg-[color:var(--bg-card)] p-4 shadow-clean">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                  Rank Preview
                </p>
                <p className="mt-2 text-xl font-black">{rank.name}</p>
              </div>

              <div
                className="rounded-lg border border-subtle bg-[color:var(--bg-card)] p-4 shadow-clean"
                aria-live="polite"
              >
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                  Last Action
                </p>
                <p className="mt-2 min-h-12 text-base font-black text-[color:var(--text-primary)]">
                  {lastMessage}
                </p>
              </div>

              <div className="hidden rounded-lg border border-subtle bg-white/80 p-4 text-sm font-semibold text-[color:var(--text-secondary)] shadow-clean md:block">
                <p>
                  Desktop: A or Left Arrow moves left. D or Right Arrow moves
                  right. Space or Enter interacts.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 md:hidden">
                {lanes.map((lane) => (
                  <Button
                    key={lane.id}
                    type="button"
                    variant={playerLane === lane.id ? "default" : "outline"}
                    onClick={() => setLane(lane.id)}
                    className="px-2 text-xs"
                  >
                    {lane.short}
                  </Button>
                ))}
              </div>

              <Button
                type="button"
                size="lg"
                onClick={handleInteract}
                className="h-14 text-base font-black"
              >
                Interact / Serve
              </Button>
            </aside>
          </section>
        )}

        {gameState === "finished" && (
          <Card className="overflow-hidden rounded-lg border-subtle bg-[color:var(--bg-card)]">
            <CardContent className="grid gap-6 p-6 md:grid-cols-[0.9fr_1fr] md:items-center">
              <div className="rounded-lg border border-subtle bg-white/80 p-5 text-center">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[color:var(--text-muted)]">
                  Final Score
                </p>
                <p className="mt-2 text-6xl font-black leading-none">{score}</p>
                <p className="mt-4 text-2xl font-black text-[color:var(--accent-text)]">
                  {rank.name}
                </p>
              </div>

              <div>
                <h2 className="text-2xl font-black sm:text-3xl">
                  Rush complete
                </h2>
                <p className="mt-3 text-base font-semibold text-[color:var(--text-secondary)]">
                  {rank.copy}
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <Button type="button" onClick={startGame}>
                    <RotateCcw aria-hidden="true" />
                    Play Again
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/search">
                      <MapPin aria-hidden="true" />
                      Find Trucks Near Me
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/claim-truck">
                      <Truck aria-hidden="true" />
                      Claim My Food Truck
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link href="/for-hosts">
                      <CalendarCheck aria-hidden="true" />
                      Book Food Trucks
                    </Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

export default FoodTruckRush;
