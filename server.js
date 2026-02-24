import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, 
         Table, TableRow, TableCell, BorderStyle, WidthType, ShadingType,
         Header, Footer, PageNumber, PageBreak, InsertedTextRun, DeletedTextRun } from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Helper: extract and parse JSON from Claude responses (strips markdown fences)
function extractJSON(text, fallback) {
  if (fallback === undefined) fallback = {};
  if (!text) return fallback;
  var cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  try {
    var s = cleaned.indexOf('{'); var e = cleaned.lastIndexOf('}');
    if (s !== -1 && e > s) return JSON.parse(cleaned.substring(s, e + 1));
  } catch (e1) {}
  try { var m = text.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch (e2) {}
  return fallback;
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

// Analysis endpoint
app.post('/api/analyze', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);

  try {
    const { documentText, documentName, specialConsiderations } = req.body;
    if (!documentText || documentText.length < 100) {
      send({ error: 'Document text too short' }); return res.end();
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      send({ error: 'ANTHROPIC_API_KEY not configured' }); return res.end();
    }

    const anthropic = new Anthropic({ apiKey });
    const text = documentText.substring(0, 100000);
    const attrList = ATTRIBUTES.map(a => `${a.id}. ${a.name} (Importance: ${a.imp}/10)`).join('\n');

    // Step 2: Comprehensive Document Summary with Enhanced Analysis
    send({ step: 2 });
    const sum = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 8192,
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
    
    let documentSummary = extractJSON(sum.content[0].text);




      documentSummary = { rawSummary: sum.content[0].text };
    }
    const summary = sum.content[0].text;

    // Step 3: Evaluate with confidence scoring
    send({ step: 3 });
    const ev = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 8192,
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
    try { evalData = JSON.parse(ev.content[0].text.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch {}

    // Step 4: Calculate scores and generate enhanced analysis
    send({ step: 4 });
    const catScores = {};
    const confidenceByCategory = {};
    
    Object.keys(CATEGORIES).forEach(cat => {
      const attrs = ATTRIBUTES.filter(a => a.cat === cat);
      let max = 0;
      let actual = 0;
      let highConfCount = 0;
      let totalCount = 0;
      
      attrs.forEach(a => {
        const e = evalData.attributeScores?.find(x => x.id === a.id);
        if (e) {
          // Skip NOT_APPLICABLE items from scoring
          if (e.status === 'NOT_APPLICABLE' || e.score === -1 || e.score === null) {
            // Don't count this attribute in the score calculation
            return;
          }
          max += a.imp;
          actual += (e.score / 10) * a.imp;
          if (e.confidence === 'HIGH') highConfCount++;
          totalCount++;
        } else {
          // If no evaluation, include with 50% score
          max += a.imp;
          actual += 0.5 * a.imp;
        }
      });
      
      // Avoid division by zero if all items are N/A
      catScores[cat] = max > 0 ? Math.round((actual / max) * 100) : 0;
      confidenceByCategory[cat] = totalCount > 0 ? Math.round((highConfCount / totalCount) * 100) : 50;
    });

    let overall = 0;
    Object.keys(CATEGORIES).forEach(c => { overall += catScores[c] * (CATEGORIES[c] / 100); });
    overall = Math.round(overall);

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
    const rpt = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 8192,
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
    try { report = JSON.parse(rpt.content[0].text.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch {
      report = { executiveSummary: { onePage: rpt.content[0].text } };
    }

    // Compile comprehensive result
    send({ result: {
      trustName: documentSummary.trustName || evalData.trustName || documentName,
      trustType: documentSummary.trustType || evalData.trustType,
      executionDate: documentSummary.executionDate,
      governingLaw: documentSummary.governingLaw,
      overallScore: overall,
      categoryScores: catScores,
      confidenceByCategory: confidenceByCategory,
      
      // Executive summaries at different detail levels
      executiveSummary: report.executiveSummary?.onePage || report.executiveSummary || rpt.content[0].text,
      executiveSummaryShort: report.executiveSummary?.oneParagraph,
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

// =====================================================
// ESTATE PLAN SUITE REVIEW ENDPOINT
// Multi-document coordinated analysis
// =====================================================

// Document types recognized in a suite review
const SUITE_DOCUMENT_TYPES = [
  { id: 'revocable_trust', label: 'Revocable Living Trust', category: 'core' },
  { id: 'irrevocable_trust', label: 'Irrevocable Trust', category: 'core' },
  { id: 'ilit', label: 'Irrevocable Life Insurance Trust (ILIT)', category: 'core' },
  { id: 'pourover_will', label: 'Pour-Over Will', category: 'core' },
  { id: 'last_will', label: 'Last Will & Testament', category: 'core' },
  { id: 'durable_poa', label: 'Durable Power of Attorney', category: 'ancillary' },
  { id: 'healthcare_directive', label: 'Healthcare Directive / Living Will', category: 'ancillary' },
  { id: 'healthcare_poa', label: 'Healthcare Power of Attorney', category: 'ancillary' },
  { id: 'beneficiary_designation', label: 'Beneficiary Designation Form', category: 'coordination' },
  { id: 'prenuptial', label: 'Prenuptial / Postnuptial Agreement', category: 'coordination' },
  { id: 'business_agreement', label: 'Business Operating / Partnership Agreement', category: 'coordination' },
  { id: 'property_deed', label: 'Property Deed / Title', category: 'coordination' },
  { id: 'trust_amendment', label: 'Trust Amendment / Restatement', category: 'core' },
  { id: 'charitable_trust', label: 'Charitable Trust / Foundation Documents', category: 'core' },
  { id: 'qprt', label: 'Qualified Personal Residence Trust (QPRT)', category: 'core' },
  { id: 'grat', label: 'Grantor Retained Annuity Trust (GRAT)', category: 'core' },
  { id: 'family_llc', label: 'Family LLC / LP Agreement', category: 'coordination' },
  { id: 'letter_of_wishes', label: 'Letter of Wishes / Intent', category: 'ancillary' },
  { id: 'tangible_property_memo', label: 'Tangible Personal Property Memorandum', category: 'ancillary' },
  { id: 'other', label: 'Other Estate Planning Document', category: 'other' }
];

// Cross-document coordination categories for analysis
const COORDINATION_CATEGORIES = {
  "Fiduciary Consistency": { weight: 18, description: "Are trustees, agents, executors, and protectors consistent and appropriate across all documents?" },
  "Beneficiary Alignment": { weight: 16, description: "Do beneficiary designations, distributions, and contingent beneficiaries align across all documents?" },
  "Tax Structure Coordination": { weight: 15, description: "Do the documents work together to optimize estate, gift, GST, and income tax outcomes?" },
  "Funding & Asset Alignment": { weight: 14, description: "Are assets properly titled and directed into the correct trust/entity structures?" },
  "Power of Attorney Integration": { weight: 10, description: "Do POA documents coordinate with trust administration and business succession provisions?" },
  "Healthcare Decision Consistency": { weight: 8, description: "Are healthcare decision-makers consistent and properly empowered across documents?" },
  "Business Succession Coordination": { weight: 7, description: "Do business agreements, trusts, and buy-sell provisions work together?" },
  "Temporal Consistency": { weight: 6, description: "Are all documents reasonably current and do they reference each other properly?" },
  "Gap Analysis": { weight: 6, description: "Are there missing documents that should exist given the overall estate plan structure?" }
};

// Document classification endpoint - uses document content to identify type
app.post('/api/classify-document', async (req, res) => {
  try {
    const { text, filename } = req.body;
    
    if (!text || text.trim().length < 30) {
      return res.json({ type: 'other', confidence: 'low', reason: 'Insufficient text to classify' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.json({ type: 'other', confidence: 'low', reason: 'API not configured' });
    }

    const anthropic = new Anthropic({ apiKey });
    const snippet = text.substring(0, 3000);
    const typeList = SUITE_DOCUMENT_TYPES.map(t => `${t.id}: ${t.label}`).join('\n');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 200,
      system: 'You are a JSON API. Output only raw JSON. No markdown fences, no ``` blocks, no preamble or explanation text.',
      messages: [{ role: 'user', content: `Classify this estate planning document based on its content. Choose the single best match from the list below.

DOCUMENT TYPES:
${typeList}

DOCUMENT CONTENT (first ~3000 chars):
${snippet}

Return ONLY a JSON object with no other text:
{"type": "the_type_id", "confidence": "high/medium/low", "reason": "brief explanation"}` }]
    });

    let result = { type: 'other', confidence: 'low', reason: 'Could not classify' };
    try {
      const match = response.content[0].text.match(/\{[\s\S]*\}/);
      if (match) result = JSON.parse(match[0]);
      // Validate the type is in our list
      if (!SUITE_DOCUMENT_TYPES.find(t => t.id === result.type)) {
        result.type = 'other';
      }
    } catch {}

    res.json(result);

  } catch (error) {
    console.error('Classification error:', error.message);
    res.json({ type: 'other', confidence: 'low', reason: 'Classification failed' });
  }
});

// Batch classification endpoint - classify multiple documents in one call
app.post('/api/classify-documents', async (req, res) => {
  try {
    const { documents } = req.body;
    
    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return res.json({ results: [] });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.json({ results: documents.map(() => ({ type: 'other', confidence: 'low', reason: 'API not configured' })) });
    }

    const anthropic = new Anthropic({ apiKey });
    const typeList = SUITE_DOCUMENT_TYPES.map(t => `${t.id}: ${t.label}`).join('\n');

    // Build a combined prompt with snippets from all documents
    const docSnippets = documents.map((doc, i) => 
      `--- DOCUMENT ${i + 1} (filename: ${doc.filename || 'unknown'}) ---\n${(doc.text || '').substring(0, 2000)}`
    ).join('\n\n');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      system: 'You are a JSON API. Respond with raw JSON only. No markdown, no code blocks, no explanation.',
      messages: [{ role: 'user', content: `Classify each of these ${documents.length} estate planning documents based on their content. Choose the single best match from the list below for each.

DOCUMENT TYPES:
${typeList}

${docSnippets}

Return ONLY a JSON object with no other text:
{"results": [{"type": "the_type_id", "confidence": "high/medium/low", "reason": "brief explanation"}, ...]}

Return exactly ${documents.length} results in the same order as the documents above.` }]
    });

    let parsed = { results: [] };
    try {

      parsed = extractJSON(response.content[0].text);
      // Validate all types
      if (parsed.results) {
        parsed.results = parsed.results.map(r => ({
          ...r,
          type: SUITE_DOCUMENT_TYPES.find(t => t.id === r.type) ? r.type : 'other'
        }));
      }
    } catch {}

    // Ensure we have the right number of results
    while ((parsed.results || []).length < documents.length) {
      parsed.results = parsed.results || [];
      parsed.results.push({ type: 'other', confidence: 'low', reason: 'Could not classify' });
    }

    res.json(parsed);

  } catch (error) {
    console.error('Batch classification error:', error.message);
    res.json({ results: (req.body.documents || []).map(() => ({ type: 'other', confidence: 'low', reason: 'Classification failed' })) });
  }
});

app.post('/api/analyze-suite', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);

  try {
    const { documents, specialConsiderations } = req.body;
    
    if (!documents || !Array.isArray(documents) || documents.length < 2) {
      send({ error: 'Please upload at least 2 documents for a suite review.' }); 
      return res.end();
    }

    if (documents.length > 10) {
      send({ error: 'Maximum of 10 documents per suite review.' }); 
      return res.end();
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      send({ error: 'ANTHROPIC_API_KEY not configured' }); 
      return res.end();
    }

    const anthropic = new Anthropic({ apiKey });
    const totalDocs = documents.length;

    // ===== PHASE 1: Individual Document Summaries =====
    send({ phase: 'summarizing', step: 1, totalSteps: totalDocs + 3, message: 'Summarizing individual documents...' });

    const documentSummaries = [];

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const text = (doc.text || '').substring(0, 80000);
      
      if (!text || text.length < 50) {
        documentSummaries.push({
          index: i,
          name: doc.name || `Document ${i + 1}`,
          type: doc.type || 'other',
          typeLabel: SUITE_DOCUMENT_TYPES.find(t => t.id === doc.type)?.label || doc.type || 'Unknown',
          error: 'Document text too short to analyze',
          summary: null
        });
        continue;
      }

      send({ phase: 'summarizing', step: i + 1, totalSteps: totalDocs + 3, message: `Analyzing: ${doc.name || 'Document ' + (i + 1)}` });

      try {
        const sumResponse = await anthropic.messages.create({
          model: 'claude-sonnet-4-5',
          max_tokens: 6000,
          system: 'You are a JSON API. Output only raw JSON. No markdown fences, no ``` blocks, no preamble or explanation text.',
          messages: [{ role: 'user', content: `You are an expert estate planning attorney. Provide a structured summary of this estate planning document for use in a cross-document coordination review.

DOCUMENT NAME: ${doc.name || 'Unknown'}
DOCUMENT TYPE: ${SUITE_DOCUMENT_TYPES.find(t => t.id === doc.type)?.label || doc.type || 'Unknown'}

DOCUMENT TEXT:
${text}

Return your analysis as JSON:
{
  "documentType": "The specific type of document (trust, will, POA, etc.)",
  "documentSubtype": "More specific classification (e.g., revocable living trust, irrevocable dynasty trust, etc.)",
  "executionDate": "Date executed (YYYY-MM-DD if possible, or 'Unknown')",
  "lastAmendmentDate": "Date of most recent amendment if any, or null",
  "governingLaw": "State/jurisdiction",
  
  "keyParties": {
    "grantor": "Name(s) of grantor/settlor/testator/principal",
    "trustees": ["List of all named trustees and successors"],
    "executors": ["List of executors/personal representatives if applicable"],
    "agents": ["List of agents (POA) if applicable"],
    "protectors": ["Trust protectors if any"],
    "beneficiaries": ["List of all named beneficiaries with shares/conditions"],
    "contingentBeneficiaries": ["Contingent/remainder beneficiaries"],
    "healthcareAgents": ["Healthcare decision-makers if applicable"],
    "guardians": ["Named guardians for minors if applicable"]
  },
  
  "keyProvisions": [
    {"provision": "Name/title", "description": "Brief description", "significance": "Why it matters for coordination"}
  ],
  
  "distributionScheme": "Summary of how assets/authority is distributed",
  "assetTypes": ["Types of assets mentioned or implied"],
  "referencedDocuments": ["Other documents referenced by name"],
  "crossDocumentDependencies": ["Provisions that depend on or reference other documents"],
  
  "taxImplications": {
    "grantorTrustStatus": "Is this a grantor trust? Intentionally defective?",
    "estateInclusion": "Will assets be included in taxable estate?",
    "gstPlanning": "Any GST exemption allocation or dynasty trust provisions?",
    "charitableProvisions": "Any charitable planning provisions?",
    "otherTaxFeatures": ["Other tax-relevant features"]
  },
  
  "fiduciaryPowers": ["Key powers granted to fiduciaries"],
  "limitations": ["Key limitations or restrictions"],
  "revocability": "Revocable or irrevocable",
  "amendmentProvisions": "How can this document be changed?",
  "terminationProvisions": "When/how does this document terminate?",
  
  "potentialIssues": [
    {"issue": "Description", "severity": "critical/important/minor"}
  ],
  
  "uniqueFeatures": ["Unusual or notable provisions that might affect coordination"]
}

Be thorough. Flag anything that might create coordination issues with other estate planning documents.` }]
        });

        let parsed = extractJSON(sumResponse.content[0].text);




          parsed = { rawSummary: sumResponse.content[0].text };
        }

        documentSummaries.push({
          index: i,
          name: doc.name || `Document ${i + 1}`,
          type: doc.type || 'other',
          typeLabel: SUITE_DOCUMENT_TYPES.find(t => t.id === doc.type)?.label || doc.type || 'Unknown',
          summary: parsed,
          error: null
        });

      } catch (err) {
        console.error(`Error summarizing document ${i}:`, err.message);
        documentSummaries.push({
          index: i,
          name: doc.name || `Document ${i + 1}`,
          type: doc.type || 'other',
          typeLabel: SUITE_DOCUMENT_TYPES.find(t => t.id === doc.type)?.label || doc.type || 'Unknown',
          error: err.message,
          summary: null
        });
      }
    }

    const validSummaries = documentSummaries.filter(d => d.summary && !d.error);
    if (validSummaries.length < 2) {
      send({ error: 'Could not analyze enough documents. At least 2 valid documents are required.' });
      return res.end();
    }

    // ===== PHASE 2: Cross-Document Coordination Analysis =====
    send({ phase: 'coordination', step: totalDocs + 1, totalSteps: totalDocs + 3, message: 'Analyzing cross-document coordination...' });

    const coordCategories = Object.entries(COORDINATION_CATEGORIES)
      .map(([name, info]) => `${name} (Weight: ${info.weight}%): ${info.description}`)
      .join('\n');

    const summariesForPrompt = validSummaries.map(d => 
      `--- DOCUMENT: ${d.name} (${d.typeLabel}) ---\n${JSON.stringify(d.summary, null, 2)}`
    ).join('\n\n');

    const coordResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8192,
      system: 'You are a JSON API. Output only raw JSON. No markdown fences, no ``` blocks, no preamble or explanation text.',
      messages: [{ role: 'user', content: `You are an expert estate planning attorney conducting a comprehensive cross-document coordination review of an estate plan suite. You have summaries of ${validSummaries.length} documents. Analyze how these documents work together as a coordinated estate plan.

SPECIAL CONSIDERATIONS FROM CLIENT: ${specialConsiderations || 'None specified'}

DOCUMENTS IN THIS ESTATE PLAN:
${summariesForPrompt}

COORDINATION EVALUATION CATEGORIES:
${coordCategories}

Analyze the estate plan as a whole. For each coordination category, evaluate how well the documents work together and identify specific issues.

Return your analysis as JSON:
{
  "coordinationScores": {
    "Fiduciary Consistency": {"score": 0-100, "confidence": "HIGH/MEDIUM/LOW", "findings": ["specific findings"], "issues": [{"issue": "description", "severity": "critical/important/minor", "affectedDocuments": ["doc names"]}]},
    "Beneficiary Alignment": {"score": 0-100, "confidence": "HIGH/MEDIUM/LOW", "findings": ["specific findings"], "issues": [{"issue": "description", "severity": "critical/important/minor", "affectedDocuments": ["doc names"]}]},
    "Tax Structure Coordination": {"score": 0-100, "confidence": "HIGH/MEDIUM/LOW", "findings": ["specific findings"], "issues": [{"issue": "description", "severity": "critical/important/minor", "affectedDocuments": ["doc names"]}]},
    "Funding & Asset Alignment": {"score": 0-100, "confidence": "HIGH/MEDIUM/LOW", "findings": ["specific findings"], "issues": [{"issue": "description", "severity": "critical/important/minor", "affectedDocuments": ["doc names"]}]},
    "Power of Attorney Integration": {"score": 0-100, "confidence": "HIGH/MEDIUM/LOW", "findings": ["specific findings"], "issues": [{"issue": "description", "severity": "critical/important/minor", "affectedDocuments": ["doc names"]}]},
    "Healthcare Decision Consistency": {"score": 0-100, "confidence": "HIGH/MEDIUM/LOW", "findings": ["specific findings"], "issues": [{"issue": "description", "severity": "critical/important/minor", "affectedDocuments": ["doc names"]}]},
    "Business Succession Coordination": {"score": 0-100, "confidence": "HIGH/MEDIUM/LOW", "findings": ["specific findings"], "issues": [{"issue": "description", "severity": "critical/important/minor", "affectedDocuments": ["doc names"]}]},
    "Temporal Consistency": {"score": 0-100, "confidence": "HIGH/MEDIUM/LOW", "findings": ["specific findings"], "issues": [{"issue": "description", "severity": "critical/important/minor", "affectedDocuments": ["doc names"]}]},
    "Gap Analysis": {"score": 0-100, "confidence": "HIGH/MEDIUM/LOW", "findings": ["specific findings"], "issues": [{"issue": "description", "severity": "critical/important/minor", "affectedDocuments": ["doc names"]}]}
  },
  
  "criticalConflicts": [
    {"title": "Conflict title", "description": "Detailed description of the conflict", "documents": ["affected doc names"], "severity": "critical/important", "resolution": "Recommended resolution"}
  ],
  
  "missingDocuments": [
    {"document": "Type of document that should exist", "reason": "Why it's needed given the current estate plan structure", "priority": "critical/important/advisory"}
  ],
  
  "fiduciaryMap": {
    "trustees": [{"name": "Name", "documents": ["Which documents they appear in"], "roles": ["Their role in each"]}],
    "agents": [{"name": "Name", "documents": ["Which documents"], "roles": ["Roles"]}],
    "executors": [{"name": "Name", "documents": ["Which documents"], "roles": ["Roles"]}],
    "protectors": [{"name": "Name", "documents": ["Which documents"], "roles": ["Roles"]}],
    "healthcareAgents": [{"name": "Name", "documents": ["Which documents"], "roles": ["Roles"]}],
    "inconsistencies": ["Any inconsistencies in fiduciary appointments across documents"]
  },
  
  "beneficiaryMap": {
    "beneficiaries": [{"name": "Name", "documents": ["Which documents they appear in"], "provisions": ["What they receive in each"]}],
    "inconsistencies": ["Any inconsistencies in beneficiary provisions across documents"],
    "disinheritedOrOmitted": ["Anyone who appears in some documents but not others, or who may be unintentionally excluded"]
  },
  
  "documentTimeline": [
    {"document": "Name", "executionDate": "Date", "lastAmended": "Date or N/A", "ageYears": "Number", "needsUpdate": true/false, "reason": "Why update needed if applicable"}
  ]
}

Be specific and reference actual document names and provisions. Focus on actionable findings.` }]
    });

    let coordinationData = extractJSON(coordResponse.content[0].text);




      coordinationData = { rawAnalysis: coordResponse.content[0].text };
    }

    // Calculate overall coordination score
    let overallCoordScore = 0;
    const coordScores = coordinationData.coordinationScores || {};
    Object.entries(COORDINATION_CATEGORIES).forEach(([cat, info]) => {
      const catScore = coordScores[cat]?.score || 50;
      overallCoordScore += catScore * (info.weight / 100);
    });
    overallCoordScore = Math.round(overallCoordScore);

    // ===== PHASE 3: Generate Comprehensive Suite Report =====
    send({ phase: 'report', step: totalDocs + 2, totalSteps: totalDocs + 3, message: 'Generating comprehensive suite report...' });

    const reportResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8192,
      system: 'You are a JSON API. Output only raw JSON. No markdown fences, no ``` blocks, no preamble or explanation text.',
      messages: [{ role: 'user', content: `Generate a comprehensive estate plan suite review report based on the cross-document coordination analysis.

DOCUMENTS REVIEWED: ${validSummaries.map(d => `${d.name} (${d.typeLabel})`).join(', ')}
OVERALL COORDINATION SCORE: ${overallCoordScore}/100
SPECIAL CONSIDERATIONS: ${specialConsiderations || 'None'}
COORDINATION ANALYSIS: ${JSON.stringify(coordinationData, null, 2)}

Generate a report as JSON:
{
  "executiveSummary": {
    "oneParagraph": "Single paragraph summary of the entire estate plan's coordination health",
    "fullSummary": "Detailed 3-5 paragraph summary covering strengths, weaknesses, and critical actions needed",
    "keyTakeaways": ["5-8 most important coordination findings"],
    "overallAssessment": "comprehensive/adequate/needs-attention/critical-issues"
  },
  
  "planStrengths": [
    {"strength": "Description of what works well", "documents": ["Relevant documents"], "significance": "Why this matters"}
  ],
  
  "coordinationIssues": [
    {"title": "Issue title", "description": "Detailed description", "severity": "critical/important/advisory", "affectedDocuments": ["doc names"], "recommendation": "Specific action to resolve", "urgency": "immediate/soon/when-convenient"}
  ],
  
  "recommendations": [
    {"priority": "critical/important/advisory", "title": "Action title", "description": "What needs to be done and why", "affectedDocuments": ["doc names"], "urgency": "immediate/soon/when-convenient", "estimatedComplexity": "simple/moderate/complex"}
  ],
  
  "questionsForAttorney": [
    {"question": "Specific question", "context": "Why this question matters given the document suite", "priority": "high/medium/low", "relatedDocuments": ["doc names"]}
  ],
  
  "actionPrioritizationMatrix": {
    "doNow": [{"item": "Action", "reason": "Why urgent and impactful", "documents": ["affected docs"]}],
    "planFor": [{"item": "Action", "reason": "Why important but not urgent", "documents": ["affected docs"]}],
    "quickWins": [{"item": "Action", "reason": "Why easy to fix", "documents": ["affected docs"]}],
    "consider": [{"item": "Action", "reason": "Why worth considering", "documents": ["affected docs"]}]
  },
  
  "scenarioAnalysis": {
    "uponFirstDeath": {
      "sequence": ["Step-by-step what happens across all documents upon first grantor/spouse death"],
      "potentialIssues": ["Issues that may arise during this transition"],
      "documentsThatActivate": ["Which documents become operative"]
    },
    "uponSecondDeath": {
      "sequence": ["Step-by-step what happens upon second death"],
      "potentialIssues": ["Issues during this transition"],
      "documentsThatActivate": ["Documents that become operative"]
    },
    "uponIncapacity": {
      "sequence": ["What happens if grantor becomes incapacitated"],
      "potentialIssues": ["Gaps or conflicts in incapacity planning"],
      "documentsThatActivate": ["Documents that become operative"]
    }
  },
  
  "taxCoordinationSummary": {
    "overallStrategy": "Description of the overall tax planning strategy across all documents",
    "estateStrategyEffectiveness": "How well the documents minimize estate taxes",
    "gstPlanning": "How GST exemption is being used across documents",
    "incomeTaxConsiderations": "Income tax implications of the trust structure",
    "opportunities": ["Tax optimization opportunities not currently captured"],
    "risks": ["Tax risks from current document coordination"]
  }
}

Be thorough, specific, and practical. Reference specific documents by name throughout.` }]
    });

    let suiteReport = extractJSON(reportResponse.content[0].text);




      suiteReport = { executiveSummary: { fullSummary: reportResponse.content[0].text } };
    }

    // ===== Send final result =====
    send({ phase: 'complete', step: totalDocs + 3, totalSteps: totalDocs + 3, message: 'Analysis complete' });

    send({ result: {
      // Metadata
      analysisType: 'suite',
      analysisDate: new Date().toISOString(),
      analysisVersion: '1.0-suite',
      documentCount: validSummaries.length,
      totalDocumentsSubmitted: documents.length,
      
      // Scores
      overallCoordinationScore: overallCoordScore,
      coordinationScores: coordScores,
      
      // Document summaries
      documentSummaries: documentSummaries,
      
      // Coordination analysis
      criticalConflicts: coordinationData.criticalConflicts || [],
      missingDocuments: coordinationData.missingDocuments || [],
      fiduciaryMap: coordinationData.fiduciaryMap || {},
      beneficiaryMap: coordinationData.beneficiaryMap || {},
      documentTimeline: coordinationData.documentTimeline || [],
      
      // Report
      executiveSummary: suiteReport.executiveSummary?.fullSummary || suiteReport.executiveSummary || '',
      executiveSummaryShort: suiteReport.executiveSummary?.oneParagraph || '',
      keyTakeaways: suiteReport.executiveSummary?.keyTakeaways || [],
      overallAssessment: suiteReport.executiveSummary?.overallAssessment || 'unknown',
      planStrengths: suiteReport.planStrengths || [],
      coordinationIssues: suiteReport.coordinationIssues || [],
      recommendations: suiteReport.recommendations || [],
      questionsForAttorney: suiteReport.questionsForAttorney || [],
      actionPrioritizationMatrix: suiteReport.actionPrioritizationMatrix || {},
      scenarioAnalysis: suiteReport.scenarioAnalysis || {},
      taxCoordinationSummary: suiteReport.taxCoordinationSummary || {}
    }});

    res.end();

  } catch (error) {
    console.error('Suite analysis error:', error.message);
    console.error('Stack:', error.stack);
    
    let errorMessage = 'Suite analysis failed';
    if (error.message?.includes('timeout')) {
      errorMessage = 'Analysis timed out. Try with fewer documents or try again.';
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

// Serve suite review page
app.get('/suite', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'suite.html'));
});

