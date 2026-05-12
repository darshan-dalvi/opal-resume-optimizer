import { NextResponse } from "next/server";
import { PdfReader } from "pdfreader";

export const runtime = "nodejs";

function normalizeWhitespace(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface PositionedTextItem {
  page: number;
  x: number;
  y: number;
  text: string;
}

function buildTextFromItems(items: PositionedTextItem[]) {
  const sortedItems = [...items].sort((left, right) => {
    if (left.page !== right.page) {
      return left.page - right.page;
    }

    if (Math.abs(left.y - right.y) > 0.15) {
      return left.y - right.y;
    }

    return left.x - right.x;
  });

  const lines: string[] = [];
  let currentPage = -1;
  let currentRowY: number | null = null;
  let currentLine: string[] = [];

  const flushLine = () => {
    if (currentLine.length > 0) {
      lines.push(currentLine.join(" "));
      currentLine = [];
    }
  };

  for (const item of sortedItems) {
    if (item.page !== currentPage) {
      flushLine();

      if (lines.length > 0) {
        lines.push("");
      }

      currentPage = item.page;
      currentRowY = null;
    }

    if (currentRowY === null || Math.abs(item.y - currentRowY) > 0.15) {
      flushLine();
      currentRowY = item.y;
    }

    const normalizedText = item.text.replace(/\s+/g, " ").trim();

    if (normalizedText) {
      currentLine.push(normalizedText);
    }
  }

  flushLine();

  return normalizeWhitespace(lines.join("\n"));
}

function extractPdfText(buffer: Buffer) {
  return new Promise<string>((resolve, reject) => {
    const items: PositionedTextItem[] = [];
    let currentPage = 1;

    new PdfReader().parseBuffer(buffer, (error, item) => {
      if (error) {
        reject(new Error(typeof error === "string" ? error : "Failed to extract text from PDF."));
        return;
      }

      if (!item) {
        resolve(buildTextFromItems(items));
        return;
      }

      if (typeof item.page === "number") {
        currentPage = item.page;
        return;
      }

      if (typeof item.text === "string") {
        items.push({
          page: currentPage,
          x: typeof item.x === "number" ? item.x : 0,
          y: typeof item.y === "number" ? item.y : items.length,
          text: item.text,
        });
      }
    });
  });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing PDF upload." }, { status: 400 });
    }

    const text = await extractPdfText(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ text });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to extract text from PDF.",
      },
      { status: 500 },
    );
  }
}