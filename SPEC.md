# pokesleep-ranker モジュール契約（実装者全員が従うこと）

ポケモンスリープの個体詳細スクショをOCRし、とくいタイプ別の重みでスコア化して
「全パターン中の上位何%か」を出す、スマホ向け静的PWA。ビルド工程なし・ES modules・CDN不使用。
`docs/` を GitHub Pages の sub-path (`/pokesleep-ranker/`) で配信するため、**すべてのパスは相対**。
UI文言は日本語。ライブラリは `docs/vendor/` に同梱する。

## ディレクトリ

```
docs/index.html, manifest.json, sw.js, icons/
docs/css/style.css
docs/js/app.js            ルータ・SW登録
docs/js/update.js         SW更新（nail_designer から流用）
docs/js/store.js          IndexedDB
docs/js/ui.js             DOMユーティリティ
docs/js/settings.js       設定の読み書き
docs/js/data/gamedata.js  SUBSKILLS / NATURES / STATS / SPECIALTIES / MAIN_SKILLS
docs/js/data/species.js   SPECIES
docs/js/data/defaults.js  DEFAULT_SETTINGS
docs/js/ocr/{image,engine,fuzzy,parse}.js
docs/js/score/{score,dist,enum-worker}.js
docs/js/io.js
docs/js/views/view-{list,capture,detail,settings}.js
docs/vendor/              tesseract.esm.min.js, worker.min.js, core/, lang/, LICENSES/
```

## ID 規約

- **とくいタイプ** `specialty`: `'berry' | 'ingredient' | 'skill' | 'all'`（表示名: きのみ／食材／スキル／オール）
  - 注意: 詳細画面左上の「きのみ」ピルは**きのみ欄のラベル**であり、とくいタイプではない。とくいタイプは種族表（species.js）から引くのが正。
- **レア度** `rarity`: `'gold' | 'silver' | 'white'`。ゲーム内の枠色は 金／青／白 なので、`silver` の表示名は「青」にする。
- **ステータス** `stat`: `'speed'`(おてつだいスピード) `'ing'`(食材おてつだい確率) `'skill'`(メインスキル発生確率) `'energy'`(げんき回復量) `'exp'`(EXP獲得量)
- **サブスキル** `subskillId`（snake_case、末尾に規模）:
  `berry_s, help_speed_s, help_speed_m, help_bonus, ing_s, ing_m, skill_trig_s, skill_trig_m,
   skill_lv_s, skill_lv_m, carry_s, carry_m, carry_l, energy_recovery_bonus, sleep_exp_bonus,
   research_exp_bonus, dream_shard_bonus`
  （gamedata 担当が現行仕様を確認して増減してよいが、既存IDは変えない）
- **せいかく** `natureId`: ローマ字 snake_case（例 `majime`, `ijippari`）。消費側は特定IDに依存せず `NATURES` 配列を回す。
- **種族** `speciesId`: ローマ字 snake_case（例 `jijiron`）。未登録の種族は `species: null` でも全機能が動くこと。

## data/gamedata.js（named export）

```js
export const SPECIALTIES = [{ id:'berry', name:'きのみ' }, { id:'ingredient', name:'食材' }, { id:'skill', name:'スキル' }, { id:'all', name:'オール' }];
export const STATS = [{ id:'speed', name:'おてつだいスピード' }, ...5件];
export const SUBSKILLS = [{ id:'berry_s', name:'きのみの数S', rarity:'gold'|'silver'|'white', aliases:[] }, ...];
export const NATURES = [{ id:'majime', name:'まじめ', up:null|statId, down:null|statId }, ...25件];
export const MAIN_SKILLS = [{ id:'cooking_chance_s', name:'料理チャンスS' }, ...];
export const SUBSKILL_UNLOCK_LEVELS = [10, 25, 50, 70, 80]; // Ver.3.6.0(2026-06)以降の既定。OCRで読めた値を優先する
export const byId = (list) => Object.fromEntries(list.map(x => [x.id, x]));
```

