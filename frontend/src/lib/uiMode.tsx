// Global UI mode. Two registers:
//
//   "simple"   — non-expert workflow. Hides version labels, audit JSON,
//                raw scores, prompt internals, and other professional
//                terminology unless explained. AI drives; user reviews.
//   "advanced" — full controls exposed (version history, sourceStrict
//                toggles, scoring details, prompt details, audit
//                notes, raw provenance).
//
// Components can call useUIMode() to branch behavior. The default for a
// fresh user is "simple" — the OS should be friendly first; the writer
// can flip to advanced when they want craft controls.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type UIMode = "simple" | "advanced";

interface UIModeContextValue {
  mode: UIMode;
  setMode: (m: UIMode) => void;
  isSimple: boolean;
  isAdvanced: boolean;
}

const KEY = "toburt.uiMode";

const UIModeContext = createContext<UIModeContextValue | null>(null);

export function UIModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<UIMode>(() => {
    if (typeof window === "undefined") return "simple";
    const v = window.localStorage.getItem(KEY);
    return v === "advanced" ? "advanced" : "simple";
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(KEY, mode);
  }, [mode]);
  const setMode = useCallback((m: UIMode) => setModeState(m), []);
  const value = useMemo<UIModeContextValue>(
    () => ({ mode, setMode, isSimple: mode === "simple", isAdvanced: mode === "advanced" }),
    [mode, setMode]
  );
  return <UIModeContext.Provider value={value}>{children}</UIModeContext.Provider>;
}

export function useUIMode(): UIModeContextValue {
  const v = useContext(UIModeContext);
  if (!v) {
    // Defensive default — the provider should always wrap the app, but if
    // a component is rendered in isolation (tests / storybook) we return
    // a benign simple-mode value rather than crash.
    return {
      mode: "simple",
      setMode: () => {},
      isSimple: true,
      isAdvanced: false,
    };
  }
  return v;
}
