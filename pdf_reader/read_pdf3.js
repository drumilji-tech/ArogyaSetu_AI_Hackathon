const m = require('pdf-parse');
const PDFParse = m.PDFParse;
const fs = require('fs');
const path = require('path');

const pdfPath = path.resolve('..', 'DAIS Apps & Agents Hackathon for Good 26 Official Rules.docx.pdf');
const buf = fs.readFileSync(pdfPath);

const parser = new PDFParse({
  verbosity: -1,
  data: new Uint8Array(buf)
});

parser.load().then(async () => {
  const numPages = parser.doc.numPages;
  console.log('SUCCESS - PAGES:', numPages);
  
  let allText = '';
  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await parser.doc.getPage(i);
      // Use the raw pdfjs API to extract text
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str || '').join(' ');
      console.log('--- PAGE', i, '---');
      console.log(pageText);
      console.log('');
    } catch(e) {
      console.log('Page', i, 'error:', e.message);
    }
  }
}).catch(e => console.error('Load Error:', e.message));
