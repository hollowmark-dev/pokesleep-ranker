// ポケモンスリープのマスタデータ（とくいタイプ・ステータス・サブスキル・せいかく・メインスキル）。
// 2026-09-11 時点の公開情報で検証。出典は docs/DATA_SOURCES.md を参照。
// aliases はOCRの揺れ（半角/全角・スペース有無・別表記）を吸収するための候補文字列。

export const SPECIALTIES = [
  { id: 'berry', name: 'きのみ', aliases: ['きのみ', 'ベリー', 'Berries'] },
  { id: 'ingredient', name: '食材', aliases: ['食材', 'しょくざい', 'Ingredients'] },
  { id: 'skill', name: 'スキル', aliases: ['スキル', 'Skills'] },
  { id: 'all', name: 'オール', aliases: ['オール', 'ォール', 'All'] },
];

export const STATS = [
  { id: 'speed', name: 'おてつだいスピード', aliases: ['おてつだいスピード', 'お手伝いスピード', 'おてつだいスピ-ド'] },
  { id: 'ing', name: '食材おてつだい確率', aliases: ['食材おてつだい確率', '食材確率', '食材おてつだい率'] },
  { id: 'skill', name: 'メインスキル発生確率', aliases: ['メインスキル発生確率', 'メインスキル確率', 'スキル発生確率'] },
  { id: 'energy', name: 'げんき回復量', aliases: ['げんき回復量', '元気回復量', 'げんき回復'] },
  { id: 'exp', name: 'EXP獲得量', aliases: ['EXP獲得量', 'ＥＸＰ獲得量', 'EXP 獲得量', 'Exp獲得量'] },
];

// サブスキルは17種。ゲーム内の枠の色は 金 / 青 / 白 の3段階。
// SPEC.md の rarity 値に合わせ 青 を 'silver' として扱う（表示名は「青」でも「銀」でもUI側の自由）。
//   gold(金)   … 7種（おてつだいボーナス・げんき回復ボーナス・各種ボーナス・きのみの数S・スキルレベルアップM）
//   silver(青) … 6種（M系とスキルレベルアップS・最大所持数アップL/M）
//   white(白)  … 4種（S系）
export const SUBSKILLS = [
  { id: 'berry_s', name: 'きのみの数S', rarity: 'gold', aliases: ['きのみの数S', 'きのみの数Ｓ', 'きのみの数 S', 'きのみの数s'] },
  { id: 'help_bonus', name: 'おてつだいボーナス', rarity: 'gold', aliases: ['おてつだいボーナス', 'お手伝いボーナス', 'おてつだいボ-ナス'] },
  { id: 'energy_recovery_bonus', name: 'げんき回復ボーナス', rarity: 'gold', aliases: ['げんき回復ボーナス', '元気回復ボーナス', 'げんき回復ボ-ナス'] },
  { id: 'sleep_exp_bonus', name: '睡眠EXPボーナス', rarity: 'gold', aliases: ['睡眠EXPボーナス', '睡眠ＥＸＰボーナス', '睡眠EXP ボーナス', '睡眠Expボーナス'] },
  { id: 'research_exp_bonus', name: 'リサーチEXPボーナス', rarity: 'gold', aliases: ['リサーチEXPボーナス', 'リサーチＥＸＰボーナス', 'リサーチEXP ボーナス', 'リサーチExpボーナス'] },
  { id: 'dream_shard_bonus', name: 'ゆめのかけらボーナス', rarity: 'gold', aliases: ['ゆめのかけらボーナス', '夢のかけらボーナス', 'ゆめのかけらボ-ナス'] },
  { id: 'skill_lv_m', name: 'スキルレベルアップM', rarity: 'gold', aliases: ['スキルレベルアップM', 'スキルレベルアップＭ', 'スキルレベルアップ M', 'スキルレベルアップm'] },

  { id: 'help_speed_m', name: 'おてつだいスピードM', rarity: 'silver', aliases: ['おてつだいスピードM', 'おてつだいスピードＭ', 'おてつだいスピード M', 'お手伝いスピードM'] },
  { id: 'ing_m', name: '食材確率アップM', rarity: 'silver', aliases: ['食材確率アップM', '食材確率アップＭ', '食材確率アップ M', '食材確率UPM'] },
  { id: 'skill_trig_m', name: 'スキル確率アップM', rarity: 'silver', aliases: ['スキル確率アップM', 'スキル確率アップＭ', 'スキル確率アップ M', 'スキル確率UPM'] },
  { id: 'skill_lv_s', name: 'スキルレベルアップS', rarity: 'silver', aliases: ['スキルレベルアップS', 'スキルレベルアップＳ', 'スキルレベルアップ S', 'スキルレベルアップs'] },
  { id: 'carry_l', name: '最大所持数アップL', rarity: 'silver', aliases: ['最大所持数アップL', '最大所持数アップＬ', '最大所持数アップ L', '最大所持数UPL'] },
  { id: 'carry_m', name: '最大所持数アップM', rarity: 'silver', aliases: ['最大所持数アップM', '最大所持数アップＭ', '最大所持数アップ M', '最大所持数UPM'] },

  { id: 'help_speed_s', name: 'おてつだいスピードS', rarity: 'white', aliases: ['おてつだいスピードS', 'おてつだいスピードＳ', 'おてつだいスピード S', 'お手伝いスピードS'] },
  { id: 'ing_s', name: '食材確率アップS', rarity: 'white', aliases: ['食材確率アップS', '食材確率アップＳ', '食材確率アップ S', '食材確率UPS'] },
  { id: 'skill_trig_s', name: 'スキル確率アップS', rarity: 'white', aliases: ['スキル確率アップS', 'スキル確率アップＳ', 'スキル確率アップ S', 'スキル確率UPS'] },
  { id: 'carry_s', name: '最大所持数アップS', rarity: 'white', aliases: ['最大所持数アップS', '最大所持数アップＳ', '最大所持数アップ S', '最大所持数UPS'] },
];

