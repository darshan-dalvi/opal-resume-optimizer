import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface LatexTemplateOption {
  id: string;
  fileName: string;
  label: string;
  description: string;
}

interface ParsedResumeDraft {
  name: string;
  contact?: string;
  sections: Map<string, string[]>;
}

interface ExperienceEntry {
  title: string;
  company: string;
  period: string;
  location?: string;
  bullets: string[];
}

interface EducationEntry {
  degree: string;
  school: string;
  year: string;
  gpa?: string;
  location?: string;
}

interface ProjectEntry {
  name: string;
  tech?: string;
  period?: string;
  bullets: string[];
}

const TEMPLATE_METADATA: Record<string, { label: string; description: string }> = {
  template1: {
    label: "Template 1",
    description: "Modern sans-serif layout with concise section blocks and emphasized experience entries.",
  },
  template2: {
    label: "Template 2",
    description: "Classic two-column heading with dense recruiter-friendly sections and compact summaries.",
  },
  template3: {
    label: "Template 3",
    description: "Academic-style layout with structured work entries and broad section spacing.",
  },
};

const LATEX_ESCAPE_MAP: Record<string, string> = {
  "\\": String.raw`\textbackslash{}`,
  "#": String.raw`\#`,
  "$": String.raw`\$`,
  "%": String.raw`\%`,
  "&": String.raw`\&`,
  "_": String.raw`\_`,
  "{": String.raw`\{`,
  "}": String.raw`\}`,
  "~": String.raw`\textasciitilde{}`,
  "^": String.raw`\textasciicircum{}`,
  "<": String.raw`\textless{}`,
  ">": String.raw`\textgreater{}`,
};

function getTemplateDirectory() {
  return path.join(process.cwd(), "template");
}

function humanizeTemplateId(value: string) {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeLatex(value: string) {
  return value.replace(/[\\#$%&_{}~^<>]/g, (character) => LATEX_ESCAPE_MAP[character] || character);
}

function isSectionHeading(line: string) {
  return /^[A-Z][A-Z\s/&-]+$/.test(line.trim());
}

function normalizeSectionLines(lines: string[] | undefined) {
  return (lines ?? []).map((line) => line.trim()).filter(Boolean);
}

function parseResumeDraft(text: string): ParsedResumeDraft {
  const lines = text.split(/\r?\n/);
  const sections = new Map<string, string[]>();
  let name = "Resume";
  let contact: string | undefined;
  let currentSection = "";

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (name === "Resume" && trimmedLine) {
      name = trimmedLine;
      continue;
    }

    if (isSectionHeading(trimmedLine)) {
      currentSection = trimmedLine;
      sections.set(currentSection, []);
      continue;
    }

    if (!currentSection) {
      continue;
    }

    if (currentSection === "CONTACT") {
      if (!contact && trimmedLine) contact = trimmedLine;
      continue;
    }

    sections.get(currentSection)?.push(line);
  }

  return { name, contact, sections };
}

function getSection(parsedDraft: ParsedResumeDraft, sectionName: string) {
  return normalizeSectionLines(parsedDraft.sections.get(sectionName));
}

function parseExperienceEntries(lines: string[]) {
  const entries: ExperienceEntry[] = [];
  let currentEntry: ExperienceEntry | null = null;

  for (const line of lines) {
    if (line.startsWith("- ")) {
      if (currentEntry) {
        currentEntry.bullets.push(line.slice(2).trim());
      }
      continue;
    }

    if (currentEntry) {
      entries.push(currentEntry);
    }

    const [title = "", company = "", period = ""] = line.split("|").map((part) => part.trim());
    currentEntry = {
      title,
      company,
      period,
      bullets: [],
    };
  }

  if (currentEntry) {
    entries.push(currentEntry);
  }

  return entries;
}

function parseEducationEntries(lines: string[]) {
  return lines.map((line) => {
    const parts = line.split("|").map((part) => part.trim());
    const degree = parts[0] ?? "";
    const school = parts[1] ?? "";
    const year = parts[2] ?? "";
    const rest = parts.slice(3);
    const gpaEntry = rest.find((p) => /^gpa:/i.test(p));
    const gpa = gpaEntry ? gpaEntry.replace(/^gpa:/i, "").trim() : undefined;
    const location = rest.find((p) => p && !gpaEntry?.startsWith(p) && !/^gpa:/i.test(p));
    return { degree, school, year, gpa, location } satisfies EducationEntry;
  });
}

function parseSkillCategories(lines: string[]): { category: string; skills: string }[] {
  const categories: { category: string; skills: string }[] = [];
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0 && colonIdx < 60) {
      categories.push({
        category: line.slice(0, colonIdx).trim(),
        skills: line.slice(colonIdx + 1).trim(),
      });
    }
  }
  return categories;
}

