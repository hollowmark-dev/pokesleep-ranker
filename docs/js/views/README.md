# views/ のデータフロー

`app.js` のハッシュルータが各 view の `export async function render(container, params)` を呼ぶ。
`capture`（`#/new`・アップロード→OCR確認→保存）は別担当が実装する。ここでは `list` と `detail` の流れと、
`app.js` に必要なルーティング追加事項をまとめる。

## view-list.js（`#/`）

1. `store.listIndividuals()` と `settings.getSettings()` を並列取得。
2. 一覧に登場する `specialty` ごとに `score/dist.js` の `getDistribution(specialty, settings)` を1回ずつ取得
   （個体ごとに毎回呼ぶと同じ分布を何度も計算してしまうため、`specialty` 単位でキャッシュしてから
   各個体の `individualScore()` を `dist.topPct(score)` に通す）。
3. とくいタイプチップ／種族名テキストフィルタ／並び替え（上位%・登録日・Lv）はフェッチ済みデータに対する
   ローカルな再描画で処理し、DB再アクセスはしない。
4. `settings.onSettingsChange()` を購読し、重みが変わったら（管理者調整中など）`render()` を丸ごと呼び直す。
   `render()` の先頭で前回の購読を必ず解除してから再購読する（多重購読・リークを防ぐ）。
5. タップで `app.js` の `navigate('#/mon/' + id)`。

## view-detail.js（`#/mon/:id`）

1. `store.getIndividual(id)` が見つからなければ `toast` を出して `navigate('#/')` で一覧へ戻す。
2. `score/score.js` の `individualScore` → `score/dist.js` の `getDistribution(specialty, settings)` →
   `dist.topPct(score)` / `dist.rank(score)` / `dist.total` の順でヘッドライン（グレード・上位%・順位/全パターン数）を出す。
3. 「蓄積内の順位」は `score.rankAmong(list, ind, settings)` を、同じとくいタイプの一覧・同じ種族の一覧の
   2パターンで呼ぶ（`ind` 自身を含む配列を渡す）。
4. 「内訳」は `score.scoreBreakdown(ind, settings)` を使うが、契約上の戻り値の形（配列か、
   `{slots, naturePoints}` のようなオブジェクトか）が SPEC.md 上厳密には確定していないため、
   `view-detail.js` の `normalizeBreakdown()` で両方の形を吸収している。scoring 担当が実装を固めたら
   ここが不要な分岐にならないか確認してほしい（**契約ギャップ**、下記参照）。
5. 「同じ種族を比較」は同じ `species` を持つ他の保存済み個体を非同期で `getDistribution` にかけ、
   上位%が良い順に並べて簡易リスト表示する。

## `app.js` への必須追加事項（重要）

`view-detail.js` の「編集」ボタンは `navigate('#/edit/' + id)` を呼ぶ。SPEC.md のルータ定義には
`#/edit/:id` が明記されていない（`#/new` は新規判定用）ため、**`app.js` 担当は `#/edit/:id` を
`view-capture` の `render(container, { id })` にルーティングし、`capture` 側が `id` があれば
既存個体の編集モードとして開くようにする必要がある。** これが無いと詳細画面の「編集」ボタンが
機能しない。

## 契約ギャップ（実装時に気づいた点）

- `score/score.js` の `scoreBreakdown(ind, settings)` の戻り値の正確な形が SPEC.md のコメント
  （`// [{slot, subskillId, points}], naturePoints`）だけでは配列単体か `{slots, naturePoints}` の
  ようなオブジェクトかを断定できない。`view-detail.js` 側で両方に対応する正規化処理を入れて防御した。
- `data/gamedata.js` の `NATURES` エントリ例には `desc`（せいかくの説明文）フィールドが無い
  （`{id, name, up, down}` のみ）。詳細画面は「せいかく名 + 説明」を要求されているため、`desc` が
  無い場合は `up`/`down` と `STATS` 名から `「きようさ↑・げんき回復量↓」` 形式の説明を自動生成する
  フォールバックを実装した（`view-detail.js` の `natureDesc()`）。`gamedata.js` に将来 `desc` を
  追加した場合はそちらが優先される。
- `io.js` は `../ui.js` の `toast` を使わず、失敗時は `Error` を throw する設計にした。設定画面
  （エクスポート/インポートのUIを持つ view、他担当実装）側で `try/catch` して `toast(e.message, 'error')`
  する想定。`navigator.share` がキャンセルされた場合（`AbortError`）はエラー扱いにせず黙って戻す。
