// ==UserScript==
// @name         Environment Ribbon
// @namespace    tomoya-hori/environment-ribbon
// @version      1.0.0
// @description  URLに応じて環境名のリボン(LOCAL / DEV / STG / PROD など)を画面の角に表示する
// @author       tomoya-hori
// @match        *://*/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  // ===========================================================================
  // 定数
  // ===========================================================================

  // 初期設定。設定画面での変更は Tampermonkey のストレージに保存され、このコードは書き換えない。
  // 各キーの意味は README の「JSON での編集」を参照
  const DEFAULT_CONFIG = {
    defaults: { position: 'top-right', size: 'medium', prefixTabTitle: false },
    rules: [
      { match: '/^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?\\//', label: 'LOCAL', theme: 'gray' },
      { match: '*://dev.example.com/*', label: 'DEV', theme: 'blue' },
      { match: '*://stg.example.com/*', label: 'STG', theme: 'orange' },
      { match: '*://www.example.com/*', label: 'PROD', theme: 'red', prefixTabTitle: true },
    ],
  };

  // 全体設定で決め、サイトごとに上書きできる項目
  const FIELDS = {
    position: {
      label: 'リボンの位置',
      options: [['top-right', '右上'], ['top-left', '左上'], ['bottom-right', '右下'], ['bottom-left', '左下']],
      summary: (text) => text,
    },
    size: {
      label: 'リボンのサイズ',
      options: [['small', '小'], ['medium', '中'], ['large', '大'], ['xlarge', '特大']],
      summary: (text) => text,
    },
    prefixTabTitle: {
      label: 'タブ名の先頭に [表示名] を付ける',
      hint: '付けると、タブ名が「[STG] 管理画面」のようになり、タブ一覧でも環境を見分けられます',
      options: [[true, '付ける'], [false, '付けない']],
      summary: (text) => `タブ名: ${text}`,
    },
  };
  const FIELD_KEYS = Object.keys(FIELDS);

  // 新しい行にはこの順で、まだ使っていない色を割り当てる
  const THEMES = {
    red: { name: '赤', bg: '#dc2626', fg: '#ffffff' },
    orange: { name: 'オレンジ', bg: '#d97706', fg: '#ffffff' },
    yellow: { name: '黄', bg: '#facc15', fg: '#111111' },
    green: { name: '緑', bg: '#16a34a', fg: '#ffffff' },
    blue: { name: '青', bg: '#2563eb', fg: '#ffffff' },
    purple: { name: '紫', bg: '#7c3aed', fg: '#ffffff' },
    gray: { name: 'グレー', bg: '#6b7280', fg: '#ffffff' },
    black: { name: '黒', bg: '#111827', fg: '#ffffff' },
  };

  // カスタムで色が未指定・不正なときに使う色
  const CUSTOM_FALLBACK = { bg: THEMES.red.bg, fg: '#ffffff' };

  // 角の領域の中で、リボン中心を角に近い側(near)と遠い側(far)のどちらに置き、何度傾けるか
  const CORNERS = {
    'top-right': { anchor: 'top: 0; right: 0;', x: 'far', y: 'near', rotate: 45 },
    'top-left': { anchor: 'top: 0; left: 0;', x: 'near', y: 'near', rotate: -45 },
    'bottom-right': { anchor: 'bottom: 0; right: 0;', x: 'far', y: 'far', rotate: -45 },
    'bottom-left': { anchor: 'bottom: 0; left: 0;', x: 'near', y: 'far', rotate: 45 },
  };

  // 中サイズを 1 とした倍率
  const SIZES = { small: 0.75, medium: 1, large: 1.35, xlarge: 1.7 };

  const STORAGE_KEY = 'config';
  const HIDDEN_KEY = 'hiddenHosts';
  const RIBBON_ID = 'tm-environment-ribbon';
  const SETTINGS_ID = 'tm-environment-ribbon-settings';

  // ===========================================================================
  // 設定の読み込みと判定(画面に依存しない処理)
  // ===========================================================================

  function isValidTheme(theme) {
    return theme === 'custom' || theme in THEMES;
  }

  // パレット順で、使われている数が最も少ない色(=まだ使っていない色)を返す
  function nextTheme(rules) {
    const count = (key) => rules.filter((r) => r.theme === key).length;
    return Object.keys(THEMES).reduce((best, key) => (count(key) < count(best) ? key : best));
  }

  function normalizeConfig(config) {
    const rules = (config.rules || []).map((r) => ({ ...r }));
    for (const rule of rules) {
      // 色が決まっていない行(JSON で theme を省いた場合など)には、ここで色を割り当てる
      if (!isValidTheme(rule.theme)) rule.theme = nextTheme(rules);
      // カスタム以外ではテーマ側の色を使うので、色は持たない
      if (rule.theme !== 'custom') {
        delete rule.color;
        delete rule.textColor;
      }
    }
    return { defaults: { ...DEFAULT_CONFIG.defaults, ...config.defaults }, rules };
  }

  function loadConfig() {
    return normalizeConfig(GM_getValue(STORAGE_KEY, DEFAULT_CONFIG));
  }

  // サイトごとの上書きを反映した、実際に使う値
  function resolve(rule, defaults, key) {
    return rule[key] ?? defaults[key];
  }

  function hasOverride(rule) {
    return FIELD_KEYS.some((k) => rule[k] !== undefined);
  }

  // <input type="color"> と CSS に渡せるよう、#rrggbb 以外は fallback に置き換える
  function toHexColor(color, fallback) {
    return /^#[0-9a-f]{6}$/i.test(color || '') ? color : fallback;
  }

  function ribbonColors(rule) {
    if (rule.theme === 'custom') {
      return { bg: toHexColor(rule.color, CUSTOM_FALLBACK.bg), fg: toHexColor(rule.textColor, CUSTOM_FALLBACK.fg) };
    }
    return THEMES[rule.theme] || THEMES.red;
  }

  function toMatcher(pattern) {
    const re = /^\/(.+)\/([a-z]*)$/.exec(pattern);
    if (re) return new RegExp(re[1], re[2]);
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$');
  }

  function findRule(config, url) {
    return config.rules.find((rule) => {
      try {
        return toMatcher(rule.match).test(url);
      } catch (e) {
        console.warn('[Environment Ribbon] 不正なパターン:', rule.match, e);
        return false;
      }
    }) || null;
  }

  function validateRules(rules) {
    if (!Array.isArray(rules)) throw new Error('"rules" は配列で指定してください');
    rules.forEach((r, i) => {
      if (!r.match) throw new Error(`${i + 1} 行目: URL パターンが空です`);
      if (!r.label) throw new Error(`${i + 1} 行目: 表示名が空です`);
      try {
        toMatcher(r.match);
      } catch (e) {
        throw new Error(`${i + 1} 行目: 正規表現が不正です (${e.message})`);
      }
    });
  }

  // テストから画面に依存しない関数だけを呼べるようにする。Tampermonkey 上では何もしない
  if (globalThis.__ENVIRONMENT_RIBBON_TEST__) {
    Object.assign(globalThis.__ENVIRONMENT_RIBBON_TEST__, {
      DEFAULT_CONFIG, THEMES, normalizeConfig, nextTheme, resolve, ribbonColors, toMatcher, findRule, validateRules,
    });
    return;
  }

  // ===========================================================================
  // リボンとタブ名
  // ===========================================================================

  function renderRibbon(rule, defaults) {
    const corner = CORNERS[resolve(rule, defaults, 'position')] || CORNERS['top-right'];
    const scale = SIZES[resolve(rule, defaults, 'size')] || SIZES.medium;
    const { bg, fg } = ribbonColors(rule);
    const box = 150 * scale;
    const at = (side) => (side === 'near' ? 40 * scale : box - 40 * scale);

    const host = document.createElement('div');
    host.id = RIBBON_ID;
    // ページの CSS の影響を受けないよう Shadow DOM に閉じ込める
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .wrap {
          position: fixed; ${corner.anchor}
          width: ${box}px; height: ${box}px;
          overflow: hidden; pointer-events: none; z-index: 2147483647;
        }
        .ribbon {
          position: absolute; left: ${at(corner.x)}px; top: ${at(corner.y)}px;
          width: ${220 * scale}px; padding: ${6 * scale}px 0;
          transform: translate(-50%, -50%) rotate(${corner.rotate}deg);
          background: ${bg}; color: ${fg}; opacity: 0.9;
          font: bold ${13 * scale}px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: 0.1em; text-align: center;
          box-shadow: 0 2px 6px rgba(0,0,0,.35);
        }
      </style>
      <div class="wrap"><div class="ribbon"></div></div>
    `;
    root.querySelector('.ribbon').textContent = rule.label;
    document.documentElement.appendChild(host);
  }

  function applyTabTitlePrefix(rule, defaults) {
    if (!resolve(rule, defaults, 'prefixTabTitle')) return;
    const prefix = `[${rule.label}] `;
    const fix = () => {
      if (!document.title.startsWith(prefix)) document.title = prefix + document.title;
    };
    fix();
    // SPA でタイトルが書き換えられたり <title> ごと差し替えられたりしても付け直す
    new MutationObserver(fix).observe(document.head || document.documentElement, {
      childList: true, subtree: true, characterData: true,
    });
  }

  // ===========================================================================
  // サイト単位の非表示
  // ===========================================================================

  function isHiddenHere() {
    return GM_getValue(HIDDEN_KEY, []).includes(location.host);
  }

  function toggleHiddenHere() {
    const hosts = GM_getValue(HIDDEN_KEY, []);
    GM_setValue(HIDDEN_KEY, hosts.includes(location.host)
      ? hosts.filter((h) => h !== location.host)
      : [...hosts, location.host]);
    location.reload();
  }

  // ===========================================================================
  // 設定画面: HTML の組み立て
  // ===========================================================================

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // <select> の値は文字列になるので、選択肢の値とは String() で比べる
  function optionText(key, value) {
    const hit = FIELDS[key].options.find(([v]) => String(v) === String(value));
    return hit ? hit[1] : '';
  }

  function optionValue(key, text) {
    return FIELDS[key].options.find(([v]) => String(v) === text)[0];
  }

  // inheritLabel を渡すと、先頭に「全体設定に従う」(値は空文字)の選択肢を付ける
  function optionsHtml(key, current, inheritLabel) {
    const list = inheritLabel ? [['', inheritLabel], ...FIELDS[key].options] : FIELDS[key].options;
    return list.map(([v, text]) =>
      `<option value="${v}"${String(current ?? '') === String(v) ? ' selected' : ''}>${escapeHtml(text)}</option>`).join('');
  }

  function overrideSummary(rule) {
    const keys = FIELD_KEYS.filter((k) => rule[k] !== undefined);
    return keys.length ? keys.map((k) => FIELDS[k].summary(optionText(k, rule[k]))).join('・') : 'なし';
  }

  const SETTINGS_CSS = `
    .bg { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 2147483647;
          display: flex; align-items: center; justify-content: center; }
    .panel { background: #fff; color: #111; width: min(980px, 96vw); max-height: 90vh; overflow: auto;
             padding: 16px; border-radius: 8px; box-sizing: border-box;
             font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    h2 { font-size: 15px; margin: 0 0 4px; }
    h3 { font-size: 13px; margin: 16px 0 4px; }
    .note { color: #555; margin: 0 0 8px; }
    .hint { color: #777; font-size: 12px; margin-left: 6px; }
    .fields { display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; align-items: center; }
    .fields select { width: auto; min-width: 120px; }
    table { width: 100%; border-collapse: collapse; }
    th { white-space: nowrap; text-align: left; font-weight: 600; color: #555; padding: 4px; border-bottom: 1px solid #ddd; }
    td { padding: 4px; vertical-align: middle; }
    tbody + tbody tr.main td { border-top: 1px solid #eee; }
    input[type=text], select { width: 100%; box-sizing: border-box; padding: 4px 6px; border: 1px solid #ccc;
                               border-radius: 4px; font: inherit; background: #fff; color: #111; }
    input[type=color] { width: 36px; height: 28px; padding: 0; border: 1px solid #ccc; border-radius: 4px; background: #fff; }
    select.inherit { color: #888; }
    button { padding: 6px 12px; cursor: pointer; font: inherit; border: 1px solid #bbb;
             border-radius: 4px; background: #f5f5f5; color: #111; }
    button.link { border: none; background: none; color: #2563eb; padding: 0; }
    button.primary { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }
    .themes { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; max-width: 280px; }
    .chip { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 2px solid #fff;
            box-shadow: 0 0 0 1px #ccc; font-size: 10px; font-weight: bold; line-height: 18px; }
    .chip.selected { box-shadow: 0 0 0 2px #111; }
    .chip.custom { background: conic-gradient(#dc2626, #facc15, #16a34a, #2563eb, #7c3aed, #dc2626); }
    .custom-colors { display: flex; gap: 6px; align-items: center; width: 100%; margin-top: 2px; font-size: 12px; color: #555; }
    .preview { display: inline-block; min-width: 56px; padding: 3px 8px; text-align: center;
               font-weight: bold; letter-spacing: .08em; border-radius: 3px; }
    .ops { white-space: nowrap; }
    .ops button { padding: 2px 6px; }
    button.override { white-space: nowrap; padding: 3px 8px; }
    button.override.active { background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; }
    tr.detail > td { padding: 0 4px 10px 24px; }
    .override-panel { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; }
    .override-panel .head { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .override-panel .fields select { width: 260px; }
    textarea { width: 100%; height: 45vh; box-sizing: border-box; font: 12px/1.4 ui-monospace, Menlo, monospace; }
    .row { display: flex; gap: 8px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
    .spacer { flex: 1; }
    .err { color: #dc2626; width: 100%; }
    details { margin-top: 12px; color: #555; }
    code { background: #f0f0f0; padding: 0 3px; border-radius: 3px; }
  `;

  function settingsHtml() {
    const defaultFields = FIELD_KEYS.map((k) => `
      <label for="d-${k}">${FIELDS[k].label}</label>
      <div>
        <select id="d-${k}" data-d="${k}"></select>
        ${FIELDS[k].hint ? `<span class="hint">${FIELDS[k].hint}</span>` : ''}
      </div>`).join('');
    return `
      <div class="bg">
        <div class="panel">
          <h2>Environment Ribbon 設定</h2>
          <div class="form">
            <h3>全体設定</h3>
            <p class="note">すべてのサイトに共通で使います。サイトごとに変えたい場合は、下の表の「上書き」から設定します。</p>
            <div class="fields defaults">${defaultFields}</div>

            <h3>サイトごとの設定</h3>
            <p class="note">上の行から順に判定し、最初に当てはまった行のリボンを表示します。</p>
            <table>
              <thead><tr>
                <th style="width:28%">URL パターン</th><th style="width:11%">表示名</th><th>色</th>
                <th>見本</th><th>全体設定の上書き</th><th></th>
              </tr></thead>
            </table>
            <div class="row">
              <button data-act="add-here">＋ このサイトを追加</button>
              <button data-act="add">＋ 空の行を追加</button>
            </div>
            <details>
              <summary>URL パターンの書き方</summary>
              <p><code>*</code> は任意の文字列です。例: <code>*://stg.example.com/*</code>、<code>*://*.dev.example.com/*</code><br>
              <code>/</code> で囲むと正規表現として扱います。例: <code>/^https?:\\/\\/localhost(:\\d+)?\\//</code></p>
            </details>
          </div>
          <div class="json" hidden>
            <textarea spellcheck="false"></textarea>
          </div>
          <div class="row">
            <button data-act="toggle-json">JSON で編集</button>
            <button data-act="reset">初期設定に戻す</button>
            <span class="spacer"></span>
            <button data-act="cancel">キャンセル</button>
            <button data-act="save" class="primary">保存して再読み込み</button>
            <div class="err"></div>
          </div>
        </div>
      </div>
    `;
  }

  function themeChipsHtml(rule) {
    const chip = (key, cls, style, title) =>
      `<button class="chip ${cls}${rule.theme === key ? ' selected' : ''}" data-act="theme" data-theme="${key}"
         style="${style}" title="${escapeHtml(title)}"></button>`;
    let custom = '';
    if (rule.theme === 'custom') {
      const { bg, fg } = ribbonColors(rule);
      custom = `
        <div class="custom-colors">
          背景 <input type="color" data-k="color" value="${bg}">
          文字 <input type="color" data-k="textColor" value="${fg}">
        </div>`;
    }
    return `
      <div class="themes">
        ${Object.entries(THEMES).map(([k, t]) => chip(k, '', `background:${t.bg}`, t.name)).join('')}
        ${chip('custom', 'custom', '', 'カスタム: 背景色と文字色を自分で選ぶ')}
        ${custom}
      </div>`;
  }

  function overridePanelHtml(rule, i, defaults) {
    const fields = FIELD_KEYS.map((k) => `
      <label for="o-${k}-${i}">${FIELDS[k].label}</label>
      <div>
        <select id="o-${k}-${i}" data-k="${k}"${rule[k] === undefined ? ' class="inherit"' : ''}>
          ${optionsHtml(k, rule[k], `全体設定に従う（${optionText(k, defaults[k])}）`)}
        </select>
      </div>`).join('');
    return `
      <div class="override-panel">
        <div class="head">
          <span class="note">このサイトだけ全体設定と変えたい項目を選びます</span>
          <button class="link" data-act="clear-override">すべて全体設定に戻す</button>
        </div>
        <div class="fields">${fields}</div>
      </div>`;
  }

  // 1 サイト = 1 つの <tbody>(通常の行 + 上書きパネルの行)。
  // 見本・上書きの要約など入力で変わる部分は updateRow で埋める
  function ruleRowHtml({ rule, i, isLast, open, defaults }) {
    return `
      <tbody data-i="${i}">
        <tr class="main">
          <td><input type="text" data-k="match" value="${escapeHtml(rule.match)}" placeholder="*://stg.example.com/*"></td>
          <td><input type="text" data-k="label" value="${escapeHtml(rule.label)}" placeholder="STG"></td>
          <td>${themeChipsHtml(rule)}</td>
          <td><span class="preview"></span></td>
          <td><button class="override" data-act="toggle-override"
                title="このサイトだけ位置・サイズ・タブ名の設定を変える">${open ? '▾' : '▸'} <span class="summary"></span></button></td>
          <td class="ops">
            <button data-act="up" title="上へ"${i === 0 ? ' disabled' : ''}>↑</button>
            <button data-act="down" title="下へ"${isLast ? ' disabled' : ''}>↓</button>
            <button data-act="del" title="削除">✕</button>
          </td>
        </tr>
        ${open ? `<tr class="detail"><td colspan="6">${overridePanelHtml(rule, i, defaults)}</td></tr>` : ''}
      </tbody>`;
  }

  // ===========================================================================
  // 設定画面: 状態と操作
  // ===========================================================================

  function openSettings() {
    if (document.getElementById(SETTINGS_ID)) return;

    let { defaults, rules } = loadConfig();
    // 上書きパネルを開いている行。並べ替えても追従するよう、行のオブジェクトそのものを覚える
    const expanded = new WeakSet();

    const overlay = document.createElement('div');
    overlay.id = SETTINGS_ID;
    const root = overlay.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${SETTINGS_CSS}</style>${settingsHtml()}`;

    const $ = (selector) => root.querySelector(selector);
    const table = $('table');
    const textarea = $('textarea');
    const isJsonMode = () => !$('.json').hidden;

    function renderDefaults() {
      for (const k of FIELD_KEYS) $(`[data-d=${k}]`).innerHTML = optionsHtml(k, defaults[k]);
    }

    function renderRows() {
      table.querySelectorAll('tbody').forEach((el) => el.remove());
      table.insertAdjacentHTML('beforeend', rules.map((rule, i) =>
        ruleRowHtml({ rule, i, isLast: i === rules.length - 1, open: expanded.has(rule), defaults })).join(''));
      table.querySelectorAll('tbody').forEach(updateRow);
    }

    // 入力のたびに作り直すとフォーカスが外れるので、入力で変わる表示だけを更新する
    function updateRow(tbody) {
      const rule = rules[tbody.dataset.i];
      const { bg, fg } = ribbonColors(rule);
      const preview = tbody.querySelector('.preview');
      preview.textContent = rule.label || '—';
      Object.assign(preview.style, { background: bg, color: fg });

      tbody.querySelector('.summary').textContent = overrideSummary(rule);
      tbody.querySelector('button.override').classList.toggle('active', hasOverride(rule));
    }

    function readJson() {
      const parsed = normalizeConfig(JSON.parse(textarea.value));
      validateRules(parsed.rules);
      return parsed;
    }

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKeydown, true);
    }

    function onKeydown(e) {
      if (e.key === 'Escape') close();
    }

    // data-act の値ごとの処理。i は押されたボタンがある行の番号(行の外なら NaN)。
    // 処理のあとは表を描き直す。描き直した後にしたいことがあれば関数で返す
    const actions = {
      up(i) {
        [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]];
      },
      down(i) {
        [rules[i + 1], rules[i]] = [rules[i], rules[i + 1]];
      },
      del(i) {
        rules.splice(i, 1);
      },
      'toggle-override'(i) {
        if (!expanded.delete(rules[i])) expanded.add(rules[i]);
      },
      'clear-override'(i) {
        FIELD_KEYS.forEach((k) => delete rules[i][k]);
      },
      theme(i, btn) {
        const rule = rules[i];
        const key = btn.dataset.theme;
        if (key === 'custom') {
          // 今の色を出発点にして調整できるようにする
          const { bg, fg } = ribbonColors(rule);
          Object.assign(rule, { theme: 'custom', color: bg, textColor: fg });
          return;
        }
        rule.theme = key;
        delete rule.color;
        delete rule.textColor;
      },
      add() {
        rules.push({ match: '', label: '', theme: nextTheme(rules) });
      },
      'add-here'() {
        rules.unshift({ match: `*://${location.host}/*`, label: '', theme: nextTheme(rules) });
        return () => table.querySelector('[data-k=label]').focus();
      },
      reset() {
        ({ defaults, rules } = normalizeConfig(DEFAULT_CONFIG));
        if (isJsonMode()) textarea.value = JSON.stringify({ defaults, rules }, null, 2);
        else renderDefaults();
      },
      'toggle-json'() {
        if (isJsonMode()) {
          ({ defaults, rules } = readJson());
          renderDefaults();
        } else {
          textarea.value = JSON.stringify({ defaults, rules }, null, 2);
        }
        $('.json').hidden = !$('.json').hidden;
        $('.form').hidden = !$('.form').hidden;
        $('[data-act=toggle-json]').textContent = isJsonMode() ? 'フォームで編集' : 'JSON で編集';
      },
      cancel() {
        close();
      },
      save() {
        if (isJsonMode()) ({ defaults, rules } = readJson());
        else validateRules(rules);
        GM_setValue(STORAGE_KEY, { defaults, rules });
        location.reload();
      },
    };

    $('.defaults').addEventListener('input', (e) => {
      const k = e.target.dataset.d;
      defaults[k] = optionValue(k, e.target.value);
      // 上書きパネルの「全体設定に従う（…）」の表示を最新にする
      renderRows();
    });

    table.addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      const tbody = e.target.closest('tbody');
      const rule = rules[tbody.dataset.i];
      if (k in FIELDS) {
        // 「全体設定に従う」(空文字)を選んだら上書きをやめる
        if (e.target.value === '') delete rule[k];
        else rule[k] = optionValue(k, e.target.value);
        e.target.classList.toggle('inherit', e.target.value === '');
      } else {
        rule[k] = e.target.value;
      }
      updateRow(tbody);
    });

    // 入力欄からドラッグして背景の上で離したときに閉じないよう、押した場所も背景だったときだけ閉じる
    let pressedOnBackdrop = false;
    root.addEventListener('mousedown', (e) => {
      pressedOnBackdrop = e.target.classList.contains('bg');
    });

    root.addEventListener('click', (e) => {
      if (pressedOnBackdrop && e.target.classList.contains('bg')) return close();
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      $('.err').textContent = '';
      try {
        const afterRender = actions[btn.dataset.act](Number(btn.closest('tbody')?.dataset.i), btn);
        if (!isJsonMode()) renderRows();
        afterRender?.();
      } catch (ex) {
        $('.err').textContent = ex.message;
      }
    });

    document.addEventListener('keydown', onKeydown, true);
    renderDefaults();
    renderRows();
    document.documentElement.appendChild(overlay);
  }

  // ===========================================================================
  // 起動
  // ===========================================================================

  GM_registerMenuCommand('⚙ リボン設定を開く', openSettings);

  const config = loadConfig();
  const rule = findRule(config, location.href);
  if (!rule) return;

  const hidden = isHiddenHere();
  GM_registerMenuCommand(hidden ? 'このサイトでリボンを表示' : 'このサイトでリボンを隠す', toggleHiddenHere);
  applyTabTitlePrefix(rule, config.defaults);
  if (!hidden) renderRibbon(rule, config.defaults);
})();
