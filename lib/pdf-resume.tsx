import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  pdf,
} from "@react-pdf/renderer";
import type { ResumeData } from "./gemini";

// ─── Register safe fallback fonts ────────────────────────────────────────────
// react-pdf ships Helvetica/Times/Courier as built-in PostScript fonts,
// which are embedded as proper text objects and are 100 % ATS-readable.
Font.registerHyphenationCallback((word) => [word]);

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9.5,
    paddingTop: 36,
    paddingBottom: 40,
    paddingHorizontal: 44,
    color: "#111",
    lineHeight: 1.38,
  },
  // Header
  name: {
    fontFamily: "Helvetica-Bold",
    fontSize: 18,
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  contact: {
    fontSize: 8.5,
    color: "#444",
    marginBottom: 10,
  },
  // Section
  sectionTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    borderBottomWidth: 0.75,
    borderBottomColor: "#bbb",
    borderBottomStyle: "solid",
    paddingBottom: 2,
    marginTop: 10,
    marginBottom: 4,
  },
  // Experience / project item
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 1,
  },
  itemTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9.5,
  },
  itemMeta: {
    fontSize: 8.5,
    color: "#555",
  },
  itemSub: {
    fontSize: 8.5,
    color: "#555",
    marginBottom: 1,
  },
  bullet: {
    flexDirection: "row",
    marginBottom: 1.5,
    paddingLeft: 10,
  },
  bulletDot: {
    width: 10,
    fontSize: 9,
    color: "#555",
  },
  bulletText: {
    flex: 1,
    fontSize: 9.5,
  },
  // Skills
  skillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 2,
  },
  skillLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9.5,
  },
  skillValue: {
    fontSize: 9.5,
    flex: 1,
  },
  // Cert / education plain line
  plainLine: {
    fontSize: 9.5,
    marginBottom: 2,
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function clean(v: string | undefined | null) {
  return (v ?? "").replace(/\s+/g, " ").trim();
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={S.bullet}>
      <Text style={S.bulletDot}>•</Text>
      <Text style={S.bulletText}>{clean(text)}</Text>
    </View>
  );
}

// ─── Document ─────────────────────────────────────────────────────────────────
export function ResumePdfDocument({ resume }: { resume: ResumeData }) {
  const contactParts = resume.contact
    ? [
        resume.contact.phone,
        resume.contact.email,
        resume.contact.linkedin,
        resume.contact.github,
        resume.contact.location,
      ].filter(Boolean)
    : [];

  return (
    <Document>
      <Page size="A4" style={S.page}>
        {/* ── Header ── */}
        <Text style={S.name}>{clean(resume.name)}</Text>
        {contactParts.length > 0 && (
          <Text style={S.contact}>{contactParts.join("  ·  ")}</Text>
        )}

        {/* ── Summary ── */}
        {resume.summary?.trim() && (
          <View>
            <Text style={S.sectionTitle}>Summary</Text>
            <Text style={{ fontSize: 9.5, marginBottom: 2 }}>{clean(resume.summary)}</Text>
          </View>
        )}

        {/* ── Skills ── */}
        {(resume.skillCategories?.length || resume.skills?.length) ? (
          <View>
            <Text style={S.sectionTitle}>Skills</Text>
            {resume.skillCategories?.length
              ? resume.skillCategories.map((cat, i) => (
                  <View key={i} style={S.skillsRow}>
                    <Text style={S.skillLabel}>{clean(cat.category)}: </Text>
                    <Text style={S.skillValue}>{clean(cat.skills)}</Text>
                  </View>
                ))
              : <Text style={S.plainLine}>{resume.skills.join(", ")}</Text>
            }
          </View>
        ) : null}

        {/* ── Experience ── */}
        {resume.experience?.length > 0 && (
          <View>
            <Text style={S.sectionTitle}>Experience</Text>
            {resume.experience.map((exp, i) => (
              <View key={i} style={{ marginBottom: 6 }}>
                <View style={S.itemRow}>
                  <Text style={S.itemTitle}>{clean(exp.title)}{exp.company ? ` — ${clean(exp.company)}` : ""}</Text>
                  <Text style={S.itemMeta}>{clean(exp.period)}</Text>
                </View>
                {exp.location && <Text style={S.itemSub}>{clean(exp.location)}</Text>}
                {exp.description?.map((bullet, j) => (
                  <Bullet key={j} text={bullet} />
                ))}
              </View>
            ))}
          </View>
        )}

        {/* ── Projects ── */}
        {resume.projects?.length > 0 && (
          <View>
            <Text style={S.sectionTitle}>Projects</Text>
            {resume.projects.map((proj, i) => (
              <View key={i} style={{ marginBottom: 6 }}>
                <View style={S.itemRow}>
                  <Text style={S.itemTitle}>{clean(proj.name)}</Text>
                  {proj.period && <Text style={S.itemMeta}>{clean(proj.period)}</Text>}
                </View>
                {proj.tech && <Text style={S.itemSub}>{clean(proj.tech)}</Text>}
                {proj.bullets?.map((bullet, j) => (
                  <Bullet key={j} text={bullet} />
                ))}
              </View>
            ))}
          </View>
        )}

        {/* ── Education ── */}
        {resume.education?.length > 0 && (
          <View>
            <Text style={S.sectionTitle}>Education</Text>
            {resume.education.map((edu, i) => (
              <View key={i} style={{ marginBottom: 5 }}>
                <View style={S.itemRow}>
                  <Text style={S.itemTitle}>{clean(edu.degree)}</Text>
                  <Text style={S.itemMeta}>{clean(edu.year)}</Text>
                </View>
                <Text style={S.itemSub}>
                  {clean(edu.school)}
                  {edu.location ? `  ·  ${clean(edu.location)}` : ""}
                  {edu.gpa ? `  ·  GPA: ${clean(edu.gpa)}` : ""}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Certifications ── */}
        {resume.certifications?.length > 0 && (
          <View>
            <Text style={S.sectionTitle}>Certifications</Text>
            {resume.certifications.map((cert, i) => (
              <Text key={i} style={S.plainLine}>• {clean(cert)}</Text>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}

export async function generateResumePdfBlob(resume: ResumeData): Promise<Blob> {
  return pdf(<ResumePdfDocument resume={resume} />).toBlob();
}
