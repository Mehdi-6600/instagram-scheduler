"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountStatusDto, PostDto } from "@/lib/client";
import {
  api,
  aspectError,
  browserTimeZone,
  localDateTimeToDate,
  prepareImageFile,
} from "@/lib/client";
import PostCard from "./PostCard";
import ConnectCard from "./ConnectCard";
import ThemeToggle from "./ThemeToggle";
import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  InstagramIcon,
  LogoutIcon,
  PlusIcon,
} from "./icons";
import { CAPTION_LIMIT } from "./dashboard-utils";

export interface CardForm {
  imageUrl: string | null;
  imagePublicId: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  caption: string;
  date: string;
  time: string;
}

export interface Card {
  key: string;
  isNew: boolean;
  mode: "view" | "edit";
  form: CardForm;
  post: PostDto | null;
  uploading: boolean;
  saving: boolean;
}

interface Toast {
  id: number;
  kind: "ok" | "err" | "info";
  text: string;
}

interface Props {
  initialPosts: PostDto[];
  initialAccount: AccountStatusDto | null;
  userEmail: string;
  mockMode: boolean;
}

function emptyForm(): CardForm {
  // default publish time: 1 hour from now
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    imageUrl: null,
    imagePublicId: null,
    imageWidth: null,
    imageHeight: null,
    caption: "",
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function postToCard(post: PostDto): Card {
  const dt = new Date(post.scheduledAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    key: post.id,
    isNew: false,
    mode: "view",
    post,
    uploading: false,
    saving: false,
    form: {
      imageUrl: post.imageUrl,
      imagePublicId: null,
      imageWidth: post.imageWidth,
      imageHeight: post.imageHeight,
      caption: post.caption,
      date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
      time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
    },
  };
}

let toastSeq = 1;

export default function Dashboard({ initialPosts, initialAccount, userEmail, mockMode }: Props) {
  const [cards, setCards] = useState<Card[]>(() =>
    [...initialPosts].sort(sortPosts).map(postToCard)
  );
  const [account, setAccount] = useState<AccountStatusDto | null>(initialAccount);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const tz = useMemo(() => browserTimeZone(), []);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200);
  }, []);

  /* -------- initial query params (oauth result) + live polling -------- */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const igErr = params.get("ig_error");
    const igOk = params.get("ig_connected");
    if (igErr) toast("err", igErr);
    if (igOk) toast("ok", "Instagram connected successfully.");
    if (igErr || igOk) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [toast]);

  const refreshPosts = useCallback(async () => {
    try {
      const res = await api<{ posts: PostDto[] }>("/api/posts");
      setCards((prev) => {
        const drafts = prev.filter((c) => c.isNew);
        const mapped = res.posts.sort(sortPosts).map((postToCard));
        // preserve edit-mode state for cards being edited
        return [
          ...drafts,
          ...mapped.map((m) => {
            const old = prev.find((c) => c.key === m.key);
            return old && old.mode === "edit"
              ? {
                  ...m,
                  mode: "edit" as const,
                  form: old.form,
                  saving: old.saving,
                  uploading: old.uploading,
                }
              : m;
          }),
        ];
      });
    } catch {
      /* transient poll error — ignore */
    }
  }, []);

  useEffect(() => {
    const hasPending = cards.some(
      (c) => c.post && (c.post.status === "PUBLISHING" || c.post.status === "SCHEDULED")
    );
    const hasPublishing = cards.some((c) => c.post?.status === "PUBLISHING");
    const interval = hasPublishing ? 4000 : hasPending ? 30000 : 0;
    if (pollRef.current) clearInterval(pollRef.current);
    if (interval > 0) {
      pollRef.current = setInterval(refreshPosts, interval);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [cards, refreshPosts]);

  /* ------------------------------ card ops ------------------------------ */
  const patchCard = useCallback((key: string, patch: Partial<CardForm> & { mode?: Card["mode"] }) => {
    setCards((prev) =>
      prev.map((c) => {
        if (c.key !== key) return c;
        const { mode, ...formPatch } = patch;
        return { ...c, mode: mode ?? c.mode, form: { ...c.form, ...formPatch } };
      })
    );
    setCardErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const addDraft = () => {
    const key = `draft-${Date.now()}`;
    setCards((prev) => [
      { key, isNew: true, mode: "edit", form: emptyForm(), post: null, uploading: false, saving: false },
      ...prev,
    ]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const editCard = (key: string) => patchCard(key, { mode: "edit" });

  const cancelCard = (key: string) => {
    setCards((prev) =>
      prev
        .filter((c) => !(c.key === key && c.isNew))
        .map((c) => (c.key === key ? { ...c, mode: "view" } : c))
    );
    setCardErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const setCardState = (key: string, patch: Partial<Card>) =>
    setCards((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const onImageFile = async (key: string, file: File) => {
    setCardState(key, { uploading: true });
    try {
      const prepared = await prepareImageFile(file);
      const err =
        prepared.original && !prepared.blob.type.startsWith("image/")
          ? "This file doesn't look like an image."
          : null;
      if (err) throw new Error(err);
      if (!prepared.original) {
        const aErr = aspectError(prepared.width, prepared.height);
        if (aErr) throw new Error(aErr);
      }
      const fd = new FormData();
      fd.append("file", prepared.blob, "photo.jpg");
      const res = await api<{ url: string; publicId: string; width: number; height: number }>(
        "/api/upload",
        { method: "POST", body: fd }
      );
      setCards((prev) =>
        prev.map((c) =>
          c.key === key
            ? {
                ...c,
                uploading: false,
                form: {
                  ...c.form,
                  imageUrl: res.url,
                  imagePublicId: res.publicId,
                  imageWidth: res.width,
                  imageHeight: res.height,
                },
              }
            : c
        )
      );
    } catch (err) {
      setCardState(key, { uploading: false });
      setCardErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : "Image upload failed",
      }));
    }
  };

  const removeImage = (key: string) =>
    patchCard(key, {
      imageUrl: null,
      imagePublicId: null,
      imageWidth: null,
      imageHeight: null,
    });

  const saveCard = async (key: string) => {
    const card = cards.find((c) => c.key === key);
    if (!card) return;
    const { form } = card;

    if (!form.imageUrl) {
      setCardErrors((prev) => ({ ...prev, [key]: "Please add an image." }));
      return;
    }
    if (form.caption.length > CAPTION_LIMIT) {
      setCardErrors((prev) => ({
        ...prev,
        [key]: `Caption is limited to ${CAPTION_LIMIT} characters.`,
      }));
      return;
    }
    const when = localDateTimeToDate(form.date, form.time);
    if (!when) {
      setCardErrors((prev) => ({ ...prev, [key]: "Choose a valid publish date and time." }));
      return;
    }
    if (card.isNew && when.getTime() < Date.now() - 60_000) {
      setCardErrors((prev) => ({
        ...prev,
        [key]: "Publish time must be in the future.",
      }));
      return;
    }

    setCardState(key, { saving: true });
    try {
      const payload = {
        imageUrl: form.imageUrl,
        imagePublicId: form.imagePublicId,
        imageWidth: form.imageWidth,
        imageHeight: form.imageHeight,
        caption: form.caption,
        scheduledAt: when.toISOString(),
        timezone: tz,
      };
      const res = card.isNew
        ? await api<{ post: PostDto }>("/api/posts", { method: "POST", json: payload })
        : await api<{ post: PostDto }>(`/api/posts/${card.key}`, {
            method: "PATCH",
            json: payload,
          });
      setCards((prev) =>
        prev.map((c) => (c.key === key ? postToCard(res.post) : c))
      );
      toast("ok", card.isNew ? "Post scheduled 🎉" : "Post updated.");
    } catch (err) {
      setCardState(key, { saving: false });
      setCardErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : "Could not save the post",
      }));
    }
  };

  const deleteCard = async (key: string) => {
    const card = cards.find((c) => c.key === key);
    if (!card) return;
    if (card.isNew) return cancelCard(key);
    if (!confirm("Delete this scheduled post?")) return;
    try {
      await api(`/api/posts/${key}`, { method: "DELETE" });
      setCards((prev) => prev.filter((c) => c.key !== key));
      toast("info", "Post deleted.");
    } catch (err) {
      toast("err", err instanceof Error ? err.message : "Could not delete the post");
    }
  };

  const retryCard = async (key: string) => {
    try {
      const res = await api<{ post: PostDto }>(`/api/posts/${key}/retry`, { method: "POST" });
      setCards((prev) => prev.map((c) => (c.key === key ? postToCard(res.post) : c)));
      toast("ok", "Retry queued — it will publish at the next scheduler run.");
    } catch (err) {
      toast("err", err instanceof Error ? err.message : "Could not retry the post");
    }
  };

  const mockConnect = async () => {
    try {
      await api("/api/instagram/mock-connect", { method: "POST" });
      const st = await api<AccountStatusDto>("/api/instagram/status");
      setAccount(st);
      toast("ok", "Mock Instagram connected (development mode).");
    } catch (err) {
      toast("err", err instanceof Error ? err.message : "Mock connect failed");
    }
  };

  const disconnect = async () => {
    try {
      await api("/api/instagram/disconnect", { method: "POST" });
      const st = await api<AccountStatusDto>("/api/instagram/status");
      setAccount(st);
      toast("info", "Instagram disconnected.");
    } catch (err) {
      toast("err", err instanceof Error ? err.message : "Disconnect failed");
    }
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const summary = useMemo(() => {
    let scheduled = 0,
      published = 0,
      failed = 0;
    for (const c of cards) {
      if (c.isNew) continue;
      if (c.post?.status === "PUBLISHED") published += 1;
      else if (c.post?.status === "FAILED") failed += 1;
      else scheduled += 1; // SCHEDULED + PUBLISHING
    }
    return { scheduled, published, failed };
  }, [cards]);

  return (
    <div className="mx-auto w-full max-w-[580px] px-4 pb-24 pt-5">
      {/* Header */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="grid size-11 place-items-center rounded-2xl text-white shadow-lg"
            style={{ background: "linear-gradient(135deg,#833ab4,#e1306c,#f77737)" }}
          >
            <InstagramIcon className="size-6" />
          </div>
          <div>
            <h1 className="text-[19px] font-extrabold leading-tight">
              My Instagram Scheduler
            </h1>
            <p className="text-xs text-muted">{userEmail}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={logout}
            className="grid size-11 place-items-center rounded-2xl border border-line bg-surface text-muted"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogoutIcon className="size-5" />
          </button>
        </div>
      </header>

      {mockMode && (
        <div className="mt-4 rounded-2xl bg-warn-bg px-4 py-3 text-[13px] leading-relaxed text-warn">
          <strong className="font-semibold">Development mock mode.</strong> Instagram
          publishing is simulated — mock posts are clearly labelled and nothing is sent to
          Instagram. Set <span className="font-mono">INSTAGRAM_MOCK_MODE=false</span> with
          real Meta credentials for production.
        </div>
      )}

      {/* Connection */}
      <div className="mt-5">
        <ConnectCard
          account={account}
          onMockConnect={mockConnect}
          onDisconnect={disconnect}
          onRefresh={async () => setAccount(await api<AccountStatusDto>("/api/instagram/status"))}
        />
      </div>

      {/* Summary */}
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <SummaryTile label="Scheduled" value={summary.scheduled} tone="sched" />
        <SummaryTile label="Published" value={summary.published} tone="ok" />
        <SummaryTile label="Failed" value={summary.failed} tone="bad" />
      </div>

      {/* Posts */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-[16px] font-bold">Posts</h2>
        <button className="btn btn-primary min-h-11! px-4! text-sm!" onClick={addDraft}>
          <PlusIcon className="size-4.5" /> Add New Post
        </button>
      </div>

      <div className="mt-3 space-y-4">
        {cards.length === 0 && (
          <div className="card grid place-items-center gap-2 px-6 py-10 text-center">
            <ClockIcon className="size-9 text-muted" />
            <p className="font-semibold">No posts yet</p>
            <p className="text-sm text-muted">
              Add your first post — an image, a caption and the exact time to publish.
            </p>
            <button className="btn btn-primary mt-2" onClick={addDraft}>
              <PlusIcon className="size-5" /> Add New Post
            </button>
          </div>
        )}

        {cards.map((card) => (
          <PostCard
            key={card.key}
            card={card}
            timezone={card.post?.timezone || tz}
            error={cardErrors[card.key] || null}
            onPatch={(patch) => patchCard(card.key, patch)}
            onSave={() => saveCard(card.key)}
            onCancel={() => cancelCard(card.key)}
            onDelete={() => deleteCard(card.key)}
            onRetry={() => retryCard(card.key)}
            onEdit={() => editCard(card.key)}
            onImageFile={(f) => onImageFile(card.key, f)}
            onRemoveImage={() => removeImage(card.key)}
          />
        ))}
      </div>

      {cards.length > 0 && (
        <button className="btn btn-soft btn-block mt-4" onClick={addDraft}>
          <PlusIcon className="size-5" /> Add New Post
        </button>
      )}

      <footer className="mt-10 text-center text-[11.5px] leading-relaxed text-muted">
        Publishing via the official Instagram Platform API · posts are published
        server-side at the scheduled time — closing this page is fine.
      </footer>

      {/* Toasts */}
      <div className="pointer-events-none fixed inset-x-3 bottom-4 z-50 mx-auto flex max-w-[540px] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`fade-up pointer-events-auto rounded-2xl px-4 py-3 text-sm font-medium shadow-lg ${
              t.kind === "ok"
                ? "bg-success text-white"
                : t.kind === "err"
                  ? "bg-danger text-white"
                  : "bg-ink text-bg"
            }`}
            style={
              t.kind === "ok"
                ? { background: "var(--success)", color: "#fff" }
                : t.kind === "err"
                  ? { background: "var(--danger)", color: "#fff" }
                  : { background: "var(--text)", color: "var(--bg)" }
            }
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "sched" | "ok" | "bad";
}) {
  const icon =
    tone === "sched" ? (
      <ClockIcon className="size-4" />
    ) : tone === "ok" ? (
      <CheckCircleIcon className="size-4" />
    ) : (
      <AlertIcon className="size-4" />
    );
  const color =
    tone === "sched" ? "var(--chip-sched)" : tone === "ok" ? "var(--success)" : "var(--danger)";
  const bg =
    tone === "sched"
      ? "var(--chip-sched-bg)"
      : tone === "ok"
        ? "var(--success-bg)"
        : "var(--danger-bg)";
  return (
    <div className="card px-3.5 py-3">
      <div className="flex items-center gap-1.5">
        <span style={{ color }}>{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {label}
        </span>
      </div>
      <p className="mt-1 text-[22px] font-extrabold leading-none">{value}</p>
    </div>
  );
}

function sortPosts(a: PostDto, b: PostDto): number {
  const rank: Record<string, number> = {
    PUBLISHING: 0,
    FAILED: 1,
    SCHEDULED: 2,
    PUBLISHED: 3,
  };
  const ra = rank[a.status] ?? 4;
  const rb = rank[b.status] ?? 4;
  if (ra !== rb) return ra - rb;
  return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
}
