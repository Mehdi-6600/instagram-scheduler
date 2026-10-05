"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { InstagramIcon } from "./icons";

interface Props {
  mode: "login" | "setup";
  /** When true, the account already exists and sign-up needs the secret. */
  needsSecret?: boolean;
}

export default function AuthForm({ mode, needsSecret }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [signupSecret, setSignupSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await api("/api/auth/login", { method: "POST", json: { email, password } });
      } else {
        await api("/api/auth/register", {
          method: "POST",
          json: { email, password, name: name || undefined, signupSecret },
        });
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <div
          className="mx-auto grid size-16 place-items-center rounded-3xl text-white shadow-xl"
          style={{ background: "linear-gradient(135deg,#833ab4,#e1306c,#f77737)" }}
        >
          <InstagramIcon className="size-8" />
        </div>
        <h1 className="mt-4 text-[22px] font-extrabold">My Instagram Scheduler</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          {mode === "login"
            ? "Sign in to your private scheduler."
            : "Create the owner account for your private scheduler."}
        </p>
      </div>

      <form onSubmit={submit} className="card space-y-3.5 p-5">
        {mode === "setup" && (
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-muted">Name</label>
            <input
              className="field"
              placeholder="Your name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-muted">Email</label>
          <input
            className="field"
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-muted">Password</label>
          <input
            className="field"
            type="password"
            required
            minLength={8}
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </div>
        {mode === "setup" && needsSecret && (
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-muted">
              Signup secret
            </label>
            <input
              className="field"
              type="password"
              required
              placeholder="From your SIGNUP_SECRET env var"
              value={signupSecret}
              onChange={(e) => setSignupSecret(e.target.value)}
            />
          </div>
        )}

        {error && (
          <p className="rounded-xl bg-danger-bg px-3 py-2.5 text-sm text-danger">{error}</p>
        )}

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? (
            <>
              <div className="spinner" /> Please wait…
            </>
          ) : mode === "login" ? (
            "Sign In"
          ) : (
            "Create Account"
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            First time setting up?{" "}
            <a href="/setup" className="font-semibold text-accent">
              Create the owner account
            </a>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <a href="/login" className="font-semibold text-accent">
              Sign in
            </a>
          </>
        )}
      </p>
    </div>
  );
}
