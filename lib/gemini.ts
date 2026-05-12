export type AIProviderId = "openai" | "anthropic" | "gemini" | "groq" | "openrouter" | "custom";

export interface AIProviderOption {
  id: AIProviderId;
  label: string;
  description: string;
  models: string[];
  apiKeyLabel: string;
}

export interface AIClientConfig {
  provider: AIProviderId;
  model: string;
  apiKey: string;
  customEndpoint?: string;
  customHeaders?: string;
  customApiKeyHeader?: string;
  customApiKeyPrefix?: string;
}

export const AI_PROVIDER_OPTIONS: AIProviderOption[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "GPT models via the Chat Completions API.",
    models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"],
    apiKeyLabel: "OpenAI API key",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude models via the Messages API.",
    models: ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
    apiKeyLabel: "Anthropic API key",
  },
  {
    id: "gemini",
    label: "Gemini",
    description: "Google Gemini via the public generateContent endpoint.",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    apiKeyLabel: "Gemini API key",
  },
  {
    id: "groq",
    label: "Groq",
    description: "OpenAI-compatible low-latency inference.",
    models: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    apiKeyLabel: "Groq API key",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Route to many hosted models behind one API key.",
    models: ["inclusionai/ring-2.6-1t:free","openai/gpt-4.1-mini", "anthropic/claude-3.7-sonnet", "google/gemini-2.5-flash"],
    apiKeyLabel: "OpenRouter API key",
  },
  {
    id: "custom",
    label: "Custom config",
    description: "Use a custom OpenAI-compatible endpoint and headers.",
    models: [],
    apiKeyLabel: "Provider API key",
  },
];

export interface ResumeData {
  name: string;
  contact?: {
    phone?: string;
    email?: string;
    linkedin?: string;
    github?: string;
    location?: string;
  };
  summary: string;
  skills: string[];
  skillCategories?: { category: string; skills: string }[];
  experience: {
    title: string;
    company: string;
    period: string;
    location?: string;
    description: string[];
  }[];
  education: {
    degree: string;
    school: string;
    year: string;
    gpa?: string;
    location?: string;
  }[];
  certifications: string[];
  projects: {
    name: string;
    tech?: string;
    period?: string;
    bullets: string[];
  }[];
}

export interface JDKeywords {
  hardSkills: string[];
  softSkills: string[];
  industryTerms: string[];
  toolsAndTech: string[];
  seniorityIndicators: string[];
}

export interface GapAnalysis {
  present: string[];
  inferable: string[];
  missing: string[];
}

export interface OptimizationEditNote {
  category: "phrasing" | "keyword" | "formatting" | "structure";
  before: string;
  after: string;
  rationale: string;
}

export interface OptimizationResult {
  revisedResume: string;
  appliedKeywords: string[];
  deferredKeywords: string[];
  editNotes: OptimizationEditNote[];
}

const SYSTEM_PROMPT =
  "You are a careful resume optimization assistant. Follow instructions exactly, preserve truthfulness, and return machine-readable output when asked.";

function extractOpenAICompatibleText(data: unknown) {
  const payload = data as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part?.type === "text" ? part.text ?? "" : ""))
      .join("\n")
      .trim();
  }

  return "";
}

function extractAnthropicText(data: unknown) {
  const payload = data as {
    content?: Array<{ type?: string; text?: string }>;
  };

  return (
    payload.content
      ?.map((part) => (part?.type === "text" ? part.text ?? "" : ""))
      .join("\n")
      .trim() ?? ""
  );
}

function extractGeminiText(data: unknown) {
  const payload = data as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  return (
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("\n")
      .trim() ?? ""
  );
}

function extractProviderError(data: unknown, rawText?: string) {
  if (typeof data === "string") {
    return data.trim() || "Provider returned an unknown error.";
  }

  const payload = data as Record<string, unknown>;
  const error = payload.error;

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error === "object") {
    const errorMessage = (error as { message?: unknown }).message;
    const errorType = (error as { type?: unknown }).type;
    const errorCode = (error as { code?: unknown }).code;
    const errorDetail = (error as { detail?: unknown }).detail ?? (error as { details?: unknown }).details;

    if (typeof errorMessage === "string" && errorMessage.trim()) {
      const meta = [errorCode, errorType].filter((value) => typeof value === "string" && value).join(" / ");
      return meta ? `${errorMessage} (${meta})` : errorMessage;
    }

    if (typeof errorDetail === "string" && errorDetail.trim()) {
      return errorDetail;
    }

    const errorKeys = Object.entries(error)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => `${key}: ${value}`)
      .join("; ");
    if (errorKeys) {
      return errorKeys;
    }
  }

  const message = payload.message;
  if (typeof message === "string" && message.trim()) {
    return message;
  }

  const status = payload.status;
  const code = payload.code;
  if ((typeof status === "string" || typeof status === "number") && (typeof code === "string" || typeof code === "number")) {
    return `Provider returned status ${status} code ${code}`;
  }

  if (typeof rawText === "string" && rawText.trim()) {
    return `Provider returned error: ${rawText.trim().slice(0, 1200)}`;
  }

  return "Provider returned an unknown error.";
}

