"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "motion/react";
import { 
  FileText, 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  Download, 
  BarChart3, 
  RefreshCcw, 
  Search,
  FileCode,
  ShieldCheck,
  ChevronRight,
  TrendingUp,
  Target
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { 
  AI_PROVIDER_OPTIONS,
  AIProviderId,
  AIClientConfig,
  parseResume, 
  extractJDKeywords, 
  analyzeGap, 
  optimizeResume, 
  validateOptimization,
  scoreKeywordMatch,
  ResumeData,
  JDKeywords,
  GapAnalysis,
  OptimizationEditNote,
} from "@/lib/gemini";
import {
  buildEditableResumeDraft,
  buildResumeHtml,
  diffResumeLines,
  summarizeDiff,
  type ResumeDiffLine,
} from "@/lib/resume-output";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DEFAULT_TARGET_ROLE = "Node.js backend developer";
const DEFAULT_PRIORITY_KEYWORDS =
  "Node.js, Express.js, MVC, REST APIs, application architecture, service design, PostgreSQL, Redis, performance tuning";

const PIPELINE_FLOW = [
  "Upload Resume PDF",
  "Upload JD",
  "Text Extraction Block",
  "Resume Structuring Block",
  "JD Skill Extraction Block",
  "Keyword Gap Analysis Block",
  "ATS Scoring Block",
  "Score < 90% ? Optimization Loop (up to 3 passes) : Skip",
  "Resume Validation Block",
  "Final Output Generator Block",
  "DOCX / PDF Export",
];

type PipelineLogStatus = "pending" | "active" | "done" | "skipped" | "error";

interface PipelineLogEntry {
  id: string;
  label: string;
  status: PipelineLogStatus;
  detail?: string;
}

const PIPELINE_STEPS = [
  { id: "extract-resume", label: "Text Extraction: Resume" },
  { id: "extract-jd", label: "Text Extraction: Job Description" },
  { id: "structure-resume", label: "Resume Structuring" },
  { id: "extract-keywords", label: "JD Skill Extraction" },
  { id: "gap-analysis", label: "Keyword Gap Analysis" },
  { id: "ats-scoring", label: "ATS Scoring" },
  { id: "optimization", label: "Optimization Flow" },
  { id: "validation", label: "Resume Validation" },
  { id: "output-generator", label: "Final Output Generator" },
] as const;

function parseKeywords(value: string) {
  return value
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function buildOptimizationContext(jobDescription: string, targetRole: string, focusKeywords: string[]) {
  const contextBlocks = [
    `Target role: ${targetRole.trim() || DEFAULT_TARGET_ROLE}`,
    focusKeywords.length > 0 ? `Priority keywords: ${focusKeywords.join(", ")}` : "",
  ].filter(Boolean);

  if (jobDescription.trim()) {
    contextBlocks.push(`Job description:\n${jobDescription.trim()}`);
  } else {
    contextBlocks.push(
      "Role brief:\nOptimize for Node.js backend delivery, MVC patterns, API design, system architecture, database-backed services, and maintainable application structure only when the source resume supports those claims.",
    );
  }

  return contextBlocks.join("\n\n");
}

function buildDocxParagraphs(text: string) {
  return text.split("\n").map((line, index) => {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      return new Paragraph({ text: "" });
    }

    if (index === 0) {
      return new Paragraph({
        text: trimmedLine,
        heading: HeadingLevel.TITLE,
        spacing: { after: 200 },
      });
    }

    if (/^[A-Z][A-Z\s/&-]+$/.test(trimmedLine)) {
      return new Paragraph({
        text: trimmedLine,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
      });
    }

    if (trimmedLine.startsWith("- ")) {
      return new Paragraph({
        text: trimmedLine.slice(2),
        bullet: { level: 0 },
        spacing: { after: 80 },
      });
    }

    return new Paragraph({
      children: [new TextRun(trimmedLine)],
      spacing: { after: 80 },
    });
  });
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

type Step = "upload" | "analysis" | "results";

interface AnalysisState {
  resumeText: string;
  jdText: string;
  parsedResume?: ResumeData;
  keywords?: JDKeywords;
  gap?: GapAnalysis;
  atsScore: number;
  optimizedResume?: string;
  optimizedScore?: number;
  isOptimizing: boolean;
  optimizationSkipped?: boolean;
  validation?: { pass: boolean; reasons: string[] };
  trackedChanges?: ResumeDiffLine[];
  diffSummary?: { added: number; removed: number };
  editNotes?: OptimizationEditNote[];
  appliedKeywords?: string[];
  deferredKeywords?: string[];
  latexTemplate?: string;
  latexTemplateId?: string;
  latexTemplateLabel?: string;
  atsScoreHistory?: { pass: number; score: number; label: string }[];
  optimizationIterations?: number;
}

interface AISelectionState {
  provider: AIProviderId | "";
  model: string;
  apiKey: string;
  customEndpoint: string;
  customHeaders: string;
  customApiKeyHeader: string;
  customApiKeyPrefix: string;
}

interface LatexTemplateOption {
  id: string;
  fileName: string;
  label: string;
  description: string;
}

export default function ResumeOptimizer() {
  const [step, setStep] = useState<Step>("upload");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [jdFile, setJdFile] = useState<File | null>(null);
  const [aiConfig, setAiConfig] = useState<AISelectionState>({
    provider: "",
    model: "",
    apiKey: "",
    customEndpoint: "",
    customHeaders: "",
    customApiKeyHeader: "Authorization",
    customApiKeyPrefix: "Bearer ",
  });
  const [jdText, setJdTextInput] = useState("");
  const [targetRole, setTargetRole] = useState(DEFAULT_TARGET_ROLE);
  const [priorityKeywords, setPriorityKeywords] = useState(DEFAULT_PRIORITY_KEYWORDS);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExportingLatexPdf, setIsExportingLatexPdf] = useState(false);
  const [pipelineLogs, setPipelineLogs] = useState<PipelineLogEntry[]>([]);
  const [latexTemplates, setLatexTemplates] = useState<LatexTemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateError, setTemplateError] = useState("");
  
  const [analysis, setAnalysis] = useState<AnalysisState>({
    resumeText: "",
    jdText: "",
    atsScore: 0,
    isOptimizing: false,
  });

  useEffect(() => {
    let isMounted = true;

    const loadTemplates = async () => {
      try {
        const response = await fetch("/api/latex-templates");
        const payload = (await response.json()) as {
          templates?: LatexTemplateOption[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load LaTeX templates.");
        }

        if (!isMounted) {
          return;
        }

        const templates = payload.templates ?? [];
        setLatexTemplates(templates);
        setSelectedTemplateId((currentValue) => currentValue || templates[0]?.id || "");
        setTemplateError("");
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setTemplateError(error instanceof Error ? error.message : "Unable to load LaTeX templates.");
      }
    };

    loadTemplates();

    return () => {
      isMounted = false;
    };
  }, []);

  const onResumeDrop = useCallback((acceptedFiles: File[]) => {
    setResumeFile(acceptedFiles[0]);
  }, []);

  const onJdDrop = useCallback((acceptedFiles: File[]) => {
    setJdFile(acceptedFiles[0]);
  }, []);

  const { getRootProps: getResumeProps, getInputProps: getResumeInput, isDragActive: isResumeDrag } = useDropzone({
    onDrop: onResumeDrop,
    accept: { "application/pdf": [".pdf"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] },
    multiple: false,
  });

  const { getRootProps: getJdProps, getInputProps: getJdInput, isDragActive: isJdDrag } = useDropzone({
    onDrop: onJdDrop,
    accept: { "application/pdf": [".pdf"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] },
    multiple: false,
  });

  const selectedProvider = AI_PROVIDER_OPTIONS.find((option) => option.id === aiConfig.provider);
  const selectedLatexTemplate = latexTemplates.find((option) => option.id === selectedTemplateId);
  const isCustomProvider = aiConfig.provider === "custom";
  const hasTargetContext = Boolean(jdFile || jdText.trim());
  const hasTemplateSelection = Boolean(selectedTemplateId);
  const hasAiConfig = Boolean(
    aiConfig.provider &&
      aiConfig.model.trim() &&
      aiConfig.apiKey.trim() &&
      (!isCustomProvider || aiConfig.customEndpoint.trim()),
  );

  const renderSelectedLatexTemplate = async (resumeText: string) => {
    const response = await fetch("/api/latex-templates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        templateId: selectedTemplateId,
        resumeText,
        targetRole,
      }),
    });

    const payload = (await response.json()) as {
      latex?: string;
      template?: LatexTemplateOption;
      error?: string;
    };

    if (!response.ok || !payload.latex) {
      throw new Error(payload.error || "Unable to render the selected LaTeX template.");
    }

    return payload;
  };

  const handleProviderChange = (providerValue: string) => {
    const nextProvider = AI_PROVIDER_OPTIONS.find((option) => option.id === providerValue);

    setAiConfig((prev) => ({
      ...prev,
      provider: (nextProvider?.id ?? "") as AISelectionState["provider"],
      model: nextProvider ? prev.provider === nextProvider.id && prev.model ? prev.model : nextProvider.models[0] ?? "" : "",
    }));
  };

  const buildAIClientConfig = (): AIClientConfig => ({
    provider: aiConfig.provider as AIProviderId,
    model: aiConfig.model.trim(),
    apiKey: aiConfig.apiKey.trim(),
    customEndpoint: aiConfig.customEndpoint.trim(),
    customHeaders: aiConfig.customHeaders.trim(),
    customApiKeyHeader: aiConfig.customApiKeyHeader.trim(),
    customApiKeyPrefix: aiConfig.customApiKeyPrefix,
  });

  const handleStartAnalysis = async () => {
    if (!resumeFile || !hasTargetContext || !hasAiConfig || !hasTemplateSelection) return;

    const mark = (id: string, status: PipelineLogStatus, detail?: string) =>
      setPipelineLogs(prev => prev.map(e => e.id === id ? { ...e, status, detail } : e));

    setIsProcessing(true);
    setPipelineLogs(PIPELINE_STEPS.map(s => ({ id: s.id, label: s.label, status: "pending" as PipelineLogStatus })));
    setStep("analysis");

    let activeStep = "";

    try {
      const clientConfig = buildAIClientConfig();
      const { extractTextFromFile } = await import("@/lib/document-extract");

      activeStep = "extract-resume";
      mark("extract-resume", "active");
      const extractedResumeText = await extractTextFromFile(resumeFile);
      mark("extract-resume", "done", resumeFile.name);

      activeStep = "extract-jd";
      mark("extract-jd", "active");
      let finalJdText = jdText.trim();
      if (jdFile) {
        finalJdText = await extractTextFromFile(jdFile);
      }
      mark("extract-jd", "done", jdFile ? jdFile.name : "Pasted text");

      activeStep = "structure-resume";
      mark("structure-resume", "active");
      const parsedResume = await parseResume(clientConfig, extractedResumeText);
      const editableResume = buildEditableResumeDraft(parsedResume) || extractedResumeText;
      mark("structure-resume", "done");

      const focusKeywords = parseKeywords(priorityKeywords);
      const optimizationContext = buildOptimizationContext(finalJdText, targetRole, focusKeywords);

      activeStep = "extract-keywords";
      mark("extract-keywords", "active");
      const keywords = await extractJDKeywords(clientConfig, optimizationContext);
      mark("extract-keywords", "done", `${(Object.values(keywords) as string[][]).flat().length} keywords extracted`);

      activeStep = "gap-analysis";
      mark("gap-analysis", "active");
      const gap = await analyzeGap(clientConfig, editableResume, optimizationContext);
      mark("gap-analysis", "done", `${gap.present.length} present · ${gap.missing.length} missing`);

      activeStep = "ats-scoring";
      mark("ats-scoring", "active");
      const initialKwScore = scoreKeywordMatch(editableResume, keywords);
      const score = initialKwScore.score;
      const shouldOptimize = score < 90;
      mark(
        "ats-scoring",
        "done",
        `${score}% — ${initialKwScore.matched.length} / ${initialKwScore.matched.length + initialKwScore.missing.length} keywords matched`,
      );

      const atsScoreHistory: { pass: number; score: number; label: string }[] = [
        { pass: 0, score, label: "Original" },
      ];

      let currentResume = editableResume;
      let currentScore = score;
      let currentMissing = initialKwScore.missing;
      let editNotes: OptimizationEditNote[] = [];
      let allAppliedKeywords: string[] = [];
      let deferredKeywords: string[] = [];
      let optimizationIterations = 0;
      const MAX_ITERATIONS = 3;

      if (shouldOptimize) {
        for (let iter = 1; iter <= MAX_ITERATIONS && currentScore < 90; iter++) {
          optimizationIterations = iter;
          activeStep = "optimization";
          mark(
            "optimization",
            "active",
            `Pass ${iter}/${MAX_ITERATIONS} — targeting ${currentMissing.length} missing keywords…`,
          );

          const optimized = await optimizeResume(
            clientConfig,
            currentResume,
            optimizationContext,
            currentMissing,
            targetRole.trim() || DEFAULT_TARGET_ROLE,
            focusKeywords,
            keywords,
            parsedResume,
          );

          let candidate = optimized.revisedResume.trim() || currentResume;

          // Reject heavily truncated outputs (AI hallucinated a short reply)
          if (candidate.length < currentResume.length * 0.6) {
            candidate = currentResume;
          }

          // Safety net: re-inject CONTACT section if the optimizer stripped it
          if (parsedResume.contact && !/^CONTACT\s*$/m.test(candidate)) {
            const contactParts = [
              parsedResume.contact.phone,
              parsedResume.contact.email,
              parsedResume.contact.linkedin,
              parsedResume.contact.github,
              parsedResume.contact.location,
            ].filter(Boolean);
            if (contactParts.length) {
              const firstNewline = candidate.indexOf("\n");
              const contactBlock = `\nCONTACT\n${contactParts.join(" | ")}\n`;
              if (firstNewline !== -1) {
                candidate =
                  candidate.slice(0, firstNewline) + contactBlock + candidate.slice(firstNewline + 1);
              }
            }
          }

          const reScore = scoreKeywordMatch(candidate, keywords);

          // Accept the candidate if it's the first pass OR if it improved the score
          if (iter === 1 || reScore.score > currentScore) {
            currentResume = candidate;
            currentScore = reScore.score;
            currentMissing = reScore.missing;
            editNotes = [...editNotes, ...optimized.editNotes].slice(0, 12);
            allAppliedKeywords = [
              ...new Set([...allAppliedKeywords, ...optimized.appliedKeywords]),
            ];
            deferredKeywords = optimized.deferredKeywords;
          }

          atsScoreHistory.push({ pass: iter, score: reScore.score, label: `Pass ${iter}` });

          if (currentScore >= 90) {
            mark(
              "optimization",
              "done",
              `Target reached — ${currentScore}% in ${iter} pass${iter > 1 ? "es" : ""}`,
            );
            break;
          } else if (iter === MAX_ITERATIONS) {
            mark("optimization", "done", `${iter} passes complete — best ATS score: ${currentScore}%`);
          }
        }
      } else {
        mark("optimization", "skipped", "Score ≥ 90 — optimization branch skipped");
      }

      const optimizedResume = currentResume;
      const optimizedScore = currentScore;
      const editNotesFinal = editNotes;
      const appliedKeywords = allAppliedKeywords;

      // Build the final keyword gap for display using deterministic scoring
      const finalKwScore = scoreKeywordMatch(optimizedResume, keywords);
      const displayGap: GapAnalysis = shouldOptimize
        ? {
            present: finalKwScore.matched,
            inferable: gap.inferable.filter(
              (k) => !finalKwScore.matched.some((m) => m.toLowerCase() === k.toLowerCase()),
            ),
            missing: finalKwScore.missing,
          }
        : gap;

      activeStep = "validation";
      mark("validation", "active");
      const validation = shouldOptimize
        ? await validateOptimization(clientConfig, editableResume, optimizedResume)
        : { pass: true, reasons: ["Optimization skipped because ATS score met or exceeded the 90 threshold."] };
      mark("validation", "done", validation.pass ? "Fact-check passed" : "Fact-check flagged issues");

      activeStep = "output-generator";
      mark("output-generator", "active");
      const latexPayload = await renderSelectedLatexTemplate(optimizedResume);
      mark("output-generator", "done", selectedLatexTemplate?.label ?? "Template rendered");

      const trackedChanges = diffResumeLines(editableResume, optimizedResume);

      setAnalysis({
        resumeText: editableResume,
        jdText: optimizationContext,
        parsedResume,
        keywords,
        gap: displayGap,
        atsScore: score,
        isOptimizing: false,
        optimizationSkipped: !shouldOptimize,
        optimizedResume,
        optimizedScore,
        validation,
        trackedChanges,
        diffSummary: summarizeDiff(trackedChanges),
        editNotes: editNotesFinal,
        appliedKeywords,
        deferredKeywords,
        latexTemplate: latexPayload.latex,
        latexTemplateId: latexPayload.template?.id || selectedTemplateId,
        latexTemplateLabel: latexPayload.template?.label || selectedLatexTemplate?.label,
        atsScoreHistory,
        optimizationIterations,
      });

      setStep("results");
    } catch (error) {
      if (activeStep) {
        mark(activeStep, "error", error instanceof Error ? error.message : "Failed");
      }
      console.error(error);
      alert(error instanceof Error ? error.message : "Analysis failed. Please try again.");
      setStep("upload");
    } finally {
      setIsProcessing(false);
    }
  };

  const exportDOCX = async () => {
    const text = analysis.optimizedResume || analysis.resumeText;
    const doc = new Document({
      sections: [{
        properties: {},
        children: buildDocxParagraphs(text),
      }],
    });

    const blob = await Packer.toBlob(doc);
    downloadBlob(blob, "optimized-resume.docx");
  };

  const exportPDF = async () => {
    if (!analysis.parsedResume) return;
    try {
      const { generateResumePdfBlob } = await import("@/lib/pdf-resume");
      const blob = await generateResumePdfBlob(analysis.parsedResume);
      downloadBlob(blob, "optimized-resume.pdf");
    } catch (err) {
      console.error(err);
      alert("PDF generation failed. Please try again.");
    }
  };

  const exportLatexTemplate = () => {
    const latexDocument = analysis.latexTemplate;

    if (!latexDocument) {
      return;
    }

    const blob = new Blob([latexDocument], { type: "application/x-tex;charset=utf-8" });
    downloadBlob(blob, "final-resume-template.tex");
  };

  const exportLatexPdf = async () => {
    const latexDocument = analysis.latexTemplate;
    if (!latexDocument) return;

    setIsExportingLatexPdf(true);
    try {
      const response = await fetch("/api/latex-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latex: latexDocument, fileName: "final-resume.pdf" }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Compilation failed." })) as { error?: string };
        throw new Error(err.error ?? `Server error ${response.status}`);
      }

      const blob = await response.blob();
      downloadBlob(blob, "final-resume.pdf");
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "LaTeX PDF export failed. Please try again.");
    } finally {
      setIsExportingLatexPdf(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-12 min-h-screen flex flex-col">
      <header className="mb-12 flex justify-between items-end border-b border-black/10 pb-6">
        <div>
          <h1 className="text-4xl font-black tracking-tighter uppercase mb-2">Opal Optimizer</h1>
          <p className="text-muted-foreground font-mono text-sm uppercase tracking-wider">
            Precision Resume Alignment System // v1.0
          </p>
        </div>
        <div className="flex gap-4">
          <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
          <div className="h-2 w-2 rounded-full bg-black/10" />
          <div className="h-2 w-2 rounded-full bg-black/10" />
        </div>
      </header>

      <main className="flex-1 relative">
        <AnimatePresence mode="wait">
          {step === "upload" && (
            <motion.div 
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 md:grid-cols-2 gap-8"
            >
              <div className="space-y-6">
                <div className="p-8 bg-white border border-black/5 rounded-2xl shadow-sm space-y-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <FileText className="w-5 h-5 text-blue-600" />
                    </div>
                    <h2 className="text-xl font-bold uppercase tracking-tight">Step 1: Upload Resume PDF</h2>
                  </div>
                  
                  <div 
                    {...getResumeProps()} 
                    className={cn(
                      "border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center transition-all cursor-pointer",
                      isResumeDrag ? "border-blue-500 bg-blue-50/50" : "border-black/10 hover:border-black/20"
                    )}
                  >
                    <input {...getResumeInput()} />
                    <Upload className="w-10 h-10 text-muted-foreground mb-4" />
                    {resumeFile ? (
                      <p className="text-sm font-medium text-blue-600">{resumeFile.name}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center">
                        <span className="font-semibold text-foreground">Click to upload</span> or drag and drop<br />
                        PDF preferred, DOCX supported (Max 5MB)
                      </p>
                    )}
                  </div>
                </div>

                <div className="p-8 bg-white border border-black/5 rounded-2xl shadow-sm space-y-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <Search className="w-5 h-5 text-blue-600" />
                    </div>
                    <h2 className="text-xl font-bold uppercase tracking-tight">Step 2: Upload JD + AI Provider</h2>
                  </div>

                  <div className="space-y-4">
                    <div 
                      {...getJdProps()} 
                      className={cn(
                        "border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center transition-all cursor-pointer",
                        isJdDrag ? "border-blue-500 bg-blue-50/50" : "border-black/10 hover:border-black/20"
                      )}
                    >
                      <input {...getJdInput()} />
                      <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                      {jdFile ? (
                        <p className="text-sm font-medium text-blue-600">{jdFile.name}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Upload JD PDF/DOCX or paste the JD text below</p>
                      )}
                    </div>
                    
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-black/10" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="px-2 bg-white text-muted-foreground font-mono">Or paste JD text</span>
                      </div>
                    </div>

                    <textarea
                      value={jdText}
                      onChange={(e) => setJdTextInput(e.target.value)}
                      placeholder="Paste the full job description here if you are not uploading a JD file..."
                      className="w-full h-32 p-4 rounded-xl border border-black/10 focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-sans"
                    />

                    <div className="rounded-xl border border-black/10 bg-gray-50 p-4 space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          AI provider
                        </label>
                        <select
                          value={aiConfig.provider}
                          onChange={(e) => handleProviderChange(e.target.value)}
                          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value="">Select provider</option>
                          {AI_PROVIDER_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          Model ID
                        </label>
                        <input
                          list="provider-models"
                          value={aiConfig.model}
                          onChange={(e) => setAiConfig((prev) => ({ ...prev, model: e.target.value }))}
                          placeholder={selectedProvider ? `Choose a ${selectedProvider.label} model` : "Select a provider first"}
                          disabled={!selectedProvider}
                          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-gray-100"
                        />
                        <datalist id="provider-models">
                          {selectedProvider?.models.map((model) => (
                            <option key={model} value={model} />
                          ))}
                        </datalist>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          {selectedProvider?.apiKeyLabel ?? "API key"}
                        </label>
                        <input
                          type="password"
                          value={aiConfig.apiKey}
                          onChange={(e) => setAiConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
                          placeholder={selectedProvider ? `Paste your ${selectedProvider.label} key` : "Select a provider first"}
                          disabled={!selectedProvider}
                          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-gray-100"
                        />
                      </div>

                      {isCustomProvider && (
                        <>
                          <div className="space-y-2">
                            <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                              Custom endpoint URL
                            </label>
                            <input
                              value={aiConfig.customEndpoint}
                              onChange={(e) => setAiConfig((prev) => ({ ...prev, customEndpoint: e.target.value }))}
                              placeholder="https://your-provider.example.com/v1/chat/completions"
                              className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            />
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                                API key header
                              </label>
                              <input
                                value={aiConfig.customApiKeyHeader}
                                onChange={(e) => setAiConfig((prev) => ({ ...prev, customApiKeyHeader: e.target.value }))}
                                placeholder="Authorization"
                                className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                              />
                            </div>

                            <div className="space-y-2">
                              <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                                API key prefix
                              </label>
                              <input
                                value={aiConfig.customApiKeyPrefix}
                                onChange={(e) => setAiConfig((prev) => ({ ...prev, customApiKeyPrefix: e.target.value }))}
                                placeholder="Bearer "
                                className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                              Extra headers JSON
                            </label>
                            <textarea
                              value={aiConfig.customHeaders}
                              onChange={(e) => setAiConfig((prev) => ({ ...prev, customHeaders: e.target.value }))}
                              placeholder='{"X-Workspace": "resume-optimizer"}'
                              className="w-full h-24 rounded-xl border border-black/10 bg-white p-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono"
                            />
                          </div>
                        </>
                      )}

                      <p className="text-xs text-muted-foreground">
                        {selectedProvider?.description ?? "Choose a provider, then enter a model and API key. Keys stay in this browser session."}
                      </p>
                    </div>

                    <div className="rounded-xl border border-black/10 bg-gray-50 p-4 space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-50 rounded-lg">
                          <FileCode className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                            Final output template
                          </div>
                          <div className="text-sm font-semibold text-foreground">
                            Select one of the TeX templates from the workspace
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          Resume template
                        </label>
                        <select
                          value={selectedTemplateId}
                          onChange={(e) => setSelectedTemplateId(e.target.value)}
                          disabled={!latexTemplates.length}
                          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-gray-100"
                        >
                          <option value="">Select template</option>
                          {latexTemplates.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {templateError ? (
                        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                          {templateError}
                        </p>
                      ) : (
                        <>
                          <p className="text-xs text-muted-foreground">
                            {selectedLatexTemplate?.description || "Load a template to generate the final LaTeX output from the selected file in template/."}
                          </p>
                          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                            TeX export uses the selected template. PDF export stays available after validation.
                          </p>
                        </>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        Target role hint
                      </label>
                      <input
                        value={targetRole}
                        onChange={(e) => setTargetRole(e.target.value)}
                        placeholder="Node.js backend developer"
                        className="w-full rounded-xl border border-black/10 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        Priority keywords hint
                      </label>
                      <input
                        value={priorityKeywords}
                        onChange={(e) => setPriorityKeywords(e.target.value)}
                        placeholder="Node.js, MVC, app architecture, REST APIs"
                        className="w-full rounded-xl border border-black/10 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>

                  </div>
                </div>

                <button
                  onClick={handleStartAnalysis}
                  disabled={!resumeFile || !hasTargetContext || !hasAiConfig || !hasTemplateSelection || Boolean(templateError)}
                  className="w-full py-4 bg-black text-white rounded-xl font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-black/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  Run ATS Pipeline
                  <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>

              <div className="p-10 flex flex-col justify-center">
                <div className="space-y-8">
                  <div className="space-y-2">
                    <h3 className="text-3xl font-black italic text-blue-600">Resume pipeline flow.</h3>
                    <p className="text-muted-foreground text-lg">
                      Upload the resume and JD, then the system runs extraction, structuring, scoring, conditional optimization, validation, and final template generation in sequence.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {PIPELINE_FLOW.map((item, index) => (
                      <div key={item} className="flex items-start gap-4 rounded-xl border border-black/5 bg-white p-4">
                        <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-[10px] font-black text-blue-600">
                          {index + 1}
                        </div>
                        <div>
                          <div className="font-bold uppercase text-[10px] tracking-widest text-black/80">Block {index + 1}</div>
                          <div className="text-sm text-muted-foreground">{item}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {step === "analysis" && (
            <motion.div
              key="analysis"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-16 space-y-10"
            >
              <div className="text-center space-y-3">
                <div className="relative inline-block mb-2">
                  <div className="w-16 h-16 border-4 border-black/5 rounded-full" />
                  <div className="absolute inset-0 border-4 border-blue-500 rounded-full border-t-transparent animate-spin" />
                </div>
                <h3 className="text-2xl font-bold uppercase tracking-tight">Running ATS Pipeline</h3>
                <p className="font-mono text-xs uppercase tracking-widest text-blue-600">
                  {pipelineLogs.find(l => l.status === "active")?.label ?? "Initializing..."}
                </p>
              </div>

              <div className="w-full max-w-lg space-y-2">
                {pipelineLogs.map((entry, index) => (
                  <div
                    key={entry.id}
                    className={cn(
                      "flex items-center gap-4 rounded-xl border px-4 py-3 transition-all duration-200",
                      entry.status === "active" && "border-blue-200 bg-blue-50",
                      entry.status === "done" && "border-green-100 bg-green-50/60",
                      entry.status === "skipped" && "border-black/5 bg-gray-50 opacity-60",
                      entry.status === "error" && "border-red-200 bg-red-50",
                      entry.status === "pending" && "border-black/5 bg-white opacity-40",
                    )}
                  >
                    <div className="flex-shrink-0 w-5 flex items-center justify-center">
                      {entry.status === "done" && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                      {entry.status === "active" && (
                        <div className="w-4 h-4 border-2 border-blue-500 rounded-full border-t-transparent animate-spin" />
                      )}
                      {entry.status === "error" && <AlertCircle className="w-4 h-4 text-red-500" />}
                      {(entry.status === "skipped" || entry.status === "pending") && (
                        <div className="w-4 h-4 rounded-full border-2 border-black/10 flex items-center justify-center">
                          <span className="text-[8px] font-black text-black/30">{index + 1}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={cn(
                        "text-xs font-mono uppercase tracking-widest",
                        entry.status === "active" && "text-blue-700 font-bold",
                        entry.status === "done" && "text-green-700",
                        entry.status === "error" && "text-red-700 font-bold",
                        entry.status === "pending" && "text-muted-foreground",
                        entry.status === "skipped" && "text-muted-foreground line-through",
                      )}>
                        {entry.label}
                      </div>
                      {entry.detail && (
                        <div className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
                          {entry.detail}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {step === "results" && (
            <motion.div 
              key="results"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-12"
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Score Card */}
                <div className="lg:col-span-1 space-y-6">
                  <div className="p-8 bg-white border border-black/5 rounded-2xl shadow-sm text-center">
                    <h4 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4">ATS Compatibility Score</h4>
                    <div className="relative inline-block">
                      <svg className="w-32 h-32 rotate-[-90deg]">
                        <circle cx="64" cy="64" r="58" fill="none" stroke="#f1f5f9" strokeWidth="8"/>
                        <motion.circle 
                          cx="64" cy="64" r="58" fill="none" stroke={analysis.atsScore >= 90 ? "#10b981" : "#3b82f6"} 
                          strokeWidth="8" strokeDasharray={364} 
                          initial={{ strokeDashoffset: 364 }}
                          animate={{ strokeDashoffset: 364 - (364 * analysis.atsScore / 100) }}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center flex-col">
                        <span className="text-4xl font-black">{analysis.atsScore}%</span>
                      </div>
                    </div>
                    {!analysis.optimizationSkipped && analysis.optimizedScore && analysis.optimizedScore > analysis.atsScore && (
                      <div className="mt-4 p-2 bg-green-50 rounded-lg border border-green-100">
                        <p className="text-[10px] font-bold text-green-700 uppercase tracking-wider">
                          Optimized to <span className="text-sm font-black">{analysis.optimizedScore}%</span>
                          {analysis.optimizationIterations && analysis.optimizationIterations > 1
                            ? ` in ${analysis.optimizationIterations} passes`
                            : ""}
                        </p>
                      </div>
                    )}

                    {/* Score history — shown when more than 1 data point exists */}
                    {analysis.atsScoreHistory && analysis.atsScoreHistory.length > 1 && (
                      <div className="mt-4 space-y-2 text-left">
                        <p className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1 text-center">Score progression</p>
                        {analysis.atsScoreHistory.map(({ pass, score: s, label }) => (
                          <div key={pass} className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground font-mono w-14 shrink-0">{label}</span>
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  "h-1.5 rounded-full transition-all",
                                  s >= 90 ? "bg-green-500" : s >= 70 ? "bg-blue-500" : "bg-orange-400",
                                )}
                                style={{ width: `${s}%` }}
                              />
                            </div>
                            <span className="font-bold w-9 text-right shrink-0">{s}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="p-8 bg-black text-white rounded-2xl">
                    <h4 className="text-xs font-mono uppercase tracking-widest text-white/50 mb-6">Pipeline Summary</h4>

                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="rounded-xl bg-white/5 p-4">
                        <div className="text-3xl font-black">{analysis.diffSummary?.added ?? 0}</div>
                        <div className="text-[10px] font-mono uppercase tracking-widest text-white/50">Added lines</div>
                      </div>
                      <div className="rounded-xl bg-white/5 p-4">
                        <div className="text-3xl font-black">{analysis.diffSummary?.removed ?? 0}</div>
                        <div className="text-[10px] font-mono uppercase tracking-widest text-white/50">Removed lines</div>
                      </div>
                    </div>

                    <div className="mb-6 rounded-xl bg-white/5 p-4 text-sm text-white/80">
                      {analysis.optimizationSkipped
                        ? "ATS score met the 90% threshold, so the optimization branch was skipped."
                        : analysis.optimizationIterations && analysis.optimizationIterations > 1
                        ? `Optimization ran ${analysis.optimizationIterations} passes to push the ATS score from ${analysis.atsScore}% to ${analysis.optimizedScore}%.`
                        : "ATS score was below 90%, so the optimization branch ran before validation and final output generation."}
                    </div>

                    <div className="space-y-4">
                      {analysis.appliedKeywords?.slice(0, 5).map((keyword, i) => (
                        <div key={`${keyword}-${i}`} className="flex items-center gap-3">
                          <div className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                          <span className="text-sm font-medium">Applied &quot;{keyword}&quot;</span>
                        </div>
                      ))}
                      {analysis.deferredKeywords?.slice(0, 3).map((keyword, i) => (
                        <div key={`${keyword}-${i}`} className="flex items-center gap-3">
                          <div className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
                          <span className="text-sm font-medium">Held back &quot;{keyword}&quot;</span>
                        </div>
                      ))}
                      {!analysis.appliedKeywords?.length && !analysis.deferredKeywords?.length && (
                        <p className="text-sm text-white/60">No keyword-specific edits were needed for this draft.</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Gap Analysis */}
                <div className="lg:col-span-2 space-y-6">
                  <div className="p-8 bg-white border border-black/5 rounded-2xl shadow-sm">
                    <div className="flex justify-between items-center mb-8">
                      <h3 className="text-xl font-bold uppercase tracking-tight flex items-center gap-2">
                        <BarChart3 className="w-5 h-5" />
                        Keyword Gap Matrix
                      </h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 text-green-600 font-bold text-[10px] uppercase tracking-widest">
                          <CheckCircle2 className="w-4 h-4" /> Present
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {analysis.gap?.present.map(s => <span key={s} className="px-2 py-1 bg-green-50 text-[10px] font-mono border border-green-100 rounded tracking-tight">{s}</span>)}
                        </div>
                      </div>
                      <div className="space-y-4 font-mono">
                        <div className="flex items-center gap-2 text-yellow-600 font-bold text-[10px] uppercase tracking-widest">
                          <RefreshCcw className="w-4 h-4" /> Inferable
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {analysis.gap?.inferable.map(s => <span key={s} className="px-2 py-1 bg-yellow-50 text-[10px] font-mono border border-yellow-100 rounded tracking-tight">{s}</span>)}
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 text-red-600 font-bold text-[10px] uppercase tracking-widest">
                          <AlertCircle className="w-4 h-4" /> Missing
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {analysis.gap?.missing.map(s => <span key={s} className="px-2 py-1 bg-red-50 text-[10px] font-mono border border-red-100 rounded tracking-tight">{s}</span>)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {analysis.optimizedResume && (
                    <div className="p-8 bg-white border border-black/5 rounded-2xl shadow-sm">
                      <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xl font-bold uppercase tracking-tight flex items-center gap-2">
                          <RefreshCcw className="w-5 h-5 text-blue-500" />
                          Validated Final Resume
                        </h3>
                        {analysis.validation && (
                          <div className={cn(
                            "flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold tracking-widest",
                            analysis.validation.pass ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                          )}>
                            {analysis.validation.pass ? <ShieldCheck className="w-3 h-3"/> : <AlertCircle className="w-3 h-3"/>}
                            {analysis.validation.pass ? "FACT-PASS" : "FACT-FAIL"}
                          </div>
                        )}
                      </div>

                      <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4">
                        {analysis.optimizationSkipped
                          ? "Optimization branch skipped. Structured resume validated and passed to final output generation."
                          : "Optimization branch completed. Validated resume is ready for output generation and export."}
                      </p>

                      <div className="bg-gray-50 rounded-xl p-6 h-[400px] overflow-y-auto mb-6">
                        <pre className="text-xs font-sans whitespace-pre-wrap leading-relaxed text-gray-700">
                          {analysis.optimizedResume}
                        </pre>
                      </div>

                      {analysis.validation && !analysis.validation.pass && analysis.validation.reasons.length > 0 && (
                        <div className="mb-6 rounded-xl border border-red-100 bg-red-50 p-4 text-xs text-red-700">
                          {analysis.validation.reasons.slice(0, 3).join(" // ")}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-4">
                        <button 
                          onClick={exportDOCX}
                          className="flex-1 min-w-[180px] py-3 bg-black text-white rounded-xl font-bold uppercase text-xs tracking-widest flex items-center justify-center gap-2 hover:bg-black/80 transition-all"
                        >
                          <Download className="w-4 h-4" /> Export Word DOCX
                        </button>
                        <button 
                          onClick={exportPDF}
                          disabled={!analysis.parsedResume}
                          className="flex-1 min-w-[180px] border border-black text-black rounded-xl font-bold uppercase text-xs tracking-widest flex items-center justify-center gap-2 hover:bg-black hover:text-white transition-all py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Download className="w-4 h-4" /> Export PDF
                        </button>
                        <button 
                          onClick={exportLatexTemplate}
                          className="flex-1 min-w-[180px] border border-black text-black rounded-xl font-bold uppercase text-xs tracking-widest flex items-center justify-center gap-2 hover:bg-black hover:text-white transition-all py-3"
                        >
                          <Download className="w-4 h-4" /> Export TeX Source
                        </button>
                      </div>
                    </div>
                  )}

                  {analysis.latexTemplate && (
                    <div className="p-8 bg-white border border-black/5 rounded-2xl shadow-sm">
                      <div className="flex justify-between items-center mb-6 gap-4">
                        <h3 className="text-xl font-bold uppercase tracking-tight flex items-center gap-2">
                          <FileCode className="w-5 h-5 text-blue-500" />
                          Final Output Generator
                        </h3>
                        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          {(analysis.latexTemplateLabel || selectedLatexTemplate?.label || "LaTeX template output").toUpperCase()}
                        </p>
                      </div>

                      <div className="rounded-xl bg-gray-50 p-6 max-h-[420px] overflow-y-auto">
                        <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-gray-700">
                          {analysis.latexTemplate}
                        </pre>
                      </div>

                      <div className="mt-6 flex flex-wrap gap-4">
                        <button
                          onClick={exportLatexTemplate}
                          className="flex-1 min-w-[180px] border border-black text-black rounded-xl font-bold uppercase text-xs tracking-widest flex items-center justify-center gap-2 hover:bg-black hover:text-white transition-all py-3"
                        >
                          <Download className="w-4 h-4" /> Export TeX Source
                        </button>
                        <button
                          onClick={exportLatexPdf}
                          disabled={!analysis.latexTemplate || isExportingLatexPdf}
                          className="flex-1 min-w-[180px] py-3 bg-black text-white rounded-xl font-bold uppercase text-xs tracking-widest flex items-center justify-center gap-2 hover:bg-black/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Download className="w-4 h-4" />
                          {isExportingLatexPdf ? "Compiling…" : "Export LaTeX PDF"}
                        </button>
                      </div>

                      <p className="mt-4 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        LaTeX PDF is compiled server-side via pdflatex — preserves template fonts, spacing, and layout exactly.
                      </p>
                    </div>
                  )}

                  {analysis.trackedChanges && analysis.trackedChanges.length > 0 && analysis.diffSummary && (analysis.diffSummary.added > 0 || analysis.diffSummary.removed > 0) && (
                    <div className="p-8 bg-white border border-black/5 rounded-2xl shadow-sm">
                      <div className="flex justify-between items-center mb-6 gap-4">
                        <h3 className="text-xl font-bold uppercase tracking-tight flex items-center gap-2">
                          <FileCode className="w-5 h-5 text-blue-500" />
                          Tracked Changes
                        </h3>
                        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          {analysis.diffSummary?.added ?? 0} additions // {analysis.diffSummary?.removed ?? 0} removals
                        </p>
                      </div>

                      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                        {analysis.trackedChanges.map((line, index) => (
                          <div
                            key={`${line.type}-${index}`}
                            className={cn(
                              "rounded-xl border px-4 py-3 text-xs font-mono whitespace-pre-wrap",
                              line.type === "added" && "border-blue-200 bg-blue-50 text-blue-900",
                              line.type === "removed" && "border-red-200 bg-red-50 text-red-800",
                              line.type === "context" && "border-black/5 bg-gray-50 text-gray-700",
                            )}
                          >
                            <span className="mr-2 inline-flex min-w-4 justify-center font-black">
                              {line.type === "added" ? "+" : line.type === "removed" ? "-" : "="}
                            </span>
                            <span className={cn(line.type === "removed" && "line-through")}>
                              {line.value || "[blank line]"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {analysis.editNotes && analysis.editNotes.length > 0 && (
                    <div className="p-8 bg-white border border-black/5 rounded-2xl shadow-sm">
                      <div className="flex justify-between items-center mb-6 gap-4">
                        <h3 className="text-xl font-bold uppercase tracking-tight flex items-center gap-2">
                          <Target className="w-5 h-5 text-blue-500" />
                          Highlighted Modifications
                        </h3>
                        <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          Stronger phrasing // ATS format // keyword alignment
                        </p>
                      </div>

                      <div className="space-y-4">
                        {analysis.editNotes.map((note, index) => (
                          <div key={`${note.category}-${index}`} className="rounded-xl border border-black/5 p-4 space-y-3">
                            <div className="text-[10px] font-mono uppercase tracking-widest text-blue-600">
                              {note.category}
                            </div>
                            <p className="text-sm text-muted-foreground">{note.rationale}</p>
                            <div className="space-y-2 text-xs">
                              <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                                <div className="mb-1 text-[10px] font-mono uppercase tracking-widest text-red-600">Before</div>
                                <p className="whitespace-pre-wrap text-gray-700">{note.before}</p>
                              </div>
                              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                                <div className="mb-1 text-[10px] font-mono uppercase tracking-widest text-blue-600">After</div>
                                <p className="whitespace-pre-wrap text-gray-700">{note.after}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-center pt-8">
                <button 
                  onClick={() => setStep("upload")}
                  className="text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-black transition-colors"
                >
                  Start New Optimization Session
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="mt-20 border-t border-black/5 pt-8 flex justify-between items-center opacity-30 grayscale hover:opacity-100 transition-all">
        <p className="font-mono text-[10px] uppercase">Opal AI Systems // Confidential</p>
        <div className="flex gap-6">
          <span className="font-mono text-[10px] uppercase tracking-tighter">ATS-COMPLIANT</span>
          <span className="font-mono text-[10px] uppercase tracking-tighter">MULTI-PROVIDER</span>
          <span className="font-mono text-[10px] uppercase tracking-tighter">SECURE PIPELINE</span>
        </div>
      </footer>
    </div>
  );
}
