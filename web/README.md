# Donation Desk (Next.js + Convex)

This app replaces the old CLI flow with a browser-based workflow:

- Upload one or more donor statement PDFs
- Extract donation records from lines containing `Payment From`
- Store parsed records in Convex
- Step 1 output: download a contributions spreadsheet (`.csv`)
- Step 2 input: upload/use spreadsheet and optionally set donation year
- Step 2 output: all donor letters in one ZIP
- Summer camp workflow: statement -> payment sheet -> camp-data merge -> camp receipts + email drafts

## Tech Stack

- Next.js (App Router)
- Convex (database + backend functions)
- PDF parsing with `pdf-parse`
- PDF letter generation with `jspdf`

## 1) Install

```bash
npm install
```

## 2) Configure Convex

Run Convex setup from this `web` folder:

```bash
npx convex dev
```

When prompted, complete login/project selection. Convex will generate the `_generated` folder under `convex/`.

Create `web/.env.local` with your deployment URL:

```bash
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

## 3) Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Access Password

The app is protected by a password gate.

- Password: `aapasddonors`

## Convex Functions

- `convex/donations.js`
  - `saveBatch`
  - `getRecentBatches`
  - `getBatchById`

Schema is defined in `convex/schema.js`.
