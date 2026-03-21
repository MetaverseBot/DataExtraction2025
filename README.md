# AAPASD Data Extraction Executables

This repo includes standalone Windows executables for the AAPASD donor workflow.

## Executables

- `executables/Data Extraction.exe`
  - Input: folder of bank statement PDFs
  - Output: donation CSV with `Name`, `Payment Date`, and `Amount`
- `executables/File Merge.exe`
  - Input: donor spreadsheet + extra data spreadsheet
  - Output: merged CSV matched by donor name
- `executables/Letter Generation.exe`
  - Input: DOCX/TXT/MD template + folder of spreadsheets
  - Output: one letter per donor, with multiple donation rows when the donor appears multiple times
- `executables/Send Email.exe`
  - Input: path to `web/.env.local`, letters folder, spreadsheet with `Name` and `Email`
  - Output: sends matching letter attachments and writes a send report CSV
- `executables/DOCX to PDF.exe`
  - Input: folder of `.docx` files
  - Output: `.pdf` version of each DOCX in the same folder
- `executables/Temp Csv Compare.exe`
  - Input: manual CSV + generated CSV
  - Output: comparison report using `Name` and `Amount` only

## What To Install

### Required on any machine using the executables

- Windows
- LibreOffice, if using `DOCX to PDF.exe`

### Required for email sending

- A valid `web/.env.local` file with Gmail OAuth values:
  - `GMAIL_USER`
  - `GMAIL_CLIENT_ID`
  - `GMAIL_CLIENT_SECRET`
  - `GMAIL_REFRESH_TOKEN`

## LibreOffice Setup

`DOCX to PDF.exe` uses LibreOffice headless conversion through `soffice`.

Typical install path:

- `C:\Program Files\LibreOffice\program\soffice.exe`

You can make it available in either of these ways:

### Option 1: Add LibreOffice to PATH

1. Find the LibreOffice program folder:
   - `C:\Program Files\LibreOffice\program`
2. Open `Edit the system environment variables`
3. Click `Environment Variables...`
4. Edit `Path`
5. Add:
   - `C:\Program Files\LibreOffice\program`
6. Open a new Command Prompt and test:

```cmd
soffice --version
```

### Option 2: Set `LIBREOFFICE_PATH`

Set it to the full EXE path, for example:

```cmd
set LIBREOFFICE_PATH=C:\Program Files\LibreOffice\program\soffice.exe
```

## Gmail OAuth Setup For Send Email

`Send Email.exe` reads Gmail credentials from the `web/.env.local` path you provide.

### Required variables

```env
GMAIL_USER=your-email@gmail.com
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
```

### Generate a new refresh token

1. Open `https://developers.google.com/oauthplayground`
2. Click the gear icon
3. Enable `Use your own OAuth credentials`
4. Paste your `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`
5. Select scope:
   - `https://mail.google.com/`
6. Click `Authorize APIs`
7. Sign in with the Gmail account from `GMAIL_USER`
8. Click `Exchange authorization code for tokens`
9. Copy the returned `refresh_token`
10. Put it into `GMAIL_REFRESH_TOKEN`

If you get `invalid_grant: Bad Request`, the refresh token is usually expired, revoked, or generated for a different OAuth client.

## How To Use The Workflow

### 1. Extract donations from PDFs

Run:

- `executables/Data Extraction.exe`

Prompts:

- input folder path
- output folder path

Expected input:

- bank statement PDFs named with a year in the filename, such as `20250131-statements-3312-.pdf`

Outputs:

- `payment_spreadsheet_<timestamp>.csv`
- rejected-line CSV/report files when applicable

### 2. Merge extra donor data

Run:

- `executables/File Merge.exe`

Prompts:

- donor file path
- extra data file path
- output folder path

Behavior:

- matches rows by donor name
- fills blank donor-file fields with extra-data fields

### 3. Generate letters

Run:

- `executables/Letter Generation.exe`

Prompts:

- template file path
- spreadsheet folder path
- output folder path

Behavior:

- processes all valid spreadsheets in the folder (`.csv`, `.xlsx`, `.xls`)
- groups repeated donations for the same donor into one letter
- duplicates the donation table row in DOCX templates when multiple donations exist
- replaces bracket placeholders only

Common placeholders supported:

- `[Name]`
- `[Amount]`
- `[Payment Date]`
- `[Contribution Date]`
- `[Today's Date]`

### 4. Convert generated DOCX files to PDF

Run:

- `executables/DOCX to PDF.exe`

Prompt:

- folder path containing `.docx` files

Behavior:

- converts all `.docx` files in that folder to `.pdf`
- writes a conversion report CSV in the same folder

### 5. Send emails with matching letters

Run:

- `executables/Send Email.exe`

Prompts:

- path to `web/.env.local`
- letters folder path
- spreadsheet path

Spreadsheet requirements:

- must include `Name`
- must include `Email`

Behavior:

- matches donor names to letter filenames
- sends all matched letter files as attachments
- writes `send_email_report_<timestamp>.csv`

## CSV Comparison Tool

Run:

- `executables/Temp Csv Compare.exe`

Behavior:

- compares manual CSV and generated CSV
- ignores dates
- compares `Name` + `Amount` only
- writes a comparison report

## Build Notes

The standalone EXEs are built with `pkg` from these folders:

- `executables/standalone`
- `executables/standalone-merge`
- `executables/standalone-letter`
- `executables/standalone-send`
- `executables/standalone-convert`

To rebuild one:

```cmd
cd executables\standalone-convert
npm install
npm run build:exe
```

Use the matching standalone folder for the executable you want to rebuild.