async function parseResponseBody(response: Response) {
  const text = await response.text();
  const parsed = tryParseJsonResponse<unknown>(text);
  return { data: parsed ?? text, rawText: text };
}

function parseCustomHeaders(rawHeaders?: string) {
  if (!rawHeaders?.trim()) {
    return {} as Record<string, string>;
  }

  try {
    const parsed = JSON.parse(rawHeaders) as Record<string, unknown>;

    return Object.entries(parsed).reduce<Record<string, string>>((headers, [key, value]) => {
      headers[key] = String(value);
      return headers;
    }, {});
  } catch {
    throw new Error("Custom headers must be valid JSON.");
  }
}

function cleanTextResponse(text: string) {
  return text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
}

function extractJsonBlock(text: string) {
  const cleanedText = cleanTextResponse(text);
  const objectStart = cleanedText.indexOf("{");
  const objectEnd = cleanedText.lastIndexOf("}");

  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
    return cleanedText.slice(objectStart, objectEnd + 1);
  }

  const arrayStart = cleanedText.indexOf("[");
  const arrayEnd = cleanedText.lastIndexOf("]");

  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    return cleanedText.slice(arrayStart, arrayEnd + 1);
  }

  return cleanedText;
}

function tryParseJsonResponse<T>(responseText: string) {
  try {
    return JSON.parse(extractJsonBlock(responseText)) as T;
  } catch {
    return null;
  }
}

async function parseJsonResponseWithRepair<T>(
  config: AIClientConfig,
  responseText: string,
  label: string,
  jsonShape: string,
  extraRules: string[] = [],
) {
  const parsedResponse = tryParseJsonResponse<T>(responseText);

  if (parsedResponse !== null) {
    return parsedResponse;
  }

  const repairedResponseText = await generateText(
    config,
    `Convert the following content into strict valid JSON.

Rules:
- Return JSON only
- Preserve the original meaning and wording as closely as possible
- Do not add facts, metrics, tools, or commentary
- Remove markdown fences and any explanatory text outside the JSON
- Escape all newlines inside string values as \\n
${extraRules.map((rule) => `- ${rule}`).join("\n")}

If a field is missing in the source content, use an empty string or empty array instead of inventing content.

JSON shape:
${jsonShape}

Content to normalize:
${responseText}`,
  );

  const repairedResponse = tryParseJsonResponse<T>(repairedResponseText);

  if (repairedResponse !== null) {
    return repairedResponse;
  }

  throw new Error(`${label} did not return valid JSON.`);
}

const OPTIMIZATION_RESPONSE_JSON_SHAPE = `{
  "revisedResume": "",
  "appliedKeywords": [""],
  "deferredKeywords": [""],
  "editNotes": [
    {
      "category": "phrasing",
      "before": "",
      "after": "",
      "rationale": ""
    }
  ]
}`;

const RESUME_DATA_JSON_SHAPE = `{
  "name": "",
  "contact": { "phone": "", "email": "", "linkedin": "", "github": "", "location": "" },
  "summary": "",
  "skills": [""],
  "skillCategories": [{ "category": "", "skills": "" }],
  "experience": [{ "title": "", "company": "", "period": "", "location": "", "description": [""] }],
  "education": [{ "degree": "", "school": "", "year": "", "gpa": "", "location": "" }],
  "certifications": [""],
  "projects": [{ "name": "", "tech": "", "period": "", "bullets": [""] }]
}`;

const JD_KEYWORDS_JSON_SHAPE = `{
  "hardSkills": [""],
  "softSkills": [""],
  "industryTerms": [""],
  "toolsAndTech": [""],
  "seniorityIndicators": [""]
}`;

const GAP_ANALYSIS_JSON_SHAPE = `{
  "present": [""],
  "inferable": [""],
  "missing": [""]
}`;

const VALIDATION_RESPONSE_JSON_SHAPE = `{
  "status": "PASS",
  "reasons": [""]
}`;

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function normalizeOptimizationResult(value: Partial<OptimizationResult> | null | undefined): OptimizationResult {
  const editNotes = Array.isArray(value?.editNotes)
    ? value.editNotes.flatMap((note) => {
        if (!note || typeof note !== "object") {
          return [];
        }

        const category = note.category;
        const normalizedCategory: OptimizationEditNote["category"] =
          category === "keyword" || category === "formatting" || category === "structure" ? category : "phrasing";

        return [
          {
            category: normalizedCategory,
            before: typeof note.before === "string" ? note.before.trim() : "",
            after: typeof note.after === "string" ? note.after.trim() : "",
            rationale: typeof note.rationale === "string" ? note.rationale.trim() : "",
          },
        ].filter((entry) => entry.before || entry.after || entry.rationale);
      })
    : [];

  return {
    revisedResume: typeof value?.revisedResume === "string" ? value.revisedResume.trim() : "",
    appliedKeywords: normalizeStringArray(value?.appliedKeywords),
    deferredKeywords: normalizeStringArray(value?.deferredKeywords),
    editNotes,
  };
}

