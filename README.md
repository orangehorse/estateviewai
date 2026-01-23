# EstateView AI - Comprehensive Trust Document Analysis

A sophisticated trust document analyzer that evaluates documents against 110 attributes across 10 weighted categories, with state-specific analysis, document age assessment, and actionable recommendations.

## Features

### Core Analysis
- **110 Evaluation Attributes** across 10 weighted categories
- **Comprehensive Document Summary** with trustees, protectors, beneficiaries, and key provisions
- **Death Event Timeline** showing sequence of events upon grantor's death
- **Succession Hierarchy** with decision-making authority mapping

### Enhanced Analysis (v2.0)
- **State-Specific Analysis** - Jurisdiction-specific considerations for all 50 states
- **Document Age Assessment** - Tax law changes since execution with update urgency
- **Questions for Your Attorney** - Specific questions based on identified gaps
- **Tax Efficiency Opportunities** - Optimization strategies with implementation guidance
- **Coordination Checklist** - Items to verify outside the trust document
- **Action Prioritization Matrix** - Urgency vs. Impact grid for recommendations
- **Family Dynamics Analysis** - Potential conflict areas and protective provisions
- **Comparison vs. Typical Trusts** - Strengths, weaknesses, and unusual features
- **Confidence Scoring** - HIGH/MEDIUM/LOW confidence for each finding
- **Boilerplate Detection** - Identifies generic vs. customized language

### Evaluation Categories

| Category | Weight |
|----------|--------|
| Asset Protection & Creditor Shielding | 15% |
| Tax Efficiency & Planning | 15% |
| Succession & Distribution Design | 14% |
| Trustee Selection & Governance | 12% |
| Flexibility & Amendment Provisions | 10% |
| Beneficiary Protections | 9% |
| Fiduciary Powers & Limitations | 8% |
| Coordination with Overall Estate Plan | 7% |
| Charitable Planning Integration | 5% |
| Technical Drafting & Legal Compliance | 5% |

### State-Specific Rules Database
Includes specific considerations for:
- **Asset Protection States**: Delaware, Nevada, South Dakota, Wyoming, Alaska
- **Community Property States**: California, Texas, Arizona, Washington, etc.
- **State Estate Tax States**: Massachusetts, Oregon, Minnesota, etc.
- **Homestead States**: Florida, Texas
- And 25+ additional jurisdictions

### Tax Law Milestone Tracking
Automatically identifies documents predating:
- 2010: Estate tax repeal year
- 2011: Portability introduction
- 2013: ATRA permanent portability
- 2017: TCJA exemption doubling
- 2020: SECURE Act (stretch IRA elimination)
- 2023: SECURE 2.0 changes
- 2026: TCJA sunset

## Deployment on Render

### 1. Push to GitHub
Upload this folder to a new GitHub repository.

### 2. Create Web Service on Render
1. Go to [dashboard.render.com](https://dashboard.render.com)
2. **New +** → **Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Name**: `estateviewai`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

### 3. Add Environment Variable
In **Environment** tab:

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | Your Claude API key |

### 4. Deploy
Your app will be at: **https://estateviewai.onrender.com**

## Local Development

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

Visit http://localhost:3000

## Report Sections

1. **Executive Summary** - Quick reference with key takeaways
2. **Key Parties & Fiduciaries** - Trustees, protectors, beneficiaries
3. **Major Provisions** - Distribution schedules, discretionary standards
4. **Death Event Timeline** - Step-by-step sequence
5. **Succession Hierarchy** - Decision-making authority
6. **Potential Issues** - Identified concerns with severity ratings
7. **Category Scores** - Performance across 10 categories
8. **Detailed Findings** - Attribute-level analysis
9. **Recommendations** - Prioritized action items
10. **Questions for Attorney** - Specific discussion points
11. **State-Specific Analysis** - Jurisdiction considerations
12. **Document Age Analysis** - Law changes since execution
13. **Tax Efficiency Opportunities** - Optimization strategies
14. **Coordination Checklist** - Items to verify externally
15. **Action Prioritization Matrix** - Urgency vs. Impact grid
16. **Family Dynamics Analysis** - Conflict risk assessment
17. **Comparison vs. Typical Trusts** - Strengths and weaknesses

## Data Privacy

- Documents are **not stored** after analysis
- Content is sent to Claude AI for processing
- Recommend redacting SSNs and account numbers before upload

## Disclaimer

For informational purposes only. Not legal advice. Consult a qualified attorney.
