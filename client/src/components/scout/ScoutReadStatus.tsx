type Props = { failures: string[]; loading: boolean; retrying: boolean; onRetry: () => void };

export function ScoutReadStatus({ failures, loading, retrying, onRetry }: Props) {
  if (!failures.length && !loading) return null;
  return (
    <section role="status" aria-live="polite" data-testid="scout-data-status" data-state={failures.length ? "unavailable" : "loading"} className="mx-4 my-3 rounded-2xl border border-orange-200 bg-white p-4 text-stone-800 shadow-sm">
      <h2 className="text-base font-bold">{failures.length ? "Some local food could not be loaded" : "Loading nearby food"}</h2>
      <p className="mt-1 text-sm">{failures.length ? `Unavailable: ${failures.join(", ")}. This does not mean there are no places nearby.` : "Checking current listings for your selected area."}</p>
      {failures.length > 0 && (
        <button type="button" disabled={retrying} aria-busy={retrying} onClick={onRetry} className="mt-3 min-h-11 rounded-xl bg-orange-600 px-4 font-semibold text-white disabled:opacity-60">
          {retrying ? "Retrying discovery…" : "Retry discovery"}
        </button>
      )}
    </section>
  );
}
