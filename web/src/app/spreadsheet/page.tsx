import Link from "next/link";

export default function SpreadsheetPage() {
  return (
    <main className="page-shell">
      <section className="card">
        <p className="hero-kicker">Step 2 of 5</p>
        <h1 className="card-title">Spreadsheet Preview</h1>
        <p className="muted-text">Validate extracted donations before letter generation.</p>
        <ul className="invalid-list">
          <li>Review individual donations and total-per-person views.</li>
          <li>Sort and group to catch formatting or amount issues.</li>
          <li>Download CSV if external edits are needed.</li>
        </ul>
        <div className="panel-nav-actions" style={{ marginTop: "0.8rem" }}>
          <Link className="secondary-btn" href="/extract">Previous Step</Link>
          <Link className="secondary-btn" href="/generate-letters">Next Step</Link>
          <Link className="cta-btn" href="/?panel=1">Open Spreadsheet Tool</Link>
        </div>
      </section>
    </main>
  );
}
