// 評価ルールの「正本」。ここの重みが全ユーザー共通の公式値になる。
// 管理者が端末内で調整したJSONを、このファイルの DEFAULT_SETTINGS に貼り替えて公開する。
// subskillWeights は SUBSKILLS の全17idを4タイプすべてに持たせること（欠けると枠が0点になる）。

export const SETTINGS_SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = {
  key: 'current',
  schemaVersion: 1,
  weightsVersion: '2026-09-11.1',

  // サブスキル枠1..5の重み。枠1ほど早く解放されるので価値が高い。
  slotWeights: [10, 9, 7, 5, 3],

  // とくいタイプ別のサブスキル評価（0..100）。
  subskillWeights: {
    berry: {
      berry_s: 100,
      help_speed_m: 80,
      help_speed_s: 45,
      help_bonus: 70,
      ing_m: 8,
      ing_s: 5,
      skill_trig_m: 10,
      skill_trig_s: 6,
      skill_lv_m: 8,
      skill_lv_s: 5,
      carry_l: 45,
      carry_m: 30,
      carry_s: 15,
      energy_recovery_bonus: 40,
      sleep_exp_bonus: 10,
      research_exp_bonus: 10,
      dream_shard_bonus: 10,
    },
    ingredient: {
      berry_s: 15,
      help_speed_m: 80,
      help_speed_s: 45,
      help_bonus: 65,
      ing_m: 100,
      ing_s: 55,
      skill_trig_m: 10,
      skill_trig_s: 6,
      skill_lv_m: 8,
      skill_lv_s: 5,
      carry_l: 50,
      carry_m: 35,
      carry_s: 20,
      energy_recovery_bonus: 40,
      sleep_exp_bonus: 10,
      research_exp_bonus: 10,
      dream_shard_bonus: 10,
    },
    skill: {
      berry_s: 10,
      help_speed_m: 75,
      help_speed_s: 40,
      help_bonus: 65,
      ing_m: 10,
      ing_s: 6,
      skill_trig_m: 100,
      skill_trig_s: 55,
      skill_lv_m: 80,
      skill_lv_s: 45,
      carry_l: 15,
      carry_m: 10,
      carry_s: 5,
      energy_recovery_bonus: 40,
      sleep_exp_bonus: 10,
      research_exp_bonus: 10,
      dream_shard_bonus: 10,
    },
    all: {
      berry_s: 55,
      help_speed_m: 85,
      help_speed_s: 48,
      help_bonus: 70,
      ing_m: 55,
      ing_s: 35,
      skill_trig_m: 60,
      skill_trig_s: 35,
      skill_lv_m: 50,
      skill_lv_s: 30,
      carry_l: 45,
      carry_m: 30,
      carry_s: 15,
      energy_recovery_bonus: 40,
      sleep_exp_bonus: 10,
      research_exp_bonus: 10,
      dream_shard_bonus: 10,
    },
  },

  // せいかく補正の評価。up は加点、down は減点（負値）。
  natureEffectWeights: {
    berry: {
      up: { speed: 40, ing: 8, skill: 8, energy: 25, exp: 5 },
      down: { speed: -40, ing: -8, skill: -8, energy: -25, exp: -5 },
    },
    ingredient: {
      up: { speed: 35, ing: 40, skill: 5, energy: 25, exp: 5 },
      down: { speed: -35, ing: -40, skill: -5, energy: -25, exp: -5 },
    },
    skill: {
      up: { speed: 30, ing: 5, skill: 40, energy: 25, exp: 5 },
      down: { speed: -30, ing: -5, skill: -40, energy: -25, exp: -5 },
    },
    all: {
      up: { speed: 25, ing: 25, skill: 25, energy: 25, exp: 5 },
      down: { speed: -25, ing: -25, skill: -25, energy: -25, exp: -5 },
    },
  },

  // 上位何%までをその評価にするか。いずれにも入らなければ D。
  gradeThresholds: { S: 1, A: 5, B: 20, C: 50 },
};

// 管理者モードの合言葉（現時点は仮）の SHA-256 hex。合言葉そのものはリポジトリに置かない。
// 再生成: python tools/hash-pass.py <新しい合言葉>  → 出力の hex をここに貼る。
export const ADMIN_PASS_HASH = '04089c0bd07647ac6498d15d23887d1432025f1fbb0707fe88ccd0d6160f5fa6';
