import { useState } from "react";
import { ArrowLeft, Check, Globe2, Users, Ban } from "lucide-react";
import { getReplyAudience, setReplyAudience, type ReplyAudience } from "../backend/replyAudience";

const OPTIONS: { value: ReplyAudience; label: string; description: string; icon: typeof Globe2 }[] = [
  { value: "everyone", label: "Everyone", description: "Any Helix user can reply to your posts.", icon: Globe2 },
  { value: "followers", label: "Followers only", description: "Only people who follow you can reply.", icon: Users },
  { value: "nobody", label: "Nobody", description: "Replies are disabled on your posts.", icon: Ban },
];

/** Local preference only - not yet enforced when composing/replying, matching this pass's scope. */
export function WhoCanReplyScreen({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState<ReplyAudience>(getReplyAudience());

  const choose = (value: ReplyAudience) => {
    setReplyAudience(value);
    setSelected(value);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-[402px] flex-col overflow-hidden bg-bg text-ink lg:mx-0 lg:max-w-[1088px] lg:px-10">
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 pb-12 pt-2 lg:px-0">
        <div className="flex w-full items-center gap-3 pt-2">
          <button type="button" onClick={onBack} className="flex size-10 items-center justify-center rounded-full bg-surface" aria-label="Back">
            <ArrowLeft size={20} className="text-ink" />
          </button>
          <span className="text-xl font-bold text-ink">Who can reply</span>
        </div>

        <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface">
          {OPTIONS.map(({ value, label, description, icon: Icon }, i) => (
            <button
              key={value}
              type="button"
              onClick={() => choose(value)}
              className={`flex w-full items-start gap-3 px-4 py-4 text-left ${i === OPTIONS.length - 1 ? "" : "border-b border-border"}`}
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-alt">
                <Icon size={16} className="text-ink" />
              </div>
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-medium text-ink">{label}</span>
                <span className="text-xs text-ink-muted">{description}</span>
              </div>
              {selected === value && <Check size={18} className="mt-1 shrink-0 text-accent" />}
            </button>
          ))}
        </div>
        <p className="px-1 text-xs leading-relaxed text-ink-faint">
          This sets your preference for future posts. Enforcing it on the network side isn't implemented yet.
        </p>
      </div>
    </div>
  );
}
