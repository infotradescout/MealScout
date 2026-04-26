import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/hooks/useAuth";

type CopyOverrides = Record<string, string>;

type AdminInlineCopyContextValue = {
  canEdit: boolean;
  isEditMode: boolean;
  setIsEditMode: (next: boolean) => void;
  getText: (key: string, fallback: string) => string;
  updateText: (key: string, value: string) => void;
};

const OVERRIDES_STORAGE_KEY = "admin_inline_copy_overrides_v1";
const EDIT_MODE_STORAGE_KEY = "admin_inline_copy_mode_v1";

const AdminInlineCopyContext = createContext<AdminInlineCopyContextValue | null>(
  null,
);

export function AdminInlineCopyProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user, authState } = useAuth();
  const [overrides, setOverrides] = useState<CopyOverrides>({});
  const [isEditMode, setIsEditMode] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const savedOverrides = window.localStorage.getItem(OVERRIDES_STORAGE_KEY);
      if (savedOverrides) {
        const parsed = JSON.parse(savedOverrides);
        if (parsed && typeof parsed === "object") {
          setOverrides(parsed as CopyOverrides);
        }
      }

      const savedMode = window.localStorage.getItem(EDIT_MODE_STORAGE_KEY);
      setIsEditMode(savedMode === "1");
    } catch {
      // no-op: keep defaults when local cache is invalid
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      OVERRIDES_STORAGE_KEY,
      JSON.stringify(overrides || {}),
    );
  }, [overrides]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(EDIT_MODE_STORAGE_KEY, isEditMode ? "1" : "0");
  }, [isEditMode]);

  const userType = String(user?.userType || "").toLowerCase();
  const canEdit =
    authState === "authenticated" &&
    (userType === "admin" || userType === "super_admin" || userType === "staff");

  const value = useMemo<AdminInlineCopyContextValue>(
    () => ({
      canEdit,
      isEditMode,
      setIsEditMode,
      getText: (key: string, fallback: string) => {
        const existing = overrides[key];
        return typeof existing === "string" ? existing : fallback;
      },
      updateText: (key: string, value: string) => {
        setOverrides((current) => ({
          ...current,
          [key]: String(value || "").trim(),
        }));
      },
    }),
    [canEdit, isEditMode, overrides],
  );

  return (
    <AdminInlineCopyContext.Provider value={value}>
      {children}
    </AdminInlineCopyContext.Provider>
  );
}

export function useAdminInlineCopy() {
  const context = useContext(AdminInlineCopyContext);
  if (!context) {
    throw new Error("useAdminInlineCopy must be used within AdminInlineCopyProvider");
  }
  return context;
}

export function AdminEditableText({
  textKey,
  defaultText,
}: {
  textKey: string;
  defaultText: string;
}) {
  const { getText } = useAdminInlineCopy();
  return <>{getText(textKey, defaultText)}</>;
}

export function AdminEditButton({
  textKey,
  defaultText,
  label,
  className,
}: {
  textKey: string;
  defaultText: string;
  label?: string;
  className?: string;
}) {
  const { canEdit, isEditMode, getText, updateText } = useAdminInlineCopy();

  if (!canEdit || !isEditMode) return null;

  return (
    <button
      type="button"
      onClick={() => {
        const current = getText(textKey, defaultText);
        const next = window.prompt(
          `Edit copy${label ? `: ${label}` : ""}`,
          current,
        );
        if (next === null) return;
        updateText(textKey, next);
      }}
      className={
        className ||
        "inline-flex h-5 items-center rounded border border-amber-300 bg-amber-100 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 hover:bg-amber-200"
      }
      title={label ? `Edit ${label}` : "Edit copy"}
    >
      Edit
    </button>
  );
}