// せいかく25種。up/down は STATS の id、補正なしは null。
// 20種が「1つ上昇・1つ下降」、5種（がんばりや・すなお・てれや・きまぐれ・まじめ）が補正なし。
export const NATURES = [
  // おてつだいスピード ▲
  { id: 'samishigari', name: 'さみしがり', up: 'speed', down: 'energy', desc: 'おてつだいスピード▲ げんき回復量▼', aliases: ['さみしがり'] },
  { id: 'ijippari', name: 'いじっぱり', up: 'speed', down: 'ing', desc: 'おてつだいスピード▲ 食材おてつだい確率▼', aliases: ['いじっぱり'] },
  { id: 'yancha', name: 'やんちゃ', up: 'speed', down: 'skill', desc: 'おてつだいスピード▲ メインスキル発生確率▼', aliases: ['やんちゃ'] },
  { id: 'yuukan', name: 'ゆうかん', up: 'speed', down: 'exp', desc: 'おてつだいスピード▲ EXP獲得量▼', aliases: ['ゆうかん'] },
  // げんき回復量 ▲
  { id: 'zubutoi', name: 'ずぶとい', up: 'energy', down: 'speed', desc: 'げんき回復量▲ おてつだいスピード▼', aliases: ['ずぶとい'] },
  { id: 'wanpaku', name: 'わんぱく', up: 'energy', down: 'ing', desc: 'げんき回復量▲ 食材おてつだい確率▼', aliases: ['わんぱく'] },
  { id: 'noutenki', name: 'のうてんき', up: 'energy', down: 'skill', desc: 'げんき回復量▲ メインスキル発生確率▼', aliases: ['のうてんき'] },
  { id: 'nonki', name: 'のんき', up: 'energy', down: 'exp', desc: 'げんき回復量▲ EXP獲得量▼', aliases: ['のんき'] },
  // 食材おてつだい確率 ▲
  { id: 'hikaeme', name: 'ひかえめ', up: 'ing', down: 'speed', desc: '食材おてつだい確率▲ おてつだいスピード▼', aliases: ['ひかえめ'] },
  { id: 'ottori', name: 'おっとり', up: 'ing', down: 'energy', desc: '食材おてつだい確率▲ げんき回復量▼', aliases: ['おっとり'] },
  { id: 'ukkariya', name: 'うっかりや', up: 'ing', down: 'skill', desc: '食材おてつだい確率▲ メインスキル発生確率▼', aliases: ['うっかりや'] },
  { id: 'reisei', name: 'れいせい', up: 'ing', down: 'exp', desc: '食材おてつだい確率▲ EXP獲得量▼', aliases: ['れいせい'] },
  // メインスキル発生確率 ▲
  { id: 'odayaka', name: 'おだやか', up: 'skill', down: 'speed', desc: 'メインスキル発生確率▲ おてつだいスピード▼', aliases: ['おだやか'] },
  { id: 'otonashii', name: 'おとなしい', up: 'skill', down: 'energy', desc: 'メインスキル発生確率▲ げんき回復量▼', aliases: ['おとなしい'] },
  { id: 'shinchou', name: 'しんちょう', up: 'skill', down: 'ing', desc: 'メインスキル発生確率▲ 食材おてつだい確率▼', aliases: ['しんちょう'] },
  { id: 'namaiki', name: 'なまいき', up: 'skill', down: 'exp', desc: 'メインスキル発生確率▲ EXP獲得量▼', aliases: ['なまいき'] },
  // EXP獲得量 ▲
  { id: 'okubyou', name: 'おくびょう', up: 'exp', down: 'speed', desc: 'EXP獲得量▲ おてつだいスピード▼', aliases: ['おくびょう'] },
  { id: 'sekkachi', name: 'せっかち', up: 'exp', down: 'energy', desc: 'EXP獲得量▲ げんき回復量▼', aliases: ['せっかち'] },
  { id: 'youki', name: 'ようき', up: 'exp', down: 'ing', desc: 'EXP獲得量▲ 食材おてつだい確率▼', aliases: ['ようき'] },
  { id: 'mujaki', name: 'むじゃき', up: 'exp', down: 'skill', desc: 'EXP獲得量▲ メインスキル発生確率▼', aliases: ['むじゃき'] },
  // 補正なし
  { id: 'ganbariya', name: 'がんばりや', up: null, down: null, desc: 'せいかくによる特徴なし', aliases: ['がんばりや'] },
  { id: 'sunao', name: 'すなお', up: null, down: null, desc: 'せいかくによる特徴なし', aliases: ['すなお'] },
  { id: 'tereya', name: 'てれや', up: null, down: null, desc: 'せいかくによる特徴なし', aliases: ['てれや'] },
  { id: 'kimagure', name: 'きまぐれ', up: null, down: null, desc: 'せいかくによる特徴なし', aliases: ['きまぐれ'] },
  { id: 'majime', name: 'まじめ', up: null, down: null, desc: 'せいかくによる特徴なし', aliases: ['まじめ'] },
];

