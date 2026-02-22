"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

function resolveNextPath(nextParam: string | null): string {
  if (!nextParam || !nextParam.startsWith("/") || nextParam.startsWith("//")) {
    return "/workflows";
  }
  return nextParam;
}

export default function LoginPage() {
  const router = useRouter();
  const [passwordInput, setPasswordInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nextPath, setNextPath] = useState("/workflows");

  useEffect(() => {
    const next = resolveNextPath(new URLSearchParams(window.location.search).get("next"));
    setNextPath(next);

    void (async () => {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { authenticated?: boolean };
      if (data.authenticated) {
        setStatusMessage("Already signed in on this device. Redirecting...");
        router.replace(next);
      }
    })();
  }, [router]);

  async function handlePasswordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatusMessage(null);
    if (!passwordInput.trim()) {
      setError("Enter password.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Login failed.");
      }

      setStatusMessage("Signed in on this device.");
      router.replace(nextPath);
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : "Login failed.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <aside className="login-brand-panel">
          <p className="hero-kicker">AAPASD Operations</p>
          <h1 className="login-title">Owner-Only Access Portal</h1>
          <p className="muted-text">
            Enter the private owner password to access donation extraction, spreadsheets, and letter
            workflows.
          </p>
          <ul className="login-feature-list">
            <li>Private owner-only workspace access</li>
            <li>Server-validated secure session cookie</li>
            <li>Protected routes across the entire portal</li>
          </ul>
        </aside>

        <div className="login-form-panel">
          <h2 className="card-title">Sign In</h2>
          <p className="muted-text">Use the shared owner password.</p>
          <form className="stack-sm" onSubmit={handlePasswordLogin}>
            <label className="input-label" htmlFor="owner-password">
              Password
            </label>
            <input
              id="owner-password"
              className="file-input"
              type="password"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.currentTarget.value)}
              autoFocus
            />
            <button type="submit" className="cta-btn" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "Login"}
            </button>
            <Link className="secondary-btn" href="/">
              Back to Homepage
            </Link>
            {statusMessage ? <p className="muted-text">{statusMessage}</p> : null}
            {error ? <p className="error-text">{error}</p> : null}
          </form>
        </div>
      </section>
    </main>
  );
}
