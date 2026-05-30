import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

type LongPressHelpProps = {
  description: string;
  children: ReactElement;
  longPressMs?: number;
};

export default function LongPressHelp({
  description,
  children,
  longPressMs = 450,
}: LongPressHelpProps) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const pressTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number }>({
    left: 0,
    top: 0,
  });

  const close = () => setOpen(false);

  const updateCoords = () => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords({
      left: rect.left + rect.width / 2,
      top: rect.top - 8,
    });
  };

  const clearPressTimer = () => {
    if (pressTimerRef.current != null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  const onPressStart = () => {
    clearPressTimer();
    pressTimerRef.current = window.setTimeout(() => {
      updateCoords();
      suppressClickRef.current = true;
      setOpen(true);
    }, longPressMs);
  };

  const onPressEnd = () => {
    clearPressTimer();
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (event: PointerEvent) => {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onDocPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onDocPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const trigger = isValidElement(children)
    ? cloneElement(children as ReactElement<any>, {
        title: description,
      })
    : children;

  return (
    <span
      ref={rootRef}
      className="relative inline-flex"
      onMouseEnter={() => {
        updateCoords();
        setOpen(true);
      }}
      onMouseLeave={close}
      onFocus={() => {
        updateCoords();
        setOpen(true);
      }}
      onBlur={close}
      onPointerDown={onPressStart}
      onPointerUp={onPressEnd}
      onPointerCancel={onPressEnd}
      onClickCapture={(event) => {
        if (!suppressClickRef.current) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {trigger as ReactNode}
      {open ? (
        <span
          role="tooltip"
          className="fixed z-[1400] max-w-[260px] -translate-x-1/2 -translate-y-full rounded-md border border-white/20 bg-black/90 px-2 py-1 text-[11px] text-white shadow-lg"
          style={{ left: `${coords.left}px`, top: `${coords.top}px` }}
        >
          {description}
        </span>
      ) : null}
    </span>
  );
}

