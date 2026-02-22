import Link from "next/link";

export default function DownloadsPage() {
  return (
    <main className="page-shell">
      <section className="card">
        <p className="hero-kicker">Step 5 of 5</p>
        <h1 className="card-title">Letter Downloads</h1>
        <p className="muted-text">Finalize output files for records, delivery, and archival.</p>
        <ul className="invalid-list">
          <li>Download individual letters for spot checks.</li>
          <li>Download ZIP bundles for full-cycle distribution.</li>
          <li>Confirm final files before sharing externally.</li>
        </ul>
        <div className="panel-nav-actions" style={{ marginTop: "0.8rem" }}>
          <Link className="secondary-btn" href="/camp-workflow">Previous Step</Link>
          <Link className="secondary-btn" href="/workflows">Back to Workflows</Link>
          <Link className="cta-btn" href="/?panel=4">Open Downloads Tool</Link>
        </div>
      </section>
    </main>
  );
}