function ensureClientConfig(config: AIClientConfig) {
  if (!config.provider) {
    throw new Error("Select an AI provider first.");
  }

  if (!config.model.trim()) {
    throw new Error("Select or enter a model first.");
  }

  if (!config.apiKey.trim()) {
    throw new Error("Enter an API key for the selected provider.");
  }

  if (config.provider === "custom" && !config.customEndpoint?.trim()) {
    throw new Error("Enter a custom endpoint for the custom provider.");
  }
}

// ─── Retry helper ────────────────────────────────────────────────────────────
// Retries on transient HTTP errors (429 rate-limit, 500/502/503 server errors).
// Uses exponential back-off with jitter: 1s → 2s → 4s (up to 3 total attempts).
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isTransient =
        err instanceof Error &&
        /429|500|502|503|rate.?limit|overloaded|server.?error/i.test(err.message);
      if (!isTransient || attempt === maxAttempts) throw err;
      const delayMs = (2 ** (attempt - 1)) * 1000 + Math.random() * 300;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

// ─── JSON schema definitions for structured-output providers ─────────────────
const OPENAI_JSON_SCHEMAS = {
  resumeData: {
    name: "resume_data",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["name","contact","summary","skills","skillCategories","experience","education","certifications","projects"],
      properties: {
        name: { type: "string" },
        contact: {
          type: "object", additionalProperties: false,
          required: ["phone","email","linkedin","github","location"],
          properties: { phone:{type:"string"}, email:{type:"string"}, linkedin:{type:"string"}, github:{type:"string"}, location:{type:"string"} },
        },
        summary: { type: "string" },
        skills: { type: "array", items: { type: "string" } },
        skillCategories: { type: "array", items: { type:"object", additionalProperties:false, required:["category","skills"], properties:{ category:{type:"string"}, skills:{type:"string"} } } },
        experience: { type: "array", items: { type:"object", additionalProperties:false, required:["title","company","period","location","description"], properties:{ title:{type:"string"}, company:{type:"string"}, period:{type:"string"}, location:{type:"string"}, description:{type:"array",items:{type:"string"}} } } },
        education: { type: "array", items: { type:"object", additionalProperties:false, required:["degree","school","year","gpa","location"], properties:{ degree:{type:"string"}, school:{type:"string"}, year:{type:"string"}, gpa:{type:"string"}, location:{type:"string"} } } },
        certifications: { type: "array", items: { type: "string" } },
        projects: { type: "array", items: { type:"object", additionalProperties:false, required:["name","tech","period","bullets"], properties:{ name:{type:"string"}, tech:{type:"string"}, period:{type:"string"}, bullets:{type:"array",items:{type:"string"}} } } },
      },
    },
  },
  optimization: {
    name: "optimization_result",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["revisedResume","appliedKeywords","deferredKeywords","editNotes"],
      properties: {
        revisedResume: { type: "string" },
        appliedKeywords: { type: "array", items: { type: "string" } },
        deferredKeywords: { type: "array", items: { type: "string" } },
        editNotes: { type: "array", items: { type:"object", additionalProperties:false, required:["category","before","after","rationale"], properties:{ category:{type:"string",enum:["phrasing","keyword","formatting","structure"]}, before:{type:"string"}, after:{type:"string"}, rationale:{type:"string"} } } },
      },
    },
  },
} as const;

type StructuredOutputSchema = typeof OPENAI_JSON_SCHEMAS[keyof typeof OPENAI_JSON_SCHEMAS] | undefined;

// Providers that support response_format json_schema
function supportsStructuredOutput(config: AIClientConfig) {
  return config.provider === "openai" || config.provider === "groq";
}

async function callOpenAICompatible(
  endpoint: string,
  config: AIClientConfig,
  prompt: string,
  extraHeaders?: Record<string, string>,
  schema?: StructuredOutputSchema,
) {
  const body: Record<string, unknown> = {
    model: config.model.trim(),
    temperature: schema ? 1 : 0.2, // structured output requires temp=1 on some models
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
  };

  if (schema && supportsStructuredOutput(config)) {
    body.response_format = { type: "json_schema", json_schema: schema };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey.trim()}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  const { data, rawText } = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(extractProviderError(data, rawText));
  }

  return extractOpenAICompatibleText(data);
}

