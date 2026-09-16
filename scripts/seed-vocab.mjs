/**
 * Load the 40,000-entry Jōyō vocabulary SQL dump into Neon.
 *
 * Usage:
 *   export DATABASE_URL="postgresql://..."
 *   node scripts/seed-vocab.mjs
 *
 * The dump is large (~4 MB). This script streams it in chunks so it works
 * over typical Neon connection limits.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_PATH = path.join(__dirname, 'joyo-vocabulary.sql');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Set DATABASE_URL to your Neon connection string.');
  process.exit(1);
}

if (!fs.existsSync(SQL_PATH)) {
  console.error('Missing scripts/joyo-vocabulary.sql');
  process.exit(1);
}

async function main() {
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    // Large multi-value INSERT statements
    statement_timeout: 300000,
  });
  await client.connect();
  console.log('Connected. Loading vocabulary from', SQL_PATH);

  // Ensure table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS joyo_vocabulary (
      id      INTEGER PRIMARY KEY,
      word    TEXT NOT NULL,
      reading TEXT,
      meaning TEXT,
      kanji   TEXT,
      everyday BOOLEAN NOT NULL DEFAULT TRUE,
      jlpt_level TEXT NOT NULL DEFAULT 'N5'
    );
    ALTER TABLE joyo_vocabulary ADD COLUMN IF NOT EXISTS everyday BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE joyo_vocabulary ADD COLUMN IF NOT EXISTS jlpt_level TEXT NOT NULL DEFAULT 'N5';
    CREATE INDEX IF NOT EXISTS idx_joyo_vocabulary_word ON joyo_vocabulary(word);
    CREATE INDEX IF NOT EXISTS idx_joyo_vocabulary_kanji ON joyo_vocabulary(kanji);
  `);

  // Optional: clear previous data for a clean reload
  if (process.env.RESET_VOCAB === '1') {
    console.log('RESET_VOCAB=1 → truncating joyo_vocabulary…');
    await client.query('TRUNCATE joyo_vocabulary');
  }

  const stream = fs.createReadStream(SQL_PATH, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let buffer = '';
  let statements = 0;
  let rowsApprox = 0;

  async function flush() {
    const sql = buffer.trim();
    buffer = '';
    if (!sql) return;
    // Skip pure comments
    if (sql.startsWith('--') && !sql.includes('INSERT')) return;
    try {
      await client.query(sql);
      statements += 1;
      if (sql.includes('INSERT')) {
        const matches = sql.match(/\),\s*\(/g);
        rowsApprox += (matches ? matches.length + 1 : 1);
      }
      if (statements % 5 === 0) {
        process.stdout.write(`\r  statements: ${statements}  ~rows: ${rowsApprox.toLocaleString()}   `);
      }
    } catch (err) {
      // Ignore "already exists" noise for CREATE/INDEX
      if (String(err.message).includes('already exists')) return;
      console.error('\nFailed statement (first 200 chars):\n', sql.slice(0, 200));
      throw err;
    }
  }

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    buffer += line + '\n';
    // Execute when we hit end of a statement
    if (trimmed.endsWith(';')) {
      await flush();
    }
  }
  await flush();

  await client.query(`ALTER TABLE joyo_vocabulary ADD COLUMN IF NOT EXISTS everyday BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE joyo_vocabulary ADD COLUMN IF NOT EXISTS jlpt_level TEXT NOT NULL DEFAULT 'N5';
    UPDATE joyo_vocabulary SET everyday = CASE
      WHEN length(word) > 14 THEN FALSE
      WHEN meaning ~* '(physics|chemistry|biology|botany|zoology|anatomy|surgery|medical|medicine|legal|law|linguistics|military|weapon|finance|financial|stock market|economics|geology|astronomy|engineering|mathematics|computer science|software|programming|religion|buddh|shinto|historical|archaeology|political|politics|government|taxation|criminal|disease|pathology|psychiatry|pharmac|agriculture|technical|telecommunication|algorithm|database|game development|adult|porn|sexual)' THEN FALSE
      WHEN meaning ~* '(loan shark|point-blank|first graduates|research student|student movement|scholarship|terror|suicide|murder|protest|weapon)' THEN FALSE
      WHEN word ~ '[＠※○〇×\\[\\]（）(){}<>]' THEN FALSE
      ELSE TRUE END;
    UPDATE joyo_vocabulary SET jlpt_level = CASE
      WHEN regexp_replace(word, '[日一国人年大十二本中長出三時行見月後前生五間上東四今金九入学高円子外八六下来気小七山話女北午百書先名川千水半男西電校語土木聞食車何南万毎白天母火右読友左休父雨会同事自社発者地業方新場員立開手力問代明動京目通言理体田主題意不作用度強公持野以思家世多正安院心界教文元重近考画海売知道集別物使品計死特私始朝運終台広住真有口少町料工建空急止送切転研足究楽起着店病質待試族銀早映親験英医仕去味写字答夜音注帰古歌買悪図週室歩風紙黒花春赤青館屋色走秋夏習駅洋旅服夕借曜飲肉貸堂鳥飯勉冬昼茶弟牛魚兄犬妹姉漢政議民連対部合市内相定回選米実関決全表戦経最現調化当約首法性要制治務成期取都和機平加受続進数記初指権支産点報済活原共得解交資予向際勝面告反判認参利組信在件側任引求所次昨論官増係感情投示変打直両式確果容必演歳争談能位置流格疑過局放常状球職与供役構割費付由説難優夫収断石違消神番規術備宅害配警育席訪乗残想声念助労例然限追商葉伝働形景落好退頭負渡失差末守若種美命福望非観察段横深申様財港識呼達良候程満敗値突光路科積他処太客否師登易速存飛殺号単座破除完降責捕危給苦迎園具辞因馬愛富彼未舞亡冷適婦寄込顔類余王返妻背熱宿薬険頼覚船途許抜便留罪努精散静婚喜浮絶幸押倒等老曲払庭徒勤遅居雑招困欠更刻賛抱犯恐息遠戻願絵越欲痛笑互束似列探逃遊迷夢君閉緒折草暮酒悲晴掛到寝暗盗吸陽御歯忘雪吹娘誤洗慣礼窓昔貧怒泳祖杯疲皆鳴腹煙眠怖耳頂箱晩寒髪忙才靴恥偶偉猫幾党協総区領県設改府査委軍団各島革村勢減再税営比防補境導副算輸述線農州武象域額欧担準賞辺造被技低復移個門課脳極含蔵量型況針専谷史階管兵接細効丸湾録省旧橋岸周材戸央券編捜竹超並療採森競介根販歴将幅般貿講林装諸劇河航鉄児禁印逆換久短油暴輪占植清倍均億圧芸署伸停爆陸玉波帯延羽固則乱普測豊厚齢囲卒略承順岩練軽了庁城患層版令角絡損募裏仏績築貨混昇池血温季星永著誌庫刊像香坂底布寺宇巨震希触依籍汚枚複郵仲栄札板骨傾届巻燃跡包駐弱紹雇替預焼簡章臓律贈照薄群秒奥詰双刺純翌快片敬悩泉皮漁荒貯硬埋柱祭袋筆訓浴童宝封胸砂塩賢腕兆床毛緑尊祝柔殿濃液衣肩零幼荷泊黄甘臣浅掃雲掘捨軟沈凍乳恋紅郊腰炭踊冊勇械菜珍卵湖喫干虫刷湯溶鉱涙匹孫鋭枝塗軒毒叫拝氷乾棒祈拾粉糸綿汗銅湿瓶咲召缶隻脂蒸肌耕鈍泥隅灯辛磨麦姓筒鼻粒詞胃畳机膚濯塔沸灰菓帽枯涼舟貝符憎皿肯燥畜挟曇滴伺ぁ\-ゖァ\-ヺー々〆ヵヶ]', '', 'g') <> '' THEN 'N1'
      WHEN word ~ '[党協総区領県設改府査委軍団各島革村勢減再税営比防補境導副算輸述線農州武象域額欧担準賞辺造被技低復移個門課脳極含蔵量型況針専谷史階管兵接細効丸湾録省旧橋岸周材戸央券編捜竹超並療採森競介根販歴将幅般貿講林装諸劇河航鉄児禁印逆換久短油暴輪占植清倍均億圧芸署伸停爆陸玉波帯延羽固則乱普測豊厚齢囲卒略承順岩練軽了庁城患層版令角絡損募裏仏績築貨混昇池血温季星永著誌庫刊像香坂底布寺宇巨震希触依籍汚枚複郵仲栄札板骨傾届巻燃跡包駐弱紹雇替預焼簡章臓律贈照薄群秒奥詰双刺純翌快片敬悩泉皮漁荒貯硬埋柱祭袋筆訓浴童宝封胸砂塩賢腕兆床毛緑尊祝柔殿濃液衣肩零幼荷泊黄甘臣浅掃雲掘捨軟沈凍乳恋紅郊腰炭踊冊勇械菜珍卵湖喫干虫刷湯溶鉱涙匹孫鋭枝塗軒毒叫拝氷乾棒祈拾粉糸綿汗銅湿瓶咲召缶隻脂蒸肌耕鈍泥隅灯辛磨麦姓筒鼻粒詞胃畳机膚濯塔沸灰菓帽枯涼舟貝符憎皿肯燥畜挟曇滴伺]' THEN 'N2'
      WHEN word ~ '[政議民連対部合市内相定回選米実関決全表戦経最現調化当約首法性要制治務成期取都和機平加受続進数記初指権支産点報済活原共得解交資予向際勝面告反判認参利組信在件側任引求所次昨論官増係感情投示変打直両式確果容必演歳争談能位置流格疑過局放常状球職与供役構割費付由説難優夫収断石違消神番規術備宅害配警育席訪乗残想声念助労例然限追商葉伝働形景落好退頭負渡失差末守若種美命福望非観察段横深申様財港識呼達良候程満敗値突光路科積他処太客否師登易速存飛殺号単座破除完降責捕危給苦迎園具辞因馬愛富彼未舞亡冷適婦寄込顔類余王返妻背熱宿薬険頼覚船途許抜便留罪努精散静婚喜浮絶幸押倒等老曲払庭徒勤遅居雑招困欠更刻賛抱犯恐息遠戻願絵越欲痛笑互束似列探逃遊迷夢君閉緒折草暮酒悲晴掛到寝暗盗吸陽御歯忘雪吹娘誤洗慣礼窓昔貧怒泳祖杯疲皆鳴腹煙眠怖耳頂箱晩寒髪忙才靴恥偶偉猫幾]' THEN 'N3'
      WHEN word ~ '[会同事自社発者地業方新場員立開手力問代明動京目通言理体田主題意不作用度強公持野以思家世多正安院心界教文元重近考画海売知道集別物使品計死特私始朝運終台広住真有口少町料工建空急止送切転研足究楽起着店病質待試族銀早映親験英医仕去味写字答夜音注帰古歌買悪図週室歩風紙黒花春赤青館屋色走秋夏習駅洋旅服夕借曜飲肉貸堂鳥飯勉冬昼茶弟牛魚兄犬妹姉漢]' THEN 'N4'
      WHEN word ~ '[日一国人年大十二本中長出三時行見月後前生五間上東四今金九入学高円子外八六下来気小七山話女北午百書先名川千水半男西電校語土木聞食車何南万毎白天母火右読友左休父雨]' THEN 'N5'
      ELSE 'N5' END;`);

  const count = await client.query('SELECT COUNT(*)::int AS c FROM joyo_vocabulary');
  console.log(`\nDone. joyo_vocabulary has ${count.rows[0].c.toLocaleString()} rows.`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

