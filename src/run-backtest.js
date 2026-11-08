import fs from 'node:fs';
import { backtestSnapshots } from './core/backtest.js';
const file=process.argv[2];
if (!file) {
  console.error('Usage: npm run backtest -- path/to/snapshots.json');
  process.exitCode=2;
} else {
  const payload=JSON.parse(fs.readFileSync(file,'utf8'));
  const result=backtestSnapshots(payload);
  console.log(JSON.stringify(result,null,2));
}
