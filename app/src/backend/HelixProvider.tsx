import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { HelixClient } from "./client";
import { getStoredDisplayName, saveDisplayName } from "./identity";
import { OnboardingScreen } from "../screens/OnboardingScreen";

const HelixContext = createContext<HelixClient | null>(null);

type Phase = "loading" | "onboarding" | "ready" | "error";

export function HelixProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<HelixClient | undefined>(undefined);
  if (!clientRef.current) clientRef.current = new HelixClient();
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string>();

  useEffect(() => {
    const client = clientRef.current!;
    client.connect().catch(() => {}); // register() awaits this itself; failures surface there.

    const storedName = getStoredDisplayName();
    if (storedName) {
      client.register(storedName).then(
        () => setPhase("ready"),
        (err) => {
          console.error("[helix] failed to start client", err);
          setError(err instanceof Error ? err.message : String(err));
          setPhase("error");
        },
      );
    } else {
      setPhase("onboarding");
    }
  }, []);

  const handleOnboardingSubmit = (name: string) => {
    saveDisplayName(name);
    setPhase("loading");
    clientRef.current!.register(name).then(
      () => setPhase("ready"),
      (err) => {
        console.error("[helix] failed to start client", err);
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      },
    );
  };

  if (phase === "onboarding") {
    return <OnboardingScreen onSubmit={handleOnboardingSubmit} />;
  }

  if (phase === "loading") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg text-sm text-ink-muted">
        Connecting to Helix…
      </div>
    );
  }

  if (phase === "error") {
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
