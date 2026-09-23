// 重複個体の検出（SPEC.md「保存する個体」参照）。
// スキャンした個体が既存の保存済み個体（レベルアップ後の再スクショ等）と同一かどうかを判定する。
// 純粋関数のみ。DOM・IndexedDBには触れない。

/**
 * 種族が一致するか判定する。
 * どちらかの species(id) が null の場合は speciesName（トリム済み・空文字は無視）で比較する。
 * 両方とも判定材料がなければ false。
 */
function sameSpecies(model, ind) {
  if (model.species != null && ind.species != null) {
    return model.species === ind.species;
  }
  const a = (model.speciesName ?? '').trim();
  const b = (ind.speciesName ?? '').trim();
  if (!a || !b) return false;
  return a === b;
}

/**
 * サブスキルをスロット位置（0..4）で比較する。
 * newModel 側が null のスロットは比較対象外（未読み取り扱い）。
 * @returns {{ sameCount: number, diffSlots: number[], newNonNullCount: number }}
 */
function compareSubskills(modelSubskills, indSubskills) {
  const m = Array.isArray(modelSubskills) ? modelSubskills : [];
  const s = Array.isArray(indSubskills) ? indSubskills : [];
  let sameCount = 0;
  let newNonNullCount = 0;
  const diffSlots = [];
  for (let i = 0; i < 5; i++) {
    const mv = m[i] ?? null;
    if (mv == null) continue;
    newNonNullCount++;
    const sv = s[i] ?? null;
    if (sv != null && sv === mv) {
      sameCount++;
    } else {
      diffSlots.push(i);
    }
  }
  return { sameCount, diffSlots, newNonNullCount };
}

/**
 * 食材構成に矛盾がないか判定する（一致は求めない。矛盾＝両方非nullで異なる食材、の場合のみ不一致）。
 */
function ingredientsCompatible(modelIngredients, indIngredients) {
  const m = Array.isArray(modelIngredients) ? modelIngredients : [];
  const s = Array.isArray(indIngredients) ? indIngredients : [];
  for (let i = 0; i < 3; i++) {
    const mi = m[i];
    const si = s[i];
    if (mi == null || si == null) continue;
    if (mi.ing == null || si.ing == null) continue;
    if (mi.ing !== si.ing) return false;
  }
  return true;
}

/**
 * 新しくスキャンした個体(model)と重複しうる保存済み個体を検出する。
 * @param {object} model  form model: { species, speciesName, nature, subskills, ingredients, level }
 * @param {object[]} saved  保存済み個体（同フィールド + id, createdAt, updatedAt, nickname）
 * @returns {Array<{ ind: object, kind: 'exact'|'near', sameCount: number, diffSlots: number[] }>}
 */
export function findDuplicateCandidates(model, saved) {
  if (!model) return [];
  const list = Array.isArray(saved) ? saved : [];

  // 種族情報が全くない新モデルは判定不能
  const hasSpeciesInfo = model.species != null || !!(model.speciesName ?? '').trim();
  if (!hasSpeciesInfo) return [];

  if (model.nature == null) return [];

  const candidates = [];

  for (const ind of list) {
    if (!ind) continue;
    if (ind.nature == null) continue;
    if (ind.nature !== model.nature) continue;
    if (!sameSpecies(model, ind)) continue;
    if (!ingredientsCompatible(model.ingredients, ind.ingredients)) continue;

    const { sameCount, diffSlots, newNonNullCount } = compareSubskills(model.subskills, ind.subskills);

    let kind = null;
    if (newNonNullCount === 5 && sameCount === 5) {
      kind = 'exact';
    } else if (newNonNullCount >= 4 && sameCount >= 4) {
      kind = 'near';
    }
    if (kind == null) continue;

    candidates.push({ ind, kind, sameCount, diffSlots });
  }

  candidates.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'exact' ? -1 : 1;
    if (a.sameCount !== b.sameCount) return b.sameCount - a.sameCount;
    const at = a.ind.updatedAt ?? a.ind.createdAt ?? 0;
    const bt = b.ind.updatedAt ?? b.ind.createdAt ?? 0;
    return bt - at;
  });

  return candidates.slice(0, 3);
}