## data/species.js

```js
export const SPECIES = [{ id:'jijiron', name:'ジジーロン', specialty:'ingredient', aliases:[] }, ...];
```

## data/defaults.js

```js
export const SETTINGS_SCHEMA_VERSION = 1;
export const DEFAULT_SETTINGS = {
  key: 'current', schemaVersion: 1,
  slotWeights: [10, 9, 7, 5, 3],                 // 枠1..5（整数）
  subskillWeights: { berry: { berry_s: 100, ... }, ingredient: {...}, skill: {...}, all: {...} }, // 整数 0..100 目安
  natureEffectWeights: { berry: { up: { speed:.., ing:.., skill:.., energy:.., exp:.. }, down: {...} }, ... ×4 }, // 整数（downは負値）
  gradeThresholds: { S: 1, A: 5, B: 20, C: 50 }, // 上位%の上限。それ以外は D
};
```

## 保存する個体（store `individuals`）

```js
{ id: 'm_' + Date.now().toString(36) + '_' + 乱数5文字,
  schemaVersion: 1,
  species: 'jijiron' | null, speciesName: 'ジジーロン',   // OCRで読んだ表示名も残す
  specialty: 'berry',
  level: 40 | null, sp: 1576 | null,
  helpIntervalSec: 3227 | null, carryLimit: 26 | null,
  mainSkill: 'cooking_chance_s' | null, mainSkillLevel: 1 | null,
  subskills: ['skill_trig_m', 'ing_s', 'skill_trig_s', 'carry_s', 'carry_m'], // 枠1..5、不明は null
  subskillUnlockLevels: [10, 25, 50, 70, 80],           // OCRで読めた値。読めなければ既定
  nature: 'majime' | null,
  nickname: '', note: '',
  ocr: { rawText: '', fieldConf: { species: 0.9, ... } } | null,
  createdAt: ms, updatedAt: ms }
```
スコア・上位%は保存しない（表示時に現在の設定で計算する）。

## store.js（named export）

`setErrorHandler(fn)`, `putIndividual(obj)`, `getIndividual(id)`, `listIndividuals()`（updatedAt降順）,
`deleteIndividual(id)`, `putManyIndividuals(list)`, `getSetting(key)`, `putSetting(obj)`,
`requestPersistentStorage()`。DB名 `pokesleep_ranker`、stores: `individuals`(keyPath id), `settings`(keyPath key)。

## settings.js（重みは「公式値」。編集は管理者のみ）

順位の信憑性を保つため、**重みの正本は `data/defaults.js`（リポジトリ）** で全員共通。
一般ユーザーの設定画面は閲覧専用。管理者（作者本人）だけが合言葉で「管理者モード」を解錠して
端末内で調整でき、書き出したJSONをリポジトリの `defaults.js` に反映して公開する。

```js
export async function getSettings()      // 管理者の端末内オーバーライドがあればそれ、なければ DEFAULT_SETTINGS（deep-merge、メモリキャッシュ）
export async function saveOverride(s)    // 管理者モードのみ呼ばれる。store 'settings' key 'override' に保存
export async function clearOverride()    // 公式値に戻す
export async function hasOverride()
export function onSettingsChange(fn)
export async function isAdmin()          // sessionStorage に解錠フラグ
export async function unlockAdmin(passphrase) // SHA-256(passphrase) を data/defaults.js の ADMIN_PASS_HASH と比較（WebCrypto）
export function lockAdmin()
```
- `DEFAULT_SETTINGS.weightsVersion`（例 `'2026-09-11.1'`）を持ち、UIに「評価ルール v…」と表示する。
- オーバーライド適用中は全画面上部に「管理者調整中（未公開の重みで表示）」バナーを出す。
- 設定画面: 一般＝重み表の閲覧のみ＋「管理者」リンク。管理者＝編集・公式値に戻す・
  「defaults.js 用JSONを書き出す」（`DEFAULT_SETTINGS` にそのまま貼れる形）。
