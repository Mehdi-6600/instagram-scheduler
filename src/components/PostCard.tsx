"use client";

import { useRef, useState } from "react";
import type { Card } from "./Dashboard";
import {
  AlertIcon,
  CameraIcon,
  CheckCircleIcon,
  ClockIcon,
  ImageIcon,
  LoaderIcon,
  PencilIcon,
  PlusIcon,
  RetryIcon,
  TrashIcon,
  XIcon,
} from "./icons";
import {
  CAPTION_LIMIT,
  formatPostDate,
  formatPostTime,
} from "./dashboard-utils";

export function StatusChip({ status }: { status: string }) {
  switch (status) {
    case "SCHEDULED":
      return (
        <span className="chip chip-scheduled">
          <ClockIcon className="size-3.5" /> Scheduled
        </span>
      );
    case "PUBLISHING":
      return (
        <span className="chip chip-publishing">
          <LoaderIcon className="size-3.5 pulse-dot" /> Publishing…
        </span>
      );
    case "PUBLISHED":
      return (
        <span className="chip chip-published">
          <CheckCircleIcon className="size-3.5" /> Published
        </span>
      );
    case "FAILED":
      return (
        <span className="chip chip-failed">
          <AlertIcon className="size-3.5" /> Failed
        </span>
      );
    default:
      return null;
  }
}

interface PostCardProps {
  card: Card;
  timezone: string;
  onPatch: (patch: Partial<Card["form"]> & { mode?: Card["mode"] }) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onImageFile: (file: File) => void;
  onRemoveImage: () => void;
  onEdit: () => void;
  error?: string | null;
}

