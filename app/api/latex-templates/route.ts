import { NextResponse } from "next/server";

import { listLatexTemplates, renderLatexFromTemplate } from "@/lib/latex-template-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const templates = await listLatexTemplates();
    return NextResponse.json({ templates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load LaTeX templates.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      templateId?: string;
      resumeText?: string;
      targetRole?: string;
    };

    if (!body.templateId || !body.resumeText) {
      return NextResponse.json(
        { error: "templateId and resumeText are required." },
        { status: 400 },
      );
    }

    const latex = await renderLatexFromTemplate(body.templateId, body.resumeText, body.targetRole ?? "");
    const templates = await listLatexTemplates();
    const template = templates.find((option) => option.id === body.templateId);

    return NextResponse.json({
      latex,
      template,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to render the selected LaTeX template.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}