function parseProjectEntries(lines: string[]): ProjectEntry[] {
  const entries: ProjectEntry[] = [];
  let current: ProjectEntry | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current) { entries.push(current); current = null; }
      continue;
    }
    if (trimmed.startsWith("- ")) {
      if (current) current.bullets.push(trimmed.slice(2).trim());
      continue;
    }
    // new project header
    if (current) entries.push(current);
    const parts = trimmed.split("|").map((p) => p.trim());
    current = { name: parts[0] ?? "", tech: parts[1], period: parts[2], bullets: [] };
  }

  if (current) entries.push(current);
  return entries.filter((e) => e.name);
}

function parseSkills(lines: string[]) {
  return lines
    .flatMap((line) => line.split("|"))
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitTitleAndDescription(value: string, fallbackTitle: string) {
  const colonIndex = value.indexOf(":");

  if (colonIndex > 0 && colonIndex < 80) {
    return {
      title: value.slice(0, colonIndex).trim(),
      description: value.slice(colonIndex + 1).trim(),
    };
  }

  return {
    title: fallbackTitle,
    description: value.trim(),
  };
}

function splitTemplateContent(templateSource: string) {
  const beginDocumentIndex = templateSource.indexOf("\\begin{document}");

  if (beginDocumentIndex === -1) {
    throw new Error("Template is missing \\begin{document}.");
  }

  const preamble = templateSource
    .slice(0, beginDocumentIndex)
    // Remove bibliography resources and biblatex (not needed and requires biber to run)
    .replace(/^.*\\addbibresource\{[^}]+\}\s*$/gm, "")
    .replace(/^.*\\usepackage(?:\[[^\]]*\])?\{biblatex\}\s*$/gm, "")
    .trimEnd();

  return {
    preamble,
  };
}

function renderSectionParagraph(title: string, content: string) {
  if (!content.trim()) {
    return "";
  }

  return `\\section{${escapeLatex(title)}}\n${escapeLatex(content)}\n`;
}

