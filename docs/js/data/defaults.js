// 評価ルールの「正本」。ここの重みが全ユーザー共通の公式値になる。
// 管理者が端末内で調整したJSONを、このファイルの DEFAULT_SETTINGS に貼り替えて公開する。
// subskillWeights は SUBSKILLS の全17idを4タイプすべてに持たせること（欠けると枠が0点になる）。
//
// 重みの根拠は docs/WEIGHTS.md（要約）と research/R1〜R4（調査レポート）にある。
// 尺度: とくいタイプごとに「最良のサブスキル = 100」。せいかくの重みも同じ 0〜100 尺度で、
// スコア計算時に「枠1のサブスキル1つ分」と同じ倍率（slotWeights の最大値）が掛かる。

export const SETTINGS_SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = {
  key: 'current',
  schemaVersion: 1,
  weightsVersion: '2026-09-12.3',

  // サブスキル枠1..5の重み。Ver.3.6.0（2026-06）で解放Lvが 10/25/50/70/80 になり
  // 5枠すべてが現実的に届くため、枠1〜3は同じ、枠4・5だけ少し下げる。
  slotWeights: [10, 10, 10, 8, 7],

  // とくいタイプ別のサブスキル評価（0..100）。
  subskillWeights: {
    // きのみ: きのみの数S が別格。おてつだいボーナスはチーム5匹に効くのでスピードMより上。
    // 最大所持数はきのみが溢れてもエナジー化されるため低く、食材確率アップは
    // きのみを拾う確率を下げるので実害扱い。
    berry: {
      berry_s: 100,
      help_bonus: 85,
      help_speed_m: 60,
      help_speed_s: 30,
      sleep_exp_bonus: 25,
      energy_recovery_bonus: 20,
      skill_lv_m: 15,
      skill_trig_m: 12,
      dream_shard_bonus: 12,
      carry_l: 12,
      research_exp_bonus: 10,
      carry_m: 8,
      skill_lv_s: 8,
      skill_trig_s: 6,
      carry_s: 4,
      ing_m: 3,
      ing_s: 2,
    },
    // 食材: 食材確率アップM が必須級。溢れると食材が止まるので最大所持数が効く。
    // きのみの数S は溢れを早めて食材収集を阻害するため低評価。
    ingredient: {
      ing_m: 100,
      help_bonus: 80,
      help_speed_m: 60,
      ing_s: 55,
      carry_l: 40,
      help_speed_s: 30,
      carry_m: 28,
      sleep_exp_bonus: 22,
      energy_recovery_bonus: 18,
      skill_lv_m: 15,
      carry_s: 15,
      skill_trig_m: 12,
      dream_shard_bonus: 12,
      research_exp_bonus: 10,
      berry_s: 8,
      skill_lv_s: 8,
      skill_trig_s: 6,
    },
    // スキル: スキル確率アップM が全ソース一致の最優先。2番手は割れる
    // （おてつだいボーナス／スキルレベルアップM はメインスキル次第）。
    // 溢れるとスキル抽選が止まるので最大所持数はそこそこ効く。
    skill: {
      skill_trig_m: 100,
      help_bonus: 75,
      skill_lv_m: 70,
      skill_trig_s: 55,
      help_speed_m: 52,
      skill_lv_s: 40,
      carry_l: 35,
      help_speed_s: 27,
      carry_m: 25,
      sleep_exp_bonus: 22,
      energy_recovery_bonus: 22,
      berry_s: 20,
      carry_s: 14,
      dream_shard_bonus: 12,
      research_exp_bonus: 10,
      ing_m: 8,
      ing_s: 4,
    },
    // オール（幻のポケモン）: 素できのみ2個なので きのみの数S が最優先。
    // 必要EXPが約2.2倍のため 睡眠EXPボーナス が他タイプより高い。
    all: {
      berry_s: 100,
      help_bonus: 95,
      skill_trig_m: 85,
      help_speed_m: 70,
      sleep_exp_bonus: 60,
      skill_trig_s: 55,
      skill_lv_m: 55,
      carry_l: 48,
      help_speed_s: 38,
      skill_lv_s: 35,
      ing_m: 34,
      carry_m: 32,
      energy_recovery_bonus: 25,
      carry_s: 20,
      ing_s: 20,
      dream_shard_bonus: 20,
      research_exp_bonus: 15,
    },
  },

  // せいかくの補正。up は上がるステータス、down は下がるステータスに対する加点・減点。
  // サブスキルと同じ 0..100 尺度（枠1のサブスキル1つ分と同じ倍率で加算される）。
  // 定説「〇〇M ＞ せいかく▲ ＞ 〇〇S」に合わせ、主力ステータスの▲は M と S の間に置く。
  // おてつだいスピードは ▲×1.11／▼×0.93 と非対称なので ▼ を軽くする。
  // きのみタイプの「食材確率▼」は、きのみを拾う確率が上がるので加点（いじっぱりが最良になる根拠）。
  natureEffectWeights: {
    berry: {
      up: { speed: 45, ing: 0, skill: 5, energy: 8, exp: 12 },
      down: { speed: -30, ing: 8, skill: -5, energy: -15, exp: -15 },
    },
    ingredient: {
      up: { speed: 45, ing: 68, skill: 4, energy: 8, exp: 12 },
      down: { speed: -30, ing: -68, skill: -4, energy: -15, exp: -18 },
    },
    // スキルタイプの食材確率: 発動抽選には影響せず、食材おてつだいが増えるぶんきのみが減るだけなので
    // ▲は小さな減点、▼は小さな加点（しんちょうがスキル最良になる根拠）。
    skill: {
      up: { speed: 40, ing: -4, skill: 68, energy: 8, exp: 12 },
      down: { speed: -27, ing: 4, skill: -68, energy: -15, exp: -18 },
    },
    // オールは現状2匹とも性格固定（無補正）なので実質使われない。将来の追加に備えた予備値。
    all: {
      up: { speed: 50, ing: 20, skill: 40, energy: 8, exp: 25 },
      down: { speed: -33, ing: -15, skill: -35, energy: -15, exp: -25 },
    },
  },

  // 食材1個あたりの「汎用価値」0..100。料理の幅（多くのレシピで使えるか）と
  // エナジー効率を合わせた暫定値で、特定レシピ特化ではなく**汎用寄り**に振ってある。
  // ここが高い食材ほど、どの料理編成に移しても腐りにくい。
  // ※ 暫定値。調査エージェントの結果で置き換える。
  ingredientValues: {
    // 汎用価値（research/R5_ingredients.md）: 基礎エナジー × 高評価レシピでの採用頻度 × 入手しづらさ で算出し最大を100に
    tail: 100, // おいしいシッポ: エナジー最高(342)かつ最レア
    leek: 83, // ふといながねぎ: エナジー185、入手ポケモンが限られるボトルネック食材
    cacao: 72, // リラックスカカオ: デザート系高評価レシピの定番
    corn: 71, // ワカクサコーン: 8種以上のレシピで採用、入手も限られる
    mushroom: 68, // あじわいキノコ: エナジー167
    pumpkin: 64, // ずっしりカボチャ: エナジー250だが対応レシピがまだ少ない（2026-04追加）
    coffee: 60, // めざましコーヒー
    herb: 60, // げきからハーブ: カレー系定番
    oil: 56, // ピュアなオイル: サラダ・カレー双方で高頻度
    honey: 49, // あまいミツ: エナジーは低いが採用レシピ数が最多
    egg: 48, // とくせんエッグ
    tomato: 48, // あんみんトマト: サラダ系定番
    soybean: 48, // ワカクサ大豆: カレー系で中頻度、入手はやや限られる
    ginger: 48, // あったかジンジャー
    milk: 48, // モーモーミルク: デザート全般の軸
    sausage: 43, // マメミート
    potato: 42, // ほっこりポテト
    avocado: 41, // つやつやアボカド: エナジー162だが対応レシピが少ない（2025-10追加）
    apple: 39, // とくせんリンゴ: エナジー最低だが古くからの汎用食材
  },

  // とくいタイプ別に、食材構成をどれだけスコアに効かせるか（0..100 の倍率%）。
  // きのみ・スキルタイプは食材構成で選ばないが、食材おてつだいは発生するので小さく残す。オールは中間。
  ingredientWeights: { berry: 10, ingredient: 100, skill: 20, all: 40 },

  // 3枠そろい／2枠そろいのボーナス（食材素点と同じ 0..100 尺度）。
  // 汎用寄りの方針なので「そろい」は控えめ。
  ingredientUniformityBonus: { same3: 6, same2: 2 },

  // 上位何%までをその評価にするか。いずれにも入らなければ D。
  gradeThresholds: { S: 1, A: 5, B: 20, C: 50 },
};

// 管理者モードの合言葉（現時点は仮）の SHA-256 hex。合言葉そのものはリポジトリに置かない。
// 再生成: python tools/hash-pass.py <新しい合言葉>  → 出力の hex をここに貼る。
export const ADMIN_PASS_HASH = '04089c0bd07647ac6498d15d23887d1432025f1fbb0707fe88ccd0d6160f5fa6';
