import { useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { SUPPORTED_LANGUAGES, getLanguageCode, setLanguageCode } from "../backend/languagePrefs";

/** Local preference only - the app UI isn't translated yet, matching this pass's scope. */
export function LanguageScreen({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState(getLanguageCode());

  const choose = (code: string) => {
    setLanguageCode(code);
    setSelected(code);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-[402px] flex-col overflow-hidden bg-bg text-ink lg:mx-0 lg:max-w-[1088px] lg:px-10">
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 pb-12 pt-2 lg:px-0">
        <div className="flex w-full items-center gap-3 pt-2">
          <button type="button" onClick={onBack} className="flex size-10 items-center justify-center rounded-full bg-surface" aria-label="Back">
            <ArrowLeft size={20} className="text-ink" />
          </button>
          <span className="text-xl font-bold text-ink">Language</span>
        </div>

        <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface">
          {SUPPORTED_LANGUAGES.map(({ code, label }, i) => (
            <button
              key={code}
              type="button"
              onClick={() => choose(code)}
              className={`flex w-full items-center justify-between px-4 py-3.5 text-left ${i === SUPPORTED_LANGUAGES.length - 1 ? "" : "border-b border-border"}`}
            >
              <span className="text-[15px] font-medium text-ink">{label}</span>
              {selected === code && <Check size={18} className="text-accent" />}
            </button>
          ))}
        </div>
        <p className="px-1 text-xs leading-relaxed text-ink-faint">
          Helix's interface is English-only for now. This sets your preference for when more languages ship.
        </p>
      </div>
    </div>
  );
}
