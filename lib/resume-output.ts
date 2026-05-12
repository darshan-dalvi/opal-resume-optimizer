import type { ResumeData } from "@/lib/gemini";

export type ResumeDiffLineType = "context" | "added" | "removed";

export interface ResumeDiffLine {
  type: ResumeDiffLineType;
  value: string;
}

function normalizeInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeBullet(value: string) {
  return normalizeInlineText(value.replace(/^[\-•*]+\s*/, ""));
}

function pushSection(lines: string[], heading: string, values: string[]) {
  const filteredValues = values.map(normalizeInlineText).filter(Boolean);

  if (filteredValues.length === 0) {
    return;
  }

  if (lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }

  lines.push(heading);
  lines.push(...filteredValues);
}

export function buildEditableResumeDraft(resume: ResumeData) {
  const lines: string[] = [];

  if (resume.name?.trim()) {
    lines.push(normalizeInlineText(resume.name));
  }

  // Contact
  if (resume.contact) {
    const contactParts = [
      resume.contact.phone,
      resume.contact.email,
      resume.contact.linkedin,
      resume.contact.github,
      resume.contact.location,
    ].filter(Boolean).map((v) => normalizeInlineText(v!));
    if (contactParts.length) {
      pushSection(lines, "CONTACT", [contactParts.join(" | ")]);
    }
  }

  pushSection(lines, "PROFESSIONAL SUMMARY", [resume.summary ?? ""]);

  // Skills — prefer categorized
  if (resume.skillCategories?.length) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push("CORE SKILLS");
    for (const cat of resume.skillCategories) {
      if (cat.category && cat.skills) lines.push(`${cat.category}: ${cat.skills}`);
    }
  } else if (resume.skills?.length) {
    pushSection(lines, "CORE SKILLS", [resume.skills.join(" | ")]);
  }

  if (resume.experience?.length) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push("PROFESSIONAL EXPERIENCE");

    for (const item of resume.experience) {
      const header = [item.title, item.company, item.period, item.location]
        .map((part) => normalizeInlineText(part ?? ""))
        .filter(Boolean)
        .join(" | ");
      if (header) lines.push(header);

      for (const bullet of item.description ?? []) {
        const normalizedBullet = normalizeBullet(bullet);
        if (normalizedBullet) lines.push(`- ${normalizedBullet}`);
      }
      lines.push("");
    }

    while (lines[lines.length - 1] === "") lines.pop();
  }

  // Projects — structured with bullets
  if (resume.projects?.length) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push("PROJECTS");

    for (const project of resume.projects) {
      if (!project) continue;
      const header = [project.name, project.tech, project.period]
        .map((part) => normalizeInlineText(part ?? ""))
        .filter(Boolean)
        .join(" | ");
      if (header) lines.push(header);

      for (const bullet of project.bullets ?? []) {
        const normalizedBullet = normalizeBullet(bullet);
        if (normalizedBullet) lines.push(`- ${normalizedBullet}`);
      }
      lines.push("");
    }

    while (lines[lines.length - 1] === "") lines.pop();
  }

  if (resume.education?.length) {
    pushSection(
      lines,
      "EDUCATION",
      resume.education.map((item) =>
        [item.degree, item.school, item.year, item.gpa ? `GPA: ${item.gpa}` : "", item.location]
          .map((part) => normalizeInlineText(part ?? ""))
          .filter(Boolean)
          .join(" | "),
      ),
    );
  }

  if (resume.certifications?.length) {
    pushSection(
      lines,
      "CERTIFICATIONS",
      resume.certifications.map((item) => `- ${normalizeBullet(item)}`),
    );
  }

  return lines.join("\n").trim();
}

