// 画面に依存しない関数(URL 判定、色の決定、設定の正規化)の単体テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SCRIPT = new URL('../environment-ribbon.user.js', import.meta.url);

function loadCore() {
  const exported = {};
  const context = vm.createContext({ console, __ENVIRONMENT_RIBBON_TEST__: exported });
  vm.runInContext(fs.readFileSync(SCRIPT, 'utf8'), context, { filename: SCRIPT.pathname });
  return exported;
}

const core = loadCore();

// vm 内で作られたオブジェクトはプロトタイプが別物なので、比較前に普通のオブジェクトにする
const plain = (v) => JSON.parse(JSON.stringify(v));

test('ワイルドカードは URL 全体と比較する', () => {
  const m = core.toMatcher('*://stg.example.com/*');
  assert.equal(m.test('https://stg.example.com/foo?x=1'), true);
  assert.equal(m.test('http://stg.example.com/'), true);
  assert.equal(m.test('https://stgxexample.com/'), false, '. は任意の 1 文字ではない');
  assert.equal(m.test('https://stg.example.com.evil.com/'), false);
});

test('ワイルドカードはサブドメインにも使える', () => {
  const m = core.toMatcher('*://*.example.com/*');
  assert.equal(m.test('https://a.b.example.com/'), true);
  assert.equal(m.test('https://example.org/'), false);
});

test('/ で囲んだパターンは正規表現として扱う', () => {
  const m = core.toMatcher('/^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?\\//');
  assert.equal(m.test('http://localhost:3000/a'), true);
  assert.equal(m.test('http://127.0.0.1/'), true);
  assert.equal(m.test('http://localhost.evil.com/'), false);
});

test('正規表現のフラグも使える', () => {
  assert.equal(core.toMatcher('/STG/i').test('https://stg.example.com/'), true);
});

test('findRule は上から順に見て最初にマッチしたルールを返す', () => {
  const config = core.normalizeConfig({
    rules: [
      { match: '*://admin.example.com/*', label: 'ADMIN' },
      { match: '*://*.example.com/*', label: 'ANY' },
    ],
  });
  assert.equal(core.findRule(config, 'https://admin.example.com/').label, 'ADMIN');
  assert.equal(core.findRule(config, 'https://www.example.com/').label, 'ANY');
  assert.equal(core.findRule(config, 'https://example.org/'), null);
});

test('findRule は不正な正規表現を飛ばして次のルールを見る', () => {
  const config = core.normalizeConfig({ rules: [{ match: '/(/', label: 'BAD' }, { match: '*', label: 'OK' }] });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(core.findRule(config, 'https://example.com/').label, 'OK');
  } finally {
    console.warn = warn;
  }
});

test('nextTheme はパレット順で最初の未使用の色を返す', () => {
  assert.equal(core.nextTheme([]), 'red');
  assert.equal(core.nextTheme([{ theme: 'red' }, { theme: 'yellow' }]), 'orange');
  assert.equal(core.nextTheme([{ theme: 'custom' }]), 'red', 'カスタムはパレットの色を使っていない扱い');
});

test('nextTheme は全色使っていたら、使われている数が最も少ない色を返す', () => {
  const all = Object.keys(core.THEMES).map((theme) => ({ theme }));
  assert.equal(core.nextTheme(all), 'red');
  assert.equal(core.nextTheme([...all, { theme: 'red' }]), 'orange');
});

test('ribbonColors はテーマかカスタムの色を返す', () => {
  assert.deepEqual(plain(core.ribbonColors({ theme: 'yellow' })), plain(core.THEMES.yellow));
  assert.deepEqual(
    plain(core.ribbonColors({ theme: 'custom', color: '#123456', textColor: '#ffff00' })),
    { bg: '#123456', fg: '#ffff00' },
  );
});

test('ribbonColors はカスタムの色が不正なら既定の色を使う', () => {
  assert.deepEqual(plain(core.ribbonColors({ theme: 'custom', color: 'red; }', textColor: '' })), { bg: '#dc2626', fg: '#ffffff' });
});

test('normalizeConfig は色が決まっていない行に、パレット順で未使用の色を割り当てる', () => {
  const config = core.normalizeConfig({
    rules: [
      { match: '*', label: 'A' },
      { match: '*', label: 'B', theme: 'red' },
      { match: '*', label: 'C', theme: 'unknown' },
    ],
  });
  assert.deepEqual(config.rules.map((r) => r.theme), ['orange', 'red', 'yellow']);
});

test('サイトごとの上書きがあればそれを、なければ全体設定を使う', () => {
  const defaults = { position: 'top-right', size: 'medium', prefixTabTitle: false };
  assert.equal(core.resolve({}, defaults, 'size'), 'medium');
  assert.equal(core.resolve({ size: 'large' }, defaults, 'size'), 'large');
  assert.equal(core.resolve({ prefixTabTitle: true }, defaults, 'prefixTabTitle'), true);
  // false の上書きも全体設定より優先する
  assert.equal(core.resolve({ prefixTabTitle: false }, { ...defaults, prefixTabTitle: true }, 'prefixTabTitle'), false);
});

test('normalizeConfig は足りない全体設定を補い、カスタム以外の色を捨てる', () => {
  const config = core.normalizeConfig({
    defaults: { size: 'large' },
    rules: [
      { match: '*', label: 'A', theme: 'blue', color: '#000000' },
      { match: '*', label: 'B', theme: 'custom', color: '#000000', textColor: '#ffffff' },
    ],
  });
  assert.deepEqual(plain(config.defaults), { position: 'top-right', size: 'large', prefixTabTitle: false });
  assert.equal(config.rules[0].color, undefined);
  assert.equal(config.rules[1].color, '#000000');
});

test('validateRules は空欄と不正な正規表現を行番号付きで知らせる', () => {
  assert.throws(() => core.validateRules([{ match: '', label: 'A' }]), /1 行目: URL パターンが空/);
  assert.throws(() => core.validateRules([{ match: '*', label: 'A' }, { match: '*', label: '' }]), /2 行目: 表示名が空/);
  assert.throws(() => core.validateRules([{ match: '/(/', label: 'A' }]), /1 行目: 正規表現が不正/);
  assert.doesNotThrow(() => core.validateRules(core.DEFAULT_CONFIG.rules));
});
