import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, 
         Table, TableRow, TableCell, BorderStyle, WidthType, ShadingType,
         Header, Footer, PageNumber, PageBreak, InsertedTextRun, DeletedTextRun } from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

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
    
    let documentSummary = {};
    try {
      const match = sum.content[0].text.match(/\{[\s\S]*\}/);
      documentSummary = JSON.parse(match ? match[0] : '{}');
    } catch {
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
1. Status: PRESENT (explicitly addressed), PARTIAL (mentioned but incomplete), ABSENT (not found), or INFERRED (implied but not explicit)
2. Score: 0-10
3. Confidence: HIGH (explicit language found), MEDIUM (inferred from context), LOW (uncertain)
4. Location: Where in document this was found (if identifiable)
5. Notes: Specific observations

Return JSON:
{
  "trustName": "...",
  "trustType": "...",
  "attributeScores": [
    {"id": 1, "status": "PRESENT/PARTIAL/ABSENT/INFERRED", "score": 0-10, "confidence": "HIGH/MEDIUM/LOW", "location": "Section or page if known", "notes": "..."}
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
      const max = attrs.reduce((s, a) => s + a.imp, 0);
      let actual = 0;
      let highConfCount = 0;
      let totalCount = 0;
      
      attrs.forEach(a => {
        const e = evalData.attributeScores?.find(x => x.id === a.id);
        if (e) {
          actual += (e.score / 10) * a.imp;
          if (e.confidence === 'HIGH') highConfCount++;
          totalCount++;
        } else {
          actual += 0.5 * a.imp;
        }
      });
      
      catScores[cat] = Math.round((actual / max) * 100);
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
    console.error(error);
    send({ error: error.message || 'Analysis failed' });
    res.end();
  }
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

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

    let revisions = { revisions: [], newSections: [] };
    try {
      const match = revisionPrompt.content[0].text.match(/\{[\s\S]*\}/);
      revisions = JSON.parse(match ? match[0] : '{}');
    } catch (e) {
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
        new TextRun({ text: `Prepared by EstateView AI — ${new Date().toLocaleDateString()}`, size: 22, italics: true, font: "Times New Roman" })
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
            children: [new TextRun({ text: "EstateView AI — Proposed Revisions", size: 18, italics: true, color: "666666" })]
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
              new TextRun({ text: " — For informational purposes only. Not legal advice.", size: 18, color: "666666" })
            ]
          })]
        })
      },
      children
    }]
  });
}

// Explicit root route fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`EstateView AI running on port ${PORT}`));
