import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Loader2, ShieldAlert } from "lucide-react";
import { useHelixState } from "../backend/HelixProvider";
import type { PostAttachment } from "../types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type State =
  | { status: "loading" }
  | { status: "ready"; dataUrl?: string; text?: string }
  | { status: "error"; message: string };

/**
 * Fetches, verifies (hash/size), and renders a post's attachment inline, keyed by the
 * attachment's content hash so the same bytes are never fetched twice (the client caches
 * verified bytes - see HelixClient.fetchAttachmentBytes). Images/video/audio render as
 * native media; markdown and other text render as a collapsible block (react-markdown +
 * GFM); anything else renders as a download link. Fetch failures surface as an error
 * state rather than silently dropping the attachment.
 */
export function AttachmentMedia({ attachment, defaultOpen = false }: { attachment: PostAttachment; defaultOpen?: boolean }) {
  const client = useHelixState();
  const [state, setState] = useState<State>({ status: "loading" });
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        if (attachment.mimeType.startsWith("text/")) {
          const bytes = await client.fetchAttachmentBytes(attachment);
          if (cancelled) return;
          setState({ status: "ready", text: new TextDecoder().decode(bytes) });
        } else {
          const dataUrl = await client.fetchAttachmentDataUrl(attachment);
          if (cancelled) return;
          setState({ status: "ready", dataUrl });
        }
      } catch (err) {
        if (cancelled) return;
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, attachment.hashHex, attachment.mimeType]);

  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-alt px-3 py-2.5">
        <Loader2 size={14} className="animate-spin text-ink-muted" />
        <span className="text-xs text-ink-muted">Verifying attachment ({attachment.mimeType})…</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5">
        <ShieldAlert size={14} className="mt-0.5 shrink-0 text-danger" />
        <p className="text-xs leading-relaxed text-danger">
          Couldn't verify attachment ({attachment.mimeType}, {formatBytes(attachment.sizeBytes)}) — {state.message}
        </p>
      </div>
    );
  }

  const mime = attachment.mimeType;

  if (mime.startsWith("image/") && state.dataUrl) {
    return <img src={state.dataUrl} alt="" className="max-h-96 w-full rounded-xl bg-black object-contain" />;
  }

  if (mime.startsWith("video/") && state.dataUrl) {
    return <video src={state.dataUrl} controls className="max-h-96 w-full rounded-xl bg-black" />;
  }

  if (mime.startsWith("audio/") && state.dataUrl) {
    return <audio src={state.dataUrl} controls className="w-full" />;
  }

  if (mime.startsWith("text/") && state.text !== undefined) {
    const isMarkdown = mime === "text/markdown" || mime.endsWith("+markdown");
    return (
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="rounded-xl border border-border bg-surface-alt">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-semibold text-ink-muted">
          <FileText size={14} className="shrink-0" />
          <span className="flex-1">{isMarkdown ? "Long-form attachment" : "Attached text"}</span>
          <span className="font-normal">
            {attachment.mimeType} • {formatBytes(attachment.sizeBytes)}
          </span>
        </summary>
        <div className="border-t border-border px-3 py-2.5">
          {isMarkdown ? (
            <div className="text-sm leading-relaxed text-ink">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.text}</ReactMarkdown>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{state.text}</pre>
          )}
        </div>
      </details>
    );
  }

  if (state.dataUrl) {
    return (
      <a
        href={state.dataUrl}
        download={`attachment-${attachment.hashHex.slice(0, 12)}`}
        className="flex items-center gap-2 rounded-xl border border-border bg-surface-alt px-3 py-2.5 text-xs font-semibold text-ink"
      >
        <FileText size={14} className="shrink-0 text-ink-muted" />
        <span className="flex-1">
          {attachment.mimeType} • {formatBytes(attachment.sizeBytes)}
        </span>
        Download
      </a>
    );
  }

  return null;
}
