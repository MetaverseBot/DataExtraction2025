import Link from "next/link";

export default function CampWorkflowPage() {
  return (
    <main className="page-shell">
      <section className="card">
        <p className="hero-kicker">Step 4 of 5 (Optional)</p>
        <h1 className="card-title">Summer Camp Workflow</h1>
        <p className="muted-text">Generate camp receipts when camp data is part of this cycle.</p>
        <ul className="invalid-list">
          <li>Upload camp payment sheet from extraction output.</li>
          <li>Upload camp directory sheet to merge student details.</li>
          <li>Generate receipt PDFs and optional email drafts.</li>
        </ul>
        <div className="panel-nav-actions" style={{ marginTop: "0.8rem" }}>
          <Link className="secondary-btn" href="/generate-letters">Previous Step</Link>
          <Link className="secondary-btn" href="/downloads">Next Step</Link>
          <Link className="cta-btn" href="/?panel=3">Open Camp Tool</Link>
        </div>
      </section>
    </main>
  );
}
