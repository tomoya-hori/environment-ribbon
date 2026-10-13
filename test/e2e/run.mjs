// ヘッドレス Chrome で test/e2e/settings.html を開き、ページ内で実行したテストの結果を表示する
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = fileURLToPath(new URL('./settings.html', import.meta.url));

if (!fs.existsSync(CHROME)) {
  console.error(`Chrome が見つかりません: ${CHROME}\n環境変数 CHROME_PATH で場所を指定してください。`);
  process.exit(1);
}

// 前回の sessionStorage などが残らないよう、毎回まっさらなプロファイルで起動する
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'environment-ribbon-e2e-'));
let dom;
try {
  dom = execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--allow-file-access-from-files',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=5000',
    '--dump-dom',
    `file://${PAGE}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}

const match = /<pre id="result">([\s\S]*?)<\/pre>/.exec(dom);
const text = match && match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
if (!text) {
  console.error('テスト結果を取得できませんでした。スクリプトの読み込みに失敗している可能性があります。');
  process.exit(1);
}

const results = JSON.parse(text);
let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`✔ ${r.name}`);
  } else {
    failed++;
    console.log(`✖ ${r.name}\n    期待: ${JSON.stringify(r.expected)}\n    実際: ${JSON.stringify(r.actual)}`);
  }
}
console.log(`\n${results.length - failed} / ${results.length} 件成功`);
process.exit(failed ? 1 : 0);
