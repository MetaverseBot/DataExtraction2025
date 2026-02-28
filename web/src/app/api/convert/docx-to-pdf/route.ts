import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ConvertPayload = {
  fileName?: string;
  docxBase64?: string;
};

function runLibreOfficeConvert(inputPath: string, outDir: string): Promise<void> {
  const sofficePath = process.env.LIBREOFFICE_PATH?.trim() || "soffice";

  return new Promise((resolve, reject) => {
    const child = spawn(
      sofficePath,
      ["--headless", "--convert-to", "pdf", "--outdir", outDir, inputPath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `LibreOffice exited with code ${code}`));
      }
    });
  });
}

export async function POST(request: Request) {
  let workDir = "";
  try {
    const body = (await request.json()) as ConvertPayload;
    if (!body.docxBase64) {
      return NextResponse.json({ error: "Missing DOCX payload." }, { status: 400 });
    }

    const safeName = (body.fileName || "letter.docx").replace(/[^a-zA-Z0-9._-]/g, "_");
    const baseName = safeName.toLowerCase().endsWith(".docx")
      ? safeName.slice(0, -5)
      : safeName;

    workDir = join(tmpdir(), `aapasd-convert-${randomUUID()}`);
    await fs.mkdir(workDir, { recursive: true });

    const inputPath = join(workDir, `${baseName}.docx`);
    const outputPath = join(workDir, `${baseName}.pdf`);
    await fs.writeFile(inputPath, Buffer.from(body.docxBase64, "base64"));

    await runLibreOfficeConvert(inputPath, workDir);
    const pdfBuffer = await fs.readFile(outputPath);

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=\"${baseName}.pdf\"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DOCX to PDF conversion failed.";
    return NextResponse.json(
      {
        error:
          `DOCX to PDF conversion failed. Ensure LibreOffice is installed and available in PATH or LIBREOFFICE_PATH. ${message}`,
      },
      { status: 500 },
    );
  } finally {
    if (workDir) {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }
}