function renderTemplate1(templateSource: string, parsedDraft: ParsedResumeDraft, targetRole: string) {
  const { preamble } = splitTemplateContent(templateSource);
  const summary = getSection(parsedDraft, "PROFESSIONAL SUMMARY").join(" ");
  const experience = parseExperienceEntries(getSection(parsedDraft, "PROFESSIONAL EXPERIENCE"));
  const projects = parseProjectEntries(getSection(parsedDraft, "PROJECTS"));
  const education = parseEducationEntries(getSection(parsedDraft, "EDUCATION"));
  const certifications = getSection(parsedDraft, "CERTIFICATIONS").map((l) => (l.startsWith("- ") ? l.slice(2).trim() : l.trim())).filter(Boolean);
  const skillLines = getSection(parsedDraft, "CORE SKILLS");
  const skillCategories = parseSkillCategories(skillLines);
  const flatSkills = parseSkills(skillLines);

  const experienceBlock = experience.length
    ? `\\section{EXPERIENCE}
  \\resumeSubHeadingListStart
${experience
  .map(
    (entry) => `    \\resumeSubheading
      {${escapeLatex(entry.company || entry.title || "Experience")}}{${escapeLatex(entry.period)}}
      {${escapeLatex(entry.title || entry.company || "Role")}}{${escapeLatex(entry.location || "")}}
      \\resumeItemListStart
${entry.bullets.map((bullet) => `        \\resumeItem{${escapeLatex(bullet)}}`).join("\n")}
      \\resumeItemListEnd`,
  )
  .join("\n\n")}
  \\resumeSubHeadingListEnd`
    : "";

  const projectBlock = projects.length
    ? `\\section{PROJECTS}
    \\resumeSubHeadingListStart
${projects
  .map(
    (project) => `      \\resumeProjectHeading
          {\\textbf{${escapeLatex(project.name)}}${project.tech ? ` $|$ \\emph{\\small{${escapeLatex(project.tech)}}}` : ""}}{${escapeLatex(project.period || "")}}
${project.bullets.length ? `          \\resumeItemListStart
${project.bullets.map((b) => `            \\resumeItem{${escapeLatex(b)}}`).join("\n")}
          \\resumeItemListEnd` : ""}`,
  )
  .join("\n\n")}
    \\resumeSubHeadingListEnd`
    : "";

  const educationBlock = education.length
    ? `\\section{EDUCATION}
  \\resumeSubHeadingListStart
${education
  .map(
    (entry) => `    \\resumeSubheading
      {${escapeLatex(entry.school || entry.degree || "Education")}}{${escapeLatex(entry.year)}}
      {${escapeLatex(entry.degree || entry.school || "")}}{${entry.gpa ? escapeLatex(`GPA: ${entry.gpa}`) : escapeLatex(entry.location || "")}}`,
  )
  .join("\n")}
  \\resumeSubHeadingListEnd`
    : "";

  const certificationsBlock = certifications.length
    ? `\\section{CERTIFICATIONS}
 \\begin{itemize}[leftmargin=0in, label={}]
${certifications.map((item) => `    \\small{\\item{${escapeLatex(item)}}}`).join("\n")}
 \\end{itemize}`
    : "";

  const skillsBlock = skillCategories.length
    ? `\\section{SKILLS}
 \\begin{itemize}[leftmargin=0in, label={}]
    \\small{\\item{
${skillCategories.map((c) => `     \\textbf{${escapeLatex(c.category)}} {: ${escapeLatex(c.skills)}} \\\\`).join("\n")}
    }}
 \\end{itemize}`
    : flatSkills.length
    ? `\\section{SKILLS}
 \\begin{itemize}[leftmargin=0in, label={}]
    \\small{\\item{
     \\textbf{Keywords} {: ${escapeLatex(flatSkills.join(", "))}}
    }}
 \\end{itemize}`
    : "";

  const summaryBlock = renderSectionParagraph("SUMMARY", summary);
  const contactLine = parsedDraft.contact ? `    \\small ${escapeLatex(parsedDraft.contact)} \\\\ \\vspace{-3pt}` : "";
  const headingRoleLine = targetRole.trim()
    ? `    \\small \\texttt{${escapeLatex(targetRole.trim())}} \\\\ \\vspace{-3pt}`
    : "";

  return `${preamble}

\\begin{document}

\\begin{center}
    \\textbf{\\Huge ${escapeLatex(parsedDraft.name)}} \\\\ \\vspace{5pt}
${contactLine}
${headingRoleLine}
\\end{center}

${summaryBlock}
${experienceBlock}

${projectBlock}

${educationBlock}

${certificationsBlock}

${skillsBlock}

\\end{document}
`;
}

