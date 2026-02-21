"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabaseBrowser";

function resolveNextPath(nextParam: string | null): string {
  if (!nextParam || !nextParam.startsWith("/") || nextParam.startsWith("//")) {
    return "/home";
  }
  return nextParam;
}

export default function LoginPage() {
  const router = useRouter();
  const [emailInput, setEmailInput] = useState("");
  const [nextPath, setNextPath] = useState("/home");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const next = resolveNextPath(new URLSearchParams(window.location.search).get("next"));
    setNextPath(next);

    const supabase = getSupabaseBrowser();
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        router.replace(next);
      }
    });
  }, [router]);

  async function handleEmailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatusMessage(null);

    const email = emailInput.trim().toLowerCase();
    if (!email) {
      setError("Enter your email address.");
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = getSupabaseBrowser();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: false,
        },
      });

      if (signInError) {
        throw signInError;
      }

      setStatusMessage("Check your email for a secure sign-in link.");
    } catch (loginError) {
      const message =
        loginError instanceof Error ? loginError.message : "Failed to send sign-in email.";
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
            Sign in with your approved owner email to access donation extraction, spreadsheets, and
            letter workflows.
          </p>
          <ul className="login-feature-list">
            <li>Email-based secure login (no shared password)</li>
            <li>Allowlisted owner accounts only</li>
            <li>Server-validated sessions on every protected route</li>
          </ul>
        </aside>

        <div className="login-form-panel">
          <h2 className="card-title">Sign In</h2>
          <p className="muted-text">Use your approved email address to receive a one-time magic link.</p>
          <form className="stack-sm" onSubmit={handleEmailLogin}>
            <label className="input-label" htmlFor="owner-email">
              Owner Email
            </label>
            <input
              id="owner-email"
              className="file-input"
              type="email"
              value={emailInput}
              onChange={(event) => setEmailInput(event.currentTarget.value)}
              autoComplete="email"
              autoFocus
            />
            <button type="submit" className="cta-btn" disabled={isSubmitting}>
              {isSubmitting ? "Sending link..." : "Send Magic Link"}
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
