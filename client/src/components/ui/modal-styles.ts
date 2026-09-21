// Above the app's 1100 navigation layer. Keep overlay/content at the same
// layer so a later nested portal can cover an earlier dialog completely.
export const modalOverlayClasses =
  "fixed inset-0 z-[1200] bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";

export const modalContentClasses =
  "fixed left-1/2 top-1/2 z-[1200] grid min-w-0 max-h-[calc(100vh-2rem)] supports-[height:100dvh]:max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-contain rounded-[1.25rem] border border-[color:var(--border-subtle)] bg-[color:var(--bg-popup)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-[color:var(--text-primary)] shadow-clean-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-2xl sm:p-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]";

export const modalFooterClasses =
  "flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end";
