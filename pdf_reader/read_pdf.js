const pdfParseModule = require('pdf-parse');
const pdfParse = pdfParseModule.default || pdfParseModule;
const fs = require('fs');
const path = require('path');

const pdfPath = path.join(__dirname, '..', 'DAIS Apps & Agents Hackathon for Good 26 Official Rules.docx.pdf');
const buf = fs.readFileSync(pdfPath);

pdfParse(buf).then(data => {
  console.log('=== TOTAL PAGES:', data.numpages, '===');
  console.log(data.text);
}).catch(e => console.error('Error:', e.message));