// =====================================================
// END ESTATE PLAN SUITE REVIEW ENDPOINT
// =====================================================

app.get('/health', (_, res) => res.json({ status: 'ok' }));

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

    const anthropic = new Anthropic({ apiKey });

    // Generate specific revision suggestions based on analysis
    const revisionPrompt = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `You are an expert trust and estate attorney reviewing a trust document. Based on the analysis results, generate specific, actionable revision suggestions.

ORIGINAL DOCUMENT TEXT (first 50000 chars):
${documentText.substring(0, 50000)}

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

    let revisions = extractJSON(revisionPrompt.content[0].text);




      console.error('Failed to parse revisions:', e);
    }

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
// DICTATION AI ENDPOINT
// =====================================================

// Dictation AI System Prompt
const DICTATION_SYSTEM_PROMPT = `You are Dictation AI, an advanced AI assistant integrated into EstateView AI, designed to transform dictated content, transcripts, or notes into polished, professional correspondence for legal and wealth management professionals.

## Core Capabilities
- Transform raw dictation into professional legal/financial correspondence
- Generate multiple document types from a single input based on user instructions within the dictation
- Perform calculations (gift tax, valuation discounts, etc.)
- Provide legal research with proper citations
- Ask for clarification when document requirements are unclear

## Practice Areas Covered
- Estate Planning & Trust Administration
- Gift & Estate Taxation (annual exclusions, lifetime exemptions, GST, valuation discounts, Crummey powers)
- Asset Protection (spendthrift trusts, DAPTs, charging orders, tenancy by entireties)
- Business & Corporate Law (entity selection, operating agreements, succession)
- Income Tax Planning (grantor trust status, basis planning)
- Wealth Management

