import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, 
         Table, TableRow, TableCell, BorderStyle, WidthType, ShadingType,
         Header, Footer, PageNumber, PageBreak, InsertedTextRun, DeletedTextRun } from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ---- Model resolution -------------------------------------------------
// The Anthropic API has no "latest" alias: every model ID is pinned and
// immutable, so any hardcoded ID eventually 404s when that model retires.
// We resolve the newest model in the configured family from GET /v1/models
// at boot and re-check daily, and re-resolve on demand if a call ever comes
// back "model not found". Setting CLAUDE_MODEL pins an exact ID and turns
// automatic resolution off.

const MODEL_FALLBACK = 'claude-sonnet-5';
const MODEL_FAMILY = process.env.CLAUDE_MODEL_FAMILY || 'sonnet';
const MODEL_PIN = process.env.CLAUDE_MODEL || null;
const MODEL_TTL_MS = 24 * 60 * 60 * 1000;
// The JSON schemas these prompts request (110 scored attributes, full reports)
// do not fit in 8192 output tokens; truncated JSON silently parses to {} and
// produces an empty analysis. Current models think before answering and that
// thinking counts against this limit, so 32k cut long trusts' summaries short.
// Requests are streamed, so a large limit does not risk an HTTP timeout.
// Clamped at request time to the model's own limit.
const JSON_MAX_TOKENS = Number(process.env.CLAUDE_MAX_OUTPUT_TOKENS) || 64000;

// How much of a document reaches the model. The old 100k cap silently dropped
// roughly two thirds of a typical trust and the user was never told, so the
// analysis read as complete when it was not. 400k characters is about 100k
// tokens, which fits a full trust alongside the prompt. Anything beyond the cap
// is still cut, but now it is reported in the result.
const MAX_DOC_CHARS = Number(process.env.MAX_DOCUMENT_CHARS) || 400000;

// Responses are far longer than they used to be, so the SDK's default timeout
// is not generous enough; a stalled request should fail cleanly rather than
// hanging the SSE stream open.
const CLIENT_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 10 * 60 * 1000;

let resolvedModel = MODEL_PIN || MODEL_FALLBACK;
let resolvedAt = 0;
let resolving = null;
let resolvedMaxOutput = 0; // advertised max output tokens for resolvedModel, 0 = unknown

async function fetchNewestModel(apiKey) {
  const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const res = await fetch(`${base}/v1/models?limit=1000`, {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  });
  if (!res.ok) throw new Error(`models list returned ${res.status}`);
  const body = await res.json();
  const candidates = (body.data || [])
    .filter(m => typeof m.id === 'string'
      && m.id.includes(MODEL_FAMILY)
      && !/preview|latest/i.test(m.id)
      && m.created_at)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!candidates.length) throw new Error(`no ${MODEL_FAMILY} models available to this key`);
  return candidates[0];
}

async function getModel(apiKey, force) {
  if (MODEL_PIN) return MODEL_PIN;
  if (!apiKey) return resolvedModel;
  if (!force && Date.now() - resolvedAt < MODEL_TTL_MS) return resolvedModel;
  if (!resolving) {
    resolving = fetchNewestModel(apiKey)
      .then(m => {
        if (m.id !== resolvedModel) console.log(`[model] using ${m.id} (was ${resolvedModel})`);
        resolvedModel = m.id;
        // The API tells us this model's real output ceiling; use it rather than guessing.
        if (typeof m.max_tokens === 'number' && m.max_tokens > 0) resolvedMaxOutput = m.max_tokens;
        resolvedAt = Date.now();
        return m.id;
      })
      .catch(err => {
        // Keep serving with whatever we last had rather than failing the request.
        console.error(`[model] resolution failed, staying on ${resolvedModel}: ${err.message}`);
        resolvedAt = Date.now();
        return resolvedModel;
      })
      .finally(() => { resolving = null; });
  }
  return resolving;
}