function buildLcsMatrix(originalLines: string[], revisedLines: string[]) {
  const matrix = Array.from({ length: originalLines.length + 1 }, () =>
    Array.from<number>({ length: revisedLines.length + 1 }).fill(0),
  );

  for (let originalIndex = originalLines.length - 1; originalIndex >= 0; originalIndex -= 1) {
    for (let revisedIndex = revisedLines.length - 1; revisedIndex >= 0; revisedIndex -= 1) {
      if (originalLines[originalIndex] === revisedLines[revisedIndex]) {
        matrix[originalIndex][revisedIndex] = matrix[originalIndex + 1][revisedIndex + 1] + 1;
      } else {
        matrix[originalIndex][revisedIndex] = Math.max(
          matrix[originalIndex + 1][revisedIndex],
          matrix[originalIndex][revisedIndex + 1],
        );
      }
    }
  }

  return matrix;
}

export function diffResumeLines(originalText: string, revisedText: string): ResumeDiffLine[] {
  const originalLines = originalText.split(/\r?\n/);
  const revisedLines = revisedText.split(/\r?\n/);
  const matrix = buildLcsMatrix(originalLines, revisedLines);
  const diffLines: ResumeDiffLine[] = [];

  let originalIndex = 0;
  let revisedIndex = 0;

  while (originalIndex < originalLines.length && revisedIndex < revisedLines.length) {
    if (originalLines[originalIndex] === revisedLines[revisedIndex]) {
      diffLines.push({ type: "context", value: originalLines[originalIndex] });
      originalIndex += 1;
      revisedIndex += 1;
      continue;
    }

    if (matrix[originalIndex + 1][revisedIndex] >= matrix[originalIndex][revisedIndex + 1]) {
      diffLines.push({ type: "removed", value: originalLines[originalIndex] });
      originalIndex += 1;
      continue;
    }

    diffLines.push({ type: "added", value: revisedLines[revisedIndex] });
    revisedIndex += 1;
  }

  while (originalIndex < originalLines.length) {
    diffLines.push({ type: "removed", value: originalLines[originalIndex] });
    originalIndex += 1;
  }

  while (revisedIndex < revisedLines.length) {
    diffLines.push({ type: "added", value: revisedLines[revisedIndex] });
    revisedIndex += 1;
  }

  return diffLines;
}

export function summarizeDiff(diffLines: ResumeDiffLine[]) {
  return diffLines.reduce(
    (summary, line) => {
      if (line.type === "added") {
        summary.added += 1;
      }

      if (line.type === "removed") {
        summary.removed += 1;
      }

      return summary;
    },
    { added: 0, removed: 0 },
  );
}

function escapeLatex(value: string) {
  return value
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/</g, "\\textless{}")
    .replace(/>/g, "\\textgreater{}");
}

function renderLatexLine(line: ResumeDiffLine) {
  if (!line.value.trim()) {
    return "\\vspace{0.5em}";
  }

  const escapedValue = escapeLatex(line.value);

  if (line.type === "added") {
    return `\\added{${escapedValue}}\\\\`;
  }

  if (line.type === "removed") {
    return `\\deleted{${escapedValue}}\\\\`;
  }

  return `${escapedValue}\\\\`;
}

export function buildLatexDiffDocument(originalText: string, revisedText: string) {
  const diffLines = diffResumeLines(originalText, revisedText);
  const body = diffLines.map(renderLatexLine).join("\n");

  return `\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage[normalem]{ulem}
\\usepackage{xcolor}
\\usepackage{changes}
\\setaddedmarkup{\\textcolor{blue}{#1}}
\\setdeletedmarkup{\\textcolor{red}{\\sout{#1}}}

\\begin{document}
\\section*{Tracked Resume Revision}
${body}
\\end{document}
`;
}

function closeItemizeBlock(lines: string[], isOpen: boolean) {
  if (isOpen) {
    lines.push("\\end{itemize}");
  }

  return false;
}