## Document Types You Can Generate
1. **Primary Client Letter**: Comprehensive communication with calculations, research, and next steps
2. **Advisor Coordination Letter(s)**: Brief other professionals (CPA, financial advisor) on the strategy
3. **Follow-Up Reminder Letter**: Sent 7-10 days later if no response
4. **Staff Checklist**: Internal task tracking with checkboxes
5. **Internal Staff Memo**: Scope of engagement and deliverables
6. **Citations & Research Summary**: All legal research, calculations, and sources documented

## CRITICAL: Document Type Determination
You must determine which documents to generate based on:

1. **Explicit requests in the dictation**:
   - "Prepare a letter to the client" â clientLetter
   - "Send a copy to their CPA" or "Letter to [advisor name]" â advisorLetter
   - "Prepare a follow-up reminder" or "reminder letter in one week" â reminderLetter
   - "Staff checklist" or "checklist for the team" â staffChecklist
   - "Internal memo" or "memo to staff" â internalMemo
   - "Include citations" or when legal research is performed â citations

2. **Implicit needs based on content**:
   - If advisors (CPA, financial advisor, etc.) are mentioned by name â likely needs advisorLetter
   - If legal research or calculations are performed â include citations document
   - If follow-up items are discussed â may need reminderLetter

3. **When unclear, ASK FOR CLARIFICATION**:
   If the dictation does not clearly specify what documents are needed, you MUST include a clarification request in the "clarificationsNeeded" array asking:
   - "What documents would you like me to prepare? Options include: client letter, advisor letters, follow-up reminder, staff checklist, internal memo, and/or citations summary."

