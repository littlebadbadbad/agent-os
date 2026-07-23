import fs from 'fs';

const c = fs.readFileSync('coverage/sdk/lcov.info', 'utf-8');
const files = c.split('end_of_record');

const targets = process.argv.slice(2);
const targetSet = new Set(targets);

for (const f of files) {
  const lines = f.trim().split('\n');
  if (!lines[0]) continue;
  const sf = lines.find(l => l.startsWith('SF:'));
  if (!sf) continue;
  const filePath = sf.slice(3).replace(/\\/g, '/');
  
  if (targetSet.size > 0 && ![...targetSet].some(t => filePath.includes(t))) continue;
  
  const daUncovered = [];
  const fndaUncovered = [];
  const brdaUncovered = [];
  
  for (const l of lines) {
    if (l.startsWith('DA:')) {
      const parts = l.split(',');
      if (parts[1] === '0') daUncovered.push(parts[0].slice(3));
    } else if (l.startsWith('FNDA:')) {
      const parts = l.split(',');
      if (parts[0].split(':')[1] === '0') fndaUncovered.push(parts[1]);
    } else if (l.startsWith('BRDA:')) {
      const parts = l.split(',');
      if (parts[3].trim() === '-' || parts[3].trim() === '0') {
        brdaUncovered.push(`line ${parts[0].split(':')[1]} block ${parts[1]} branch ${parts[2]} taken=${parts[3].trim()}`);
      }
    }
  }
  
  if (daUncovered.length > 0 || fndaUncovered.length > 0 || brdaUncovered.length > 0) {
    console.log(`\n=== ${filePath} ===`);
    if (daUncovered.length > 0) console.log(`  DA lines 0-hit: ${daUncovered.join(', ')}`);
    if (fndaUncovered.length > 0) console.log(`  Functions 0-hit at lines: ${fndaUncovered.join(', ')}`);
    if (brdaUncovered.length > 0) console.log(`  Branches uncovered:`);
    for (const b of brdaUncovered) console.log(`    ${b}`);
  }
}
