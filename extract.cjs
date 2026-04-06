const fs = require('fs');
try {
  const txt = fs.readFileSync('src/App.tsx', 'utf8');
  const lines = txt.split('\n');
  const importStr = `import {
  type Vector2,
  type StrokeBounds,
  type Stroke,
  generateShapePoints,
  textToPoints,
  computeCentroid,
  computeBounds,
  decimatePoints
} from './utils/geometry';`;

  // Verify the lines first
  let startIdx = lines.findIndex(l => l.startsWith('// ─── Shape generators:'));
  let endIdx = lines.findIndex(l => l.startsWith('type Layer = {'));
  
  if (startIdx !== -1 && endIdx !== -1) {
    console.log(`Replacing lines ${startIdx} to ${endIdx}`);
    lines.splice(startIdx, endIdx - startIdx, importStr, '', '');
    fs.writeFileSync('src/App.tsx', lines.join('\n'));
    console.log('Successfully extracted geometry helpers!');
  } else {
    console.error('Could not find start or end index.');
  }
} catch (e) {
  console.error(e);
}
