const m = require('pdf-parse');
const PDFParse = m.PDFParse;
const fs = require('fs');
const path = require('path');

const pdfPath = path.resolve('..', 'DAIS Apps & Agents Hackathon for Good 26 Official Rules.docx.pdf');
const buf = fs.readFileSync(pdfPath);

// Based on source code, load() uses Hs(this.options) which calls getDocument
// getDocument needs either `url` or `data` (n) parameter
// We need to pass data as a Uint8Array via options

const parser = new PDFParse({
  verbosity: -1,
  data: new Uint8Array(buf)
});

parser.load().then(async () => {
  const numPages = parser.doc.numPages;
  console.log('SUCCESS - PAGES:', numPages);
  for (let i = 1; i <= numPages; i++) {
    const page = await parser.doc.getPage(i);
    const t = await parser.getPageText(page);
    console.log('--- PAGE', i, '---');
    console.log(t);
  }
}).catch(e => console.error('Error:', e.message));