Do NOT assume all document types are needed. Only generate documents that are explicitly or clearly implicitly requested.

## Processing Instructions
1. **Identify embedded AI instructions** marked with:
   - "AIâPlease Do the Followingâ"
   - "Note to AI:"
   - "Instructions for AI:"
   - "Please include..." / "Make sure to..."

2. **Extract key information**:
   - Dictator/professional name and firm
   - Client names and relationships
   - Other advisors mentioned (CPA, financial advisor, etc.)
   - Assets, values, and transaction details
   - Legal research requests
   - Calculation requirements
   - **Document requests** (what letters/documents to prepare)

3. **Perform calculations** with clear documentation:
   - Show all inputs and assumptions
   - Show step-by-step calculation
   - State conclusion in plain English

4. **Provide legal research** with proper citations:
   - Statutes: IRC Â§2503(b); Fla. Stat. Â§736.0103
   - Regulations: Treas. Reg. Â§25.2503-4(b)
   - Cases: Estate of Strangi v. Commissioner, 115 T.C. 478 (2000)
   - Mark confidence levels: HIGH, MEDIUM, LOW, or VERIFICATION REQUIRED

## Output Format
Return JSON with this structure:
{
  "analysis": {
    "dictator": "Name of professional dictating",
    "clients": ["Client names identified"],
    "advisors": [{"name": "", "role": "", "firm": ""}],
    "practiceArea": "Detected practice area",
    "jurisdiction": "Detected jurisdiction",
    "keyTopics": ["List of main topics"],
    "calculationsRequired": ["List of calculations needed"],
    "researchRequired": ["List of research topics"],
    "documentsRequested": ["List of document types explicitly or implicitly requested"]
  },
  "clarificationsNeeded": [
    {"question": "Question text", "context": "Why this is needed", "critical": true/false}
  ],
  "documents": [
    {
      "type": "clientLetter|advisorLetter|reminderLetter|staffChecklist|internalMemo|citations",
      "title": "Document title",
      "description": "Brief description",
      "content": "Full document content in markdown format",
      "metadata": {
        "recipients": ["List of recipients"],
        "cc": ["CC recipients"],
        "subject": "Subject line if applicable"
      }
    }
  ],
  "calculationsPerformed": [
    {
      "description": "What was calculated",
      "inputs": {"key": "value"},
      "calculation": "Step-by-step calculation",
      "result": "Final result",
      "assumptions": ["List of assumptions made"]
    }
  ],
  "researchProvided": [
    {
      "topic": "Research topic",
      "summary": "Summary of findings",
      "citations": ["Properly formatted citations"],
      "confidence": "HIGH|MEDIUM|LOW|VERIFICATION_REQUIRED",
      "textUsedInDocuments": "Exact text inserted into documents"
    }
  ]
}

