# Donation Desk (Next.js + Supabase)

This app provides an internal browser workflow for AAPASD:

- Extract donation records from bank statement PDFs
- Review data in spreadsheet preview
- Generate letters from templates and spreadsheet uploads
- Send emails with generated letter attachments
- Run summer camp merge + receipt workflow

## Tech Stack

- Next.js (App Router)
- Supabase (database)
- PDF parsing with `pdf-parse`
- PDF generation with `jspdf`
- DOCX template rendering with `jszip`

## Setup

Install dependencies:

```bash
npm install
```

Create `web/.env.local` with required values:

```bash
SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
OWNER_PORTAL_PASSWORD=...
AUTH_SESSION_SECRET=...

# Optional automated Gmail sending
GMAIL_USER=...
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
```

Run locally:

```bash
npm run dev
```

Open `http://localhost:3000`.