async function callAnthropic(config: AIClientConfig, prompt: string) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": config.apiKey.trim(),
    },
    body: JSON.stringify({
      model: config.model.trim(),
      max_tokens: 4096,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    }),
  });

  const { data, rawText } = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(extractProviderError(data, rawText));
  }

  return extractAnthropicText(data);
}

async function callGemini(config: AIClientConfig, prompt: string) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    config.model.trim(),
  )}:generateContent?key=${encodeURIComponent(config.apiKey.trim())}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      generationConfig: {
        temperature: 0.2,
      },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    }),
  });

  const { data, rawText } = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(extractProviderError(data, rawText));
  }

  return extractGeminiText(data);
}

async function callCustomProvider(config: AIClientConfig, prompt: string) {
  const headers = parseCustomHeaders(config.customHeaders);
  const apiKeyHeader = config.customApiKeyHeader?.trim() || "Authorization";
  const apiKeyPrefix = config.customApiKeyPrefix ?? "Bearer ";

  headers[apiKeyHeader] = `${apiKeyPrefix}${config.apiKey.trim()}`.trim();

  const response = await fetch(config.customEndpoint!.trim(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      model: config.model.trim(),
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
  });

  const { data, rawText } = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(extractProviderError(data, rawText));
  }

  return extractOpenAICompatibleText(data);
}

async function generateText(
  config: AIClientConfig,
  prompt: string,
  schema?: StructuredOutputSchema,
): Promise<string> {
  ensureClientConfig(config);

  return withRetry(() => {
    switch (config.provider) {
      case "openai":
        return callOpenAICompatible("https://api.openai.com/v1/chat/completions", config, prompt, undefined, schema);
      case "groq":
        return callOpenAICompatible("https://api.groq.com/openai/v1/chat/completions", config, prompt, undefined, schema);
      case "openrouter":
        return callOpenAICompatible("https://openrouter.ai/api/v1/chat/completions", config, prompt, {
          "HTTP-Referer": typeof window !== "undefined" ? window.location.origin : "https://localhost",
          "X-Title": "Opal Optimizer",
        });
      case "anthropic":
        return callAnthropic(config, prompt);
      case "gemini":
        return callGemini(config, prompt);
      case "custom":
        return callCustomProvider(config, prompt);
      default:
        throw new Error("Unsupported AI provider.");
    }
  });
}