// All Claude calls go through this. It injects the resolved model and, if that
// model has been retired out from under us mid-flight, re-resolves and retries
// once instead of surfacing a 404 to the user.
// Requests are streamed (a large max_tokens can take minutes) and accept an
// AbortSignal so work stops when the browser goes away.
async function createMessage(client, params, { signal } = {}) {
  const call = (p) => client.messages.stream(p, { signal }).finalMessage();
  const apiKey = (client && client.apiKey) || process.env.ANTHROPIC_API_KEY;
  const model = await getModel(apiKey);
  // Requesting more than the model allows is a hard API error, so clamp to the
  // ceiling the models endpoint reported for this model.
  const params2 = { ...params, model };
  if (resolvedMaxOutput && params2.max_tokens > resolvedMaxOutput) {
    console.warn(`[claude] clamping max_tokens ${params2.max_tokens} -> ${resolvedMaxOutput} for ${model}`);
    params2.max_tokens = resolvedMaxOutput;
  }
  try {
    return await call(params2);
  } catch (err) {
    if (signal && signal.aborted) throw err;
    // A parameter this model no longer accepts (temperature was deprecated this
    // way) is a 400 that names the offending key. Drop it and retry rather than
    // failing the whole analysis.
    const msg = (err && err.message) || '';
    if (err && err.status === 400 && /invalid_request_error/i.test(msg)) {
      const named = msg.match(/[`'"](\w+)[`'"]\s+is\s+(?:deprecated|not supported|unsupported)/i)
                 || msg.match(/unexpected\s+(?:keyword\s+)?(?:argument|parameter)\s+[`'"]?(\w+)/i);
      const key = named && named[1];
      if (key && key in params2) {
        console.warn(`[claude] API rejected parameter "${key}" for ${model}; retrying without it`);
        const stripped = { ...params2 };
        delete stripped[key];
        return await call(stripped);
      }
    }
    const missingModel = err && (err.status === 404 || /not_found_error/i.test(msg));
    if (!missingModel || MODEL_PIN) throw err;
    console.warn(`[model] ${model} rejected as not found, re-resolving`);
    const fresh = await getModel(apiKey, true);
    if (fresh === model) throw err;
    return await call({ ...params2, model: fresh });
  }
}

// Helper: build candidate repairs for JSON that is malformed or cut short.
// Walks the text tracking string state and bracket depth, collecting every
// offset where a complete value ended outside a string. Each candidate rewinds
// to one of those offsets, drops a dangling comma and closes whatever is still
// open, newest boundary first. A truncated 110-attribute evaluation then yields
// the attributes that did arrive instead of nothing at all.
function repairCandidates(src, maxTries) {
  const limit = maxTries || 400;
  const safe = [];
  let inStr = false, esc = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') { inStr = false; safe.push(i); }
    } else if (ch === '"') inStr = true;
    else if (ch === '}' || ch === ']') safe.push(i);
    else if (/[0-9]/.test(ch)) safe.push(i);
  }
  const out = [];
  for (let k = safe.length - 1; k >= 0 && out.length < limit; k--) {
    let cut = src.slice(0, safe[k] + 1);
    // a trailing comma, or a key left without its value, cannot be closed
    cut = cut.replace(/,\s*$/, '');
    let s2 = false, e2 = false;
    const open = [];
    for (let i = 0; i < cut.length; i++) {
      const ch = cut[i];
      if (s2) {
        if (e2) e2 = false;
        else if (ch === '\\') e2 = true;
        else if (ch === '"') s2 = false;
      } else if (ch === '"') s2 = true;
      else if (ch === '{') open.push('}');
      else if (ch === '[') open.push(']');
      else if (ch === '}' || ch === ']') open.pop();
    }
    if (s2) continue;
    if (/[{[,:]\s*$/.test(cut)) continue;
    let closed = cut;
    for (let i = open.length - 1; i >= 0; i--) closed += open[i];
    out.push(closed);
  }
  return out;
}

// Helper: extract and parse JSON from Claude responses. Strips markdown fences,
// then tries the raw text, the outermost {...}, a trailing-comma cleanup, and
// finally a repair pass. Logs when everything fails - these parses used to fail
// silently into an empty object, which surfaced as an analysis where every
// score was the no-data default and every section read "not available".
function extractJSON(text, fallback, label) {
  if (fallback === undefined) fallback = {};
  if (typeof text !== 'string' || !text.trim()) return fallback;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const body = start !== -1 ? cleaned.slice(start) : cleaned;

  const attempts = [cleaned];
  if (start !== -1 && end > start) attempts.push(cleaned.substring(start, end + 1));
  attempts.push(body.replace(/,(\s*[}\]])/g, '$1'));
  for (const candidate of attempts) {
    try { return JSON.parse(candidate); } catch (e) { /* try the next shape */ }
  }

  for (const candidate of repairCandidates(body)) {
    try {
      const parsed = JSON.parse(candidate);
      console.warn(`[json] ${label || 'response'}: recovered ${candidate.length} of ${cleaned.length} chars by repairing malformed or truncated JSON`);
      return parsed;
    } catch (e) { /* rewind further */ }
  }

  console.warn(`[json] ${label || 'response'}: unparseable (${cleaned.length} chars, starts "${cleaned.slice(0, 80).replace(/\s+/g, ' ')}"), using fallback`);
  return fallback;
}


// Helper: pull the text out of a Messages API response. Never index content[0]
// directly - the content array can carry non-text blocks (thinking, tool use),
// in which case content[0].text is undefined and every downstream JSON.parse
// silently yields {}. Also warns when a response was truncated at max_tokens,
// which produces unparseable JSON.
function textOf(message, label) {
  const blocks = (message && Array.isArray(message.content)) ? message.content : [];
  const text = blocks
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
    .trim();
  const tag = label || 'response';
  if (!text) {
    console.warn(`[claude] ${tag}: no text block (blocks=${blocks.map(b => b && b.type).join(',') || 'none'}, stop_reason=${message && message.stop_reason})`);
  } else if (message && message.stop_reason === 'max_tokens') {
    console.warn(`[claude] ${tag}: truncated at max_tokens after ${text.length} chars; JSON will not parse`);
  }
  return text;
}

// Helper: Claude sometimes returns executiveSummary (and friends) as an object
// rather than a string. The frontend formatters call String methods on these
// fields, so coerce to text here rather than shipping an object to the client.
function asText(value, fallback) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback || '';
  if (typeof value === 'object') {
    var preferred = value.onePage || value.fullSummary || value.oneParagraph || value.summary || value.text;
    if (typeof preferred === 'string') return preferred;
    try { return JSON.stringify(value, null, 2); } catch (e) { return fallback || ''; }
  }
  return String(value);
}

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Evaluation framework with 110 attributes across 10 categories
const CATEGORIES = {
  "Asset Protection & Creditor Shielding": 15,
  "Tax Efficiency & Planning": 15,
  "Succession & Distribution Design": 14,
  "Trustee Selection & Governance": 12,
  "Flexibility & Amendment Provisions": 10,
  "Beneficiary Protections": 9,
  "Fiduciary Powers & Limitations": 8,
  "Coordination with Overall Estate Plan": 7,
  "Charitable Planning Integration": 5,
  "Technical Drafting & Legal Compliance": 5
};

const ATTRIBUTES = [
  // Asset Protection (10)
  {id:1,name:"Spendthrift clause",imp:10,cat:"Asset Protection & Creditor Shielding"},
  {id:2,name:"Discretionary distribution standard",imp:9,cat:"Asset Protection & Creditor Shielding"},
  {id:3,name:"Domestic asset protection provisions",imp:8,cat:"Asset Protection & Creditor Shielding"},
  {id:4,name:"Anti-alienation provisions",imp:9,cat:"Asset Protection & Creditor Shielding"},
  {id:5,name:"Exception creditor carve-outs",imp:7,cat:"Asset Protection & Creditor Shielding"},
  {id:6,name:"Self-settled trust limitations",imp:8,cat:"Asset Protection & Creditor Shielding"},
  {id:7,name:"Fraudulent transfer avoidance",imp:9,cat:"Asset Protection & Creditor Shielding"},
  {id:8,name:"Charging order provisions",imp:8,cat:"Asset Protection & Creditor Shielding"},
  {id:9,name:"Divorce protection",imp:9,cat:"Asset Protection & Creditor Shielding"},
  {id:10,name:"Bankruptcy remoteness",imp:8,cat:"Asset Protection & Creditor Shielding"},
  // Tax Efficiency (15)
  {id:11,name:"GST exemption allocation",imp:10,cat:"Tax Efficiency & Planning"},
  {id:12,name:"Estate tax inclusion/exclusion clarity",imp:10,cat:"Tax Efficiency & Planning"},
  {id:13,name:"Grantor trust status provisions",imp:9,cat:"Tax Efficiency & Planning"},
  {id:14,name:"Asset substitution power",imp:8,cat:"Tax Efficiency & Planning"},
  {id:15,name:"Crummey withdrawal rights",imp:8,cat:"Tax Efficiency & Planning"},
  {id:16,name:"Hanging powers",imp:7,cat:"Tax Efficiency & Planning"},
  {id:17,name:"Formula funding clauses",imp:9,cat:"Tax Efficiency & Planning"},
  {id:18,name:"QTIP election provisions",imp:9,cat:"Tax Efficiency & Planning"},
  {id:19,name:"Portability planning",imp:8,cat:"Tax Efficiency & Planning"},
  {id:20,name:"Basis step-up optimization",imp:9,cat:"Tax Efficiency & Planning"},
  {id:21,name:"Delaware tax trap provisions",imp:7,cat:"Tax Efficiency & Planning"},
  {id:22,name:"Charitable remainder provisions",imp:8,cat:"Tax Efficiency & Planning"},
  {id:23,name:"Private foundation coordination",imp:8,cat:"Tax Efficiency & Planning"},
  {id:24,name:"State income tax considerations",imp:9,cat:"Tax Efficiency & Planning"},
  {id:25,name:"Section 678 powers",imp:7,cat:"Tax Efficiency & Planning"},
  // Succession & Distribution (15)
  {id:26,name:"Primary beneficiary designations",imp:10,cat:"Succession & Distribution Design"},
  {id:27,name:"Contingent beneficiary chain",imp:10,cat:"Succession & Distribution Design"},
  {id:28,name:"Per stirpes/per capita elections",imp:9,cat:"Succession & Distribution Design"},
  {id:29,name:"Age-based distribution schedules",imp:8,cat:"Succession & Distribution Design"},
  {id:30,name:"Incentive trust provisions",imp:7,cat:"Succession & Distribution Design"},
  {id:31,name:"Disincentive provisions",imp:7,cat:"Succession & Distribution Design"},
  {id:32,name:"Adopted children provisions",imp:8,cat:"Succession & Distribution Design"},
  {id:33,name:"Posthumous children provisions",imp:6,cat:"Succession & Distribution Design"},
  {id:34,name:"Pretermitted heir provisions",imp:7,cat:"Succession & Distribution Design"},
  {id:35,name:"Class gift closing rules",imp:8,cat:"Succession & Distribution Design"},
  {id:36,name:"Generation-skipping options",imp:9,cat:"Succession & Distribution Design"},
  {id:37,name:"Ultimate distribution provisions",imp:8,cat:"Succession & Distribution Design"},
  {id:38,name:"Specific bequest provisions",imp:7,cat:"Succession & Distribution Design"},
  {id:39,name:"Residuary distribution clarity",imp:9,cat:"Succession & Distribution Design"},
  {id:40,name:"Survivorship requirements",imp:8,cat:"Succession & Distribution Design"},
  // Trustee Selection & Governance (15)
  {id:41,name:"Initial trustee designation",imp:10,cat:"Trustee Selection & Governance"},
  {id:42,name:"Successor trustee chain",imp:10,cat:"Trustee Selection & Governance"},
  {id:43,name:"Co-trustee provisions",imp:8,cat:"Trustee Selection & Governance"},
  {id:44,name:"Corporate trustee requirements",imp:7,cat:"Trustee Selection & Governance"},
  {id:45,name:"Trustee removal provisions",imp:9,cat:"Trustee Selection & Governance"},
  {id:46,name:"Trustee resignation procedures",imp:8,cat:"Trustee Selection & Governance"},
  {id:47,name:"Trust protector designation",imp:9,cat:"Trustee Selection & Governance"},
  {id:48,name:"Trust protector powers",imp:9,cat:"Trustee Selection & Governance"},
  {id:49,name:"Distribution committee provisions",imp:7,cat:"Trustee Selection & Governance"},
  {id:50,name:"Investment committee provisions",imp:7,cat:"Trustee Selection & Governance"},
  {id:51,name:"Compensation provisions",imp:8,cat:"Trustee Selection & Governance"},
  {id:52,name:"Bond waiver provisions",imp:7,cat:"Trustee Selection & Governance"},
  {id:53,name:"Trustee liability standards",imp:8,cat:"Trustee Selection & Governance"},
  {id:54,name:"Indemnification provisions",imp:8,cat:"Trustee Selection & Governance"},
  {id:55,name:"Conflict of interest protocols",imp:8,cat:"Trustee Selection & Governance"},
  // Flexibility & Amendment (10)
  {id:56,name:"Revocation/amendment powers",imp:10,cat:"Flexibility & Amendment Provisions"},
  {id:57,name:"Decanting authority",imp:9,cat:"Flexibility & Amendment Provisions"},
  {id:58,name:"Trust protector modification powers",imp:9,cat:"Flexibility & Amendment Provisions"},
  {id:59,name:"Power to change situs",imp:9,cat:"Flexibility & Amendment Provisions"},
  {id:60,name:"Merger/consolidation provisions",imp:7,cat:"Flexibility & Amendment Provisions"},
  {id:61,name:"Division/severance provisions",imp:8,cat:"Flexibility & Amendment Provisions"},
  {id:62,name:"Non-judicial settlement provisions",imp:8,cat:"Flexibility & Amendment Provisions"},
  {id:63,name:"Virtual representation provisions",imp:7,cat:"Flexibility & Amendment Provisions"},
  {id:64,name:"Tax law change modifications",imp:9,cat:"Flexibility & Amendment Provisions"},
  {id:65,name:"Cy pres/equitable deviation",imp:7,cat:"Flexibility & Amendment Provisions"},
  // Beneficiary Protections (10)
  {id:66,name:"Special needs trust provisions",imp:9,cat:"Beneficiary Protections"},
  {id:67,name:"Substance abuse provisions",imp:8,cat:"Beneficiary Protections"},
  {id:68,name:"Mental incapacity provisions",imp:8,cat:"Beneficiary Protections"},
  {id:69,name:"Marital property characterization",imp:9,cat:"Beneficiary Protections"},
  {id:70,name:"Prenuptial coordination",imp:7,cat:"Beneficiary Protections"},
  {id:71,name:"Beneficiary privacy protections",imp:7,cat:"Beneficiary Protections"},
  {id:72,name:"Education funding provisions",imp:8,cat:"Beneficiary Protections"},
  {id:73,name:"Health care funding provisions",imp:8,cat:"Beneficiary Protections"},
  {id:74,name:"Business succession provisions",imp:9,cat:"Beneficiary Protections"},
  {id:75,name:"Primary residence provisions",imp:8,cat:"Beneficiary Protections"},
  // Fiduciary Powers (12)
  {id:76,name:"Investment powers",imp:9,cat:"Fiduciary Powers & Limitations"},
  {id:77,name:"Retention of original assets",imp:8,cat:"Fiduciary Powers & Limitations"},
  {id:78,name:"Real estate powers",imp:9,cat:"Fiduciary Powers & Limitations"},
  {id:79,name:"Business entity powers",imp:9,cat:"Fiduciary Powers & Limitations"},
  {id:80,name:"Borrowing powers",imp:8,cat:"Fiduciary Powers & Limitations"},
  {id:81,name:"Lending powers",imp:7,cat:"Fiduciary Powers & Limitations"},
  {id:82,name:"Power to employ agents",imp:8,cat:"Fiduciary Powers & Limitations"},
  {id:83,name:"Tax election powers",imp:9,cat:"Fiduciary Powers & Limitations"},
  {id:84,name:"Digital asset powers",imp:8,cat:"Fiduciary Powers & Limitations"},
  {id:85,name:"Life insurance powers",imp:8,cat:"Fiduciary Powers & Limitations"},
  {id:86,name:"Tangible property management",imp:7,cat:"Fiduciary Powers & Limitations"},
  {id:87,name:"Environmental liability provisions",imp:7,cat:"Fiduciary Powers & Limitations"},
  // Coordination (8)
  {id:88,name:"Pour-over will coordination",imp:9,cat:"Coordination with Overall Estate Plan"},
  {id:89,name:"Beneficiary designation coordination",imp:9,cat:"Coordination with Overall Estate Plan"},
  {id:90,name:"Power of attorney coordination",imp:8,cat:"Coordination with Overall Estate Plan"},
  {id:91,name:"Business entity coordination",imp:9,cat:"Coordination with Overall Estate Plan"},
  {id:92,name:"Prenuptial/postnuptial coordination",imp:7,cat:"Coordination with Overall Estate Plan"},
  {id:93,name:"Community property considerations",imp:8,cat:"Coordination with Overall Estate Plan"},
  {id:94,name:"Homestead protection coordination",imp:8,cat:"Coordination with Overall Estate Plan"},
  {id:95,name:"Tangible property memorandum",imp:7,cat:"Coordination with Overall Estate Plan"},
  // Charitable Planning (5)
  {id:96,name:"Charitable remainder provisions",imp:8,cat:"Charitable Planning Integration"},
  {id:97,name:"Charitable lead provisions",imp:7,cat:"Charitable Planning Integration"},
  {id:98,name:"Private foundation coordination",imp:9,cat:"Charitable Planning Integration"},
  {id:99,name:"Donor advised fund provisions",imp:7,cat:"Charitable Planning Integration"},
  {id:100,name:"Charitable distribution authority",imp:8,cat:"Charitable Planning Integration"},
  // Technical Drafting (10)
  {id:101,name:"Proper execution formalities",imp:10,cat:"Technical Drafting & Legal Compliance"},
  {id:102,name:"Governing law designation",imp:9,cat:"Technical Drafting & Legal Compliance"},
  {id:103,name:"Severability clause",imp:8,cat:"Technical Drafting & Legal Compliance"},
  {id:104,name:"Definitions section",imp:9,cat:"Technical Drafting & Legal Compliance"},
  {id:105,name:"Construction provisions",imp:8,cat:"Technical Drafting & Legal Compliance"},
  {id:106,name:"Perpetuities savings clause",imp:8,cat:"Technical Drafting & Legal Compliance"},
  {id:107,name:"Arbitration provisions",imp:7,cat:"Technical Drafting & Legal Compliance"},
  {id:108,name:"No-contest clause",imp:8,cat:"Technical Drafting & Legal Compliance"},
  {id:109,name:"Headings and formatting",imp:6,cat:"Technical Drafting & Legal Compliance"},
  {id:110,name:"Integration clause",imp:7,cat:"Technical Drafting & Legal Compliance"}
];

// User-friendly names for attributes (simplified for non-attorneys)
const FRIENDLY_NAMES = {
  1: "Spendthrift Protection",
  2: "Trustee Discretion Standards",
  3: "Asset Protection Provisions",
  4: "Anti-Alienation Safeguards",
  5: "Creditor Exception Rules",
  6: "Self-Funded Trust Rules",
  7: "Fraudulent Transfer Protection",
  8: "Charging Order Provisions",
  9: "Divorce Protection",
  10: "Bankruptcy Safeguards",
  11: "Generation-Skipping Tax Planning",
  12: "Estate Tax Clarity",
  13: "Grantor Trust Status",
  14: "Asset Substitution Rights",
  15: "Gift Tax Annual Exclusion (Crummey)",
  16: "Hanging Power Provisions",
  17: "Formula Funding Clauses",
  18: "Marital Deduction (QTIP) Provisions",
  19: "Portability Planning",
  20: "Stepped-Up Basis Optimization",
  21: "Delaware Tax Trap Provisions",
  22: "Charitable Remainder Provisions",
  23: "Private Foundation Coordination",
  24: "State Income Tax Planning",
  25: "Section 678 Powers",
  26: "Primary Beneficiary Designations",
  27: "Backup Beneficiary Chain",
  28: "Distribution Method (Per Stirpes)",
  29: "Age-Based Distribution Schedule",
  30: "Incentive Provisions",
  31: "Disincentive Provisions",
  32: "Adopted Children Provisions",
  33: "Posthumous Children Provisions",
  34: "Omitted Heir Provisions",
  35: "Class Gift Rules",
  36: "Generation-Skipping Options",
  37: "Ultimate Distribution Plan",
  38: "Specific Bequests",
  39: "Residuary Distribution",
  40: "Survivorship Requirements",
  41: "Initial Trustee Named",
  42: "Successor Trustee Chain",
  43: "Co-Trustee Provisions",
  44: "Corporate Trustee Rules",
  45: "Trustee Removal Process",
  46: "Trustee Resignation Process",
  47: "Trust Protector Designation",
  48: "Trust Protector Powers",
  49: "Distribution Committee",
  50: "Investment Committee",
  51: "Trustee Compensation",
  52: "Bond Waiver",
  53: "Trustee Liability Standards",
  54: "Indemnification Provisions",
  55: "Conflict of Interest Rules",
  56: "Amendment/Revocation Powers",
  57: "Decanting Authority",
  58: "Trust Protector Modification Powers",
  59: "Change of Trust Location",
  60: "Trust Merger/Consolidation",
  61: "Trust Division/Severance",
  62: "Non-Judicial Settlement",
  63: "Virtual Representation",
  64: "Tax Law Change Provisions",
  65: "Cy Pres / Deviation Clause",
  66: "Special Needs Provisions",
  67: "Substance Abuse Provisions",
  68: "Mental Incapacity Provisions",
  69: "Marital Property Protection",
  70: "Prenuptial Coordination",
  71: "Beneficiary Privacy",
  72: "Education Funding",
  73: "Healthcare Funding",
  74: "Business Succession",
  75: "Primary Residence Provisions",
  76: "Investment Powers",
  77: "Asset Retention Powers",
  78: "Real Estate Powers",
  79: "Business Entity Powers",
  80: "Borrowing Powers",
  81: "Lending Powers",
  82: "Agent Employment Powers",
  83: "Tax Election Powers",
  84: "Digital Asset Powers",
  85: "Life Insurance Powers",
  86: "Tangible Property Management",
  87: "Environmental Liability",
  88: "Pour-Over Will Coordination",
  89: "Beneficiary Designation Sync",
  90: "Power of Attorney Coordination",
  91: "Business Entity Coordination",
  92: "Prenuptial Agreement Sync",
  93: "Community Property Provisions",
  94: "Homestead Protection",
  95: "Personal Property Memorandum",
  96: "Charitable Remainder Trust",
  97: "Charitable Lead Provisions",
  98: "Private Foundation Planning",
  99: "Donor Advised Fund Provisions",
  100: "Charitable Distribution Authority",
  101: "Proper Execution",
  102: "Clear Definitions",
  103: "Consistent Terminology",
  104: "Unambiguous Language",
  105: "Administrative Provisions",
  106: "Perpetuities Savings Clause",
  107: "Dispute Resolution (Arbitration)",
  108: "No-Contest Clause",
  109: "Professional Formatting",
  110: "Integration Clause"
};

// State-specific trust law considerations
const STATE_SPECIFIC_RULES = {
  "Florida": ["Unique homestead protections - cannot be devised if survived by spouse or minor child", "No state income tax on trusts", "Does not recognize self-settled asset protection trusts", "Specific elective share rules", "Pretermitted spouse/child statutes"],
  "California": ["Community property state", "No self-settled asset protection trusts", "State income tax applies to trusts with CA beneficiaries", "Specific rules on trust modifications"],
  "Texas": ["Community property state", "Homestead protections", "No state income tax", "Unique rules on spendthrift trusts"],
  "New York": ["High state income tax on trusts", "Specific power of appointment rules", "Decanting statute with limitations", "Rule against perpetuities still applies with modifications"],
  "Delaware": ["Favorable trust jurisdiction", "Recognizes self-settled asset protection trusts (after 4 years)", "No state income tax on trusts with no DE beneficiaries", "Directed trust statutes", "Dynasty trusts permitted (no RAP)"],
  "Nevada": ["Recognizes self-settled asset protection trusts (after 2 years)", "No state income tax", "Dynasty trusts permitted", "Strong charging order protections for LLCs"],
  "South Dakota": ["Premier trust jurisdiction", "No state income tax", "Dynasty trusts permitted", "Self-settled asset protection trusts recognized", "Privacy protections"],
  "Wyoming": ["Self-settled asset protection trusts", "No state income tax", "Dynasty trusts", "Strong LLC protections"],
  "Alaska": ["First state with DAPT statute", "No state income tax", "Dynasty trusts permitted"],
  "Tennessee": ["Investment services trust act", "No state income tax on interest/dividends", "Dynasty trusts (360 years)"],
  "Arizona": ["Community property state", "Asset protection trusts recognized", "No state income tax on trusts"],
  "Washington": ["Community property state", "State estate tax with lower exemption", "No state income tax"],
  "Massachusetts": ["State estate tax with $2M exemption", "Decanting statute", "Income tax on trusts"],
  "New Jersey": ["State estate tax (being phased out)", "Inheritance tax still applies", "Income tax on trusts"],
  "Illinois": ["State estate tax with $4M exemption", "Income tax on trusts", "Decanting permitted"],
  "Pennsylvania": ["Inheritance tax (varies by relationship)", "No estate tax", "Income tax on trusts"],
  "Ohio": ["No state estate tax", "Income tax on trusts", "Legacy trust statute for asset protection"],
  "Michigan": ["No state estate tax", "Income tax on trusts", "Decanting statute"],
  "Georgia": ["No state estate tax", "Income tax on trusts with GA source income"],
  "North Carolina": ["No state estate tax", "Income tax on trusts with NC connections"],
  "Virginia": ["No state estate tax", "Income tax on trusts"],
  "Colorado": ["No state estate tax", "Income tax on trusts"],
  "Utah": ["No state estate tax", "Income tax on trusts", "Asset protection trust statute"],
  "Oregon": ["State estate tax with $1M exemption", "Income tax on trusts"],
  "Minnesota": ["State estate tax with $3M exemption", "Income tax on trusts"],
  "Hawaii": ["State estate tax with federal exemption tie", "Community property option available"],
  "Connecticut": ["State estate/gift tax", "Income tax on trusts"],
  "Maryland": ["State estate tax AND inheritance tax", "Income tax on trusts"],
  "Maine": ["State estate tax with $6.8M exemption"],
  "Vermont": ["State estate tax with $5M exemption"],
  "Rhode Island": ["State estate tax with $1.77M exemption"],
  "District of Columbia": ["State estate tax with higher exemption"]
};

// Major tax law changes for document age analysis
const TAX_LAW_MILESTONES = [
  { year: 2001, event: "EGTRRA - Gradual estate tax exemption increase began" },
  { year: 2010, event: "Estate tax temporarily repealed; carryover basis rules" },
  { year: 2011, event: "Portability introduced - $5M exemption, surviving spouse can use deceased spouse's unused exemption" },
  { year: 2013, event: "ATRA - Portability made permanent, $5.25M exemption indexed for inflation" },
  { year: 2014, event: "Final portability regulations issued" },
  { year: 2017, event: "TCJA - Exemption doubled to ~$11.18M, sunsets in 2026" },
  { year: 2020, event: "SECURE Act - Eliminated stretch IRA for most non-spouse beneficiaries (10-year rule)" },
  { year: 2022, event: "SECURE Act regulations clarified RMD requirements during 10-year period" },
  { year: 2023, event: "SECURE 2.0 - Additional retirement account changes" },
  { year: 2026, event: "TCJA sunset - Exemption scheduled to return to ~$6-7M (inflation adjusted)" }
];

// Helper function to generate user-friendly status explanations
function getStatusExplanation(status, score) {
  if (status === 'NOT_APPLICABLE') {
    return "Not applicable to this trust";
  }
  if (score >= 8) {
    return "Well-drafted and comprehensive";
  } else if (score >= 6) {
    return "Present and adequately addressed";
  } else if (score >= 4) {
    return "Present but could be strengthened";
  } else if (score >= 2) {
    return "Mentioned but needs improvement";
  } else {
    if (status === 'ABSENT') return "Not addressed in document";
    if (status === 'INFERRED') return "May be implied but not explicit";
    return "Missing or inadequate";
  }
}

// Proxies in front of the app (Render's load balancer included) close a
// connection that goes quiet for too long, and each Claude call here can run
// for minutes without sending a byte. The browser then reports "network error".
// Writing a small keep-alive every few seconds keeps the connection open.
const KEEPALIVE_MS = Number(process.env.KEEPALIVE_MS) || 15000;

function startKeepAlive(res, chunk) {
  const timer = setInterval(() => {
    if (!res.writableEnded) res.write(chunk);
  }, KEEPALIVE_MS);
  const stop = () => clearInterval(timer);
  res.on('close', stop);
  res.on('finish', stop);
  return stop;
}

// Aborts in-flight Claude calls when the browser disconnects, so an abandoned
// request stops costing API usage. 'close' also fires after a normal finish,
// so only abort if the response was not completed.
function abortOnDisconnect(res) {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}

function isAbort(err, signal) {
  return Boolean(signal && signal.aborted) || (err && /abort/i.test(err.name || ''));
}

// Analysis endpoint
app.post('/api/analyze', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  // SSE comment lines (starting with ":") are ignored by the page.
  startKeepAlive(res, ': keep-alive\n\n');
  const signal = abortOnDisconnect(res);

  const send = (d) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(d)}\n\n`); };

  try {
    const { documentText, documentName, specialConsiderations } = req.body;
    if (!documentText || documentText.length < 100) {
      send({ error: 'Document text too short' }); return res.end();
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      send({ error: 'ANTHROPIC_API_KEY not configured' }); return res.end();
    }

    const anthropic = new Anthropic({ apiKey, timeout: CLIENT_TIMEOUT_MS, maxRetries: 2 });
    const ask = (params) => createMessage(anthropic, params, { signal });
    const text = documentText.substring(0, MAX_DOC_CHARS);
    const documentTruncated = documentText.length > MAX_DOC_CHARS;
    // Document names carry client names, and the privacy notice promises documents
    // are not stored, so log a short digest rather than the filename.
    const docTag = crypto.createHash('sha256').update(String(documentName || 'document')).digest('hex').slice(0, 8);
    console.log(`[analyze] doc:${docTag}: ${documentText.length} chars extracted, ${text.length} sent${documentTruncated ? ' (TRUNCATED)' : ''}`);
    const attrList = ATTRIBUTES.map(a => `${a.id}. ${a.name} (Importance: ${a.imp}/10)`).join('\n');

    // Step 2: Comprehensive Document Summary with Enhanced Analysis
    send({ step: 2 });
    const sum = await ask({
      max_tokens: JSON_MAX_TOKENS,
      messages: [{ role: 'user', content: `You are an expert trust and estate attorney conducting a comprehensive trust document analysis. Analyze this trust document thoroughly.

DOCUMENT TEXT:
${text}

Return your analysis as JSON with the following comprehensive structure:
{
  "trustName": "Official name of the trust",
  "trustType": "Type (revocable/irrevocable, living/testamentary, grantor/non-grantor, etc.)",
  "executionDate": "Date trust was executed (YYYY-MM-DD format if possible)",
  "lastAmendmentDate": "Date of most recent amendment if any",
  "governingLaw": "State/jurisdiction governing the trust",
  
  "grantor": {
    "name": "Full name of grantor/settlor",
    "additionalGrantors": ["Names of any co-grantors"]
  },
  
  "trustees": {
    "initial": [{"name": "Name", "role": "Sole Trustee / Co-Trustee", "powers": "Summary of specific powers", "limitations": "Any limitations on authority"}],
    "successors": [{"order": 1, "name": "Name", "condition": "Condition for succession"}],
    "corporateTrusteeProvisions": "Any provisions for institutional trustees",
    "removalProvisions": "How trustees can be removed and by whom"
  },
  
  "trustProtectors": {
    "designated": [{"name": "Name", "powers": ["List of specific powers"]}],
    "successorProtectors": [{"order": 1, "name": "Name"}],
    "powersInclude": ["Comprehensive list of trust protector powers"]
  },
  
  "beneficiaries": {
    "primary": [{"name": "Name", "relationship": "Relationship to grantor", "share": "Percentage or description", "conditions": "Any conditions on inheritance"}],
    "contingent": [{"name": "Name", "condition": "Condition for inheritance"}],
    "remaindermen": [{"name": "Name/class", "condition": "Final distribution condition"}]
  },
  
  "majorProvisions": [
    {"title": "Provision name", "description": "Detailed description", "significance": "Why this matters", "pageOrSection": "Where found if identifiable"}
  ],
  
  "distributionSchedule": {
    "duringLifetime": "Description of lifetime distribution rules",
    "uponDeath": "Description of death distribution rules",
    "ageBasedDistributions": [{"age": 25, "percentage": "33%", "description": "Description"}],
    "discretionaryStandards": "HEMS, absolute discretion, or other standards",
    "spendthriftProvisions": "Description of spendthrift protections"
  },
  
  "deathEventTimeline": [
    {"order": 1, "event": "Event description", "timing": "When this occurs", "responsibleParty": "Who handles this", "details": "Additional details"}
  ],
  
  "hierarchyOfEvents": {
    "successionOrder": [{"position": 1, "role": "Role", "holder": "Name", "successor": "Next in line"}],
    "decisionMakingAuthority": "Description of who has authority for what",
    "disputeResolution": "How disputes are handled"
  },
  
  "potentialIssues": [
    {"issue": "Description of issue", "severity": "critical/important/minor", "explanation": "Why this is a concern", "recommendation": "Suggested action", "confidence": "high/medium/low"}
  ],
  
  "unusualProvisions": [
    {"provision": "Description", "notes": "Why this is notable"}
  ],
  
  "amendments": [
    {"date": "Date", "description": "What was changed"}
  ],
  
  "referencedDocuments": [
    {"documentName": "Name of referenced document", "purpose": "Why it's referenced", "isAttached": true/false}
  ],
  
  "familyDynamicsFlags": [
    {"flag": "Description of potential family dynamic issue", "indicators": "What in the document suggests this", "severity": "high/medium/low"}
  ],
  
  "boilerplateAssessment": {
    "appearsCustomized": true/false,
    "genericLanguageAreas": ["Areas that appear to use standard boilerplate"],
    "customizedAreas": ["Areas that appear specifically tailored"],
    "overallQuality": "Assessment of drafting quality"
  },
  
  "keyDatesAndDeadlines": [
    {"event": "Event", "date": "Date or trigger", "action": "Required action"}
  ],
  
  "assetTypes": ["Types of assets mentioned or implied in the trust"]
}

Be thorough and extract all relevant information. Include confidence levels where information is inferred rather than explicit. If information is not present in the document, indicate "Not specified" for that field.` }]
    });
    
    const summary = textOf(sum, 'summary');
    let documentSummary = extractJSON(summary, { rawSummary: summary }, 'summary');

    // Step 3: Evaluate with confidence scoring
    send({ step: 3 });
    const ev = await ask({
      max_tokens: JSON_MAX_TOKENS,
      messages: [{ role: 'user', content: `As an expert wealth planner and asset protection attorney, evaluate this trust document against the evaluation framework.

DOCUMENT SUMMARY: ${summary}
SPECIAL CONSIDERATIONS FROM USER: ${specialConsiderations || 'None'}
GOVERNING STATE: ${documentSummary.governingLaw || 'Unknown'}

EVALUATION ATTRIBUTES (110 total):
${attrList}

For each attribute, provide:
1. Status: PRESENT (explicitly addressed), PARTIAL (mentioned but incomplete), ABSENT (not found), INFERRED (implied but not explicit), or NOT_APPLICABLE (does not apply to this type of trust)
2. Score: 0-10 (use null or -1 for NOT_APPLICABLE items)
3. Confidence: HIGH (explicit language found), MEDIUM (inferred from context), LOW (uncertain)
4. Location: Where in document this was found (if identifiable)
5. Notes: Specific observations

Important: Mark attributes as NOT_APPLICABLE when they genuinely don't apply to this trust type. For example:
- Charitable provisions in a non-charitable trust
- QTIP provisions in a trust without a surviving spouse beneficiary
- Special needs provisions when no disabled beneficiaries exist
- Business succession provisions when trust holds no business interests

Return JSON:
{
  "trustName": "...",
  "trustType": "...",
  "attributeScores": [
    {"id": 1, "status": "PRESENT/PARTIAL/ABSENT/INFERRED/NOT_APPLICABLE", "score": 0-10, "confidence": "HIGH/MEDIUM/LOW", "location": "Section or page if known", "notes": "..."}
  ],
  "criticalIssues": [
    {"title": "...", "description": "...", "severity": "critical/important/minor", "confidence": "HIGH/MEDIUM/LOW", "affectedAttributes": [1,2,3]}
  ],
  "stateSpecificIssues": [
    {"issue": "...", "explanation": "...", "severity": "critical/important/minor"}
  ]
}` }]
    });

    let evalData = { attributeScores: [], criticalIssues: [], stateSpecificIssues: [] };
    evalData = extractJSON(textOf(ev, 'evaluation'), evalData, 'evaluation');

    // Step 4: Calculate scores and generate enhanced analysis
    send({ step: 4 });
    const catScores = {};
    const confidenceByCategory = {};
    
    const assessed = [];
    const unassessed = [];
    const notApplicable = [];
    Object.keys(CATEGORIES).forEach(cat => {
      const attrs = ATTRIBUTES.filter(a => a.cat === cat);
      let max = 0;
      let actual = 0;
      let highConfCount = 0;
      let totalCount = 0;
      
      attrs.forEach(a => {
        const e = evalData.attributeScores?.find(x => x.id === a.id);
        if (!e) {
          // The model did not return this attribute. Crediting it 50% used to
          // blend invented data into the headline score, indistinguishable from
          // a real assessment. Leave it out and report coverage instead.
          unassessed.push(a.id);
          return;
        }
        if (e.status === 'NOT_APPLICABLE' || e.score === -1 || e.score === null) {
          notApplicable.push(a.id);
          return;
        }
        max += a.imp;
        actual += (e.score / 10) * a.imp;
        if (e.confidence === 'HIGH') highConfCount++;
        totalCount++;
        assessed.push(a.id);
      });
      
      // Avoid division by zero if all items are N/A
      catScores[cat] = max > 0 ? Math.round((actual / max) * 100) : null;
      confidenceByCategory[cat] = totalCount > 0 ? Math.round((highConfCount / totalCount) * 100) : 50;
    });

    // Weight only the categories that actually got scored, so an unscored
    // category cannot drag the total down as if it had failed.
    let overall = 0;
    let weightUsed = 0;
    Object.keys(CATEGORIES).forEach(c => {
      if (catScores[c] === null) return;
      overall += catScores[c] * (CATEGORIES[c] / 100);
      weightUsed += CATEGORIES[c] / 100;
    });
    overall = weightUsed > 0 ? Math.round(overall / weightUsed) : null;
    const coverage = {
      assessed: assessed.length,
      notApplicable: notApplicable.length,
      unassessed: unassessed.length,
      total: ATTRIBUTES.length,
      percent: Math.round((assessed.length + notApplicable.length) / ATTRIBUTES.length * 100)
    };
    if (unassessed.length) {
      console.warn(`[score] model returned ${assessed.length + notApplicable.length}/${ATTRIBUTES.length} attributes; ${unassessed.length} unassessed and excluded from the score`);
    }

    // Calculate document age and applicable law changes
    const executionYear = documentSummary.executionDate ? 
      parseInt(documentSummary.executionDate.substring(0, 4)) : null;
    const documentAge = executionYear ? new Date().getFullYear() - executionYear : null;
    const missedLawChanges = executionYear ? 
      TAX_LAW_MILESTONES.filter(m => m.year > executionYear) : [];

    // Get state-specific considerations
    const governingState = documentSummary.governingLaw || '';
    const stateRules = Object.entries(STATE_SPECIFIC_RULES).find(([state]) => 
      governingState.toLowerCase().includes(state.toLowerCase())
    );

    // Step 5: Generate comprehensive report with all enhancements
    send({ step: 5 });
    const rpt = await ask({
      max_tokens: JSON_MAX_TOKENS,
      messages: [{ role: 'user', content: `Generate a comprehensive trust analysis report with enhanced features.

DOCUMENT SUMMARY: ${JSON.stringify(documentSummary)}
SPECIAL CONSIDERATIONS: ${specialConsiderations || 'None'}
CATEGORY SCORES: ${Object.entries(catScores).map(([c,s]) => `${c}: ${s}%`).join(', ')}
OVERALL SCORE: ${overall}/100
DOCUMENT AGE: ${documentAge ? documentAge + ' years' : 'Unknown'}
GOVERNING STATE: ${governingState}
STATE-SPECIFIC RULES: ${stateRules ? JSON.stringify(stateRules[1]) : 'None identified'}
MISSED LAW CHANGES SINCE EXECUTION: ${JSON.stringify(missedLawChanges)}
IDENTIFIED ISSUES: ${JSON.stringify(evalData.criticalIssues || [])}
FAMILY DYNAMICS FLAGS: ${JSON.stringify(documentSummary.familyDynamicsFlags || [])}
BOILERPLATE ASSESSMENT: ${JSON.stringify(documentSummary.boilerplateAssessment || {})}
REFERENCED DOCUMENTS: ${JSON.stringify(documentSummary.referencedDocuments || [])}

Generate a comprehensive report as JSON:
{
  "executiveSummary": {
    "oneParagraph": "Single paragraph summary for quick reference",
    "onePage": "Detailed one-page summary (3-4 paragraphs)",
    "keyTakeaways": ["List of 5-7 most important points"]
  },
  
  "detailedFindings": [
    {"title": "...", "description": "...", "severity": "critical/important/minor", "confidence": "HIGH/MEDIUM/LOW", "category": "..."}
  ],
  
  "recommendations": [
    {"priority": "critical/important/advisory", "title": "...", "issue": "...", "action": "...", "urgency": "immediate/soon/when-convenient", "impact": "high/medium/low"}
  ],
  
  "questionsForAttorney": [
    {"question": "Specific question to ask estate planning attorney", "context": "Why this question matters", "relatedIssue": "What finding prompted this question", "priority": "high/medium/low"}
  ],
  
  "stateSpecificAnalysis": {
    "governingState": "${governingState}",
    "advantages": ["Advantages of this state's trust laws"],
    "concerns": ["Potential issues under this state's laws"],
    "alternativeJurisdictions": ["States that might offer better protection or tax treatment"],
    "recommendations": ["State-specific recommendations"]
  },
  
  "documentAgeAnalysis": {
    "executionDate": "${documentSummary.executionDate || 'Unknown'}",
    "ageInYears": ${documentAge || 'null'},
    "lastReviewRecommended": "Date by which review should occur",
    "missedLawChanges": ${JSON.stringify(missedLawChanges)},
    "updateUrgency": "critical/important/routine",
    "specificUpdatesNeeded": ["List of specific updates needed due to law changes"]
  },
  
  "taxEfficiencyOpportunities": [
    {"opportunity": "Description of tax optimization opportunity", "benefit": "Potential benefit", "implementation": "How to implement", "priority": "high/medium/low"}
  ],
  
  "coordinationChecklist": [
    {"item": "Item to verify", "category": "retirement/insurance/real-estate/business/other", "action": "Specific action to take", "responsible": "Who should handle", "verified": false}
  ],
  
  "actionPrioritizationMatrix": {
    "doNow": [{"item": "...", "reason": "..."}],
    "planFor": [{"item": "...", "reason": "..."}],
    "quickWins": [{"item": "...", "reason": "..."}],
    "consider": [{"item": "...", "reason": "..."}]
  },
  
  "familyDynamicsAnalysis": {
    "potentialConflictAreas": ["Areas where family conflict might arise"],
    "protectiveProvisions": ["Provisions that help prevent conflict"],
    "missingProtections": ["Protections that should be considered"],
    "overallRisk": "high/medium/low"
  },
  
  "comparisonNotes": {
    "strengthsVsTypical": ["Ways this trust is stronger than typical documents"],
    "weaknessesVsTypical": ["Ways this trust is weaker than typical documents"],
    "unusualFeatures": ["Features that are uncommon"]
  }
}

Be thorough, specific, and actionable. Prioritize practical guidance over general observations.` }]
    });

    let report = {};
    const rptText = textOf(rpt, 'report');
    report = extractJSON(rptText, { executiveSummary: { onePage: rptText } }, 'report');

    // Compile comprehensive result
    send({ result: {
      trustName: documentSummary.trustName || evalData.trustName || documentName,
      trustType: documentSummary.trustType || evalData.trustType,
      executionDate: documentSummary.executionDate,
      governingLaw: documentSummary.governingLaw,
      overallScore: overall,
      categoryScores: catScores,
      confidenceByCategory: confidenceByCategory,

      // How much of the framework and of the document this score is based on
      coverage: coverage,
      documentTruncated: documentTruncated,
      documentChars: documentText.length,
      documentCharsAnalyzed: text.length,
      
      // Executive summaries at different detail levels
      executiveSummary: asText(report.executiveSummary, rptText),
      executiveSummaryShort: asText(report.executiveSummary?.oneParagraph, ''),
      keyTakeaways: report.executiveSummary?.keyTakeaways,
      
      // Core analysis
      detailedFindings: report.detailedFindings || evalData.criticalIssues,
      recommendations: report.recommendations,
      // Enrich attribute scores with friendly names and categories
      attributeScores: (evalData.attributeScores || []).map(attr => {
        const attrDef = ATTRIBUTES.find(a => a.id === attr.id);
        return {
          ...attr,
          name: attrDef?.name || `Attribute ${attr.id}`,
          friendlyName: FRIENDLY_NAMES[attr.id] || attrDef?.name || `Attribute ${attr.id}`,
          category: attrDef?.cat || 'Other',
          importance: attrDef?.imp || 5,
          explanation: attr.notes || getStatusExplanation(attr.status, attr.score)
        };
      }),
      
      // Enhanced document summary
      documentSummary: documentSummary,
      
      // New enhanced sections
      questionsForAttorney: report.questionsForAttorney,
      stateSpecificAnalysis: report.stateSpecificAnalysis,
      documentAgeAnalysis: report.documentAgeAnalysis,
      taxEfficiencyOpportunities: report.taxEfficiencyOpportunities,
      coordinationChecklist: report.coordinationChecklist,
      actionPrioritizationMatrix: report.actionPrioritizationMatrix,
      familyDynamicsAnalysis: report.familyDynamicsAnalysis,
      comparisonNotes: report.comparisonNotes,
      
      // Metadata
      analysisDate: new Date().toISOString(),
      analysisVersion: "2.0-enhanced"
    }});
    res.end();

  } catch (error) {
    if (isAbort(error, signal)) {
      console.log('[analyze] browser disconnected; stopped the analysis');
      return;
    }
    console.error('Analysis error:', error.message);
    console.error('Stack:', error.stack);
    
    let errorMessage = 'Analysis failed';
    if (error.message?.includes('timeout')) {
      errorMessage = 'Analysis timed out. Please try again.';
    } else if (error.message?.includes('rate')) {
      errorMessage = 'API rate limit reached. Please wait a moment and try again.';
    } else if (error.message?.includes('overloaded')) {
      errorMessage = 'Service is busy. Please try again in a few moments.';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    send({ error: errorMessage });
    res.end();
  }
});


app.get('/health', (_, res) => res.json({
  status: 'ok',
  model: resolvedModel,
  pinned: Boolean(MODEL_PIN),
  modelResolvedAt: resolvedAt ? new Date(resolvedAt).toISOString() : null
}));

// Privacy policy page (clean URL)
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

// Generate DOCX with redlines endpoint
app.post('/api/generate-redline', async (req, res) => {
  try {
    const { documentText, analysisResult, documentName } = req.body;
    
    if (!documentText || !analysisResult) {
      return res.status(400).json({ error: 'Missing required data' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const anthropic = new Anthropic({ apiKey, timeout: CLIENT_TIMEOUT_MS, maxRetries: 2 });

    // Generate specific revision suggestions based on analysis
    const revisionPrompt = await createMessage(anthropic, {
      max_tokens: JSON_MAX_TOKENS,
      messages: [{
        role: 'user',
        content: `You are an expert trust and estate attorney reviewing a trust document. Based on the analysis results, generate specific, actionable revision suggestions.

ORIGINAL DOCUMENT TEXT (first 50000 chars):
${documentText.substring(0, MAX_DOC_CHARS)}

ANALYSIS RESULTS:
${JSON.stringify(analysisResult, null, 2)}

Generate a JSON array of specific revisions. Each revision should include:
1. The exact original text to find (verbatim quote from document, 10-100 words)
2. The suggested replacement text (professionally written in legal style matching the document)
3. The type: "addition" (new clause/section), "modification" (change existing text), or "deletion" (remove text)
4. A brief explanation of why this change is recommended
5. Priority: "critical", "important", or "advisory"

Focus on the most impactful changes based on:
- Missing critical provisions identified in the analysis
- Outdated language that needs updating
- Unclear or ambiguous provisions
- Tax efficiency improvements
- Asset protection enhancements

Return JSON format:
{
  "revisions": [
    {
      "originalText": "exact text from document to find",
      "replacementText": "new text to replace it with",
      "type": "modification|addition|deletion",
      "explanation": "Why this change is recommended",
      "priority": "critical|important|advisory",
      "category": "Category this relates to"
    }
  ],
  "newSections": [
    {
      "title": "Section Title",
      "content": "Full text of new section to add",
      "insertAfter": "Description of where to insert",
      "explanation": "Why this section should be added",
      "priority": "critical|important|advisory"
    }
  ]
}

Limit to 15-20 most important revisions. Write replacement text in professional legal style matching the original document's tone and formatting conventions.`
      }]
    });

    let revisions = extractJSON(textOf(revisionPrompt, 'revisions'), {}, 'revisions');

    // Create the DOCX document with tracked changes
    const doc = createRedlineDocument(documentText, revisions, analysisResult, documentName);
    
    const buffer = await Packer.toBuffer(doc);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Trust_Revisions_${new Date().toISOString().split('T')[0]}.docx"`);
    res.send(buffer);

  } catch (error) {
    console.error('DOCX generation error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate document' });
  }
});

// Helper function to create redline document
function createRedlineDocument(originalText, revisions, analysisResult, documentName) {
  const date = new Date().toISOString();
  const author = "EstateView AI";
  
  // Document styles
  const styles = {
    default: {
      document: {
        run: { font: "Times New Roman", size: 24 }
      }
    },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 28, bold: true, font: "Times New Roman" },
        paragraph: { spacing: { before: 240, after: 120 } }
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 26, bold: true, font: "Times New Roman" },
        paragraph: { spacing: { before: 200, after: 100 } }
      }
    ]
  };

  const children = [];
  
  // Title page
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 200 },
      children: [
        new TextRun({ text: "PROPOSED REVISIONS", bold: true, size: 36, font: "Times New Roman" })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({ text: documentName || "Trust Document", size: 28, font: "Times New Roman" })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({ text: `Prepared by EstateView AI â ${new Date().toLocaleDateString()}`, size: 22, italics: true, font: "Times New Roman" })
      ]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({ text: `Overall Document Score: ${analysisResult.overallScore}/100`, size: 24, font: "Times New Roman" })
      ]
    })
  );

  // Executive summary of changes
  children.push(
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: "SUMMARY OF PROPOSED REVISIONS", bold: true })]
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ 
          text: "The following revisions are recommended based on a comprehensive analysis of the trust document. Changes are shown with tracked changes formatting: ",
          size: 24
        }),
        new TextRun({ text: "additions appear underlined", underline: {}, size: 24 }),
        new TextRun({ text: " and ", size: 24 }),
        new TextRun({ text: "deletions appear with strikethrough", strike: true, size: 24 }),
        new TextRun({ text: ".", size: 24 })
      ]
    })
  );

  // Summary table of revisions
  const revisionsList = revisions.revisions || [];
  const newSections = revisions.newSections || [];
  
  if (revisionsList.length > 0 || newSections.length > 0) {
    const border = { style: BorderStyle.SINGLE, size: 1, color: "999999" };
    const borders = { top: border, bottom: border, left: border, right: border };
    
    const tableRows = [
      new TableRow({
        children: [
          new TableCell({
            borders,
            shading: { fill: "E8E8E8", type: ShadingType.CLEAR },
            width: { size: 1500, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({ text: "Priority", bold: true, size: 20 })] })]
          }),
          new TableCell({
            borders,
            shading: { fill: "E8E8E8", type: ShadingType.CLEAR },
            width: { size: 2000, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({ text: "Type", bold: true, size: 20 })] })]
          }),
          new TableCell({
            borders,
            shading: { fill: "E8E8E8", type: ShadingType.CLEAR },
            width: { size: 5860, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({ text: "Description", bold: true, size: 20 })] })]
          })
        ]
      })
    ];

    revisionsList.forEach((rev, i) => {
      tableRows.push(new TableRow({
        children: [
          new TableCell({
            borders,
            width: { size: 1500, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({ text: (rev.priority || "advisory").toUpperCase(), size: 20 })] })]
          }),
          new TableCell({
            borders,
            width: { size: 2000, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({ text: rev.type || "modification", size: 20 })] })]
          }),
          new TableCell({
            borders,
            width: { size: 5860, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({ text: rev.explanation || "", size: 20 })] })]
          })
        ]
      }));
    });

    newSections.forEach((sec) => {
      tableRows.push(new TableRow({
        children: [
          new TableCell({
            borders,
            width: { size: 1500, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({ text: (sec.priority || "advisory").toUpperCase(), size: 20 })] })]
          }),
          new TableCell({
            borders,
            width: { size: 2000, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({ text: "NEW SECTION", size: 20 })] })]
          }),
          new TableCell({
            borders,
            width: { size: 5860, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({ text: sec.title + ": " + (sec.explanation || ""), size: 20 })] })]
          })
        ]
      }));
    });

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        columnWidths: [1500, 2000, 5860],
        rows: tableRows
      })
    );
  }

  // Detailed revisions section
  children.push(
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: "DETAILED PROPOSED REVISIONS", bold: true })]
    })
  );

  // Add each revision with tracked changes
  revisionsList.forEach((rev, index) => {
    children.push(
      new Paragraph({
        spacing: { before: 300, after: 100 },
        children: [
          new TextRun({ text: `Revision ${index + 1}: `, bold: true, size: 24 }),
          new TextRun({ text: `[${(rev.priority || "advisory").toUpperCase()}] `, bold: true, size: 24, 
            color: rev.priority === "critical" ? "CC0000" : rev.priority === "important" ? "CC6600" : "666666" }),
          new TextRun({ text: rev.category || "", italics: true, size: 24 })
        ]
      }),
      new Paragraph({
        spacing: { after: 100 },
        children: [new TextRun({ text: rev.explanation || "", size: 22, italics: true })]
      })
    );

    // Show the change with tracked changes formatting
    if (rev.type === "deletion") {
      children.push(
        new Paragraph({
          spacing: { after: 200 },
          shading: { fill: "FFF5F5", type: ShadingType.CLEAR },
          children: [
            new TextRun({ text: "DELETE: ", bold: true, size: 22 }),
            new TextRun({ text: rev.originalText || "", strike: true, size: 22, color: "CC0000" })
          ]
        })
      );
    } else if (rev.type === "addition") {
      children.push(
        new Paragraph({
          spacing: { after: 200 },
          shading: { fill: "F5FFF5", type: ShadingType.CLEAR },
          children: [
            new TextRun({ text: "ADD: ", bold: true, size: 22 }),
            new TextRun({ text: rev.replacementText || "", underline: {}, size: 22, color: "006600" })
          ]
        })
      );
    } else {
      // Modification - show both
      children.push(
        new Paragraph({
          spacing: { after: 100 },
          children: [new TextRun({ text: "ORIGINAL TEXT:", bold: true, size: 22 })]
        }),
        new Paragraph({
          spacing: { after: 100 },
          shading: { fill: "FFF5F5", type: ShadingType.CLEAR },
          children: [new TextRun({ text: rev.originalText || "", strike: true, size: 22, color: "CC0000" })]
        }),
        new Paragraph({
          spacing: { after: 100 },
          children: [new TextRun({ text: "REVISED TEXT:", bold: true, size: 22 })]
        }),
        new Paragraph({
          spacing: { after: 200 },
          shading: { fill: "F5FFF5", type: ShadingType.CLEAR },
          children: [new TextRun({ text: rev.replacementText || "", underline: {}, size: 22, color: "006600" })]
        })
      );
    }
  });

  // New sections to add
  if (newSections.length > 0) {
    children.push(
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: "RECOMMENDED NEW PROVISIONS", bold: true })]
      }),
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({ 
          text: "The following provisions are recommended to be added to the trust document:", 
          size: 24, italics: true 
        })]
      })
    );

    newSections.forEach((sec, index) => {
      children.push(
        new Paragraph({
          spacing: { before: 300, after: 100 },
          children: [
            new TextRun({ text: `New Provision ${index + 1}: `, bold: true, size: 24 }),
            new TextRun({ text: sec.title || "", bold: true, size: 24 })
          ]
        }),
        new Paragraph({
          spacing: { after: 100 },
          children: [
            new TextRun({ text: `[${(sec.priority || "advisory").toUpperCase()}] `, bold: true, size: 22,
              color: sec.priority === "critical" ? "CC0000" : sec.priority === "important" ? "CC6600" : "666666" }),
            new TextRun({ text: sec.explanation || "", italics: true, size: 22 })
          ]
        }),
        new Paragraph({
          spacing: { after: 100 },
          children: [new TextRun({ text: `Insert after: ${sec.insertAfter || "appropriate location"}`, size: 20, italics: true })]
        }),
        new Paragraph({
          spacing: { after: 200 },
          shading: { fill: "F5FFF5", type: ShadingType.CLEAR },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: "006600" } },
          children: [new TextRun({ text: sec.content || "", size: 22 })]
        })
      );
    });
  }

  // Disclaimer
  children.push(
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      spacing: { before: 200, after: 200 },
      children: [new TextRun({ text: "IMPORTANT DISCLAIMER", bold: true, size: 24 })]
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ 
        text: "This document contains suggested revisions generated by EstateView AI for informational purposes only. These suggestions do not constitute legal advice. Before implementing any changes to your trust document, you should consult with a qualified estate planning attorney who can review your specific circumstances and ensure compliance with applicable state and federal laws.",
        size: 22
      })]
    }),
    new Paragraph({
      children: [new TextRun({ 
        text: `Document generated: ${new Date().toLocaleString()}`,
        size: 20, italics: true
      })]
    })
  );

  return new Document({
    styles,
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: "EstateView AI â Proposed Revisions", size: 18, italics: true, color: "666666" })]
          })]
        })
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Page ", size: 18 }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18 }),
              new TextRun({ text: " â For informational purposes only. Not legal advice.", size: 18, color: "666666" })
            ]
          })]
        })
      },
      children
    }]
  });
}


