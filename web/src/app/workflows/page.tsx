"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const cards = [
  { href: "/extract", title: "Data Extraction", copy: "Extract Data From Bank Statements" },
  { href: "/generate-letters", title: "Generate Letters", copy: "Generate Letters from Bank Statement data" },
];

export default function WorkflowsPage() {
  const router = useRouter();
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      if (!response.ok) {
        router.replace("/login?next=/workflows");
        return;
      }

      const data = (await response.json()) as { authenticated?: boolean };
      const authenticated = Boolean(data.authenticated);
      setIsSignedIn(authenticated);
      if (!authenticated) {
        router.replace("/login?next=/workflows");
      }
    })();
  }, [router]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
    window.location.assign("/login");
  }

  return (
    <main className="page-shell">
      <section className="panel-nav">
        <div className="panel-nav-head">
          <p className="hero-kicker">AAPASD Finance Workflows</p>
          <p className="muted-text">Choose a workspace page</p>
        </div>
        <div className="panel-nav-actions">
          <Link className="secondary-btn" href="/">
            Homepage
          </Link>
          {isSignedIn ? <span className="pill signed-status-pill">Signed in on this device</span> : null}
          <button type="button" className="secondary-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </section>

      <section className="dashboard-grid records-panel">
        {cards.map((card) => (
          <article key={card.href} className="card">
            <h2 className="card-title">{card.title}</h2>
            <p className="muted-text">{card.copy}</p>
            <Link className="cta-btn tool-open-btn" href={card.href}>
              Open Tool
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
