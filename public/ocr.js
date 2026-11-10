// Shared document text extraction with OCR fallback.
//
// pdf.js can only read a PDF's text layer. Scanned trusts, signed-and-scanned
// copies and photos of documents have no text layer, so they used to come back
// empty and fail with "Document text too short". When that happens the file is
// sent to /api/ocr, which has Claude read the page images and transcribe them.
//
// Exposes window.EstateOCR. Needs pdf.js (pdfjsLib) loaded for PDFs.
(function () {
  const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
  const OCR_EXTS = ['pdf', ...IMAGE_EXTS];

  // The Claude API accepts requests up to 32 MB, and base64 makes a file about
  // a third larger, so stay safely under that.
  const MAX_OCR_BYTES = 22 * 1024 * 1024;

  // A page with fewer readable characters than this is treated as a scan.
  const SPARSE_PAGE_CHARS = 30;
  // OCR the whole file when at least this share of its pages are scans.
  const SPARSE_PAGE_SHARE = 0.25;

  function extOf(file) {
    return String(file.name || '').split('.').pop().toLowerCase();
  }

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error || new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }

  async function ocrFile(file) {
    const ext = extOf(file);
    if (!OCR_EXTS.includes(ext)) throw new Error('OCR is not available for .' + ext + ' files');
    if (file.size > MAX_OCR_BYTES) {
      throw new Error('This scanned file is too large to read (' + (file.size / 1048576).toFixed(1) +
        ' MB; the limit is ' + Math.round(MAX_OCR_BYTES / 1048576) + ' MB). Split it into smaller PDFs and try again.');
    }
    const data = await readAsBase64(file);
    const resp = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, ext })
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body.error || 'Could not read the scanned document');
    if (body.truncated) console.warn('[ocr] transcription stopped before the end of the document');
    return body.text || '';
  }

  // Text layer first; OCR when the PDF is wholly or largely scanned.
  async function extractPdfText(file) {
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = '';
    let sparse = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      if (pageText.replace(/\s/g, '').length < SPARSE_PAGE_CHARS) sparse++;
      text += pageText + '\n';
    }
    if (pdf.numPages && sparse / pdf.numPages >= SPARSE_PAGE_SHARE) {
      return await ocrFile(file);
    }
    return text;
  }

  window.EstateOCR = { IMAGE_EXTS, OCR_EXTS, isImage: f => IMAGE_EXTS.includes(extOf(f)), ocrFile, extractPdfText };
})();