// =====================================================
// OCR ENDPOINT
// Scanned PDFs and photos have no text layer for pdf.js to read in the
// browser. The page sends the file here and Claude transcribes it from the
// page images. Nothing is written to disk, matching the privacy notice.
// =====================================================

const OCR_MEDIA_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif'
};
const OCR_MAX_TOKENS = Number(process.env.OCR_MAX_OUTPUT_TOKENS) || 64000;
// A long scan can outrun one response's output limit. Ask the model to carry on
// from where it stopped, a bounded number of times.
const OCR_MAX_CONTINUATIONS = 3;

const OCR_PROMPT = `Transcribe every page of this document verbatim, in reading order.
- Preserve article, section and paragraph numbering, headings and defined terms exactly as written.
- Start each page with a line "--- Page N ---".
- Write [illegible] for text you cannot read, [signature] for signatures, and [handwritten: ...] for handwritten notes you can read.
- Reproduce tables as plain text rows.
- Output only the transcription: no summary, commentary or analysis.`;

async function ocrDocument(anthropic, data, mediaType, signal) {
  const apiKey = (anthropic && anthropic.apiKey) || process.env.ANTHROPIC_API_KEY;
  const model = await getModel(apiKey);
  let maxTokens = OCR_MAX_TOKENS;
  if (resolvedMaxOutput && maxTokens > resolvedMaxOutput) maxTokens = resolvedMaxOutput;

  const fileBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
  const messages = [{ role: 'user', content: [fileBlock, { type: 'text', text: OCR_PROMPT }] }];

  let text = '';
  for (let round = 0; round <= OCR_MAX_CONTINUATIONS; round++) {
    // Streamed so a long transcription is not cut off by an HTTP timeout.
    const msg = await anthropic.messages
      .stream({ model, max_tokens: maxTokens, messages }, { signal })
      .finalMessage();

    if (msg.stop_reason === 'refusal') {
      const err = new Error('The document could not be processed.');
      err.status = 422;
      throw err;
    }
    text += msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    if (msg.stop_reason !== 'max_tokens') return { text, truncated: false };

    messages.push({ role: 'assistant', content: msg.content });
    messages.push({
      role: 'user',
      content: 'Continue the transcription exactly where you stopped. Do not repeat any text already written.'
    });
  }
  return { text, truncated: true };
}