export function buildLatexResumeTemplate(text: string) {
  const lines = text.split(/\r?\n/);
  const nameLine = lines.find((line) => line.trim())?.trim() ?? "Resume";
  const bodyLines = lines.slice(lines.findIndex((line) => line.trim()) + 1);
  const latexBody: string[] = [];
  let isInsideItemize = false;

  for (const line of bodyLines) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      isInsideItemize = closeItemizeBlock(latexBody, isInsideItemize);
      latexBody.push("\\vspace{0.35em}");
      continue;
    }

    if (/^[A-Z][A-Z\s/&-]+$/.test(trimmedLine)) {
      isInsideItemize = closeItemizeBlock(latexBody, isInsideItemize);
      latexBody.push(`\\section*{${escapeLatex(trimmedLine)}}`);
      continue;
    }

    if (trimmedLine.startsWith("- ")) {
      if (!isInsideItemize) {
        latexBody.push("\\begin{itemize}");
        isInsideItemize = true;
      }

      latexBody.push(`  \\item ${escapeLatex(trimmedLine.slice(2))}`);
      continue;
    }

    isInsideItemize = closeItemizeBlock(latexBody, isInsideItemize);

    if (trimmedLine.includes("|")) {
      latexBody.push(`\\textbf{${escapeLatex(trimmedLine)}}\\\\`);
      continue;
    }

    latexBody.push(`${escapeLatex(trimmedLine)}\\\\`);
  }

  closeItemizeBlock(latexBody, isInsideItemize);

  return `\\documentclass[11pt]{article}
\\usepackage[margin=0.8in]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage[hidelinks]{hyperref}
\\usepackage{enumitem}
\\setlist[itemize]{leftmargin=1.25em, itemsep=0.2em, topsep=0.2em}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0.3em}

\\begin{document}
{\\LARGE \\textbf{${escapeLatex(nameLine)}}}\\[0.6em]
${latexBody.join("\n")}
\\end{document}
`;
}

// ─── HTML Resume Renderer (browser print-to-PDF) ────────────────────────────

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlBullets(items: string[]) {
  const rows = items
    .map((item) => item.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean)
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("\n");
  return rows ? `<ul>${rows}</ul>` : "";
}

const TEMPLATE_CSS: Record<string, string> = {
  template1: `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #111; background: #fff; padding: 0.55in 0.65in; }
    h1 { font-size: 22pt; font-weight: 800; text-align: center; letter-spacing: -0.5px; margin-bottom: 3px; }
    .contact { text-align: center; font-size: 8.5pt; color: #555; margin-bottom: 14px; }
    .contact span { margin: 0 5px; }
    section { margin-bottom: 9px; }
    .section-title { font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1.5px solid #ccc; padding-bottom: 2px; margin-bottom: 5px; }
    .exp-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1px; }
    .exp-title { font-weight: 700; font-size: 9.5pt; }
    .exp-date { font-size: 8.5pt; color: #444; white-space: nowrap; }
    .exp-sub { display: flex; justify-content: space-between; font-size: 8.8pt; color: #444; margin-bottom: 2px; }
    ul { margin: 2px 0 5px 16px; padding: 0; }
    li { font-size: 9pt; margin-bottom: 1.5px; line-height: 1.35; }
    .skills-row { font-size: 9pt; line-height: 1.55; }
    .skills-label { font-weight: 600; }
    @media print { body { padding: 0; } @page { size: letter; margin: 0.5in 0.6in; } }
  `,
  template2: `
    @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif; font-size: 10pt; color: #1a1a1a; background: #fff; padding: 0.5in 0.6in; }
    h1 { font-size: 21pt; font-weight: 700; text-align: center; margin-bottom: 3px; }
    .contact { text-align: center; font-size: 8.5pt; color: #555; margin-bottom: 12px; }
    .contact span { margin: 0 4px; }
    section { margin-bottom: 8px; }
    .section-title { font-size: 11pt; font-variant: small-caps; font-weight: 600; letter-spacing: 0.04em; border-bottom: 1px solid #999; padding-bottom: 1.5px; margin-bottom: 5px; }
    .exp-item { margin-bottom: 6px; }
    .exp-header { display: flex; justify-content: space-between; align-items: baseline; }
    .exp-title { font-weight: 700; font-size: 9.5pt; }
    .exp-date { font-size: 8.5pt; color: #555; }
    .exp-company { font-size: 9pt; color: #444; font-style: italic; margin-bottom: 2px; }
    ul { margin: 2px 0 4px 14px; padding: 0; list-style: disc; }
    li { font-size: 9pt; margin-bottom: 1.5px; line-height: 1.35; }
    .skills-row { font-size: 9pt; margin-bottom: 2px; }
    b { font-weight: 600; }
    @media print { body { padding: 0; } @page { size: A4; margin: 0.45in 0.55in; } }
  `,
  template3: `
    @import url('https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Lato', 'Helvetica Neue', Helvetica, sans-serif; font-size: 10pt; color: #222; background: #fff; padding: 0.5in 0.65in; }
    .name-block { border-bottom: 2.5px solid #e07b39; padding-bottom: 6px; margin-bottom: 12px; }
    h1 { font-size: 22pt; font-weight: 700; letter-spacing: 0.5px; color: #1a1a1a; }
    .contact { font-size: 8.5pt; color: #666; margin-top: 2px; }
    .contact span { margin-right: 10px; }
    section { margin-bottom: 10px; }
    .section-title { font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #e07b39; margin-bottom: 5px; padding-bottom: 2px; border-bottom: 1px solid #e9c8af; }
    .exp-row { display: flex; justify-content: space-between; align-items: baseline; }
    .exp-title { font-weight: 700; font-size: 9.5pt; }
    .exp-date { font-size: 8.5pt; color: #666; white-space: nowrap; }
    .exp-company { font-size: 9pt; color: #555; margin-bottom: 2px; }
    ul { margin: 2px 0 5px 15px; padding: 0; }
    li { font-size: 9pt; margin-bottom: 1.5px; line-height: 1.35; }
    .skills-group { margin-bottom: 3px; font-size: 9pt; }
    .skills-cat { font-weight: 700; color: #e07b39; }
    @media print { body { padding: 0; } @page { size: A4; margin: 0.45in 0.6in; } }
  `,
};

