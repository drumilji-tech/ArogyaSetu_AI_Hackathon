const fs = require('fs');
const src = fs.readFileSync('./node_modules/pdf-parse/dist/pdf-parse/cjs/index.cjs', 'utf8');

// Find where "no `url`" error originates - look at getDocument calls
const needle = 'no \\`url\\`';
let idx = src.indexOf('no `url`');
if (idx >= 0) {
  console.log('Found at:', idx);
  console.log('Context:', src.substring(Math.max(0, idx-400), idx+200));
}

// Also look for load function that uses getDocument
const loadIdx = src.indexOf('async load(');
if (loadIdx >= 0) {
  console.log('\nload function:', src.substring(loadIdx, loadIdx+500));
}
