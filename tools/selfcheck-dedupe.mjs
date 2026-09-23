// dedupe.js（重複個体検出）の自己診断。
// 使い方: node tools/selfcheck-dedupe.mjs

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function assert(cond, msg) {
  if (!cond) {
    console.error('NG: ' + msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dedupeUrl = pathToFileURL(path.join(__dirname, '..', 'docs', 'js', 'dedupe.js')).href;
const { findDuplicateCandidates } = await import(dedupeUrl);

function baseModel(overrides = {}) {
  return {
    species: 'jijiron',
    speciesName: 'ジジーロン',
    nature: 'majime',
    subskills: ['skill_trig_m', 'ing_s', 'skill_trig_s', 'carry_s', 'carry_m'],
    ingredients: [{ ing: 'tomato', count: 1 }, null, null],
    level: 40,
    ...overrides,
  };
}

function baseSaved(overrides = {}) {
  return {
    id: 'm_saved1',
    species: 'jijiron',
    speciesName: 'ジジーロン',
    nature: 'majime',
    subskills: ['skill_trig_m', 'ing_s', 'skill_trig_s', 'carry_s', 'carry_m'],
    ingredients: [{ ing: 'tomato', count: 1 }, null, null],
    level: 25,
    createdAt: 1000,
    updatedAt: 1000,
    nickname: '',
    ...overrides,
  };
}

// 1. 完全一致（レベルだけ違う再スクショ）
{
  const model = baseModel();
  const saved = [baseSaved()];
  const res = findDuplicateCandidates(model, saved);
  assert(res.length === 1, '完全一致: 1件ヒットするはず');
  assert(res[0].kind === 'exact', '完全一致: kind=exact');
  assert(res[0].sameCount === 5, '完全一致: sameCount=5');
  assert(res[0].diffSlots.length === 0, '完全一致: diffSlotsは空');
  assert(res[0].ind.id === 'm_saved1', '完全一致: indが返る');
}

// 2. near一致（1枠だけ違う。OCR誤読やサブスキルのタネ想定）
{
  const model = baseModel({ subskills: ['skill_trig_m', 'ing_s', 'skill_trig_s', 'carry_s', 'ing_m'] }); // 枠4のcarry_m→ing_m
  const saved = [baseSaved()];
  const res = findDuplicateCandidates(model, saved);
  assert(res.length === 1, 'near一致: 1件ヒットするはず');
  assert(res[0].kind === 'near', 'near一致: kind=near');
  assert(res[0].sameCount === 4, 'near一致: sameCount=4');
  assert(res[0].diffSlots.length === 1 && res[0].diffSlots[0] === 4, `near一致: diffSlotsは[4] (実際 ${JSON.stringify(res[0].diffSlots)})`);
}

// 3. 3枠しか一致しない → 候補にならない
{
  const model = baseModel({ subskills: ['skill_trig_m', 'ing_s', 'berry_s', 'carry_l', 'ing_m'] }); // 枠3,4,5違う
  const saved = [baseSaved()];
  const res = findDuplicateCandidates(model, saved);
  assert(res.length === 0, '3枠一致: 候補にならないはず');
}

// 4. せいかくが違う → 対象外
{
  const model = baseModel({ nature: 'ijippari' });
  const saved = [baseSaved()];
  const res = findDuplicateCandidates(model, saved);
  assert(res.length === 0, 'せいかく違い: 候補にならないはず');
}

// 5. 種族が違う → 対象外
{
  const model = baseModel({ species: 'pikachu', speciesName: 'ピカチュウ' });
  const saved = [baseSaved()];
  const res = findDuplicateCandidates(model, saved);
  assert(res.length === 0, '種族違い: 候補にならないはず');
}

// 6. species id が null の場合は speciesName でフォールバック
{
  const model = baseModel({ species: null, speciesName: 'ジジーロン' });
  const saved = [baseSaved({ species: null, speciesName: 'ジジーロン' })];
  const res = findDuplicateCandidates(model, saved);
  assert(res.length === 1, 'species null フォールバック: 名前一致でヒットするはず');
  assert(res[0].kind === 'exact', 'species null フォールバック: kind=exact');

  const model2 = baseModel({ species: null, speciesName: 'ジジーロン' });
  const saved2 = [baseSaved({ species: null, speciesName: 'ズガドーン' })];
  const res2 = findDuplicateCandidates(model2, saved2);
  assert(res2.length === 0, 'species null フォールバック: 名前不一致は対象外');
}

// 7. 食材の不一致は候補から除外／nullは除外しない
{
  const model = baseModel({ ingredients: [{ ing: 'tomato', count: 1 }, null, null] });
  const savedMismatch = baseSaved({ ingredients: [{ ing: 'leek', count: 1 }, null, null] });
  const resMismatch = findDuplicateCandidates(model, [savedMismatch]);
  assert(resMismatch.length === 0, '食材不一致: 候補から除外されるはず');

  const savedNull = baseSaved({ ingredients: [null, null, null] });
  const resNull = findDuplicateCandidates(model, [savedNull]);
  assert(resNull.length === 1, '食材null: 除外されずヒットするはず');
}

// 8. ソート順: exact優先 → sameCount大 → 新しいもの優先
{
  const model = baseModel();
  const exactOld = baseSaved({ id: 'exact_old', updatedAt: 100, createdAt: 100 });
  const exactNew = baseSaved({ id: 'exact_new', updatedAt: 500, createdAt: 500 });
  const nearHigh = baseSaved({
    id: 'near',
    subskills: ['skill_trig_m', 'ing_s', 'skill_trig_s', 'carry_s', 'ing_m'],
    updatedAt: 900,
    createdAt: 900,
  });
  const res = findDuplicateCandidates(model, [nearHigh, exactOld, exactNew]);
  assert(res.length === 3, 'ソート順: 3件ヒットするはず');
  assert(res[0].ind.id === 'exact_new', `ソート順: 先頭はexact_new (実際 ${res[0].ind.id})`);
  assert(res[1].ind.id === 'exact_old', `ソート順: 2番目はexact_old (実際 ${res[1].ind.id})`);
  assert(res[2].ind.id === 'near', `ソート順: 3番目はnear (実際 ${res[2].ind.id})`);
}

// 9. 最大3件まで
{
  const model = baseModel();
  const saved = [];
  for (let i = 0; i < 5; i++) {
    saved.push(baseSaved({ id: 'dup' + i, updatedAt: i, createdAt: i }));
  }
  const res = findDuplicateCandidates(model, saved);
  assert(res.length === 3, `最大3件: 実際 ${res.length}件`);
}

// 10. サブスキル欄がない古いレコードでも例外を投げない
{
  const model = baseModel();
  const legacy = {
    id: 'legacy1',
    species: 'jijiron',
    speciesName: 'ジジーロン',
    nature: 'majime',
    // subskills, ingredients, createdAt, updatedAt が無い
  };
  let threw = false;
  let res = [];
  try {
    res = findDuplicateCandidates(model, [legacy]);
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'レガシーレコード: 例外を投げないこと');
  assert(Array.isArray(res), 'レガシーレコード: 配列を返すこと');
  // subskillsが全null相当なので sameCount=0 → 候補外でよい
  assert(res.length === 0, 'レガシーレコード: サブスキル無しは候補にならないはず');
}

console.log('dedupe selfcheck OK');
