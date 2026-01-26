// =====================================================
// DICTATION AI ENDPOINT - Add to server.js
// =====================================================
// Add this code before the root route fallback in server.js
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
   - "Prepare a letter to the client" → clientLetter
   - "Send a copy to their CPA" or "Letter to [advisor name]" → advisorLetter
   - "Prepare a follow-up reminder" or "reminder letter in one week" → reminderLetter
   - "Staff checklist" or "checklist for the team" → staffChecklist
   - "Internal memo" or "memo to staff" → internalMemo
   - "Include citations" or when legal research is performed → citations

2. **Implicit needs based on content**:
   - If advisors (CPA, financial advisor, etc.) are mentioned by name → likely needs advisorLetter
   - If legal research or calculations are performed → include citations document
   - If follow-up items are discussed → may need reminderLetter

3. **When unclear, ASK FOR CLARIFICATION**:
   If the dictation does not clearly specify what documents are needed, you MUST include a clarification request in the "clarificationsNeeded" array asking:
   - "What documents would you like me to prepare? Options include: client letter, advisor letters, follow-up reminder, staff checklist, internal memo, and/or citations summary."

Do NOT assume all document types are needed. Only generate documents that are explicitly or clearly implicitly requested.

## Processing Instructions
1. **Identify embedded AI instructions** marked with:
   - "AI—Please Do the Following—"
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
   - Statutes: IRC §2503(b); Fla. Stat. §736.0103
   - Regulations: Treas. Reg. §25.2503-4(b)
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

Internal: "CONFIDENTIAL — ATTORNEY WORK PRODUCT"`;

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
      outputFormat
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
3. If document types are unclear or not specified, include this in clarificationsNeeded before proceeding

## Additional Instructions from User:
${additionalInstructions || 'None provided'}

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
      result = { rawResponse: response.content[0].text };
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

  // Optional: Clean up after download
  // generatedDocuments.delete(docId);
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
          text: "CONFIDENTIAL — ATTORNEY WORK PRODUCT", 
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
  let inList = false;

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
    else if (trimmedLine.startsWith('☐ ') || trimmedLine.startsWith('- [ ] ')) {
      const text = trimmedLine.replace(/^(☐ |- \[ \] )/, '');
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "☐ ", size: 24 }),
            new TextRun({ text: text, size: 24 })
          ],
          spacing: { after: 100 },
          indent: { left: 360 }
        })
      );
    }
    // Bullet points
    else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('• ')) {
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
      const text = trimmedLine.replace(/^\d+\.\s/, '');
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
          text: "⚠️ VERIFICATION REQUIRED: This research summary is provided for attorney review and verification. All citations should be confirmed for currency and applicability before reliance. This preliminary research does not constitute legal advice.",
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
              text: isInternalDoc ? "CONFIDENTIAL" : "EstateView AI — Dictation", 
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
                text: isInternalDoc ? " — Attorney Work Product" : " — Review required before delivery", 
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
