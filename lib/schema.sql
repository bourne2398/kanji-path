-- Kanji Path schema (Neon Postgres)
-- Run in the Neon SQL Editor once.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'student')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  reset_token_hash TEXT,
  reset_expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS joyo_vocabulary (
  id      INTEGER PRIMARY KEY,
  word    TEXT NOT NULL,
  reading TEXT,
  meaning TEXT,
  kanji   TEXT,
  everyday BOOLEAN NOT NULL DEFAULT TRUE,
  jlpt_level TEXT NOT NULL DEFAULT 'N5' CHECK (jlpt_level IN ('N5','N4','N3','N2','N1'))
);

CREATE INDEX IF NOT EXISTS idx_joyo_vocabulary_word ON joyo_vocabulary(word);
CREATE INDEX IF NOT EXISTS idx_joyo_vocabulary_kanji ON joyo_vocabulary(kanji);
CREATE INDEX IF NOT EXISTS idx_joyo_vocabulary_everyday ON joyo_vocabulary(everyday);
CREATE INDEX IF NOT EXISTS idx_joyo_vocabulary_jlpt_level ON joyo_vocabulary(jlpt_level);

-- Unified vocabulary learning progress. One record powers Flash Cards and Words Practice.
CREATE TABLE IF NOT EXISTS vocabulary_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vocabulary_id INTEGER NOT NULL REFERENCES joyo_vocabulary(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL DEFAULT 0,
  ease REAL NOT NULL DEFAULT 2.5,
  interval INTEGER NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_ms BIGINT,
  flash_seen BOOLEAN NOT NULL DEFAULT FALSE,
  writing_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, vocabulary_id)
);
CREATE INDEX IF NOT EXISTS idx_vocab_progress_user_due ON vocabulary_progress(user_id, due_at);
CREATE INDEX IF NOT EXISTS idx_vocab_progress_user_stage ON vocabulary_progress(user_id, stage);

ALTER TABLE joyo_vocabulary ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Daily Life';
CREATE INDEX IF NOT EXISTS idx_joyo_vocabulary_category ON joyo_vocabulary(category);

UPDATE joyo_vocabulary
SET category = CASE
  WHEN meaning ~* '(food|meal|rice|bread|drink|water|tea|coffee|eat|cook|restaurant|kitchen|vegetable|fruit|meat|fish|milk)' THEN 'Food & Drinks'
  WHEN meaning ~* '(family|father|mother|brother|sister|parent|child|friend|person|people|man|woman|boy|girl|husband|wife)' THEN 'People & Family'
  WHEN meaning ~* '(buy|sell|shop|shopping|money|price|cash|store|market|customer|clerk|cheap|expensive)' THEN 'Shopping & Money'
  WHEN meaning ~* '(train|station|car|bus|bicycle|bike|taxi|road|street|travel|trip|airport|flight|ticket)' THEN 'Travel & Transport'
  WHEN meaning ~* '(school|study|student|teacher|class|lesson|work|job|company|office|business)' THEN 'School & Work'
  WHEN meaning ~* '(today|tomorrow|yesterday|morning|afternoon|evening|night|week|month|year|time|day|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)' THEN 'Time & Dates'
  WHEN meaning ~* '(house|home|room|door|place|town|city|country|building|hospital|park|shop)' THEN 'Places & Home'
  WHEN meaning ~* '(head|face|eye|ear|hand|foot|body|health|doctor|hospital|pain|medicine)' THEN 'Health & Body'
  WHEN meaning ~* '(go|come|eat|drink|buy|sell|see|hear|read|write|speak|say|make|do|use|take|give|get|put|open|close|start|stop|wait|help|think|know|want|need|live|sleep|wake)' THEN 'Common Verbs'
  WHEN meaning ~* '(big|small|new|old|good|bad|easy|difficult|hot|cold|long|short|high|low|fast|slow|many|few|beautiful|interesting|important)' THEN 'Common Adjectives'
  ELSE 'Daily Life' END
WHERE category IS NULL OR category = 'Daily Life';