function extractContactFallback(text: string): ResumeData["contact"] {
  const emailMatch = text.match(/[\w._%+\-]+@[\w.\-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = text.match(/(?:\+?\d{1,3}[\s\-.]?)?(?:\(?\d{3,5}\)?[\s\-.]?)?\d{3,5}[\s\-.]?\d{3,5}/);
  const linkedinMatch = text.match(/linkedin\.com\/in\/([\w\-%.]+)/i);
  const githubMatch = text.match(/github\.com\/([\w\-%.]+)/i);

  // Location: look for common patterns like "City, State" or "City, Country" in the first 10 lines
  const firstLines = text.split(/\r?\n/).slice(0, 10).join(" ");
  const locationMatch = firstLines.match(/\b([A-Z][a-zA-Z\s]+,\s*(?:[A-Z][a-zA-Z\s]+|[A-Z]{2}))\b/);

  const contact: ResumeData["contact"] = {};
  if (emailMatch) contact.email = emailMatch[0].trim();
  if (phoneMatch) {
    const p = phoneMatch[0].trim();
    // Require at least 7 digits to avoid matching years like "2022"
    if ((p.match(/\d/g) ?? []).length >= 7) contact.phone = p;
  }
  if (linkedinMatch) contact.linkedin = `linkedin.com/in/${linkedinMatch[1]}`;
  if (githubMatch) {
    const ghUser = githubMatch[1];
    // Ignore common non-user paths like "actions", "marketplace", etc.
    if (!/^(actions|marketplace|features|about)$/i.test(ghUser)) {
      contact.github = `github.com/${ghUser}`;
    }
  }
  if (locationMatch) contact.location = locationMatch[1].trim();

  return Object.keys(contact).length > 0 ? contact : undefined;
}

export async function parseResume(config: AIClientConfig, text: string): Promise<ResumeData> {
  const useStructured = supportsStructuredOutput(config);

  const prompt = `Analyze the following resume and convert it into structured JSON.

Extract:
- Name
- Contact info: phone, email, linkedin URL, github URL, location
- Professional Summary
- Skills (flat list) AND skillCategories (each category name with its skill list as a comma-separated string)
- Work Experience: title, company, period, location, achievement-oriented bullet points
- Education: degree, school, year/period, GPA or grade, location
- Certifications
- Projects: name, tech stack, period, bullet-point descriptions

Rules:
- Preserve original meaning verbatim — do not rephrase or invent
- Preserve ALL metrics, numbers, percentages, and quantifiable results exactly as written
- Extract bullets verbatim — keep every number, percentage, and outcome intact
- Extract ALL projects with their full bullet descriptions, not just names
- Extract ALL skill categories exactly as labeled in the source
- Extract GPA / percentage / grade from education if present
- Extract contact details (phone, email, LinkedIn, GitHub, city/location) if present
- Do not hallucinate or paraphrase
- Return valid JSON only

JSON shape:
${RESUME_DATA_JSON_SHAPE}

Resume:
${text}`;

  const responseText = await generateText(
    config,
    prompt,
    useStructured ? OPENAI_JSON_SCHEMAS.resumeData : undefined,
  );

  const parsed = await parseJsonResponseWithRepair<ResumeData>(
    config,
    responseText,
    "Resume parsing",
    RESUME_DATA_JSON_SHAPE,
  );

  // Fallback: if AI didn't extract contact info, extract it from raw text using regex
  const contactEmpty =
    !parsed.contact ||
    !Object.values(parsed.contact).some((v) => typeof v === "string" && v.trim());
  if (contactEmpty) {
    const fallback = extractContactFallback(text);
    if (fallback) parsed.contact = fallback;
  } else {
    // Fill individual missing fields from raw text
    const fb = extractContactFallback(text);
    if (fb) {
      parsed.contact = {
        phone: parsed.contact?.phone?.trim() || fb.phone,
        email: parsed.contact?.email?.trim() || fb.email,
        linkedin: parsed.contact?.linkedin?.trim() || fb.linkedin,
        github: parsed.contact?.github?.trim() || fb.github,
        location: parsed.contact?.location?.trim() || fb.location,
      };
    }
  }

  return parsed;
}

export async function extractJDKeywords(config: AIClientConfig, text: string): Promise<JDKeywords> {
  const responseText = await generateText(
    config,
    `Extract ALL relevant keywords and phrases from this job description. Be exhaustive — capture every term a recruiter or ATS system would score against.

Return categories:
1. Hard Skills — technical competencies, languages, algorithms, methodologies
2. Soft Skills — communication, collaboration, problem-solving, etc.
3. Industry Terms — domain-specific vocabulary, standards, frameworks
4. Tools & Technologies — software, platforms, libraries, services
5. Seniority Indicators — experience levels, titles, ownership language

Rules:
- Extract exact phrases where possible (e.g. "RAG pipeline" not just "pipeline")
- Include both acronym and full form where both appear (e.g. "CI/CD" and "continuous integration")
- Include certifications and qualifications mentioned
- Be thorough — missing keywords here directly harms ATS matching
- Return JSON only

JSON shape:
${JD_KEYWORDS_JSON_SHAPE}

Job Description:
${text}`,
  );

  return parseJsonResponseWithRepair<JDKeywords>(
    config,
    responseText,
    "Keyword extraction",
    JD_KEYWORDS_JSON_SHAPE,
  );
}

export async function analyzeGap(config: AIClientConfig, resumeText: string, jdText: string): Promise<GapAnalysis> {
  const responseText = await generateText(
    config,
    `Compare ALL keywords from the job description against the resume.

Extract every keyword from the JD — including hard skills, tools, frameworks, domain terms, soft skills, action verbs, certifications, and methodologies.

Classify EACH keyword into exactly one of:
1. present — keyword or a clear synonym appears in the resume
2. inferable — candidate has related experience that implies this skill, even if the exact word is absent
3. missing — no evidence in the resume; would require fabrication to add

Be strict: a keyword is only "present" if it literally appears in the resume text.
Be generous with "inferable" only when there is clear adjacent evidence.

Do not hallucinate skills.

Return JSON only.

JSON shape:
${GAP_ANALYSIS_JSON_SHAPE}

Resume:
${resumeText}

Job Description:
${jdText}`,
  );

  return parseJsonResponseWithRepair<GapAnalysis>(
    config,
    responseText,
    "Gap analysis",
    GAP_ANALYSIS_JSON_SHAPE,
  );
}

// ─── Guardrail helpers ───────────────────────────────────────────────────────

/**
 * Estimate total years of professional experience from ResumeData.
 * Only full-time / non-internship roles count toward hasPaidEmployment.
 */
function estimateExperienceYears(resume: ResumeData): {
  totalYears: number;
  hasOnlyProjectsOrInternships: boolean;
} {
  const CURRENT_YEAR = new Date().getFullYear();

  function parseYear(s: string): number | null {
    if (/present|current|now/i.test(s.trim())) return CURRENT_YEAR;
    const m = s.match(/\b(19|20)\d{2}\b/);
    return m ? parseInt(m[0], 10) : null;
  }

  let totalMonths = 0;
  let hasPaidEmployment = false;

  for (const job of resume.experience ?? []) {
    const isInternship = /intern(ship)?|trainee|co[\s-]?op/i.test(job.title ?? "");
    if (!isInternship) hasPaidEmployment = true;

    const parts = (job.period ?? "").split(/\s*[-–—]\s*|\s+to\s+/i);
    const startYear = parts[0] ? parseYear(parts[0]) : null;
    let endYear: number | null = parts[1] ? parseYear(parts[1]) : null;
    if (!endYear && startYear) endYear = startYear + 1; // single-year entry → ~1 year

    if (startYear && endYear && endYear >= startYear) {
      totalMonths += (endYear - startYear) * 12;
    }
  }

  return {
    totalYears: Math.min(totalMonths / 12, 40),
    hasOnlyProjectsOrInternships: !hasPaidEmployment,
  };
}

const SENIORITY_TITLE_PATTERN =
  /\b(senior|lead|principal|staff engineer|architect|director|manager|head of|vp)\b/i;

/**
 * Detect whether the JD / target role demands seniority and how many years.
 */
function detectJDSeniority(
  keywords: JDKeywords,
  targetRole: string,
): { requiredYears: number | null; requiresSeniority: boolean } {
  let requiredYears: number | null = null;
  let requiresSeniority = SENIORITY_TITLE_PATTERN.test(targetRole);

  for (const indicator of keywords.seniorityIndicators) {
    const yearsMatch = indicator.match(/(\d+)\+?\s*years?/i);
    if (yearsMatch) {
      const years = parseInt(yearsMatch[1], 10);
      if (requiredYears === null || years > requiredYears) requiredYears = years;
    }
    if (SENIORITY_TITLE_PATTERN.test(indicator)) requiresSeniority = true;
  }

  // Also scan hard skills / industry terms for seniority language
  const allJdText = [...keywords.hardSkills, ...keywords.industryTerms].join(" ");
  if (SENIORITY_TITLE_PATTERN.test(allJdText)) requiresSeniority = true;

  return { requiredYears, requiresSeniority };
}

/**
 * Build a guardrail block to inject into the optimization prompt when the
 * candidate's experience level is significantly below what the JD requires.
 * Returns null when no mismatch is detected.
 */
function buildGuardrailBlock(
  resume: ResumeData,
  jdKeywords: JDKeywords,
  targetRole: string,
): string | null {
  const { totalYears, hasOnlyProjectsOrInternships } = estimateExperienceYears(resume);
  const { requiredYears, requiresSeniority } = detectJDSeniority(jdKeywords, targetRole);

  const isEarlyCareer = totalYears < 2 || hasOnlyProjectsOrInternships;
  const hasYearsMismatch = requiredYears !== null && totalYears < requiredYears - 0.5;

  if (!isEarlyCareer && !hasYearsMismatch) return null;

  const lines: string[] = [
    "SENIORITY GUARDRAIL — NON-NEGOTIABLE:",
    "",
  ];

  if (hasYearsMismatch && requiredYears !== null) {
    const approxYears = Math.round(totalYears * 10) / 10;
    lines.push(
      `  Candidate has ~${approxYears} year(s) of experience; the JD requires ${requiredYears}+ years.`,
    );
  }
  if (isEarlyCareer && requiresSeniority) {
    lines.push(
      "  Candidate is early-career (< 2 years or internships/projects only) but the JD targets a senior/lead level.",
    );
  }

  lines.push(
    "",
    "YOU MUST:",
    "  - Emphasize transferable skills, relevant projects, and any internship / open-source / freelance work",
    "  - Frame the candidate as an individual contributor, learner, or junior team member",
    "  - Use strong action verbs that match the candidate's actual scope of work",
    "",
    "YOU MUST NOT:",
    '  - Apply "Senior", "Lead", "Principal", "Architect", or similar seniority titles anywhere in the output',
    "  - Imply or state the candidate has " +
      (requiredYears !== null ? `${requiredYears}+` : "more") +
      " years of experience",
    "  - Invent or imply team leadership, people management, or mentoring unless explicitly stated in the original",
    "  - Add certifications, tools, or technologies not present in the original resume",
  );

  return lines.join("\n");
}

/**
 * Rank missing keywords by descending ATS weight so the optimizer focuses on
 * high-value terms first. Hard skills/tools (weight 3) come before industry terms
 * (weight 2) which come before soft skills/seniority (weight 1).
 * Cap at 15 to keep the prompt tight and reduce hallucination pressure.
 */
function rankMissingKeywords(
  missing: string[],
  keywords: JDKeywords,
  cap = 15,
): string[] {
  const weightMap = new Map<string, number>();
  for (const kw of keywords.hardSkills) weightMap.set(kw.toLowerCase(), 3);
  for (const kw of keywords.toolsAndTech) weightMap.set(kw.toLowerCase(), 3);
  for (const kw of keywords.industryTerms) weightMap.set(kw.toLowerCase(), 2);
  for (const kw of keywords.softSkills) weightMap.set(kw.toLowerCase(), 1);
  for (const kw of keywords.seniorityIndicators) weightMap.set(kw.toLowerCase(), 1);

  return [...missing]
    .sort((a, b) => (weightMap.get(b.toLowerCase()) ?? 0) - (weightMap.get(a.toLowerCase()) ?? 0))
    .slice(0, cap);
}

export async function optimizeResume(
  config: AIClientConfig,
  resumeText: string,
  optimizationContext: string,
  missingKeywords: string[],
  targetRole: string,
  focusKeywords: string[],
  allKeywords?: JDKeywords,
  resumeData?: ResumeData,
): Promise<OptimizationResult> {
  const rankedMissing = allKeywords
    ? rankMissingKeywords(missingKeywords, allKeywords)
    : missingKeywords.slice(0, 15);

  const guardrailBlock =
    resumeData && allKeywords
      ? buildGuardrailBlock(resumeData, allKeywords, targetRole)
      : null;

  const prompt = `You are a professional resume writer. Rewrite the resume to score 90+ on ATS and professional resume scoring tools like Resume Worded.

═══════════════════════════════════════════════════════════
GOALS (all must be achieved simultaneously)
═══════════════════════════════════════════════════════════
1. ATS compatibility — plain single-column text; no tables, icons, graphics
2. Keyword coverage — integrate every PRIORITY MISSING KEYWORD naturally
3. Impact per bullet — every bullet must show outcome, scope, or metric
4. Brevity — every bullet is ONE LINE; no paragraphs; no filler
5. Writing quality — strong action verbs; present/past consistent tense; no passive voice
6. Summary — 1-2 confident sentences, keyword-rich, no weak qualifiers
7. Formatting consistency — uniform dates (Mon YYYY), uniform bullets (- ), ALL CAPS section headers

═══════════════════════════════════════════════════════════
ACTION VERBS — USE ONLY STRONG VERBS
═══════════════════════════════════════════════════════════
Preferred (use these):
  Built, Designed, Developed, Architected, Engineered, Implemented, Deployed,
  Optimized, Reduced, Increased, Automated, Scaled, Delivered, Led, Drove,
  Launched, Integrated, Streamlined, Accelerated, Improved, Established,
  Migrated, Refactored, Containerized, Trained, Fine-tuned, Orchestrated

BANNED (never use these):
  Helped, Assisted, Worked on, Worked with, Participated in, Was responsible for,
  Responsible for, Contributed to, Involved in, Supported, Handled, Did

═══════════════════════════════════════════════════════════
BULLET QUALITY RULES — EVERY BULLET MUST FOLLOW THIS
═══════════════════════════════════════════════════════════
- Start with a strong action verb (past tense for past roles, present for current)
- Include at least one of: metric, %, time saved, scale, user count, cost, throughput
- Keep to ONE LINE — never wrap into a second line
- No trailing punctuation (no period at end)
- No filler openers like "Responsible for" or "Helped to"
- If original has a metric → KEEP IT verbatim; never remove numbers
- If original has no metric → reframe around outcome/impact/scale where factually supportable

═══════════════════════════════════════════════════════════
PROFESSIONAL SUMMARY RULES
═══════════════════════════════════════════════════════════
- Write exactly 1-2 sentences
- Open with the job title / domain (e.g. "AI Engineer with 2 years…" not "Results-driven…")
- Include the 3-5 most important JD keywords naturally
- No weak qualifiers: "approximately", "eager to", "experienced in", "skilled in", "proficient in"
- No generic phrases: "fast-paced environment", "team player", "passionate about"
- Use confident, declarative language

═══════════════════════════════════════════════════════════
SKILLS SECTION RULES
═══════════════════════════════════════════════════════════
- Keep all skill categories from original
- Add PRIORITY MISSING KEYWORDS to the most relevant existing skill category
- Never create a new skill that doesn't appear in original resume or JD

═══════════════════════════════════════════════════════════
DATE & FORMATTING CONSISTENCY
═══════════════════════════════════════════════════════════
- Dates: use "Mon YYYY – Mon YYYY" or "Mon YYYY – Present" uniformly
- All section headings in ALL CAPS
- All bullets start with "- "
- No mixed date formats in the same resume

═══════════════════════════════════════════════════════════
ANTI-FABRICATION RULES — NEVER VIOLATE
═══════════════════════════════════════════════════════════
- Do NOT invent employers, job titles, or date ranges
- Do NOT invent metrics unless clearly present in original
- Do NOT add tools or technologies not in the original resume
- Do NOT add certifications not in the original
- Do NOT invent leadership, management, or mentorship roles
- Only rephrase, reframe, and reorder what already exists
${guardrailBlock ? `\n${guardrailBlock}\n` : ""}
═══════════════════════════════════════════════════════════
OUTPUT CONSTRAINTS
═══════════════════════════════════════════════════════════
- Plain text resume only — no markdown, no fences, no commentary
- All JSON string values must be properly escaped
- Escape line breaks as \\n inside JSON string fields
- Preserve CONTACT section exactly — do not modify or omit it
- Section order: CONTACT → PROFESSIONAL SUMMARY → CORE SKILLS → PROFESSIONAL EXPERIENCE → PROJECTS → EDUCATION → CERTIFICATIONS
- Output the FULL resume — no truncation

Focus role: ${targetRole}

Priority missing keywords (add as many as possible WITHOUT fabricating):
${rankedMissing.map((kw, i) => `${i + 1}. ${kw}`).join("\n")}

Additional focus keywords: ${focusKeywords.join(", ") || "(none)"}

Return JSON only:
- revisedResume: the COMPLETE revised plain-text resume
- appliedKeywords: keywords from the missing list incorporated
- deferredKeywords: keywords that cannot be added without fabrication
- editNotes: up to 8 most impactful edits with category, before, after, rationale

JSON shape:
${OPTIMIZATION_RESPONSE_JSON_SHAPE}

Resume:
${resumeText}

Optimization Context:
${optimizationContext}`;

  const responseText = await generateText(
    config,
    prompt,
    supportsStructuredOutput(config) ? OPENAI_JSON_SCHEMAS.optimization : undefined,
  );

  const optimizedResponse = await parseJsonResponseWithRepair<Partial<OptimizationResult>>(
    config,
    responseText,
    "Resume optimization",
    OPTIMIZATION_RESPONSE_JSON_SHAPE,
    [
      "Preserve the resume text exactly except for JSON escaping.",
      "Keep editNotes to at most 8 entries.",
    ],
  );

  return normalizeOptimizationResult(optimizedResponse);
}

/**
 * Deterministic ATS keyword-match scorer.
 * Uses exact substring matching (case-insensitive) to replicate how text-based
 * ATS scanners (Workday, Taleo, Jobscan, etc.) compute a match percentage.
 * Hard skills and tools are weighted 3×, industry terms 2×, soft skills / seniority 1×.
 * Returns a 0–100 score and the full matched / missing keyword lists.
 */
export function scoreKeywordMatch(
  resumeText: string,
  keywords: JDKeywords,
): { score: number; matched: string[]; missing: string[] } {
  const lower = resumeText.toLowerCase();

  const buckets: { kws: string[]; weight: number }[] = [
    { kws: keywords.hardSkills, weight: 3 },
    { kws: keywords.toolsAndTech, weight: 3 },
    { kws: keywords.industryTerms, weight: 2 },
    { kws: keywords.softSkills, weight: 1 },
    { kws: keywords.seniorityIndicators, weight: 1 },
  ];

  const seen = new Set<string>();
  let totalWeight = 0;
  let matchedWeight = 0;
  const matched: string[] = [];
  const missing: string[] = [];

  for (const { kws, weight } of buckets) {
    for (const kw of kws) {
      const normalized = kw.toLowerCase().trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      totalWeight += weight;
      if (lower.includes(normalized)) {
        matchedWeight += weight;
        matched.push(kw);
      } else {
        missing.push(kw);
      }
    }
  }

  return {
    score: totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0,
    matched,
    missing,
  };
}

export async function validateOptimization(
  config: AIClientConfig,
  originalResume: string,
  optimizedResume: string,
): Promise<{ pass: boolean; reasons: string[] }> {
  const responseText = await generateText(
    config,
    `Compare the optimized resume against the original resume.

Check for ALL of the following fabrication types:
- Hallucinated or added skills, tools, or technologies not in the original
- Invented job titles, employers, or date ranges
- Fabricated certifications not in the original
- Invented metrics, numbers, or quantifiable claims not in the original
- Seniority inflation: does the optimized resume imply "Senior", "Lead", "Principal", "Architect", or similar titles / seniority language that the original does not support?
- Invented team leadership, people management, or mentoring claims not in the original
- Any implied years-of-experience claim that exceeds what the original resume shows

Also check for writing quality regressions:
- Are weak verbs used ("helped", "assisted", "worked on", "responsible for", "participated in")?
- Are there bullets longer than two lines?
- Are there filler phrases ("fast-paced environment", "team player", "passionate about")?
- Is the summary longer than 2 sentences?
- Are any metrics from the original resume removed in the optimized version?

Return PASS if NO fabrications AND no writing quality regressions are found.
Return FAIL if ANY issue from either list is detected, and list each violation briefly in "reasons".

Return JSON only.

JSON shape:
${VALIDATION_RESPONSE_JSON_SHAPE}

Original:
${originalResume}

Optimized:
${optimizedResume}`,
  );

  const res = await parseJsonResponseWithRepair<{ status?: string; reasons?: string[] }>(
    config,
    responseText,
    "Optimization validation",
    VALIDATION_RESPONSE_JSON_SHAPE,
  );
  return {
    pass: res.status === "PASS",
    reasons: res.reasons || [],
  };
}