function renderTemplate2(templateSource: string, parsedDraft: ParsedResumeDraft, targetRole: string) {
  const { preamble } = splitTemplateContent(templateSource);
  const summary = getSection(parsedDraft, "PROFESSIONAL SUMMARY").join(" ");
  const experience = parseExperienceEntries(getSection(parsedDraft, "PROFESSIONAL EXPERIENCE"));
  const projects = parseProjectEntries(getSection(parsedDraft, "PROJECTS"));
  const education = parseEducationEntries(getSection(parsedDraft, "EDUCATION"));
  const certifications = getSection(parsedDraft, "CERTIFICATIONS").map((l) => (l.startsWith("- ") ? l.slice(2).trim() : l.trim())).filter(Boolean);
  const skillLines = getSection(parsedDraft, "CORE SKILLS");
  const skillCategories = parseSkillCategories(skillLines);
  const flatSkills = parseSkills(skillLines);

  const summaryBlock = summary
    ? `\\section{Summary}
\\resumeSubHeadingListStart
\\resumeSubItem{Professional Summary}{${escapeLatex(summary)}}
\\resumeSubHeadingListEnd`
    : "";

  const skillsBlockItems = [
    skillCategories.length
      ? skillCategories.map((c) => `\\resumeSubItem{${escapeLatex(c.category)}}{${escapeLatex(c.skills)}}`).join("\n")
      : flatSkills.length ? `\\resumeSubItem{Keywords}{${escapeLatex(flatSkills.join(", "))}}` : "",
    certifications.length ? `\\resumeSubItem{Certifications}{${escapeLatex(certifications.join(", "))}}` : "",
  ].filter(Boolean);

  const skillsBlock = skillsBlockItems.length
    ? `\\section{Skills Summary}
\\resumeSubHeadingListStart
${skillsBlockItems.join("\n")}
\\resumeSubHeadingListEnd`
    : "";

  const experienceBlock = experience.length
    ? `\\section{Experience}
\\resumeSubHeadingListStart
${experience
  .map(
    (entry) => `  \\resumeSubheading{${escapeLatex(entry.company || entry.title || "Experience")}}{${escapeLatex(entry.period)}}
    {${escapeLatex(entry.title || entry.company || "Role")}}{${escapeLatex(entry.location || "")}}
    \\resumeItemListStart
${entry.bullets.map((bullet) => `      \\item\\small{${escapeLatex(bullet)} \\vspace{-2pt}}`).join("\n")}
    \\resumeItemListEnd`,
  )
  .join("\n\n")}
\\resumeSubHeadingListEnd`
    : "";

  const projectsBlock = projects.length
    ? `\\section{Projects}
\\resumeSubHeadingListStart
${projects
  .map(
    (project) => {
      const bulletBlock = project.bullets.length
        ? `  \\resumeItemListStart
${project.bullets.map((b) => `    \\item\\small{${escapeLatex(b)} \\vspace{-2pt}}`).join("\n")}
  \\resumeItemListEnd`
        : "";
      return `\\resumeSubItem{${escapeLatex(project.name)}}{${escapeLatex([project.tech, project.period].filter(Boolean).join(" | "))}}
${bulletBlock}`;
    },
  )
  .join("\n\\vspace{2pt}\n")}
\\resumeSubHeadingListEnd`
    : "";

  const educationBlock = education.length
    ? `\\section{Education}
\\resumeSubHeadingListStart
${education
  .map(
    (entry) => `  \\resumeSubheading
      {${escapeLatex(entry.school || entry.degree || "Education")}}{${escapeLatex(entry.year)}}
      {${escapeLatex(entry.degree || entry.school || "")}}{${entry.gpa ? escapeLatex(`GPA: ${entry.gpa}`) : escapeLatex(entry.location || "")}}`,
  )
  .join("\n")}
\\resumeSubHeadingListEnd`
    : "";

  const contactLine = parsedDraft.contact ? `  ${escapeLatex(parsedDraft.contact)}\\\\` : "";

  return `${preamble}

\\begin{document}

\\begin{tabular*}{\\textwidth}{l@{\\extracolsep{\\fill}}r}
  \\textbf{{\\LARGE ${escapeLatex(parsedDraft.name)}}} & ${escapeLatex(targetRole.trim() || "Resume")}\\\\
${contactLine}
\\end{tabular*}

${summaryBlock}
\\vspace{-5pt}
${skillsBlock}
\\vspace{-5pt}
${experienceBlock}
\\vspace{-5pt}
${projectsBlock}
\\vspace{-5pt}
${educationBlock}

\\end{document}
`;
}