- `ADMIN_PASS_HASH` は `defaults.js` に置く（hex）。合言葉本体はリポジトリに置かない。
  `tools/hash-pass.py <合言葉>` でハッシュを作る。

## ui.js

`$(sel, root?)`, `el(tag, attrs?, ...children)`（attrs: class, dataset, on* ハンドラ, その他属性）,
`toast(msg, kind='info'|'error')`, `openBusy(title, msg)` → `{ update(msg, pct?), close() }`,
`confirmModal(msg)` → Promise<boolean>, `openModal(contentEl)` → `{ close() }`。

## app.js

ハッシュルータ。`#/` 一覧、`#/new` 判定（アップロード→確認→保存）、`#/mon/:id` 詳細、`#/settings` 設定。
各 view は `export async function render(container, params)` を持つ。`export function navigate(hash)`。

## score/score.js

```js
export function natureScore(specialty, natureId, settings)            // up/down の合算、中立は0
export function individualScore(ind, settings)                         // Σ slotW[i]*subW[spec][sub_i] + natureScore。null枠は0
export function scoreBreakdown(ind, settings)                          // [{slot, subskillId, points}], naturePoints
export function grade(topPct, settings)                                // 'S'|'A'|'B'|'C'|'D'
export function rankAmong(list, ind, settings)                         // { rank, total }  同点は同順位
```

## score/dist.js

```js
export async function getDistribution(specialty, settings)
// → { total, topPct(score), rank(score) /* 1..total, 同点は中位 */, maxScore, minScore }
```
(specialty, 重み) の正規化文字列を FNV-1a でハッシュしメモリキャッシュ。列挙は `enum-worker.js`（classic worker、
`new Worker(new URL('./enum-worker.js', import.meta.url))`）。5枠の順列 × NATURES の畳み込み。

## ocr/

```js
// image.js
export async function fileToCanvas(file, { targetWidth = 1080 } = {})   // グレースケール・コントラスト伸長済み canvas と scale
// engine.js
export async function recognize(canvas, onProgress)  // → { rawText, tokens:[{text,bbox:{x0,y0,x1,y1},conf}], lines:[{text,bbox,tokens}] }
// fuzzy.js
export function normalize(s), levenRatio(a,b), bestMatch(text, candidates, { threshold, key='name', aliases='aliases' })
// parse.js
export function parseFields(ocrResult) // → { specialty:{value,conf}, species:{value,conf,rawName}, level, sp, helpIntervalSec, carryLimit, mainSkill, mainSkillLevel, subskills:{value:[5], conf:[5]}, subskillUnlockLevels, nature }
```
engine.js は `workerPath/corePath/langPath` を **`new URL('../../vendor/…', import.meta.url).href` の絶対URL** で渡す。
`workerBlobURL:false`, `gzip:true`, `langPath` を必ず指定（既定だと外部CDNへ行く）。

## io.js

`exportAll()` → JSON Blob を保存/共有（`{ app:'pokesleep-ranker', version:1, exportedAt, settings, individuals }`）、
`importFile(file)` → id でマージ（新しい updatedAt を優先）、件数を返す。

## コーディング規約

- ES2020、モジュール、依存ゼロ（tesseract.js 以外）。`console.log` は残さない。
- 例外はユーザー向けに `toast(…, 'error')` で見せる。
- 色・余白は `style.css` の CSS 変数を使う（`--accent`, `--bg`, `--card`, `--text`, `--muted`, `--danger`, `--gold`, `--silver`）。
- 各ファイル冒頭に1〜3行の役割コメント（日本語）。

## 食材構成（2026-09-12 追加）

