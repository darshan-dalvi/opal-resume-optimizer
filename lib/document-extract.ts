function normalizeWhitespace(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getFileExtension(file: File) {
  const parts = file.name.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

async function extractPdfText(file: File) {
  const formData = new FormData();
  formData.append("file", file, file.name);

  const response = await fetch("/api/extract-text", {
    method: "POST",
    body: formData,
  });

  const payload = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.error || "Failed to extract PDF text.");
  }

  return normalizeWhitespace(payload?.text || "");
}

async function extractDocxText(file: File) {
  const mammoth = await import("mammoth/mammoth.browser");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return normalizeWhitespace(result.value);
}

export async function extractTextFromFile(file: File): Promise<string> {
  const fileExtension = getFileExtension(file);

  if (file.type === "application/pdf" || fileExtension === "pdf") {
    return extractPdfText(file);
  }

  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileExtension === "docx"
  ) {
    return extractDocxText(file);
  }

  return normalizeWhitespace(await file.text());
}