CREATE TABLE IF NOT EXISTS game_history (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS practice_history (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kanji_progress (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kanji       TEXT NOT NULL,
  write_count INTEGER NOT NULL DEFAULT 0,
  set_id      INTEGER,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, kanji)
);

CREATE INDEX IF NOT EXISTS idx_kanji_progress_user ON kanji_progress(user_id);

CREATE TABLE IF NOT EXISTS user_progress (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  words_learned    INTEGER NOT NULL DEFAULT 0,
  kanji_learned    INTEGER NOT NULL DEFAULT 0,
  hiragana_learned INTEGER NOT NULL DEFAULT 0,
  katakana_learned INTEGER NOT NULL DEFAULT 0,
  total_target     INTEGER NOT NULL DEFAULT 20000,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kana_progress (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character   TEXT NOT NULL,
  script      TEXT NOT NULL CHECK (script IN ('hiragana', 'katakana')),
  write_count INTEGER NOT NULL DEFAULT 0,
  mastered    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, character, script)
);

CREATE INDEX IF NOT EXISTS idx_kana_progress_user ON kana_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_kana_progress_script ON kana_progress(script);

-- Path / JLPT grid + SRS (N5–N1)
-- stage > 0 means learned/in-progress on the roadmap grid
CREATE TABLE IF NOT EXISTS path_progress (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kanji      TEXT NOT NULL,
  jlpt       TEXT CHECK (jlpt IS NULL OR jlpt IN ('N5','N4','N3','N2','N1')),
  stage      INTEGER NOT NULL DEFAULT 0,
  ease       REAL NOT NULL DEFAULT 2.5,
  interval   INTEGER NOT NULL DEFAULT 0,
  due_at     TIMESTAMPTZ,
  reps       INTEGER NOT NULL DEFAULT 0,
  lapses     INTEGER NOT NULL DEFAULT 0,
  last_ms    BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, kanji)
);

