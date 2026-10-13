# Environment Ribbon

Tampermonkey 用のユーザースクリプトです。開いている URL に応じて、画面の角に `LOCAL` / `DEV` / `STG` / `PROD` などのリボンを表示します。本番環境で誤操作しないための目印として使います。

## インストール

1. Tampermonkey のダッシュボードで「新規スクリプトを作成」を開く
2. `environment-ribbon.user.js` の中身を貼り付けて保存する

## 設定

コードを書き換える必要はありません。

1. 設定したいサイトを開く
2. ブラウザのツールバーにある Tampermonkey のアイコンをクリックし、「⚙ リボン設定を開く」を選ぶ
3. 画面に出る表で、URL パターン、表示名を入力し、必要なら色を選ぶ。「＋ このサイトを追加」を押すと、今開いているサイトの行が入った状態で追加される
4. 「保存して再読み込み」を押す

### 色

色は並んでいる丸から選びます。

- **赤・オレンジ・黄・緑・青・紫・グレー・黒**: テーマを指定する。文字色はテーマに合わせて決まる(黄だけ黒文字)
- **カスタム**(虹色の丸): 背景色と文字色を自分で選ぶ

行を追加すると、上の並び順で、他の行がまだ使っていない色が最初から選ばれています。環境ごとに自然と色が分かれるので、本番を赤にしたいなど色に意味を持たせたいときだけ選び直してください。8色すべて使っている場合は、使われている数が最も少ない色が選ばれます。

### 全体設定とサイトごとの上書き

次の3項目は、画面上部の「全体設定」で全サイト分をまとめて決めます。

- リボンの位置(右上・左上・右下・左下)
- リボンのサイズ(小・中・大・特大)
- タブ名の先頭に [表示名] を付けるかどうか。付けると、タブ名が「[STG] 管理画面」のようになり、タブ一覧でも環境を見分けられる

特定のサイトだけ変えたいときは、その行の「全体設定の上書き」ボタンを押します。開いたパネルで変えたい項目だけ選び、ほかは「全体設定に従う」のままにします。上書きしている項目はボタンに「左下・タブ名: 付ける」のように表示されるので、どのサイトで何を変えたか一覧で分かります。

### JSON での編集

設定は Tampermonkey のストレージに保存されます。スクリプトを更新しても消えません。「JSON で編集」に切り替えると、設定をまとめてコピーしたり貼り付けたりできるので、チーム内での共有に使えます。JSON の形式は次のとおりです。

```json
{
  "defaults": { "position": "top-right", "size": "medium", "prefixTabTitle": false },
  "rules": [
    { "match": "/^https?:\\/\\/localhost(:\\d+)?\\//", "label": "LOCAL", "theme": "gray" },
    { "match": "*://stg.example.com/*", "label": "STG", "theme": "purple" },
    { "match": "*://admin.example.com/*", "label": "ADMIN", "theme": "custom", "color": "#0f766e", "textColor": "#ffffff" },
    { "match": "*://www.example.com/*", "label": "PROD", "theme": "red", "size": "large", "prefixTabTitle": true }
  ]
}
```

`defaults` は全サイト共通の設定です。

| キー | 説明 |
| --- | --- |
| `position` | `top-right` / `top-left` / `bottom-right` / `bottom-left` |
| `size` | `small` / `medium` / `large` / `xlarge` |
| `prefixTabTitle` | `true` にするとタブ名の先頭に `[label]` を付ける |

`rules` はサイトごとの設定で、上から順に評価し、最初にマッチしたものを使います。

| キー | 説明 |
| --- | --- |
| `match` | URL 全体と比較するパターン。`*` はワイルドカード。`/.../` で囲むと正規表現として扱う |
| `label` | リボンに表示する文字 |
| `theme` | `red` / `orange` / `yellow` / `green` / `blue` / `purple` / `gray` / `black` / `custom`。省略すると、読み込み時に未使用の色を割り当てる |
| `color` / `textColor` | `theme` が `custom` のときの背景色と文字色 |
| `position` / `size` / `prefixTabTitle` | 書いた項目だけ、このサイトで `defaults` を上書きする。省略すると `defaults` に従う |

リボンはクリックを透過するので、下にあるボタンなども操作できます。邪魔な場合はメニューの「このサイトでリボンを隠す」でホスト単位に非表示にできます。

## 開発

ツールとタスクは [mise](https://mise.jdx.dev/) で管理しています。最初に `mise install` で Node を入れてください。

| コマンド | 内容 |
| --- | --- |
| `mise run check` | ユーザースクリプトの構文をチェックする |
| `mise run test` | URL 判定や色の決定などの単体テストを実行する(`test/core.test.mjs`) |
| `mise run test:e2e` | ヘッドレス Chrome で `test/e2e/settings.html` を開き、リボンの表示と設定画面の操作を確かめる |
| `mise run ci` | 上の3つをまとめて実行する |
| `mise run preview` | Tampermonkey なしでスクリプトを試すページ(`dev/preview.html`)をブラウザで開く |

E2E テストは macOS の Google Chrome を使います。別の場所にある場合は `CHROME_PATH=/path/to/chrome mise run test:e2e` のように指定してください。

単体テストでは、グローバル変数 `__ENVIRONMENT_RIBBON_TEST__` を用意してからスクリプトを読み込みます。この変数があると、スクリプトは画面に依存しない関数をそこに書き出し、画面には何も描かずに終わります。Tampermonkey 上ではこの変数がないので影響はありません。

リリースするときは、スクリプト冒頭の `@version` を上げてください。Tampermonkey はこの値を見て更新を判断します。