## Writing Standards
- Professional, authoritative tone suitable for legal practice
- Clear explanations accessible to non-experts
- Proper legal terminology used correctly
- Numbered paragraphs for complex letters
- Clear section breaks and headings
- All disclaimers included

## Required Disclaimers
Client Letters: "This letter is intended to summarize our discussion and provide preliminary guidance. The recommendations herein are based on our current understanding of the facts and applicable law. Before implementing any strategy, we recommend reviewing this analysis with your other professional advisors."

Research: "This research summary is provided for attorney review and verification. Citations should be confirmed for currency and applicability."

Internal: "CONFIDENTIAL â ATTORNEY WORK PRODUCT"`;

// Store generated documents temporarily (in production, use proper storage)
const generatedDocuments = new Map();

// Dictation API endpoint
app.post('/api/dictation', async (req, res) => {
  try {
    const { 
      content, 
      additionalInstructions, 
      practiceArea, 
      jurisdiction, 
      outputFormat,
      clarificationResponses,
      skipClarifications
    } = req.body;

    if (!content || (typeof content === 'string' && content.length < 50)) {
      return res.status(400).json({ error: 'Content too short. Please provide more detailed input.' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const anthropic = new Anthropic({ apiKey });

    // Build the user prompt
    let userPrompt = `Process the following dictation/transcript and generate professional documents.

