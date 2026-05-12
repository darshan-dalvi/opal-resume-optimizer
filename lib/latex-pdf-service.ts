import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface LatexPdfCapability {
  available: boolean;
  engine?: string;
  message: string;
}

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const LATEX_ENGINES = ["pdflatex", "xelatex", "lualatex"] as const;
const COMPILE_TIMEOUT_MS = 120_000;

// ─── Remote compilation via LaTeX-on-HTTP (latex.ytotech.com) ────────────────
const LATEX_ON_HTTP_URL = "https://latex.ytotech.com/builds/sync";
const REMOTE_TIMEOUT_MS = 90_000;

async function compileWithRemoteService(
  latexSource: string,
): Promise<Buffer> {
  const payload = {
    compiler: "pdflatex",
    // "content" = plain string; "file" would be base64 — use content so pdflatex
    // receives valid LaTeX rather than a base64 blob.
    resources: [
      {
        main: true,
        content: latexSource,
      },
    ],
    options: {
      compiler: {
        // Disable biber/bibtex — our templates don't have .bib files
        bibliography: false,
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(LATEX_ON_HTTP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/pdf" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const rawText = await response.text().catch(() => "");
    let errorMessage = `LaTeX online compilation failed (HTTP ${response.status})`;
    try {
      const errorJson = JSON.parse(rawText) as {
        error?: string;
        log_files?: Record<string, string>;
      };
      const log = errorJson.log_files ? (Object.values(errorJson.log_files)[0] ?? "") : "";
      if (log) {
        // Extract lines that start with ! (TeX errors) or contain file:line: error patterns
        const errorLines = log
          .split("\n")
          .filter((l) => l.startsWith("!") || /\.tex:\d+:/.test(l))
          .slice(0, 6)
          .join("\n")
          .slice(0, 1000);
        if (errorLines) {
          errorMessage += `\nCompilation errors:\n${errorLines}`;
        } else {
          // Fallback: show last 20 lines of log
          const tail = log.split("\n").slice(-20).join("\n").slice(0, 1000);
          errorMessage += `\nLog tail:\n${tail}`;
        }
      }
    } catch {
      if (rawText) errorMessage += `: ${rawText.slice(0, 600)}`;
    }
    throw new Error(errorMessage);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("pdf")) {
    // service returned an error payload instead of a PDF
    const body = await response.text().catch(() => "");
    throw new Error(
      `LaTeX online compilation returned non-PDF response: ${body.slice(0, 400)}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── Local engine helpers ─────────────────────────────────────────────────────
function runCommand(command: string, args: string[], cwd?: string, timeoutMs = 15_000) {
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${command} timed out while running.`));
        return;
      }
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function findAvailableEngine() {
  for (const engine of LATEX_ENGINES) {
    try {
      const result = await runCommand(engine, ["--version"]);
      if (result.exitCode === 0) return engine;
    } catch {
      continue;
    }
  }
  return null;
}

function buildCompileArgs(texFileName: string) {
  return ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", texFileName];
}

function summarizeCompilerText(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-16)
    .join("\n")
    .slice(0, 2400);
}

async function readCompileLog(tempDir: string) {
  try {
    return await readFile(path.join(tempDir, "resume.log"), "utf8");
  } catch {
    return "";
  }
}

function buildCompileError(engine: string, processResult: ProcessResult, compileLog: string) {
  const details = summarizeCompilerText(
    [processResult.stdout, processResult.stderr, compileLog].filter(Boolean).join("\n"),
  );
  return details
    ? `LaTeX compilation failed with ${engine}.\n${details}`
    : `LaTeX compilation failed with ${engine}. Check that the template packages are installed.`;
}

// ─── Public API ───────────────────────────────────────────────────────────────
export async function getLatexPdfCapability(): Promise<LatexPdfCapability> {
  const engine = await findAvailableEngine();
  if (engine) {
    return { available: true, engine, message: `LaTeX PDF export available via local ${engine}.` };
  }
  // Remote service is always treated as available
  return {
    available: true,
    engine: "latex.ytotech.com",
    message: "LaTeX PDF export available via LaTeX-on-HTTP remote service.",
  };
}

export async function compileLatexToPdf(latexSource: string) {
  const localEngine = await findAvailableEngine();

  // ── Prefer local engine ──────────────────────────────────────────────────────
  if (localEngine) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "opal-latex-"));
    const texFileName = "resume.tex";
    const texFilePath = path.join(tempDir, texFileName);
    const pdfFilePath = path.join(tempDir, "resume.pdf");

    try {
      await writeFile(texFilePath, latexSource, "utf8");

      const processResult = await runCommand(
        localEngine,
        buildCompileArgs(texFileName),
        tempDir,
        COMPILE_TIMEOUT_MS,
      );

      if (processResult.exitCode !== 0) {
        const compileLog = await readCompileLog(tempDir);
        throw new Error(buildCompileError(localEngine, processResult, compileLog));
      }

      const pdfBuffer = await readFile(pdfFilePath);
      return { engine: localEngine, pdfBuffer };
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ── Fall back to remote LaTeX-on-HTTP service ────────────────────────────────
  const pdfBuffer = await compileWithRemoteService(latexSource);
  return { engine: "latex.ytotech.com (remote)", pdfBuffer };
}