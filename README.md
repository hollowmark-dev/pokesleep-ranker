# ポケスリ個体評価（pokesleep-ranker）

ポケモンスリープの個体詳細画面のスクリーンショットをOCRで読み取り、とくいタイプ別の
重み付けでスコア化して「全パターン中の上位何%か」を判定するスマホ向けの静的PWAです。

## 何をするアプリか

1. 個体詳細画面のスクショ（ページ最上部・縦画面）をアップロード
2. 端末内でOCR（Tesseract.js）して、種族・Lv・SP・おてつだい時間・最大所持数・メインスキル・
   サブスキル5枠・せいかくを読み取る。とくいタイプは種族表から引く
3. 読み取り結果を確認・修正（読めなかった項目は「要確認」表示）
4. とくいタイプごとの重み表でスコアを計算し、サブスキル5枠の並び×せいかく25種の
   全パターン（17種の場合 18,564,000 通り）の中での「上位◯%」と S/A/B/C/D の評価を表示
5. 端末内に蓄積し、同じとくいタイプ・同じ種族の手持ちの中での順位も表示

### 読み取りの仕組み

画面全体をOCRするのではなく、画面の色（緑のヘッダーバー・メインスキルカードの黄色い枠線）を
基準点にして項目ごとに小さく切り出し、1行ずつOCRしています。ゲームのUIは画面幅に対して
固定レイアウトなので、機種が違っても幅で拡縮すれば同じ位置になります。切り出し位置は
`docs/js/ocr/layout.js` の `LAYOUT_TUNING` にまとめてあり、ゲームのUIが変わったらここを直します。
基準点が見つからない画像では、画面全体のOCR（`docs/js/ocr/parse.js`）に切り替わります。

サブスキルの解放Lvは枠の順に 10/25/50/70/80 固定（Ver.3.6.0 以降）なので読み取りません。
通知の重なりなどで読めなかった項目は空欄になるので、フォームで直してから保存してください。

## プライバシー

- 画像・OCR結果・保存した個体データは、すべて**この端末のブラウザ内（IndexedDB）**だけで
  処理・保存されます。
- 画像やデータがサーバーにアップロードされることはありません。通信が発生するのは
  Service Worker のアプリ本体更新チェックのみです（初回読み込み後はオフラインでも動作）。
- OCRライブラリ（tesseract.js）はCDNから読み込まず、`docs/vendor/` に同梱したものを使います。
  これも外部通信なしで動く理由の一つです。

## ローカルでの動かし方

```
python tools/serve.py 8032
```

`http://localhost:8032/` を開いてください。標準の `http.server` と違い、確認のたびに
ES モジュールのブラウザキャッシュを気にしなくていいように `no-store` を付けて配信します
（GitHub Pages への公開時はこのスクリプトは使いません）。

Claude Code から確認する場合は `.claude/launch.json` の `pokesleep-ranker` 設定を使います。

読み取り精度を確かめたいときは、自分のスクショを `samples/`（git 管理外）に置き、
`docs/_samples/`（同じく管理外）にコピーして `http://localhost:8032/_samples/xxx.jpg` として
ブラウザから読み込めるようにしてください。

## vendorライブラリ（tesseract.js）の取得方法

`docs/vendor/` には以下をピン留めしたバージョンで同梱しています。

| パッケージ | バージョン |
|---|---|
| tesseract.js | 6.0.1 |
| tesseract.js-core | 6.1.2 |
| jpn.traineddata（tessdata_fast） | main ブランチ時点のスナップショット |

再取得・更新する場合は次を実行してください（PowerShell 5.1想定）。

```
powershell -ExecutionPolicy Bypass -File tools/fetch-vendor.ps1
```

`npm` が使える環境では `npm pack` で取得し、使えない環境では npm レジストリの `.tgz` を
直接ダウンロードします。取得したファイルは以下に配置されます。

```
docs/vendor/tesseract.esm.min.js
docs/vendor/worker.min.js (+ worker.min.js.LICENSE.txt)
docs/vendor/core/tesseract-core-simd-lstm.wasm.js
docs/vendor/core/tesseract-core-lstm.wasm.js
docs/vendor/lang/jpn.traineddata.gz   （tessdata_fast を取得しgzip圧縮したもの）
docs/vendor/LICENSES/                 （tesseract.js・tesseract.js-core・tessdata_fast のライセンス）
```

バージョンを上げる場合は `tools/fetch-vendor.ps1` 冒頭の `$TESSERACT_VERSION` /
`$CORE_VERSION` を書き換えてから再実行してください。

## 重み（評価ルール）の正本と管理者モード

重みの決め方と根拠は [docs/WEIGHTS.md](docs/WEIGHTS.md) にまとめ、元にした調査レポート（効果値の検証、
コミュニティの厳選基準、YouTube解説者の基準）は `research/` に置いています。

順位判定に使う重み（`slotWeights` / `subskillWeights` / `natureEffectWeights` /
`gradeThresholds`）は、全員が同じ基準で見られるよう **`docs/js/data/defaults.js` の
`DEFAULT_SETTINGS` をリポジトリ上の正本**として扱います。一般ユーザーの設定画面は
この値の閲覧のみです。

重みを調整できるのは作者本人（管理者）だけです。設定画面の「管理者」から合言葉を
入力すると、その端末内だけで有効なオーバーライド（IndexedDBの `settings` ストア）を
編集できます。実際に公開する場合は、管理者モードの「defaults.js 用JSONを書き出す」で
出力したJSONを `docs/js/data/defaults.js` の `DEFAULT_SETTINGS` にそのまま貼り付けて
コミット・公開してください。

合言葉のハッシュ（`ADMIN_PASS_HASH`、SHA-256のhex）も `defaults.js` に置きますが、
**合言葉そのものはリポジトリに残しません**。ハッシュを作るには:

```
python tools/hash-pass.py <合言葉>
```

## ゲームデータの検証（チェックリスト）

`docs/js/data/gamedata.js`（サブスキル・せいかく・メインスキル等）と
`docs/js/data/species.js`（種族・とくいタイプ）は公式情報源と突き合わせて検証すること。
このセクションは検証済み項目を埋めていくためのプレースホルダーです。

検証の記録（参照したURL・日付・不確かな点）は `docs/DATA_SOURCES.md` にあります。

- [x] `SUBSKILLS` 17件・レアリティ（金/青/白。コード上は gold/silver/white）— 2026-09-11
- [x] `NATURES` 25件の up/down 組み合わせ — 2026-09-11
- [x] `SUBSKILL_UNLOCK_LEVELS` = 10/25/50/70/80（Ver.3.6.0 で 75→70、100→80 に変更）— 2026-09-11
- [x] `SPECIES` 247件のとくいタイプ分類 — 2026-09-11（未実装のパラドックス系などは除外）
- [x] `MAIN_SKILLS` 36件 — 2026-09-11
- [ ] 新ポケモン・新スキル追加時に再確認する

## ライセンス

このリポジトリ本体は MIT License です（`LICENSE` を参照）。
`docs/vendor/` 以下の同梱ライブラリは各パッケージのライセンス（`docs/vendor/LICENSES/`）に
従います。
