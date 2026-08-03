import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { HelixClient } from "./client";

const HelixContext = createContext<HelixClient | null>(null);

export function HelixProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<HelixClient | undefined>(undefined);
  if (!clientRef.current) clientRef.current = new HelixClient();
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    clientRef.current!.start("Helix User").then(
      () => setStarting(false),
      (err) => {
        console.error("[helix] failed to start client", err);
        setError(err instanceof Error ? err.message : String(err));
        setStarting(false);
      },
    );
  }, []);

  if (starting) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg text-sm text-ink-muted">
        Connecting to Helix…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg p-6 text-center text-sm text-danger">
        Failed to start: {error}
      </div>
    );
  }

  return <HelixContext.Provider value={clientRef.current}>{children}</HelixContext.Provider>;
}

export function useHelixClient(): HelixClient {
  const client = useContext(HelixContext);
  if (!client) throw new Error("useHelixClient must be used within a HelixProvider");
  return client;
}

/** Re-renders whenever the client's underlying state (feed, follows, genomes) changes. */
export function useHelixState(): HelixClient {
  const client = useHelixClient();
  useSyncExternalStore(
    (onStoreChange) => client.subscribe(onStoreChange),
    () => client.getVersion(),
  );
  return client;
}