function renderContactHtml(resume: ResumeData) {
  if (!resume.contact) return "";
  const parts = [
    resume.contact.phone ? `<span>&#128222; ${escapeHtml(resume.contact.phone)}</span>` : "",
    resume.contact.email ? `<span><a href="mailto:${escapeHtml(resume.contact.email)}">${escapeHtml(resume.contact.email)}</a></span>` : "",
    resume.contact.linkedin ? `<span><a href="https://${escapeHtml(resume.contact.linkedin.replace(/^https?:\/\//, ""))}">${escapeHtml(resume.contact.linkedin.replace(/^https?:\/\/(www\.)?/, ""))}</a></span>` : "",
    resume.contact.github ? `<span><a href="https://${escapeHtml(resume.contact.github.replace(/^https?:\/\//, ""))}">${escapeHtml(resume.contact.github.replace(/^https?:\/\/(www\.)?/, ""))}</a></span>` : "",
    resume.contact.location ? `<span>${escapeHtml(resume.contact.location)}</span>` : "",
  ].filter(Boolean);
  if (!parts.length) return "";
  return `<div class="contact">${parts.join(" &nbsp;|&nbsp; ")}</div>`;
}

function renderSummarySection(summary: string) {
  if (!summary?.trim()) return "";
  return `<section>
  <div class="section-title">Summary</div>
  <p style="font-size:9.5pt;line-height:1.45;">${escapeHtml(summary.trim())}</p>
</section>`;
}

function renderSkillsSection(skills: string[], templateId: string, skillCategories?: { category: string; skills: string }[]) {
  if (skillCategories?.length) {
    const rows = skillCategories
      .filter((c) => c.category && c.skills)
      .map((c) => `<div class="skills-row"><span class="skills-label">${escapeHtml(c.category)}:</span> ${escapeHtml(c.skills)}</div>`)
      .join("\n");
    if (rows) return `<section>\n  <div class="section-title">Skills</div>\n  ${rows}\n</section>`;
  }

  if (!skills?.length) return "";

  if (templateId === "template3") {
    const techSkills = skills.filter((_, i) => i % 2 === 0);
    const otherSkills = skills.filter((_, i) => i % 2 !== 0);
    return `<section>\n  <div class="section-title">Skills</div>\n  ${techSkills.length ? `<div class="skills-group"><span class="skills-cat">Technical: </span>${escapeHtml(techSkills.join(", "))}</div>` : ""}\n  ${otherSkills.length ? `<div class="skills-group"><span class="skills-cat">Other: </span>${escapeHtml(otherSkills.join(", "))}</div>` : ""}\n</section>`;
  }

  return `<section>\n  <div class="section-title">Skills</div>\n  <div class="skills-row">${escapeHtml(skills.join(" \u00b7 "))}</div>\n</section>`;
}