CREATE INDEX IF NOT EXISTS idx_path_progress_user ON path_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_path_progress_due ON path_progress(user_id, due_at);
CREATE INDEX IF NOT EXISTS idx_path_progress_jlpt ON path_progress(user_id, jlpt);
CREATE INDEX IF NOT EXISTS idx_path_progress_stage ON path_progress(user_id, stage);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'path_progress' AND column_name = 'jlpt'
  ) THEN
    ALTER TABLE path_progress ADD COLUMN jlpt TEXT
      CHECK (jlpt IS NULL OR jlpt IN ('N5','N4','N3','N2','N1'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'path_progress' AND column_name = 'last_ms'
  ) THEN
    ALTER TABLE path_progress ADD COLUMN last_ms BIGINT;
  END IF;
END $$;


-- Safe upgrades for existing databases.
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires_at TIMESTAMPTZ;
ALTER TABLE joyo_vocabulary ADD COLUMN IF NOT EXISTS everyday BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE joyo_vocabulary ADD COLUMN IF NOT EXISTS jlpt_level TEXT NOT NULL DEFAULT 'N5';
ALTER TABLE joyo_vocabulary DROP CONSTRAINT IF EXISTS joyo_vocabulary_jlpt_level_check;
ALTER TABLE joyo_vocabulary ADD CONSTRAINT joyo_vocabulary_jlpt_level_check CHECK (jlpt_level IN ('N5','N4','N3','N2','N1'));
CREATE INDEX IF NOT EXISTS idx_joyo_vocabulary_everyday ON joyo_vocabulary(everyday);

-- Start from a broad everyday filter. Specialist/obscure terms are excluded by the API's
-- same classification rules, while administrators can further curate the boolean in SQL.
UPDATE joyo_vocabulary
SET everyday = CASE
  WHEN length(word) > 14 THEN FALSE
  WHEN meaning ~* '(physics|chemistry|biology|botany|zoology|anatomy|surgery|medical|medicine|legal|law|linguistics|military|weapon|finance|financial|stock market|economics|geology|astronomy|engineering|mathematics|computer science|software|programming|religion|buddh|shinto|historical|archaeology|political|politics|government|taxation|criminal|disease|pathology|psychiatry|pharmac|agriculture|technical|telecommunication|algorithm|database|game development|adult|porn|sexual)' THEN FALSE
  WHEN meaning ~* '(loan shark|point-blank|first graduates|research student|student movement|scholarship|terror|suicide|murder|protest|weapon)' THEN FALSE
  WHEN word ~ '[＠※○〇×\[\]（）(){}<>]' THEN FALSE
  ELSE TRUE END;

-- Practical JLPT category based on the hardest kanji represented in this app's JLPT character sets.
-- This is an app category, not an official JLPT vocabulary list.
UPDATE joyo_vocabulary
SET jlpt_level = CASE
  WHEN regexp_replace(word, '[日一国人年大十二本中長出三時行見月後前生五間上東四今金九入学高円子外八六下来気小七山話女北午百書先名川千水半男西電校語土木聞食車何南万毎白天母火右読友左休父雨会同事自社発者地業方新場員立開手力問代明動京目通言理体田主題意不作用度強公持野以思家世多正安院心界教文元重近考画海売知道集別物使品計死特私始朝運終台広住真有口少町料工建空急止送切転研足究楽起着店病質待試族銀早映親験英医仕去味写字答夜音注帰古歌買悪図週室歩風紙黒花春赤青館屋色走秋夏習駅洋旅服夕借曜飲肉貸堂鳥飯勉冬昼茶弟牛魚兄犬妹姉漢政議民連対部合市内相定回選米実関決全表戦経最現調化当約首法性要制治務成期取都和機平加受続進数記初指権支産点報済活原共得解交資予向際勝面告反判認参利組信在件側任引求所次昨論官増係感情投示変打直両式確果容必演歳争談能位置流格疑過局放常状球職与供役構割費付由説難優夫収断石違消神番規術備宅害配警育席訪乗残想声念助労例然限追商葉伝働形景落好退頭負渡失差末守若種美命福望非観察段横深申様財港識呼達良候程満敗値突光路科積他処太客否師登易速存飛殺号単座破除完降責捕危給苦迎園具辞因馬愛富彼未舞亡冷適婦寄込顔類余王返妻背熱宿薬険頼覚船途許抜便留罪努精散静婚喜浮絶幸押倒等老曲払庭徒勤遅居雑招困欠更刻賛抱犯恐息遠戻願絵越欲痛笑互束似列探逃遊迷夢君閉緒折草暮酒悲晴掛到寝暗盗吸陽御歯忘雪吹娘誤洗慣礼窓昔貧怒泳祖杯疲皆鳴腹煙眠怖耳頂箱晩寒髪忙才靴恥偶偉猫幾党協総区領県設改府査委軍団各島革村勢減再税営比防補境導副算輸述線農州武象域額欧担準賞辺造被技低復移個門課脳極含蔵量型況針専谷史階管兵接細効丸湾録省旧橋岸周材戸央券編捜竹超並療採森競介根販歴将幅般貿講林装諸劇河航鉄児禁印逆換久短油暴輪占植清倍均億圧芸署伸停爆陸玉波帯延羽固則乱普測豊厚齢囲卒略承順岩練軽了庁城患層版令角絡損募裏仏績築貨混昇池血温季星永著誌庫刊像香坂底布寺宇巨震希触依籍汚枚複郵仲栄札板骨傾届巻燃跡包駐弱紹雇替預焼簡章臓律贈照薄群秒奥詰双刺純翌快片敬悩泉皮漁荒貯硬埋柱祭袋筆訓浴童宝封胸砂塩賢腕兆床毛緑尊祝柔殿濃液衣肩零幼荷泊黄甘臣浅掃雲掘捨軟沈凍乳恋紅郊腰炭踊冊勇械菜珍卵湖喫干虫刷湯溶鉱涙匹孫鋭枝塗軒毒叫拝氷乾棒祈拾粉糸綿汗銅湿瓶咲召缶隻脂蒸肌耕鈍泥隅灯辛磨麦姓筒鼻粒詞胃畳机膚濯塔沸灰菓帽枯涼舟貝符憎皿肯燥畜挟曇滴伺ぁ\-ゖァ\-ヺー々〆ヵヶ]', '', 'g') <> '' THEN 'N1'
  WHEN word ~ '[党協総区領県設改府査委軍団各島革村勢減再税営比防補境導副算輸述線農州武象域額欧担準賞辺造被技低復移個門課脳極含蔵量型況針専谷史階管兵接細効丸湾録省旧橋岸周材戸央券編捜竹超並療採森競介根販歴将幅般貿講林装諸劇河航鉄児禁印逆換久短油暴輪占植清倍均億圧芸署伸停爆陸玉波帯延羽固則乱普測豊厚齢囲卒略承順岩練軽了庁城患層版令角絡損募裏仏績築貨混昇池血温季星永著誌庫刊像香坂底布寺宇巨震希触依籍汚枚複郵仲栄札板骨傾届巻燃跡包駐弱紹雇替預焼簡章臓律贈照薄群秒奥詰双刺純翌快片敬悩泉皮漁荒貯硬埋柱祭袋筆訓浴童宝封胸砂塩賢腕兆床毛緑尊祝柔殿濃液衣肩零幼荷泊黄甘臣浅掃雲掘捨軟沈凍乳恋紅郊腰炭踊冊勇械菜珍卵湖喫干虫刷湯溶鉱涙匹孫鋭枝塗軒毒叫拝氷乾棒祈拾粉糸綿汗銅湿瓶咲召缶隻脂蒸肌耕鈍泥隅灯辛磨麦姓筒鼻粒詞胃畳机膚濯塔沸灰菓帽枯涼舟貝符憎皿肯燥畜挟曇滴伺]' THEN 'N2'
  WHEN word ~ '[政議民連対部合市内相定回選米実関決全表戦経最現調化当約首法性要制治務成期取都和機平加受続進数記初指権支産点報済活原共得解交資予向際勝面告反判認参利組信在件側任引求所次昨論官増係感情投示変打直両式確果容必演歳争談能位置流格疑過局放常状球職与供役構割費付由説難優夫収断石違消神番規術備宅害配警育席訪乗残想声念助労例然限追商葉伝働形景落好退頭負渡失差末守若種美命福望非観察段横深申様財港識呼達良候程満敗値突光路科積他処太客否師登易速存飛殺号単座破除完降責捕危給苦迎園具辞因馬愛富彼未舞亡冷適婦寄込顔類余王返妻背熱宿薬険頼覚船途許抜便留罪努精散静婚喜浮絶幸押倒等老曲払庭徒勤遅居雑招困欠更刻賛抱犯恐息遠戻願絵越欲痛笑互束似列探逃遊迷夢君閉緒折草暮酒悲晴掛到寝暗盗吸陽御歯忘雪吹娘誤洗慣礼窓昔貧怒泳祖杯疲皆鳴腹煙眠怖耳頂箱晩寒髪忙才靴恥偶偉猫幾]' THEN 'N3'
  WHEN word ~ '[会同事自社発者地業方新場員立開手力問代明動京目通言理体田主題意不作用度強公持野以思家世多正安院心界教文元重近考画海売知道集別物使品計死特私始朝運終台広住真有口少町料工建空急止送切転研足究楽起着店病質待試族銀早映親験英医仕去味写字答夜音注帰古歌買悪図週室歩風紙黒花春赤青館屋色走秋夏習駅洋旅服夕借曜飲肉貸堂鳥飯勉冬昼茶弟牛魚兄犬妹姉漢]' THEN 'N4'
  WHEN word ~ '[日一国人年大十二本中長出三時行見月後前生五間上東四今金九入学高円子外八六下来気小七山話女北午百書先名川千水半男西電校語土木聞食車何南万毎白天母火右読友左休父雨]' THEN 'N5'
  ELSE 'N5'
END;

CREATE INDEX IF NOT EXISTS idx_joyo_vocabulary_jlpt_level ON joyo_vocabulary(jlpt_level);
