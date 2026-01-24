import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

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
      attributeScores: evalData.attributeScores,
      
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

// Explicit root route fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`EstateView AI running on port ${PORT}`));
