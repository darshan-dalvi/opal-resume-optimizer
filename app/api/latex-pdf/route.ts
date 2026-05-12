import { NextResponse } from "next/server";

import { compileLatexToPdf, getLatexPdfCapability } from "@/lib/latex-pdf-service";

export const runtime = "nodejs";

function sanitizeFileName(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "final-resume.pdf";
}

export async function GET() {
  try {
    const capability = await getLatexPdfCapability();
    return NextResponse.json(capability);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to check LaTeX PDF export support.";
    return NextResponse.json({ available: false, message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      latex?: string;
      fileName?: string;
    };

    if (!body.latex?.trim()) {
      return NextResponse.json({ error: "latex is required." }, { status: 400 });
    }

    const capability = await getLatexPdfCapability();

    if (!capability.available) {
      return NextResponse.json({ error: capability.message }, { status: 503 });
    }

    const { pdfBuffer, engine } = await compileLatexToPdf(body.latex);
    const fileName = sanitizeFileName(body.fileName || "final-resume.pdf");
    const pdfBody = new Uint8Array(pdfBuffer);

    return new NextResponse(pdfBody, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Latex-Engine": engine,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to compile LaTeX to PDF.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}