export default function PostCard({
  card,
  timezone,
  onPatch,
  onSave,
  onCancel,
  onDelete,
  onRetry,
  onImageFile,
  onRemoveImage,
  onEdit,
  error,
}: PostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const { form, post, mode, uploading, saving } = card;
  const isNew = card.isNew;

  const captionLeft = CAPTION_LIMIT - form.caption.length;

  /* ------------------------------ EDIT MODE ------------------------------ */
  if (mode === "edit") {
    return (
      <article className="card fade-up overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4 pb-1">
          <h2 className="text-[15px] font-semibold">
            {isNew ? "New post" : "Edit post"}
          </h2>
          <button
            className="btn btn-soft min-h-9! px-2.5! py-1.5! text-sm!"
            onClick={onCancel}
            aria-label="Close editor"
          >
            <XIcon className="size-4" /> Cancel
          </button>
        </div>

        {/* Image area */}
        <div className="px-4 pt-3">
          {form.imageUrl ? (
            <div className="relative overflow-hidden rounded-2xl border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={form.imageUrl}
                alt="Post preview"
                className="w-full max-h-[420px] object-cover"
              />
              {uploading && (
                <div className="absolute inset-0 grid place-items-center bg-black/35">
                  <div className="spinner" />
                </div>
              )}
              <button
                onClick={onRemoveImage}
                disabled={uploading}
                className="absolute right-2 top-2 rounded-full bg-black/55 p-2 text-white"
                aria-label="Remove image"
              >
                <TrashIcon className="size-4.5" />
              </button>
            </div>
          ) : (
            <div className="grid place-items-center gap-3 rounded-2xl border-2 border-dashed border-line bg-surface2 px-4 py-8 text-center">
              <ImageIcon className="size-9 text-muted" />
              <p className="text-sm text-muted">Add a photo for this post</p>
              <div className="flex w-full flex-col gap-2">
                <button
                  className="btn btn-primary w-full"
                  onClick={() => cameraRef.current?.click()}
                  disabled={uploading}
                >
                  <CameraIcon className="size-5" /> Take Photo
                </button>
                <button
                  className="btn btn-soft w-full"
                  onClick={() => libraryRef.current?.click()}
                  disabled={uploading}
                >
                  <ImageIcon className="size-5" /> Choose from Library
                </button>
              </div>
            </div>
          )}

          {form.imageUrl && (
            <div className="mt-2 flex gap-2">
              <button
                className="btn btn-soft flex-1 min-h-11! text-sm!"
                onClick={() => cameraRef.current?.click()}
                disabled={uploading}
              >
                <CameraIcon className="size-4.5" /> Retake
              </button>
              <button
                className="btn btn-soft flex-1 min-h-11! text-sm!"
                onClick={() => libraryRef.current?.click()}
                disabled={uploading}
              >
                <ImageIcon className="size-4.5" /> Replace
              </button>
            </div>
          )}

          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImageFile(f);
              e.target.value = "";
            }}
          />
          <input
            ref={libraryRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImageFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {/* Caption */}
        <div className="px-4 pt-4">
          <label className="mb-1.5 block text-[13px] font-semibold text-muted">
            Caption
          </label>
          <textarea
            className="field min-h-[132px] resize-y"
            placeholder="Write your caption…  (emojis, #hashtags, @mentions and line breaks all work)"
            value={form.caption}
            maxLength={CAPTION_LIMIT}
            onChange={(e) => onPatch({ caption: e.target.value })}
          />
          <p
            className={`mt-1 text-right text-xs ${captionLeft < 100 ? "text-danger" : "text-muted"}`}
          >
            {captionLeft} characters left
          </p>
        </div>

        {/* Date & time */}
        <div className="grid grid-cols-2 gap-3 px-4 pt-2">
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-muted">
              Publish date
            </label>
            <input
              type="date"
              className="field"
              value={form.date}
              onChange={(e) => onPatch({ date: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-muted">
              Publish time
            </label>
            <input
              type="time"
              className="field"
              value={form.time}
              onChange={(e) => onPatch({ time: e.target.value })}
            />
          </div>
        </div>
        <p className="px-4 pt-2 text-xs text-muted">
          Times use your timezone: <strong className="text-ink">{timezone}</strong>
        </p>

        {error && (
          <p className="mx-4 mt-3 rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2 px-4 pb-4 pt-4">
          <button
            className="btn btn-primary btn-block"
            onClick={onSave}
            disabled={saving || uploading}
          >
            {saving ? (
              <>
                <div className="spinner" /> Saving…
              </>
            ) : uploading ? (
              <>
                <div className="spinner" /> Uploading image…
              </>
            ) : (
              <>
                <PlusIcon className="size-5" /> {isNew ? "Schedule Post" : "Save Changes"}
              </>
            )}
          </button>
          {!isNew && (
            <button className="btn btn-danger-soft btn-block" onClick={onDelete}>
              <TrashIcon className="size-5" /> Delete Post
            </button>
          )}
        </div>
      </article>
    );
  }

  /* ------------------------------ VIEW MODE ------------------------------ */
  const p = post!;
  return (
    <article className="card fade-up overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <StatusChip status={p.status} />
        <div className="flex items-center gap-2 text-xs font-medium text-muted">
          {p.status === "PUBLISHED" && p.mock && (
            <span className="chip chip-scheduled">Mock publish</span>
          )}
          {p.attemptCount > 1 && <span>{p.attemptCount} attempts</span>}
        </div>
      </div>

      <div className="px-4 pt-3">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.imageUrl}
            alt={p.caption ? p.caption.slice(0, 80) : "Scheduled post"}
            className="w-full max-h-[460px] object-cover"
            loading="lazy"
          />
        </div>
      </div>

      {p.caption && (
        <div className="px-4 pt-3">
          <p
            className={`text-[15px] leading-relaxed ${expanded ? "caption-open" : "caption-preview"}`}
            onClick={() => setExpanded((v) => !v)}
          >
            {p.caption}
          </p>
          {!expanded && p.caption.length > 160 && (
            <button
              className="mt-1 text-sm font-semibold text-accent"
              onClick={() => setExpanded(true)}
            >
              Show more
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 px-4 pt-3">
        <div className="rounded-2xl bg-surface2 px-3.5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {p.status === "PUBLISHED" ? "Published date" : "Publish date"}
          </p>
          <p className="mt-1 text-[14px] font-semibold">
            {formatPostDate(p.publishedAt ?? p.scheduledAt, p.timezone)}
          </p>
        </div>
        <div className="rounded-2xl bg-surface2 px-3.5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {p.status === "PUBLISHED" ? "Published time" : "Publish time"}
          </p>
          <p className="mt-1 text-[14px] font-semibold">
            {formatPostTime(p.publishedAt ?? p.scheduledAt, p.timezone)}
          </p>
        </div>
      </div>
      <p className="px-4 pt-1.5 text-xs text-muted">Timezone: {p.timezone}</p>

      {p.status === "FAILED" && p.errorMessage && (
        <div className="mx-4 mt-3 rounded-2xl bg-danger-bg px-3.5 py-3">
          <p className="text-[13px] font-semibold text-danger">Publishing failed</p>
          <p className="mt-1 text-[13px] leading-relaxed text-danger">{p.errorMessage}</p>
        </div>
      )}

      {p.status === "PUBLISHING" && (
        <p className="mx-4 mt-3 rounded-2xl bg-info-bg px-3.5 py-3 text-[13px] text-info">
          Publishing to Instagram — this takes a few seconds. The card locks until it finishes.
        </p>
      )}

      {(p.status === "PUBLISHED" || p.status === "FAILED") && (
        <div className="px-4 pt-3">
          <button
            className="text-sm font-semibold text-accent"
            onClick={() => setShowDetails((v) => !v)}
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
          {showDetails && (
            <div className="mt-2 rounded-2xl bg-surface2 p-3 text-[12.5px] leading-relaxed text-muted">
              {p.instagramMediaId && (
                <p>
                  Instagram media ID:{" "}
                  <span className="font-mono text-ink">{p.instagramMediaId}</span>
                </p>
              )}
              {p.errorCode && <p>Error code: {p.errorCode}</p>}
              {p.attempts && p.attempts.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {p.attempts.map((a) => (
                    <li key={a.id} className="rounded-xl bg-surface px-2.5 py-2">
                      <p className="font-semibold text-ink">
                        Attempt {a.attemptNumber} · {a.status.toLowerCase()} ·{" "}
                        {new Date(a.startedAt).toLocaleString()}
                      </p>
                      {a.errorMessage && <p className="mt-0.5">{a.errorMessage}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 pt-4">
        {p.status === "FAILED" && (
          <button className="btn btn-primary flex-1 min-h-11!" onClick={onRetry}>
            <RetryIcon className="size-5" /> Retry
          </button>
        )}
        {(p.status === "SCHEDULED" || p.status === "FAILED") && (
          <>
            <button className="btn btn-soft flex-1 min-h-11!" onClick={onEdit}>
              <PencilIcon className="size-4.5" /> Edit
            </button>
            <button className="btn btn-danger-soft flex-1 min-h-11!" onClick={onDelete}>
              <TrashIcon className="size-4.5" /> Delete
            </button>
          </>
        )}
        {p.status === "PUBLISHED" && (
          <p className="text-xs text-muted">
            Published posts are read-only. Posted via the official Instagram API
            {p.mock ? " (mock mode — nothing was sent to Instagram)." : "."}
          </p>
        )}
      </div>
    </article>
  );
}