## Input Content:
${typeof content === 'string' ? content : JSON.stringify(content)}

## User Preferences:
- Practice Area: ${practiceArea === 'auto' ? 'Auto-detect from content' : practiceArea}
- Jurisdiction: ${jurisdiction === 'auto' ? 'Auto-detect from content' : jurisdiction}
- Output Format: ${outputFormat}

## Document Type Instructions:
Determine which documents to generate based on:
1. Explicit requests in the dictation (e.g., "prepare a letter to the client", "send a copy to their CPA", "prepare a follow-up reminder")
2. Implicit needs based on content (e.g., if advisors are mentioned, prepare advisor letters; if research is performed, include citations document)
3. If document types are unclear or not specified, include this in clarificationsNeeded

## Additional Instructions from User:
${additionalInstructions || 'None provided'}`;

    // Add clarification context if responses were provided
    if (clarificationResponses && clarificationResponses !== 'SKIPPED') {
      userPrompt += `

## Clarification Responses Provided by User:
${clarificationResponses}

Based on these clarification responses, please proceed with generating the documents. Do not ask for further clarifications - use the information provided and make reasonable assumptions for anything still unclear.`;
    } else if (skipClarifications) {
      userPrompt += `

## Note: User chose to skip clarifications
Please proceed with generating documents using your best judgment and reasonable assumptions. Note any assumptions made in the documents.`;
    } else {
      userPrompt += `