// メインスキル。派生スキル（固有名）は base に元スキルのidを持つ。
// 個体詳細では「ほっぺすりすり」のように固有名で表示されるため、
// 「固有名(元スキル名)」表記も aliases に入れてOCRの取りこぼしを防ぐ。
export const MAIN_SKILLS = [
  { id: 'energy_charge_s', name: 'エナジーチャージS', base: null, aliases: ['エナジーチャージS', 'エナジーチャージＳ'] },
  { id: 'energy_charge_m', name: 'エナジーチャージM', base: null, aliases: ['エナジーチャージM', 'エナジーチャージＭ'] },
  { id: 'takuwaeru', name: 'たくわえる', base: 'energy_charge_s', aliases: ['たくわえる', 'たくわえる(エナジーチャージS)'] },
  { id: 'nightmare', name: 'ナイトメア', base: 'energy_charge_m', aliases: ['ナイトメア', 'ナイトメア(エナジーチャージM)'] },
  { id: 'psycho_break', name: 'サイコブレイク', base: null, aliases: ['サイコブレイク', 'サイコブレイク(きのみゾーン)', 'きのみゾーン'] },

  { id: 'berry_burst', name: 'きのみバースト', base: null, aliases: ['きのみバースト'] },
  { id: 'ryuseigun', name: 'りゅうせいぐん', base: 'berry_burst', aliases: ['りゅうせいぐん', 'りゅうせいぐん(きのみバースト)', '流星群'] },
  { id: 'bakenokawa', name: 'ばけのかわ', base: 'berry_burst', aliases: ['ばけのかわ', 'ばけのかわ(きのみバースト)', '化けの皮'] },

  { id: 'help_support_s', name: 'おてつだいサポートS', base: null, aliases: ['おてつだいサポートS', 'おてつだいサポートＳ'] },
  { id: 'help_boost', name: 'おてつだいブースト', base: null, aliases: ['おてつだいブースト', 'おてつだいブースト(でんき)', 'おてつだいブースト(ほのお)', 'おてつだいブースト(みず)'] },

  { id: 'energy_yell_s', name: 'げんきエールS', base: null, aliases: ['げんきエールS', 'げんきエールＳ'] },
  { id: 'energy_charge_self_s', name: 'げんきチャージS', base: null, aliases: ['げんきチャージS', 'げんきチャージＳ'] },
  { id: 'energy_all_s', name: 'げんきオールS', base: null, aliases: ['げんきオールS', 'げんきオールＳ'] },
  { id: 'hoppe_surisuri', name: 'ほっぺすりすり', base: 'energy_yell_s', aliases: ['ほっぺすりすり', 'ほっぺすりすり(げんきエールS)'] },
  { id: 'iyashi_no_hadou', name: 'いやしのはどう', base: 'energy_yell_s', aliases: ['いやしのはどう', 'いやしのはどう(げんきエールS)', '癒しの波動'] },
  { id: 'tsuki_no_hikari', name: 'つきのひかり', base: 'energy_charge_self_s', aliases: ['つきのひかり', 'つきのひかり(げんきチャージS)', '月の光'] },
  { id: 'mikazuki_no_inori', name: 'みかづきのいのり', base: 'energy_all_s', aliases: ['みかづきのいのり', 'みかづきのいのり(げんきオールS)', '三日月の祈り'] },
  { id: 'kinomi_juice', name: 'きのみジュース', base: 'energy_all_s', aliases: ['きのみジュース', 'きのみジュース(げんきオールS)'] },

  { id: 'cooking_power_up_s', name: '料理パワーアップS', base: null, aliases: ['料理パワーアップS', '料理パワーアップＳ'] },
  { id: 'cooking_chance_s', name: '料理チャンスS', base: null, aliases: ['料理チャンスS', '料理チャンスＳ'] },
  { id: 'cooking_assist_s', name: '料理アシストS', base: null, aliases: ['料理アシストS', '料理アシストＳ'] },
  { id: 'build_up', name: 'ビルドアップ', base: 'cooking_assist_s', aliases: ['ビルドアップ', 'ビルドアップ(料理アシストS)'] },
  { id: 'minus', name: 'マイナス', base: 'cooking_power_up_s', aliases: ['マイナス', 'マイナス(料理パワーアップS)'] },

  { id: 'ing_get_s', name: '食材ゲットS', base: null, aliases: ['食材ゲットS', '食材ゲットＳ'] },
  { id: 'ing_select_s', name: '食材セレクトS', base: null, aliases: ['食材セレクトS', '食材セレクトＳ'] },
  { id: 'plus', name: 'プラス', base: 'ing_get_s', aliases: ['プラス', 'プラス(食材ゲットS)'] },
  { id: 'present', name: 'プレゼント', base: 'ing_get_s', aliases: ['プレゼント', 'プレゼント(食材ゲットS)'] },
  { id: 'kyouun', name: 'きょううん', base: 'ing_select_s', aliases: ['きょううん', 'きょううん(食材セレクトS)', '強運'] },
  { id: 'kairiki_basami', name: 'かいりきバサミ', base: 'ing_select_s', aliases: ['かいりきバサミ', 'かいりきバサミ(食材セレクトS)'] },

  { id: 'dream_shard_get_s', name: 'ゆめのかけらゲットS', base: null, aliases: ['ゆめのかけらゲットS', 'ゆめのかけらゲットＳ'] },
  { id: 'hadouddan', name: 'はどうだん', base: 'dream_shard_get_s', aliases: ['はどうだん', 'はどうだん(ゆめのかけらゲットS)', '波動弾'] },

  { id: 'skill_copy', name: 'スキルコピー', base: null, aliases: ['スキルコピー'] },
  { id: 'henshin', name: 'へんしん', base: 'skill_copy', aliases: ['へんしん', 'へんしん(スキルコピー)', '変身'] },
  { id: 'monomane', name: 'ものまね', base: 'skill_copy', aliases: ['ものまね', 'ものまね(スキルコピー)', '物真似'] },

  { id: 'yubi_wo_furu', name: 'ゆびをふる', base: null, aliases: ['ゆびをふる', '指をふる'] },
  { id: 'almighty', name: 'オールマイティー', base: 'yubi_wo_furu', aliases: ['オールマイティー', 'オールマイティー(ゆびをふる)', 'オールマイティ'] },
];

// サブスキルの解放レベル。
// 【2026-09-11 時点の確認結果】Ver.3.6.0（2026-06-25）で解放レベルが引き下げられ、
//   旧: 10 / 25 / 50 / 75 / 100  →  現行: 10 / 25 / 50 / 70 / 80
// （公式アップデート情報 "Unlocks at Lv. 75 → unlocks at Lv.70" / "Unlocks at Lv. 100 → unlocks at Lv.80"、
//   game8・ポケスリ攻略Wiki も現行値を 10/25/50/70/80 と記載）。
// SPEC.md の既定値 [10,25,50,75,100] は旧仕様のため、ここは現行値を採用する。
// OCRで実際に読めた値があればそちらを優先すること（SPEC.md の方針どおり）。
export const SUBSKILL_UNLOCK_LEVELS = [10, 25, 50, 70, 80];

// 旧仕様。過去のスクショを読み込んだときの参考用。
export const SUBSKILL_UNLOCK_LEVELS_LEGACY = [10, 25, 50, 75, 100];

export const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
