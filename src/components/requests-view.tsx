"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FEEDBACK_STATUSES,
  STATUS_LABEL,
  type FeedbackListItem,
  type FeedbackStatus,
} from "@/lib/feedback";
import { cn } from "@/lib/utils";

const shortDate = (iso: string) => iso.slice(0, 10);
const pagePath = (url: string | null) => {
  if (!url) return "—";
  try {
    return new URL(url).pathname || url;
  } catch {
    return url;
  }
};

/** Cycle order matches the spec: New → Selected → Shipped → Declined → New. */
const NEXT: Record<FeedbackStatus, FeedbackStatus> = {
  new: "selected",
  selected: "shipped",
  shipped: "declined",
  declined: "new",
};

const STATUS_TONE: Record<FeedbackStatus, string> = {
  new: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  selected: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  shipped: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  declined: "bg-muted text-muted-foreground",
};

type Filter = "all" | FeedbackStatus;

export function RequestsView({
  initial,
  error,
}: {
  initial: FeedbackListItem[];
  error: string | null;
}) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const s of FEEDBACK_STATUSES) c[s] = 0;
    for (const it of items) c[it.status]++;
    return c;
  }, [items]);

  const shown = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.status === filter)),
    [items, filter]
  );

  const cycle = useCallback(async (id: number, from: FeedbackStatus) => {
    const to = NEXT[from];
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: to } : it)));
    try {
      await fetch(`/api/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
    } catch {
      // Revert on failure so the UI never lies about the stored status.
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: from } : it)));
    }
  }, []);

  const toggle = (id: number) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const build = useCallback(async () => {
    const ids = [...checked];
    if (ids.length === 0) return;
    setBusy(true);
    setCopied(false);
    try {
      const res = await fetch("/api/feedback/build-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "build failed");
      setPrompt(json.prompt);
      // Selected happens server-side; reflect it locally for still-'new' items.
      setItems((prev) =>
        prev.map((it) =>
          checked.has(it.id) && it.status === "new" ? { ...it, status: "selected" } : it
        )
      );
    } catch (e) {
      setPrompt(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [checked]);

  const copy = useCallback(async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [prompt]);

  const zoomItem = zoom != null ? items.find((i) => i.id === zoom) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Feature requests &amp; feedback</CardTitle>
          <CardDescription>
            Everything submitted from the in-app feedback bubble, newest first.
            Click a status pill to cycle it (New → Selected → Shipped → Declined).
            Tick items and <strong>Build prompt</strong> to turn them into a
            paste-ready Claude Code prompt — those items become{" "}
            <strong>Selected</strong> automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            {(["all", ...FEEDBACK_STATUSES] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm",
                  filter === f ? "bg-foreground text-background" : "hover:bg-muted"
                )}
              >
                {f === "all" ? "All" : STATUS_LABEL[f]}{" "}
                <span className="tabular-nums opacity-70">{counts[f] ?? 0}</span>
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-muted-foreground tabular-nums">
                {checked.size} selected
              </span>
              <Button onClick={build} disabled={checked.size === 0 || busy} variant="outline">
                {busy ? "Building…" : "Build prompt"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {prompt ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Generated prompt</CardTitle>
              <div className="flex gap-2">
                <Button onClick={copy} variant="outline">
                  {copied ? "Copied!" : "Copy to clipboard"}
                </Button>
                <Button onClick={() => setPrompt(null)} variant="ghost">
                  Dismiss
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <textarea
              readOnly
              value={prompt}
              rows={14}
              className="w-full resize-y rounded-md border bg-muted/40 p-3 font-mono text-xs"
            />
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Card>
          <CardContent className="py-6 text-sm text-red-600 dark:text-red-400">
            Couldn&rsquo;t load feedback: {error}
          </CardContent>
        </Card>
      ) : shown.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {items.length === 0
              ? "No feedback yet — the bubble is bottom-right on every page."
              : "Nothing in this status."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {shown.map((it) => (
            <Card key={it.id}>
              <CardContent className="flex gap-3 py-4">
                <input
                  type="checkbox"
                  checked={checked.has(it.id)}
                  onChange={() => toggle(it.id)}
                  className="mt-1 h-4 w-4 shrink-0"
                  aria-label={`select feedback ${it.id}`}
                />
                {it.hasImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/feedback/${it.id}/image`}
                    alt="attachment thumbnail"
                    onClick={() => setZoom(it.id)}
                    className="h-16 w-16 shrink-0 cursor-zoom-in rounded-md border object-cover"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words text-sm">{it.body}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">{shortDate(it.createdAt)}</span>
                    {it.submitter ? <span>· {it.submitter}</span> : null}
                    <span>· {pagePath(it.sourceUrl)}</span>
                    <span className="tabular-nums opacity-60">· #{it.id}</span>
                  </div>
                </div>
                <button
                  onClick={() => cycle(it.id, it.status)}
                  className={cn(
                    "h-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
                    STATUS_TONE[it.status]
                  )}
                  title="Click to change status"
                >
                  {STATUS_LABEL[it.status]}
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {zoomItem ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/feedback/${zoomItem.id}/image`}
            alt="attachment full size"
            className="max-h-[90vh] max-w-[90vw] rounded-lg border"
          />
        </div>
      ) : null}
    </div>
  );
}
