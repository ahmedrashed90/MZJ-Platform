import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { marketingFetch } from "./api";
import type { MarketingMeta } from "./types";

type MarketingContextValue = {
  meta: MarketingMeta | null;
  loading: boolean;
  error: string;
  refreshMeta: () => Promise<void>;
};

const MarketingContext = createContext<MarketingContextValue | null>(null);

export function MarketingProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<MarketingMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshMeta = async () => {
    setLoading(true);
    setError("");
    try {
      setMeta(await marketingFetch<MarketingMeta>("/api/marketing?action=meta"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل إعدادات التسويق");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refreshMeta(); }, []);
  const value = useMemo(() => ({ meta, loading, error, refreshMeta }), [meta, loading, error]);
  return <MarketingContext.Provider value={value}>{children}</MarketingContext.Provider>;
}

export function useMarketing() {
  const value = useContext(MarketingContext);
  if (!value) throw new Error("MarketingProvider is missing");
  return value;
}
