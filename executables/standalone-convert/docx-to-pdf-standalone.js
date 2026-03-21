#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      const trimmed = answer.trim();
      const unquoted = trimmed.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim();
      resolve(unquoted);
    });
  });
}

function runLibreOfficeConvert(inputPath, outDir) {
  const sofficePath = process.env.LIBREOFFICE_PATH?.trim() || "soffice";

  return new Promise((resolve, reject) => {
    const child = spawn(
      sofficePath,
      ["--headless", "--convert-to", "pdf", "--outdir", outDir, inputPath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || stdout || `LibreOffice exited with code ${code}`));
      }
    });
  });
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("DOCX to PDF (Standalone EXE)");
    console.log("Input: Folder containing .docx files");
    console.log("Output: PDF version of each DOCX file");
    console.log("Rule: uses LibreOffice headless conversion");
    console.log("");

    const inputFolder = await ask(rl, "DOCX folder path: ");

    if (!fs.existsSync(inputFolder) || !fs.statSync(inputFolder).isDirectory()) {
      throw new Error("DOCX folder does not exist.");
    }

    const docxFiles = fs
      .readdirSync(inputFolder)
      .filter((name) => name.toLowerCase().endsWith(".docx"))
      .map((name) => path.join(inputFolder, name));

    if (docxFiles.length === 0) {
      throw new Error("No .docx files found in the folder.");
    }

    console.log(`DOCX files found: ${docxFiles.length}`);
    console.log("");

    let converted = 0;
    const failures = [];

    for (const docxFile of docxFiles) {
      const fileName = path.basename(docxFile);
      try {
        await runLibreOfficeConvert(docxFile, inputFolder);
        converted += 1;
        console.log(`Converted: ${fileName}`);
      } catch (error) {
        failures.push({ fileName, reason: error.message });
        console.log(`Failed: ${fileName}`);
      }
    }

    const reportPath = path.join(
      inputFolder,
      `docx_to_pdf_report_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`,
    );
    const reportLines = ["File,Status,Reason"];
    for (const filePath of docxFiles) {
      const fileName = path.basename(filePath);
      const failure = failures.find((item) => item.fileName === fileName);
      if (failure) {
        reportLines.push(`"${fileName}","Failed","${String(failure.reason).replaceAll('"', '""')}"`);
      } else {
        reportLines.push(`"${fileName}","Converted",""`);
      }
    }
    fs.writeFileSync(reportPath, `${reportLines.join("\r\n")}\r\n`, "utf8");

    console.log("");
    console.log(`Done. Converted: ${converted}`);
    console.log(`Failed: ${failures.length}`);
    console.log(`Report: ${reportPath}`);
    if (failures.length > 0) {
      console.log("");
      console.log("If conversion failed, ensure LibreOffice is installed and `soffice` is available in PATH or set `LIBREOFFICE_PATH`.");
    }
  } catch (error) {
    console.error("");
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    console.log("");
    await ask(rl, "Press Enter to close...");
    rl.close();
  }
}

void main();
