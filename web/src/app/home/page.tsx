"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabaseBrowser";

const cards = [
  { href: "/extract", title: "Extraction", copy: "Upload statements and extract donation rows." },
  { href: "/spreadsheet", title: "Spreadsheet Preview", copy: "Review and download extracted records." },
  { href: "/generate-letters", title: "Generate Letters", copy: "Use templates and CSV rows to generate donor letters." },
  { href: "/camp-workflow", title: "Summer Camp Workflow", copy: "Merge camp data and generate camp receipts." },
  { href: "/downloads", title: "Letter Downloads", copy: "Download individual letters or ZIP bundles." },
];

export default function HomeLandingPage() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="page-shell">
      <section className="panel-nav">
        <div className="panel-nav-head">
          <p className="hero-kicker">AAPASD Finance Workflow</p>
          <p className="muted-text">Choose a workspace page</p>
        </div>
        <div className="panel-nav-actions">
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
            <Link className="cta-btn" href={card.href}>
              Open
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