## Important: Check for Clarifications First
Before generating documents, identify any critical information that is missing or unclear. If clarifications are needed, return them in the clarificationsNeeded array and DO NOT generate documents yet. Only generate documents if you have sufficient information to proceed.`;
    }

    userPrompt += `

Please analyze this content and generate the appropriate professional documents. Return your response as valid JSON matching the specified output format.`;

    // Call Claude API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16384,
      system: DICTATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    // Parse the response
    let result;
    try {
      const jsonMatch = response.content[0].text.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      result = { 
        error: 'Failed to parse AI response',
        rawResponse: response.content[0].text.substring(0, 500) 
      };
    }

    // If clarifications are needed and user hasn't already responded, return just the clarifications
    if (result.clarificationsNeeded && result.clarificationsNeeded.length > 0 && !clarificationResponses && !skipClarifications) {
      return res.json({
        success: true,
        needsClarification: true,
        clarificationsNeeded: result.clarificationsNeeded,
        analysis: result.analysis
      });
    }

    // Generate document files
    const documents = [];
    const sessionId = Date.now().toString(36) + Math.random().toString(36).substr(2);

    if (result.documents && Array.isArray(result.documents)) {
      for (let i = 0; i < result.documents.length; i++) {
        const doc = result.documents[i];
        const docId = `${sessionId}-${i}`;
        
        // Create DOCX document
        const docxDoc = await createDictationDocument(doc, result);
        const docxBuffer = await Packer.toBuffer(docxDoc);
        
        // Store the document
        generatedDocuments.set(docId, {
          buffer: docxBuffer,
          filename: `${doc.type}_${sessionId}.docx`,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        });

        documents.push({
          id: docId,
          type: doc.type,
          title: doc.title,
          description: doc.description,
          filename: `${doc.type}_${sessionId}.docx`,
          format: 'docx'
        });
      }
    }

    // Return the result with document references
    res.json({
      success: true,
      analysis: result.analysis,
      clarificationsNeeded: result.clarificationsNeeded,
      calculationsPerformed: result.calculationsPerformed,
      researchProvided: result.researchProvided,
      documents: documents
    });

  } catch (error) {
    console.error('Dictation API error:', error);
    res.status(500).json({ error: 'Failed to process dictation', details: error.message });
  }
});

// Download endpoint for generated documents
app.get('/api/dictation/download/:docId', (req, res) => {
  const { docId } = req.params;
  const filename = req.query.filename || 'document.docx';

  const doc = generatedDocuments.get(docId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found or expired' });
  }

  res.setHeader('Content-Type', doc.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(doc.buffer);
});

// Helper function to create DOCX documents from dictation output
async function createDictationDocument(doc, fullResult) {
  const children = [];

  // Document type determines styling
  const isInternalDoc = ['staffChecklist', 'internalMemo', 'citations'].includes(doc.type);
  
  // Header based on document type
  if (isInternalDoc) {
    children.push(
      new Paragraph({
        children: [new TextRun({ 
          text: "CONFIDENTIAL â ATTORNEY WORK PRODUCT", 
          bold: true, 
          size: 20,
          color: "666666"
        })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      })
    );
  }

  // Title
  children.push(
    new Paragraph({
      children: [new TextRun({ 
        text: doc.title, 
        bold: true, 
        size: 32 
      })],
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 }
    })
  );

  // Metadata (recipients, subject, etc.)
  if (doc.metadata) {
    if (doc.metadata.recipients && doc.metadata.recipients.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "To: ", bold: true, size: 24 }),
            new TextRun({ text: doc.metadata.recipients.join(", "), size: 24 })
          ],
          spacing: { after: 100 }
        })
      );
    }
    if (doc.metadata.cc && doc.metadata.cc.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Cc: ", bold: true, size: 24 }),
            new TextRun({ text: doc.metadata.cc.join(", "), size: 24 })
          ],
          spacing: { after: 100 }
        })
      );
    }
    if (doc.metadata.subject) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Re: ", bold: true, size: 24 }),
            new TextRun({ text: doc.metadata.subject, size: 24 })
          ],
          spacing: { after: 100 }
        })
      );
    }
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Date: ", bold: true, size: 24 }),
          new TextRun({ text: new Date().toLocaleDateString('en-US', { 
            year: 'numeric', month: 'long', day: 'numeric' 
          }), size: 24 })
        ],
        spacing: { after: 300 }
      })
    );
  }

  // Horizontal rule
  children.push(
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } },
      spacing: { after: 300 }
    })
  );

  // Main content - parse markdown-like content
  const contentLines = (doc.content || '').split('\n');

  for (const line of contentLines) {
    const trimmedLine = line.trim();
    
    if (!trimmedLine) {
      children.push(new Paragraph({ spacing: { after: 200 } }));
      continue;
    }

    // Headings
    if (trimmedLine.startsWith('### ')) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmedLine.substring(4), bold: true, size: 24 })],
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 300, after: 150 }
        })
      );
    } else if (trimmedLine.startsWith('## ')) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmedLine.substring(3), bold: true, size: 26 })],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 }
        })
      );
    } else if (trimmedLine.startsWith('# ')) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmedLine.substring(2), bold: true, size: 28 })],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 }
        })
      );
    }
    // Checkboxes (for checklists)
    else if (trimmedLine.startsWith('â ') || trimmedLine.startsWith('- [ ] ')) {
      const text = trimmedLine.replace(/^(â |- \[ \] )/, '');
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "â ", size: 24 }),
            new TextRun({ text: text, size: 24 })
          ],
          spacing: { after: 100 },
          indent: { left: 360 }
        })
      );
    }
    // Bullet points
    else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('â¢ ')) {
      const text = trimmedLine.substring(2);
      children.push(
        new Paragraph({
          children: [new TextRun({ text: text, size: 24 })],
          bullet: { level: 0 },
          spacing: { after: 100 }
        })
      );
    }
    // Numbered items
    else if (/^\d+\.\s/.test(trimmedLine)) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmedLine, size: 24 })],
          spacing: { after: 100 }
        })
      );
    }
    // Bold text handling
    else if (trimmedLine.includes('**')) {
      const parts = trimmedLine.split(/(\*\*[^*]+\*\*)/);
      const runs = parts.map(part => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return new TextRun({ text: part.slice(2, -2), bold: true, size: 24 });
        }
        return new TextRun({ text: part, size: 24 });
      });
      children.push(
        new Paragraph({
          children: runs,
          spacing: { after: 150 }
        })
      );
    }
    // Regular paragraph
    else {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmedLine, size: 24 })],
          spacing: { after: 150 }
        })
      );
    }
  }

  // Add disclaimer for client letters
  if (doc.type === 'clientLetter') {
    children.push(
      new Paragraph({ spacing: { before: 400 } }),
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC" } },
        spacing: { before: 200, after: 200 }
      }),
      new Paragraph({
        children: [new TextRun({ 
          text: "DISCLAIMER: This letter is intended to summarize our discussion and provide preliminary guidance. The recommendations herein are based on our current understanding of the facts and applicable law. Before implementing any strategy, we recommend reviewing this analysis with your other professional advisors. This letter does not constitute a guarantee of any particular tax treatment or legal outcome.",
          size: 20,
          italics: true,
          color: "666666"
        })],
        spacing: { after: 200 }
      })
    );
  }

  // Add verification notice for citations document
  if (doc.type === 'citations') {
    children.push(
      new Paragraph({ spacing: { before: 400 } }),
      new Paragraph({
        shading: { fill: "FFF3CD", type: ShadingType.CLEAR },
        children: [new TextRun({ 
          text: "â ï¸ VERIFICATION REQUIRED: This research summary is provided for attorney review and verification. All citations should be confirmed for currency and applicability before reliance. This preliminary research does not constitute legal advice.",
          size: 22,
          bold: true
        })],
        spacing: { after: 200 }
      })
    );
  }

  // Footer with generation info
  children.push(
    new Paragraph({ spacing: { before: 600 } }),
    new Paragraph({
      children: [new TextRun({ 
        text: `Generated by Dictation AI (EstateView AI) on ${new Date().toLocaleString()}`,
        size: 18,
        italics: true,
        color: "999999"
      })],
      alignment: AlignmentType.CENTER
    })
  );

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 24 },
          paragraph: { spacing: { line: 276 } }
        }
      }
    },
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
            children: [new TextRun({ 
              text: isInternalDoc ? "CONFIDENTIAL" : "EstateView AI â Dictation", 
              size: 18, 
              italics: true, 
              color: "666666" 
            })]
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
              new TextRun({ 
                text: isInternalDoc ? " â Attorney Work Product" : " â Review required before delivery", 
                size: 18, 
                color: "666666" 
              })
            ]
          })]
        })
      },
      children
    }]
  });
}

// Route for dictation page
app.get('/dictation', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dictation.html'));
});

// =====================================================
// END DICTATION AI ENDPOINT
// =====================================================

// Explicit root route fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`EstateView AI running on port ${PORT}`));