app.post('/api/ocr', async (req, res) => {
  let signal = null;
  try {
    const { data, ext } = req.body || {};
    const mediaType = OCR_MEDIA_TYPES[String(ext || '').toLowerCase()];
    if (!mediaType) return res.status(400).json({ error: 'OCR supports PDF, JPG, PNG, WEBP and GIF files.' });
    if (typeof data !== 'string' || data.length < 100) return res.status(400).json({ error: 'No file data received.' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    const anthropic = new Anthropic({ apiKey, timeout: CLIENT_TIMEOUT_MS, maxRetries: 2 });

    // A long scan can take minutes. Send the headers now and keep the
    // connection alive with whitespace, which JSON parsing ignores. From here
    // on the status is 200, so failures are reported as { error } in the body.
    res.status(200).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    startKeepAlive(res, ' ');
    signal = abortOnDisconnect(res);

    const started = Date.now();
    const { text, truncated } = await ocrDocument(anthropic, data, mediaType, signal);
    // Log size and timing only; document contents and names stay out of logs.
    console.log(`[ocr] ${ext} ${Math.round(data.length * 0.75 / 1024)} KB -> ${text.length} chars in ${Date.now() - started} ms${truncated ? ' (TRUNCATED)' : ''}`);
    res.end(JSON.stringify({ text, truncated }));
  } catch (err) {
    if (isAbort(err, signal)) {
      console.log('[ocr] browser disconnected; stopped the transcription');
      return;
    }
    console.error('[ocr] failed:', err.status || '', err.message);
    let status = 500;
    let message = 'Could not read the scanned document. Please try again.';
    if (err.status === 422) {
      status = 422; message = err.message;
    } else if (err.status === 400 || err.status === 413) {
      status = 400; message = 'The file could not be read. It may be too large, password-protected or damaged.';
    }
    if (res.headersSent) res.end(JSON.stringify({ error: message }));
    else res.status(status).json({ error: message });
  }
});

// =====================================================
// END OCR ENDPOINT
// =====================================================


// Explicit root route fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`EstateView AI running on port ${PORT}`);
  getModel(process.env.ANTHROPIC_API_KEY).then(m => console.log(`[model] resolved to ${m}`));
});
