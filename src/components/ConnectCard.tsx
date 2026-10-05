"use client";

import { useState } from "react";
import type { AccountStatusDto } from "@/lib/client";
import { AlertIcon, InstagramIcon, LinkIcon, LoaderIcon } from "./icons";

interface Props {
  account: AccountStatusDto | null;
  onMockConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onRefresh: () => void;
}

export default function ConnectCard({ account, onMockConnect, onDisconnect, onRefresh }: Props) {
  const [busy, setBusy] = useState(false);
  const connected = Boolean(account?.connected);
  const mock = Boolean(account?.mock);

  const disconnect = async () => {
    if (!confirm("Disconnect Instagram? Scheduled posts will stay but can't publish until you reconnect.")) return;
    setBusy(true);
    try {
      await onDisconnect();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card overflow-hidden">
      {/* gradient strip */}
      <div
        className="h-1.5 w-full"
        style={{
          background: connected
            ? "linear-gradient(90deg,#833ab4,#e1306c,#f77737)"
            : "var(--border)",
        }}
      />
      <div className="p-4">
        {connected ? (
          <div className="flex items-center gap-3">
            {account?.profilePictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={account.profilePictureUrl}
                alt=""
                className="size-14 rounded-full border-2 border-line object-cover"
              />
            ) : (
              <div className="grid size-14 place-items-center rounded-full bg-surface2 text-accent">
                <InstagramIcon className="size-7" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[15px] font-bold">
                <span className="inline-block size-2.5 rounded-full bg-success" />
                {mock ? "Mock Instagram Connected" : "Instagram Connected"}
              </p>
              <p className="truncate text-[14px] text-muted">
                @{account?.username}
                {account?.accountType ? ` · ${account.accountType.toLowerCase()}` : ""}
              </p>
              {account?.status === "EXPIRED" && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-warn">
                  <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
                  Authorization expired — reconnect to keep publishing.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="grid size-14 place-items-center rounded-full bg-danger-bg text-danger">
              <InstagramIcon className="size-7" />
            </div>
            <div className="flex-1">
              <p className="flex items-center gap-2 text-[15px] font-bold">
                <span className="inline-block size-2.5 rounded-full bg-danger" />
                Instagram Not Connected
              </p>
              <p className="text-[13px] leading-relaxed text-muted">
                Connect with official Meta authorization. Your Instagram password is never
                shared with this app.
              </p>
            </div>
          </div>
        )}

        {/* actions */}
        <div className="mt-4">
          {!connected && account?.mockMode && (
            <button
              className="btn btn-primary btn-block"
              onClick={async () => {
                setBusy(true);
                try {
                  await onMockConnect();
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
            >
              {busy ? <div className="spinner" /> : <LinkIcon className="size-5" />}
              Connect Mock Instagram (dev mode)
            </button>
          )}
          {!connected && !account?.mockMode && (
            <a className="btn btn-primary btn-block" href="/api/instagram/connect">
              <InstagramIcon className="size-5" /> Connect Instagram
            </a>
          )}
          {connected && (
            <div className="flex gap-2">
              {mock ? (
                <button className="btn btn-soft flex-1" onClick={onRefresh}>
                  Refresh status
                </button>
              ) : (
                <a className="btn btn-soft flex-1" href="/api/instagram/connect">
                  <LinkIcon className="size-4.5" /> Reconnect
                </a>
              )}
              <button className="btn btn-danger-soft flex-1" onClick={disconnect} disabled={busy}>
                {busy ? <LoaderIcon className="size-4.5 pulse-dot" /> : null} Disconnect
              </button>
            </div>
          )}
        </div>

        {/* prerequisites / explanation */}
        <details className="mt-4 rounded-2xl bg-surface2 px-3.5 py-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-ink">
            How connecting works
          </summary>
          <div className="mt-2 space-y-2 text-[12.5px] leading-relaxed text-muted">
            <p>
              This app uses the <strong className="text-ink">official Instagram Platform
              (Meta Graph API)</strong> with OAuth login — no passwords, no browser
              automation, no scraping.
            </p>
            <p>Meta requires for publishing:</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                An Instagram <strong className="text-ink">professional account</strong>{" "}
                (Business or Creator) — switch free in Instagram → Settings → Account type.
              </li>
              <li>
                With Facebook Login (default): the Instagram account must be{" "}
                <strong className="text-ink">linked to a Facebook Page</strong> you manage.
              </li>
              <li>
                Permissions requested: <span className="font-mono">instagram_basic</span>,{" "}
                <span className="font-mono">instagram_content_publish</span> (+ Pages
                permissions to find your account).
              </li>
            </ul>
            <p>
              Only JPEG images with an aspect ratio between 4:5 and 1.91:1 can be published,
              up to 100 API-published posts per 24 h. Captions are limited to 2,200
              characters.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}
