const m = require('pdf-parse');
const PDFParse = m.PDFParse;
const fs = require('fs');
const path = require('path');

const pdfPath = path.resolve('..', 'ArogyaSetu_TRACK1_FINAL_v2.pdf');
const buf = fs.readFileSync(pdfPath);

const parser = new PDFParse({
  verbosity: -1,
  data: new Uint8Array(buf)
});

parser.load().then(async () => {
  const numPages = parser.doc.numPages;
  console.log('PAGES:', numPages);
  
  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await parser.doc.getPage(i);
      const textContent = await page.getTextContent();
      // Group by line using transform y-coordinate
      const items = textContent.items;
      let lines = {};
      items.forEach(item => {
        if (!item.str || !item.str.trim()) return;
        const y = Math.round(item.transform[5]);
        if (!lines[y]) lines[y] = [];
        lines[y].push(item.str);
      });
      // Sort by y descending (top to bottom)
      const sortedY = Object.keys(lines).map(Number).sort((a,b) => b-a);
      const pageText = sortedY.map(y => lines[y].join(' ')).join('\n');
      
      console.log('\n========== PAGE', i, '==========');
      console.log(pageText);
    } catch(e) {
      console.log('Page', i, 'error:', e.message);
    }
  }
}).catch(e => console.error('Load Error:', e.message));