function renderExperienceSection(experience: ResumeData["experience"]) {
  if (!experience?.length) return "";

  const items = experience.map((exp) => {
    const bullets = htmlBullets(exp.description ?? []);
    return `<div class="exp-item" style="margin-bottom:6px;">
  <div class="exp-header">
    <span class="exp-title">${escapeHtml(exp.title ?? "")}</span>
    <span class="exp-date">${escapeHtml(exp.period ?? "")}</span>
  </div>
  <div class="exp-company">${escapeHtml(exp.company ?? "")}</div>
  ${bullets}
</div>`;
  });

  return `<section>
  <div class="section-title">Experience</div>
  ${items.join("\n")}
</section>`;
}

function renderEducationSection(education: ResumeData["education"]) {
  if (!education?.length) return "";

  const items = education.map(
    (edu) => `<div class="exp-item" style="margin-bottom:4px;">
  <div class="exp-header">
    <span class="exp-title">${escapeHtml(edu.degree ?? "")}</span>
    <span class="exp-date">${escapeHtml(edu.year ?? "")}</span>
  </div>
  <div class="exp-company">${escapeHtml(edu.school ?? "")}${edu.location ? ` &mdash; ${escapeHtml(edu.location)}` : ""}</div>
  ${edu.gpa ? `<div style="font-size:8.5pt;color:#555;">${escapeHtml(edu.gpa)}</div>` : ""}
</div>`,
  );

  return `<section>
  <div class="section-title">Education</div>
  ${items.join("\n")}
</section>`;
}

function renderCertsSection(certifications: string[]) {
  if (!certifications?.length) return "";
  return `<section>
  <div class="section-title">Certifications</div>
  ${htmlBullets(certifications)}
</section>`;
}

function renderProjectsSection(projects: ResumeData["projects"]) {
  if (!projects?.length) return "";

  const items = projects.map((project) => {
    const subLine = [project.tech, project.period]
      .filter((value): value is string => Boolean(value))
      .map(escapeHtml)
      .join(" \u00b7 ");
    const bullets = htmlBullets(project.bullets ?? []);
    return `<div class="exp-item" style="margin-bottom:6px;">
  <div class="exp-header">
    <span class="exp-title">${escapeHtml(project.name ?? "")}</span>
  </div>
  ${subLine ? `<div class="exp-company">${subLine}</div>` : ""}
  ${bullets}
</div>`;
  });

  return `<section>
  <div class="section-title">Projects</div>
  ${items.join("\n")}
</section>`;
}

export function buildResumeHtml(resume: ResumeData, templateId: string): string {
  const css = TEMPLATE_CSS[templateId] ?? TEMPLATE_CSS.template1;
  const name = escapeHtml(resume.name?.trim() || "Resume");

  const nameBlock =
    templateId === "template3"
      ? `<div class="name-block"><h1>${name}</h1>${renderContactHtml(resume)}</div>`
      : `<h1>${name}</h1>${renderContactHtml(resume)}`;

  const body = [
    renderSummarySection(resume.summary),
    renderSkillsSection(resume.skills, templateId, resume.skillCategories),
    renderExperienceSection(resume.experience),
    renderEducationSection(resume.education),
    renderProjectsSection(resume.projects),
    renderCertsSection(resume.certifications),
  ]
    .filter(Boolean)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${name}</title>
<style>${css}</style>
</head>
<body>
${nameBlock}
${body}
</body>
</html>`;
}