食材タイプの厳選で重要な「食材構成」を評価に加える。価値は**汎用寄り**（多くのレシピで使える食材を高く評価。揃いボーナスは控えめ）。

### data/ingredients.js（named export）

```js
export const INGREDIENTS = [{ id:'tomato', name:'あんみんトマト', energy: 110, aliases: [] }, ...]; // 全食材
export const INGREDIENT_UNLOCK_LEVELS = [1, 30, 60];
// 種族ごとの候補。枠1は固定、枠2・3は候補から個体ごとに1つ決まる。count はその候補を選んだときの個数
export const SPECIES_INGREDIENTS = {
  jijiron: { slot1: [{ ing:'tomato', count:1 }], slot2: [{ ing:'tomato', count:2 }, { ing:'corn', count:2 }], slot3: [...] },
  ...
};
```
食材ID（英語 snake_case、固定）: `leek`(ふといながねぎ) `mushroom`(あじわいキノコ) `egg`(とくせんエッグ) `potato`(ほっこりポテト)
`apple`(とくせんリンゴ) `herb`(げきからハーブ) `sausage`(マメミート) `milk`(モーモーミルク) `honey`(あまいミツ)
`oil`(ピュアなオイル) `ginger`(あったかジンジャー) `tomato`(あんみんトマト) `cacao`(リラックスカカオ) `tail`(おいしいシッポ)
`soybean`(ワカクサ大豆) `corn`(ワカクサコーン) `coffee`(めざましコーヒー)。新食材があれば同じ流儀で追加する。

### 保存する個体への追加

`ingredients: [ { ing:'tomato', count:1 } | null, { ing, count } | null, { ing, count } | null ]`（枠1..3。未解放でも
スクショに個数は出るので、分かれば入れる）。

### 設定（defaults.js）への追加

```js
ingredientValues: { tomato: 60, leek: 100, ... },     // 食材1個の汎用価値 0..100（全食材IDを持つ）
ingredientWeights: { berry: 0, ingredient: 100, skill: 0, all: 40 }, // とくい別に食材構成をどれだけ効かせるか
ingredientUniformityBonus: { same3: 10, same2: 4 },   // 3枠同じ／2枠同じの揃いボーナス（0..100尺度）
```

### 採点（score.js）

```js
export function ingredientScore(ind, settings)   // 0..100尺度の「素点」: Σ count_i × value_i / 100 × 10 + 揃いボーナス
export function ingredientPoints(ind, settings)  // 素点 × ingredientWeights[spec]/100 × natureScale(settings)
```
- 素点の目安: 最高価値(100)の食材1個 ＝ 10点。個数合計14・価値100なら 140点 ＝ 枠1のサブスキル重み140相当。
  つまり食材構成は食材タイプで「サブスキル1〜1.5枠分」の重みになる。
- 合計スコア ＝ サブスキル ＋ せいかく ＋ 食材構成。`scoreBreakdown` に `ingredientPoints` と各枠の内訳を足す。
- 枠が null の場合、その枠は 0 点。

### 順位（dist.js）

`getDistribution(specialty, settings, speciesId = null)`。`speciesId` が `SPECIES_INGREDIENTS` にあり、
かつ `ingredientWeights[specialty] > 0` なら、その種族の食材構成の全パターン（枠1×枠2候補×枠3候補、最大9通り）の
点数リストで既存のヒストグラムを畳み込む。`total` はパターン数の積になる。キャッシュキーには構成点数リストを含める。
これで「全組み合わせ中の上位◯%」に食材構成も入る。

### 読み取り（layout.js）

食材アイコンは画像なのでOCRしない。**個数「x1」「x2」「x4」は文字**なので、名前カードの下の3か所（1080幅で
y≈345、x≈585／766／945 付近）から読む。個数と種族の候補表を突き合わせて食材を決め、一意に決まらない場合は
`{ ing:null, count }` にしてフォームで候補から選ばせる（候補は SPECIES_INGREDIENTS から）。