function renderTemplate3(templateSource: string, parsedDraft: ParsedResumeDraft, targetRole: string) {
  const { preamble } = splitTemplateContent(templateSource);
  const summary = getSection(parsedDraft, "PROFESSIONAL SUMMARY").join(" ");
  const experience = parseExperienceEntries(getSection(parsedDraft, "PROFESSIONAL EXPERIENCE"));
  const projects = parseProjectEntries(getSection(parsedDraft, "PROJECTS"));
  const education = parseEducationEntries(getSection(parsedDraft, "EDUCATION"));
  const certifications = getSection(parsedDraft, "CERTIFICATIONS").map((l) => (l.startsWith("- ") ? l.slice(2).trim() : l.trim())).filter(Boolean);
  const skillLines = getSection(parsedDraft, "CORE SKILLS");
  const skillCategories = parseSkillCategories(skillLines);
  const flatSkills = parseSkills(skillLines);

  const experienceBlock = experience.length
    ? `\\section{Work Experience}
${experience
  .map(
    (entry) => `\\begin{joblong}{${escapeLatex(`${entry.title || "Role"}${entry.company ? ` at ${entry.company}` : ""}${entry.location ? `, ${entry.location}` : ""}`)}}{${escapeLatex(entry.period)}}
${entry.bullets.map((bullet) => `\\item ${escapeLatex(bullet)}`).join("\n")}
\\end{joblong}`,
  )
  .join("\n\n")}`
    : "";

  const projectsBlock = projects.length
    ? `\\section{Projects}
${projects
  .map(
    (project) => {
      const techLine = [project.tech, project.period]
        .filter((value): value is string => Boolean(value))
        .map(escapeLatex)
        .join(" | ");
      const bulletBlock = project.bullets.length
        ? `\\begin{itemize}[nosep,leftmargin=1em,itemsep=2pt]
${project.bullets.map((b) => `\\item ${escapeLatex(b)}`).join("\n")}
\\end{itemize}`
        : "";
      return `\\begin{tabularx}{\\linewidth}{ @{}l r@{} }
\\textbf{${escapeLatex(project.name)}}${techLine ? ` & \\small{${techLine}}` : " & "} \\\\[3.75pt]
\\end{tabularx}
${bulletBlock}`;
    },
  )
  .join("\n\n")}`
    : "";

  const educationBlock = education.length
    ? `\\section{Education}
\\begin{tabularx}{\\linewidth}{@{}l X@{}}
${education
  .map(
    (entry) => `${escapeLatex(entry.year || "")}
 & ${escapeLatex(entry.degree || "Degree")} at \\textbf{${escapeLatex(entry.school || "Institution")}}${entry.gpa ? ` \\hfill \\small{${escapeLatex(entry.gpa)}}` : ""} \\\\`,
  )
  .join("\n")}
\\end{tabularx}`
    : "";

  const skillsBlock = skillCategories.length || flatSkills.length || certifications.length
    ? `\\section{Skills}
\\begin{tabularx}{\\linewidth}{@{}l X@{}}
${skillCategories.length
  ? skillCategories.map((c) => `${escapeLatex(c.category)} & \\normalsize{${escapeLatex(c.skills)}}\\\\`).join("\n")
  : flatSkills.length ? `Keywords & \\normalsize{${escapeLatex(flatSkills.join(", "))}}\\\\` : ""}
${certifications.length ? `Certifications & \\normalsize{${escapeLatex(certifications.join(", "))}}\\\\` : ""}
\\end{tabularx}`
    : "";

  const contactLine = parsedDraft.contact ? `${escapeLatex(parsedDraft.contact)} \\\\` : "";

  return `${preamble}

\\begin{document}

\\pagestyle{empty}

\\begin{tabularx}{\\linewidth}{@{} C @{} }
\\Huge{${escapeLatex(parsedDraft.name)}} \\\\[7.5pt]
${contactLine}
${experienceBlock}

${projectsBlock}

${educationBlock}

${skillsBlock}

\\end{document}
`;
}

async function readTemplateSource(templateId: string) {
  const templatePath = path.join(getTemplateDirectory(), `${templateId}.tex`);
  return readFile(templatePath, "utf8");
}

export async function listLatexTemplates(): Promise<LatexTemplateOption[]> {
  const entries = await readdir(getTemplateDirectory(), { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tex"))
    .map((entry) => {
      const id = entry.name.replace(/\.tex$/i, "");
      const metadata = TEMPLATE_METADATA[id];

      return {
        id,
        fileName: entry.name,
        label: metadata?.label || humanizeTemplateId(id),
        description: metadata?.description || "LaTeX resume template",
      } satisfies LatexTemplateOption;
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export async function renderLatexFromTemplate(templateId: string, resumeText: string, targetRole: string) {
  const templateSource = await readTemplateSource(templateId);
  const parsedDraft = parseResumeDraft(resumeText);

  switch (templateId) {
    case "template1":
      return renderTemplate1(templateSource, parsedDraft, targetRole);
    case "template2":
      return renderTemplate2(templateSource, parsedDraft, targetRole);
    case "template3":
      return renderTemplate3(templateSource, parsedDraft, targetRole);
    default:
      throw new Error(`Unsupported template: ${templateId}`);
  }
}