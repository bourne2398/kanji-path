/**
 * Kanji Path — main application logic
 * Data is loaded asynchronously from /data/kanji-data.json
 */

let SETS = [];
let DATA_LOADED = false;
let DATA_LOAD_PROMISE = null;

const KANJI_DATA_URL = '/data/kanji-data.json';
const KANJI_DATA_CACHE_KEY = 'kp_kanji_data_v1';

/**
 * Load kanji sets with memory + localStorage cache.
 * Returns a promise that resolves to the SETS array.
 */
function loadKanjiData(force = false) {
  if (DATA_LOADED && !force && SETS.length) {
    return Promise.resolve(SETS);
  }
  if (DATA_LOAD_PROMISE && !force) {
    return DATA_LOAD_PROMISE;
  }

  DATA_LOAD_PROMISE = (async () => {
    // 1. Try in-memory (already handled above)
    // 2. Try localStorage cache for instant offline / repeat visits
    if (!force) {
      try {
        const cached = localStorage.getItem(KANJI_DATA_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && Array.isArray(parsed.sets) && parsed.sets.length > 0) {
            SETS = parsed.sets.map(s => ({
              id: s.id,
              kanji: s.kanji,
              cards: s.cards
            }));
            DATA_LOADED = true;
            // Refresh from network in background
            fetchAndCacheKanjiData().catch(() => {});
            return SETS;
          }
        }
      } catch (_) {}
    }

    // 3. Network fetch
    return fetchAndCacheKanjiData();
  })();

  return DATA_LOAD_PROMISE;
}

async function fetchAndCacheKanjiData() {
  const res = await fetch(KANJI_DATA_URL, { cache: 'force-cache' });
  if (!res.ok) {
    throw new Error('Failed to load kanji data (' + res.status + ')');
  }
  const data = await res.json();
  if (!data || !Array.isArray(data.sets)) {
    throw new Error('Invalid kanji data format');
  }
  SETS = data.sets.map(s => ({
    id: s.id,
    kanji: s.kanji,
    cards: s.cards
  }));
  DATA_LOADED = true;
  try {
    localStorage.setItem(KANJI_DATA_CACHE_KEY, JSON.stringify({
      version: data.version || 1,
      sets: SETS
    }));
  } catch (_) {}
  return SETS;
}

const $ = id => document.getElementById(id);
const bind = (id, event, fn) => { const el = $(id); if (el) el[event] = fn; };

const esc = x => String(x).replace(/[&<>"']/g, m =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const shuffled = a => [...a].sort(() => Math.random() - 0.5);
const getCards = ids => ids.flatMap(id => SETS[id - 1].cards);
const setSummary = ids =>
  ids.length === SETS.length ? 'All sets' :
  ids.length === 1 ? `Set ${ids[0]}` :
  `${ids.length} sets`;

let mode = 'study';
let modalTarget = 'study';
let modalSelected = [1];
let historyEntries = [];

let quitTarget = null;

const state = {
  study: { sets: [1], cards: [], allCards: [], flips: [], reverse: false, wordMode: false, wordSourceKanji: '', levelFilter: 'EVERYDAY' },
  practice: { sets: [1], items: [], i: 0 },
  words: { sets: [1], items: [], allItems: [], i: 0, levelFilter: 'EVERYDAY', vocabLoading: false },
  // stubs so leftover quiz/games helpers do not crash if called
  quiz:  { sets: [1], cards: [], i: 0, reverse: false, score: 0, answered: false, playing: false,
           timerSeconds: 0, timer: null, endAt: 0, results: [], lastMsg: '', settingsConfigured: false },
  games: { type: '', sets: [1], cards: [], i: 0, score: 0, playing: false, results: [], timerSeconds: 0, questionCount: 10, reverse: false, timer: null, endAt: 0, matched: 0, selectedMatch: null, matchBoard: null }
};

let hanziWriter = null;
let hanziDataCache = new Map();
let practiceResizeObserver = null;

// Account state. Guests may study locally, but cloud progress requires an account.
let currentUser = null;
let accountModal = null;

function showAccountModal(view='login') {
  const modalEl = document.getElementById('loginModal');
  if (!modalEl) return;
  if (!accountModal && window.bootstrap) accountModal = bootstrap.Modal.getOrCreateInstance(modalEl);
  switchAccountView(view);
  if (accountModal) accountModal.show(); else modalEl.classList.remove('hidden');
}
function switchAccountView(view) {
  const login=document.getElementById('loginForm'), reg=document.getElementById('registerForm'), forgot=document.getElementById('forgotForm');
  const sign=document.getElementById('signInTab'), create=document.getElementById('registerTab');
  login?.classList.toggle('d-none',view!=='login'); reg?.classList.toggle('d-none',view!=='register'); forgot?.classList.toggle('d-none',view!=='forgot');
  sign?.classList.toggle('active',view==='login'); create?.classList.toggle('active',view==='register');
  const title=document.getElementById('accountTitle'), sub=document.getElementById('accountSubtitle');
  if(view==='register'){title.textContent='Create your account ✨';sub.textContent='Your progress will be saved securely to your account.'}
  else if(view==='forgot'){title.textContent='Password recovery';sub.textContent='We’ll help you get back into your account.'}
  else {title.textContent='Welcome back ✨';sub.textContent='Sign in to save your learning journey.'}
}
function setAccountMessage(id,msg,kind='danger') { const el=document.getElementById(id); if(!el)return; el.textContent=msg||''; el.className='alert alert-'+kind+' py-2'+(msg?'':' d-none'); }

async function refreshCurrentUser() {
  try { const res=await fetch('/api/auth/me',{credentials:'include',cache:'no-store'}); const data=await res.json(); currentUser=data.user||null; }
  catch(_){ currentUser=null; }
  updateUserBanner();
  if(currentUser) await syncPathProgressWithServer();
  return currentUser;
}
function updateUserBanner() {
  const label=document.getElementById('userBannerLabel'), hint=document.getElementById('userBannerHint'), login=document.getElementById('loginOpenBtn'), logout=document.getElementById('logoutBtn');
  if(!label)return;
  if(currentUser){ label.textContent='Signed in · '+(currentUser.name||currentUser.email); hint.textContent='Your Kanji Path progress is being saved to your account.'; login?.classList.add('hidden'); logout?.classList.remove('hidden'); }
  else { label.textContent='Guest mode'; hint.textContent='Sign in or create an account so your progress is saved to the database and follows you to another device.'; login?.classList.remove('hidden'); logout?.classList.add('hidden'); }
}
function requireAuth() { if(currentUser)return true; showAccountModal('login'); return false; }

async function savePathProgressToServer(progress) {
  if(!currentUser) return false;
  const items=Object.entries(progress||{}).map(([kanji,v])=>({kanji,...v}));
  if(!items.length)return true;
  try { const r=await fetch('/api/progress?type=path',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({items})}); return r.ok; }
  catch(e){ console.warn('Cloud progress save failed',e); return false; }
}
async function syncPathProgressWithServer() {
  if(!currentUser)return;
  try {
    const r=await fetch('/api/progress?type=path',{credentials:'include',cache:'no-store'});
    if(!r.ok)return;
    const data=await r.json();
    const accountKey=pathStorageKey();
    let local=loadPathProgress();
    const legacyRaw=localStorage.getItem('kanjiMnemonicPath');
    if(legacyRaw && !localStorage.getItem(accountKey)){ try { const legacy=JSON.parse(legacyRaw); if(legacy && typeof legacy==='object' && Object.keys(legacy).length) local={...legacy,...local}; } catch(_){} }
    const merged={...data.items?.reduce((o,x)=>{o[x.kanji]={stage:x.stage,ease:x.ease,interval:x.interval,due:x.due,reps:x.reps,lapses:x.lapses,last:x.last};return o;},{}),...local};
    // Prefer the more advanced local state when a guest had already studied before signing in.
    for(const item of (data.items||[])){
      const l=local[item.kanji], serverStage=Number(item.stage)||0;
      if(l && Number(l.stage||0)>serverStage) merged[item.kanji]=l;
    }
    savePathProgress(merged);
    try{localStorage.removeItem('kanjiMnemonicPath')}catch(_){}
    await savePathProgressToServer(merged);
    renderPath();
  }catch(e){console.warn('Cloud progress sync failed',e)}
}

function bindAuthUi() {
  document.getElementById('loginOpenBtn')?.addEventListener('click',()=>showAccountModal('login'));
  document.getElementById('signInTab')?.addEventListener('click',()=>switchAccountView('login'));
  document.getElementById('registerTab')?.addEventListener('click',()=>switchAccountView('register'));
  document.getElementById('forgotOpenBtn')?.addEventListener('click',()=>switchAccountView('forgot'));
  document.getElementById('backToSignIn')?.addEventListener('click',()=>switchAccountView('login'));
  document.getElementById('loginForm')?.addEventListener('submit',async e=>{e.preventDefault();setAccountMessage('loginError','');const email=document.getElementById('loginEmail').value.trim(),password=document.getElementById('loginPassword').value;try{const r=await fetch('/api/auth/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});const d=await r.json();if(!r.ok){setAccountMessage('loginError',d.error||'Sign in failed');return;}currentUser=d.user;updateUserBanner();await syncPathProgressWithServer();accountModal?.hide();}catch(_){setAccountMessage('loginError','Network error. Please try again.')}});
  document.getElementById('registerForm')?.addEventListener('submit',async e=>{e.preventDefault();setAccountMessage('registerError','');const name=document.getElementById('registerName').value.trim(),email=document.getElementById('registerEmail').value.trim(),password=document.getElementById('registerPassword').value,password2=document.getElementById('registerPassword2').value;if(password!==password2){setAccountMessage('registerError','Passwords do not match.');return;}try{const r=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({name,email,password})});const d=await r.json();if(!r.ok){setAccountMessage('registerError',d.error||'Registration failed');return;}currentUser=d.user;updateUserBanner();await syncPathProgressWithServer();accountModal?.hide();}catch(_){setAccountMessage('registerError','Network error. Please try again.')}});
  document.getElementById('forgotForm')?.addEventListener('submit',async e=>{e.preventDefault();setAccountMessage('forgotMessage','');const email=document.getElementById('forgotEmail').value.trim();try{const r=await fetch('/api/auth/forgot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});const d=await r.json();setAccountMessage('forgotMessage',d.message||'If the account exists, a reset link has been sent.','success');}catch(_){setAccountMessage('forgotMessage','Unable to send the reset request. Please try again.')}});
  document.getElementById('resetForm')?.addEventListener('submit',async e=>{e.preventDefault();const params=new URLSearchParams(location.search),token=params.get('reset');const p1=document.getElementById('resetPassword').value,p2=document.getElementById('resetPassword2').value;if(!token){setAccountMessage('resetMessage','This reset link is invalid or expired.');return;}if(p1!==p2){setAccountMessage('resetMessage','Passwords do not match.');return;}try{const r=await fetch('/api/auth/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:p1})});const d=await r.json();if(!r.ok){setAccountMessage('resetMessage',d.error||'Reset failed.');return;}setAccountMessage('resetMessage','Password updated. You can now sign in.','success');history.replaceState({},'',location.pathname);setTimeout(()=>{bootstrap.Modal.getOrCreateInstance(document.getElementById('resetModal')).hide();showAccountModal('login')},900);}catch(_){setAccountMessage('resetMessage','Network error. Please try again.')}});
  document.getElementById('logoutBtn')?.addEventListener('click',async()=>{try{await fetch('/api/auth/logout',{method:'POST',credentials:'include'})}catch(_){}currentUser=null;updateUserBanner();});
  const token=new URLSearchParams(location.search).get('reset'); if(token){setTimeout(()=>{const m=document.getElementById('resetModal');if(m&&window.bootstrap)bootstrap.Modal.getOrCreateInstance(m).show();},0);}
}

async function apiGetHistory(type) { if(type==='games')return{games:loadHistory()}; if(type==='practice')return{practice:loadPracticeHistory()}; return{games:loadHistory(),practice:loadPracticeHistory()}; }
async function apiPostGame(entry){return{ok:true,local:true,entry};}
async function apiPostPractice(item){return{ok:true,local:true,item};}

function speak(text, lang) {
  if (!text) return;
  const isJa = lang && String(lang).startsWith('ja');
  // Prefer more natural Japanese pronunciation when possible
  if (isJa) {
    try {
      // Higher-quality Japanese TTS (Google Translate endpoint — free, no key, may be rate-limited)
      const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ja&q=' + encodeURIComponent(String(text));
      const audio = new Audio(url);
      audio.play().catch(() => speakFallback(text, lang));
      return;
    } catch (_) {}
  }
  speakFallback(text, lang);
}

function speakFallback(text, lang) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text));
  u.lang = lang || 'en-US';
  // Prefer the best available Japanese / English voice
  const voices = window.speechSynthesis.getVoices();
  if (voices && voices.length) {
    const prefer = (namePart) => voices.find(v => v.lang && v.lang.startsWith((lang || 'en').slice(0, 2)) && v.name.includes(namePart));
    const preferred = prefer('Google') || prefer('Microsoft') || prefer('Kyoko') || prefer('Otoya') || prefer('Samantha') ||
      voices.find(v => v.lang && v.lang.startsWith((lang || 'en').slice(0, 2)));
    if (preferred) u.voice = preferred;
  }
  u.rate = (lang && lang.startsWith('ja')) ? 0.85 : 1;
  u.pitch = 1;
  window.speechSynthesis.speak(u);
}

// Pre-load voices (needed on some browsers)
if (typeof speechSynthesis !== 'undefined') {
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

function isKanjiChar(ch) {
  if (!ch) return false;
  const code = ch.codePointAt(0);
  return (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff);
}

/** Single-character items for Practice tab */
function getPracticeItems(ids) {
  return ids.map(id => {
    const set = SETS[id - 1];
    if (!set) return null;
    const exact = set.cards.find(c => c[0] === set.kanji) || set.cards[0] || [set.kanji, '', ''];
    return {
      setId: id,
      word: set.kanji,
      kanji: set.kanji,
      chars: [set.kanji],
      charIndex: 0,
      reading: exact[1] || '',
      english: exact[2] || ''
    };
  }).filter(Boolean);
}

/** Multi-character compound words for Words tab */
function getWordPracticeItems(ids) {
  const items = [];
  const seen = new Set();
  for (const id of ids) {
    const set = SETS[id - 1];
    if (!set) continue;
    for (const card of set.cards) {
      const word = card[0] || '';
      const chars = [...word].filter(isKanjiChar);
      if (chars.length < 2) continue;
      if (seen.has(word)) continue;
      seen.add(word);
      items.push({
        setId: id,
        word,
        kanji: chars[0],
        chars,
        charIndex: 0,
        reading: card[1] || '',
        english: card[2] || ''
      });
    }
  }
  return items;
}

function setupPractice(ids) {
  const s = state.practice;
  s.sets = [...ids];
  s.items = getPracticeItems(ids);
  s.i = 0;
  closePracticeModal();
  renderPractice();
}

function setupWords(ids) {
  const s = state.words;
  s.sets = [...ids];
  s.items = [];
  s.i = 0;
  closePracticeModal();
  renderWords();
  ensureVocabularyLoaded();
}

function isEverydayVocab(word, meaning='') {
  const w=String(word||'').trim(), m=String(meaning||'').toLowerCase();
  if(!w || w.length>14) return false;
  if(/[＠※○〇×\[\]（）(){}<>]/.test(w)) return false;
  const specialist=/\b(physics|chemistry|biology|botany|zoology|anatomy|surgery|medical|medicine|legal|law|jurisprud|linguistics|grammar|military|weapon|warfare|finance|financial|stock market|economics|geology|astronomy|engineering|mathematics|mathematical|computer science|software|programming|religion|buddh|shinto|buddhist|historical|archaeology|political|politics|government|taxation|court|criminal|disease|pathology|psychiatry|pharmac|agriculture|chemic|technical|telecommunication|algorithm|database|game development|adult|porn|sexual)/i;
  if(specialist.test(m)) return false;
  const bad=/\b(loan shark|point-blank|first graduates|research student|student movement|scholarship|terror|suicide|murder|protest|weapon|weaponry)\b/i;
  if(bad.test(m)) return false;
  return true;
}
function normalizeVocabRow(r) {
  if (!r) return null;
  const word=String(r.word ?? r[0] ?? '').trim(); if(!word)return null;
  const reading=String(r.reading ?? r[1] ?? '').trim(); const meaning=String(r.meaning ?? r[2] ?? '').trim();
  const everyday=r.everyday !== undefined ? !!r.everyday : isEverydayVocab(word,meaning);
  return {word,reading,meaning,everyday};
}
function filteredVocabularyItems(){return (Array.isArray(state.words.allItems)?state.words.allItems:[]).filter(x=>x.everyday!==false);}

function renderWords() {
  const s = state.words;
  const grid = $('wordsGrid');
  if (!grid) return;
  const all = Array.isArray(s.allItems) ? s.allItems : [];
  const filtered = filteredVocabularyItems();
  s.items = filtered;
  grid.innerHTML = '';
  if (!all.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">Click <b>Load Everyday Vocabulary</b>. The vocabulary is cached in your browser after the first load, so future opens are instant.</div>';
    if ($('wordsCount')) $('wordsCount').textContent = '0 words';
    return;
  }
  const maxVisible = 120;
  filtered.slice(0, maxVisible).forEach((item, idx) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'practice-tile word-flashcard';
    const chars = [...item.word].filter(isKanjiChar);
    const count = chars.length ? Math.min(...chars.map(ch => getKanjiWriteCount(ch))) : 0;
    const percent = chars.length ? Math.round((count / PRACTICE_GOAL) * 100) : 0;
    if (count >= PRACTICE_GOAL && chars.length) tile.classList.add('practice-complete');
    tile.style.setProperty('--practice-fill', percent + '%');
    tile.setAttribute('aria-label', `${item.word}, ${item.reading}, ${item.meaning}`);
    tile.innerHTML = '<span class="pt-kanji">' + esc(item.word) + '</span>' +
      '<span class="pt-meta">' + esc(item.reading || '') + (item.meaning ? ' · ' + esc(item.meaning) : '') + '</span>' +
      '' +
      '<span class="pt-progress">' + (chars.length ? esc(practiceProgressLabel(count)) : 'Kana word') + '</span>';
    tile.onclick = () => openWordWrite(idx);
    grid.appendChild(tile);
  });
  const hidden = Math.max(0, filtered.length - maxVisible);
  if ($('wordsProgress')) $('wordsProgress').textContent = `${filtered.length.toLocaleString()} everyday vocabulary · showing ${Math.min(maxVisible, filtered.length).toLocaleString()} flashcards${hidden ? ` · ${hidden.toLocaleString()} more available` : ''}. Tap a word to write it.`;
  if ($('wordsCount')) $('wordsCount').textContent = `${filtered.length.toLocaleString()} words`;
  if ($('wordsSetSummary')) $('wordsSetSummary').textContent = 'Everyday vocabulary';
}

async function ensureVocabularyLoaded(force = false) {
  if (state.words.vocabLoading && !force) return state.words.vocabLoading;
  state.words.vocabLoading = true;
  const button = $('wordsLoadAll');
  if (button) { button.disabled = true; button.textContent = 'Loading vocabulary…'; }
  const cacheKey = 'kanjiPathVocabulary40kV3';
  const readCache = () => new Promise(resolve => {
    try {
      const req = indexedDB.open('kanjiPathVocabularyDB', 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('vocab')) req.result.createObjectStore('vocab'); };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('vocab','readonly');
        const get = tx.objectStore('vocab').get(cacheKey);
        get.onsuccess = () => { resolve(get.result || null); db.close(); };
        get.onerror = () => { resolve(null); db.close(); };
      };
      req.onerror = () => resolve(null);
    } catch (_) { resolve(null); }
  });
  const writeCache = data => new Promise(resolve => {
    try {
      const req = indexedDB.open('kanjiPathVocabularyDB', 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('vocab')) req.result.createObjectStore('vocab'); };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('vocab','readwrite');
        tx.objectStore('vocab').put(data, cacheKey);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); resolve(); };
      };
      req.onerror = () => resolve();
    } catch (_) { resolve(); }
  });
  try {
    const cached = await readCache();
    if (cached && Array.isArray(cached.items) && cached.items.length) {
      state.words.allItems = cached.items.map(normalizeVocabRow).filter(Boolean);
      renderWords();
      if (button) button.textContent = state.words.allItems.length >= 40000 ? 'Refresh Vocabulary' : 'Load Everyday Vocabulary';
      state.words.vocabLoading = false;
      // Refresh in the background only when the cache is older than 24h.
      if (!force && cached.ts && Date.now() - cached.ts < 86400000) return state.words.allItems;
    }

    const first = await fetch('/api/vocab?page=0&limit=300', { credentials:'include', cache:'no-store' });
    if (!first.ok) throw new Error('Vocabulary API ' + first.status);
    const firstData = await first.json();
    const total = Number(firstData.total || 0);
    let items = (firstData.items || []).map(normalizeVocabRow).filter(Boolean);
    state.words.allItems = items;
    renderWords();

    // Fetch the remaining database pages without blocking the Word tab.
    const pageSize = Math.max(1, Number(firstData.items?.length || 300));
    const pages = Math.ceil(total / pageSize);
    for (let page = 1; page < pages && items.length < 40000; page++) {
      try {
        const res = await fetch(`/api/vocab?page=${page}&limit=${pageSize}`, { credentials:'include', cache:'no-store' });
        if (!res.ok) break;
        const data = await res.json();
        const batch = (data.items || []).map(normalizeVocabRow).filter(Boolean);
        if (!batch.length) break;
        items.push(...batch);
        if (page % 3 === 0 || items.length >= 40000) {
          state.words.allItems = items.slice(0,40000);
          renderWords();
          if ($('wordsProgress')) $('wordsProgress').textContent = `Loading vocabulary: ${Math.min(items.length,40000).toLocaleString()} / ${Math.min(total || 40000,40000).toLocaleString()}…`;
        }
      } catch (e) { console.warn('Vocabulary page failed', page, e); break; }
    }
    state.words.allItems = items.slice(0,40000);
    await writeCache({ ts:Date.now(), total:Math.max(total,state.words.allItems.length), items:state.words.allItems });
    renderWords();
    if ($('wordsProgress')) $('wordsProgress').textContent = `${state.words.allItems.length.toLocaleString()} vocabulary entries ready and cached on this device. Filters are instant.`;
    if (button) button.textContent = state.words.allItems.length >= 40000 ? 'Refresh Vocabulary' : 'Retry Vocabulary Load';
  } catch (e) {
    console.error('Vocabulary load failed:', e);
    if ($('wordsProgress')) $('wordsProgress').textContent = 'Could not load vocabulary. Make sure /api/vocab is deployed and the database contains the vocabulary table.';
    if (button) button.textContent = 'Retry Vocabulary Load';
  } finally {
    state.words.vocabLoading = false;
    if (button) button.disabled = false;
  }
  return state.words.allItems || [];
}

function openWordWrite(idx) {
  // Convert the vocabulary flashcard into the shared multi-kanji writing item.
  const w = state.words;
  const v = w.items[idx];
  if (!v) return;
  const item = {
    setId: 'Vocabulary',
    word: v.word,
    kanji: [...v.word].filter(isKanjiChar)[0] || v.word,
    chars: [...v.word].filter(isKanjiChar),
    charIndex: 0,
    reading: v.reading || '',
    english: v.meaning || ''
  };
  if (!item.chars.length) return;
  state.practice.items = [item];
  state.practice.sets = [];
  state.practice.i = 0;
  openPracticeModal(0);
}

function destroyHanzi() {
  if (practiceResizeObserver) {
    try { practiceResizeObserver.disconnect(); } catch (_) {}
    practiceResizeObserver = null;
  }
  if (hanziWriter && typeof hanziWriter.cancelQuiz === 'function') {
    try { hanziWriter.cancelQuiz(); } catch (_) {}
  }
  hanziWriter = null;
  const el = $('hanziTarget');
  if (el) el.innerHTML = '';
}

function getPracticeHanziSize() {
  const box = $('practiceHwBox');
  const wrap = box ? box.parentElement : null;
  const modal = $('practiceModal');
  if (!box || !wrap || !modal) return 280;

  // Measure the actual space available to the square. Do not subtract a
  // hard-coded amount: the footer is outside .modal-body and CSS flexbox
  // already reserves its height. A hard-coded subtraction could make the
  // writer's SVG larger than the visible box and clip the character.
  const availableW = wrap.clientWidth;
  const availableH = wrap.clientHeight;
  const maxW = Math.max(160, availableW - 4);
  const maxH = Math.max(160, availableH - 4);
  return Math.max(160, Math.min(360, maxW, maxH));
}

function resizePracticeHanzi() {
  if (!hanziWriter) return;
  const box = $('practiceHwBox');
  if (!box) return;
  const size = getPracticeHanziSize();
  box.style.width = size + 'px';
  box.style.height = size + 'px';
  try {
    if (typeof hanziWriter.updateDimensions === 'function') {
      hanziWriter.updateDimensions({ width: size, height: size });
    }
  } catch (_) {}
}

function loadJapaneseHanziData(char, onLoad, onError) {
  const cached = hanziDataCache.get(char);
  if (cached) {
    onLoad(cached);
    return;
  }

  // Use the Japanese Hanzi Writer data set. Hanzi Writer's normal data is
  // Chinese-oriented and does not reliably contain Japanese glyph variants
  // such as 黒. The Japanese data preserves the Japanese stroke shapes/order.
  const url = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data-jp@0/' + encodeURIComponent(char) + '.json';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  fetch(url, { cache: 'force-cache', signal: controller.signal })
    .then(res => {
      if (!res.ok) throw new Error('Japanese stroke data unavailable (' + res.status + ')');
      return res.json();
    })
    .then(data => {
      clearTimeout(timeout);
      if (!data || typeof data !== 'object') throw new Error('Invalid Japanese stroke data');
      hanziDataCache.set(char, data);
      onLoad(data);
    })
    .catch(err => {
      clearTimeout(timeout);
      console.warn('Japanese Hanzi Writer data failed for', char, err);
      onError(err);
    });
}

function loadHanzi(char) {
  destroyHanzi();
  const target = $('hanziTarget');
  if (!target) return;
  if (typeof HanziWriter === 'undefined') {
    target.innerHTML = '<div style="padding:24px;text-align:center;color:#64748b">Loading stroke engine…</div>';
    setTimeout(() => {
      if (typeof HanziWriter !== 'undefined') loadHanzi(char);
      else target.innerHTML = '<div style="padding:24px;text-align:center;color:#64748b">Need internet to load Japanese stroke data. Check connection and try again.</div>';
    }, 700);
    return;
  }

  const box = $('practiceHwBox');
  const size = getPracticeHanziSize();
  if (box) {
    box.style.width = size + 'px';
    box.style.height = size + 'px';
  }


  try {
    hanziWriter = HanziWriter.create('hanziTarget', char, {
      width: size,
      height: size,
      padding: Math.max(8, Math.round(size * 0.055)),
      strokeAnimationSpeed: 0.9,
      delayBetweenStrokes: 220,
      showOutline: true,
      showCharacter: true,
      renderer: 'svg',
      strokeColor: '#0f172a',
      outlineColor: '#cbd5e1',
      drawingColor: '#0f172a',
      highlightColor: '#0d7a6f',
      drawingWidth: Math.max(14, Math.round(size * 0.075)),
      strokeWidth: Math.max(3, Math.round(size * 0.018)),
      charDataLoader: loadJapaneseHanziData,
      onLoadCharDataSuccess: () => {
        target.setAttribute('data-character', char);
        resizePracticeHanzi();
        // Explicitly render both the character and its outline after the
        // async Japanese data has loaded.
        try { hanziWriter.showCharacter(); hanziWriter.showOutline(); } catch (_) {}
      },
      onLoadCharDataError: () => {
        target.innerHTML = '<div style="padding:24px;text-align:center;color:#64748b">Japanese stroke data for 「' + esc(char) + '」 could not be loaded. Please check your internet connection.</div>';
        hanziWriter = null;
      }
    });

    // Re-measure after SVG creation because the modal may finish its layout
    // one frame later on phones and smaller laptop windows.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resizePracticeHanzi());
    });

    if (window.ResizeObserver && box) {
      practiceResizeObserver = new ResizeObserver(() => resizePracticeHanzi());
      practiceResizeObserver.observe(box.parentElement || box);
    }
  } catch (e) {
    console.error('Hanzi Writer initialization failed:', e);
    target.innerHTML = '<div style="padding:24px;text-align:center;color:#64748b">Could not initialize Japanese stroke practice for 「' + esc(char) + '」.</div>';
    hanziWriter = null;
  }
}

const PRACTICE_GOAL = 10;
const PRACTICE_PROGRESS_KEY = 'kanjiPracticeWritingProgress';

function getPracticeProgressStorageKey() {
  const userKey = currentUser && (currentUser.id || currentUser.email)
    ? String(currentUser.id || currentUser.email)
    : 'device';
  return PRACTICE_PROGRESS_KEY + ':' + userKey;
}

function loadPracticeWritingProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(getPracticeProgressStorageKey()) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function savePracticeWritingProgress(progress) {
  try {
    localStorage.setItem(getPracticeProgressStorageKey(), JSON.stringify(progress));
  } catch (_) {}
}

async function apiGetKanjiProgress() {
  return { progress: loadPracticeWritingProgress() };
}

async function apiSaveKanjiProgress(kanji, count, setId) {
  const progress = loadPracticeWritingProgress();
  progress[kanji] = Math.min(PRACTICE_GOAL, Math.max(0, Math.floor(Number(count) || 0)));
  savePracticeWritingProgress(progress);
  return { ok: true, local: true, count: progress[kanji] };
}

async function syncPracticeWritingProgress() {
  renderPractice();
}

function getKanjiWriteCount(kanji) {
  const progress = loadPracticeWritingProgress();
  const value = Number(progress[kanji] || 0);
  return Math.min(PRACTICE_GOAL, Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0));
}

async function recordKanjiWrite(kanji, setId) {
  if (!kanji) return 0;

  // Optimistic local update so the tile changes immediately.
  const progress = loadPracticeWritingProgress();
  const current = Number(progress[kanji] || 0);
  const optimistic = Math.min(
    PRACTICE_GOAL,
    Math.max(0, Number.isFinite(current) ? Math.floor(current) : 0) + 1
  );
  progress[kanji] = optimistic;
  savePracticeWritingProgress(progress);

  try {
    const data = await apiSaveKanjiProgress(kanji, optimistic, setId);
    const serverCount = Math.min(
      PRACTICE_GOAL,
      Math.max(0, Number(data.count || 0))
    );
    progress[kanji] = Number.isFinite(serverCount) ? Math.floor(serverCount) : optimistic;
    savePracticeWritingProgress(progress);
    return progress[kanji];
  } catch (err) {
    console.warn('Kanji progress database save failed:', err);
    return optimistic;
  }
}

function practiceProgressLabel(count) {
  return `${Math.min(PRACTICE_GOAL, count)} / ${PRACTICE_GOAL} writings`;
}

function renderPractice() {
  const s = state.practice;
  const grid = $('practiceGrid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!s.items.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">Choose sets to practice.</div>';
    $('practiceProgress').textContent = '';
    $('practiceSetSummary').textContent = 'No sets';
    $('practiceCount').textContent = '0 kanji';
    return;
  }

  s.items.forEach((item, idx) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'practice-tile';

    const count = getKanjiWriteCount(item.kanji);
    const percent = Math.round((count / PRACTICE_GOAL) * 100);
    if (count >= PRACTICE_GOAL) tile.classList.add('practice-complete');
    tile.style.setProperty('--practice-fill', percent + '%');
    tile.setAttribute('aria-label', `${item.kanji}, ${practiceProgressLabel(count)}`);

    tile.innerHTML =
      '<span class="pt-kanji">' + esc(item.kanji) + '</span>' +
      '<span class="pt-meta">Set ' + item.setId + '</span>' +
      '<span class="pt-progress">' + esc(practiceProgressLabel(count)) + '</span>';

    tile.onclick = () => openPracticeModal(idx);
    grid.appendChild(tile);
  });

  $('practiceProgress').textContent = 'Write each kanji 10 times. You can pause and practice another kanji anytime.';
  $('practiceSetSummary').textContent = setSummary(s.sets);
  $('practiceCount').textContent = s.items.length + ' kanji';
}

function renderPracticeSlots(item) {
  const slotsEl = $('practiceSlots');
  if (!slotsEl || !item) return;
  const chars = item.chars && item.chars.length ? item.chars : [item.kanji];
  const idx = typeof item.charIndex === 'number' ? item.charIndex : 0;
  slotsEl.innerHTML = chars.map((ch, i) => {
    let cls = 'practice-slot';
    let label = '';
    if (i < idx) { cls += ' filled'; label = esc(ch); }
    else if (i === idx) { cls += ' current'; }
    const aria = i === idx ? `Current character ${ch}` : (i < idx ? `Rewrite ${ch}` : `Go to ${ch}`);
    return `<button type="button" class="${cls}" data-i="${i}" aria-label="${aria}" title="${aria}">${label}</button>`;
  }).join('');
  slotsEl.querySelectorAll('.practice-slot').forEach(btn => {
    btn.addEventListener('click', () => practiceGoToChar(Number(btn.dataset.i)));
  });
  const current = slotsEl.querySelector('.practice-slot.current');
  if (current) current.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function getCurrentPracticeChar(item) {
  if (!item) return '';
  const chars = item.chars && item.chars.length ? item.chars : [item.kanji];
  const idx = typeof item.charIndex === 'number' ? item.charIndex : 0;
  return chars[Math.min(idx, chars.length - 1)] || item.kanji;
}

function updatePracticeModalHeader(item) {
  if (!item) return;
  const chars = item.chars && item.chars.length ? item.chars : [item.kanji];
  const current = getCurrentPracticeChar(item);
  item.kanji = current;
  if ($('practiceReading')) $('practiceReading').textContent = item.reading || '';
  if ($('practiceModalKanji')) $('practiceModalKanji').textContent = item.word || item.kanji;
  if ($('practiceModalMeta')) {
    const parts = [];
    if (item.english) parts.push(item.english);
    if (item.word && chars.length > 1) parts.push('Char ' + (item.charIndex + 1) + '/' + chars.length);
    parts.push('Set ' + item.setId);
    $('practiceModalMeta').textContent = parts.join(' · ');
  }
  const prev = $('practicePrevious');
  if (prev) {
    prev.disabled = !item.word || item.charIndex <= 0;
    prev.title = prev.disabled ? 'Already at the first kanji' : 'Go back to the previous kanji';
  }
  renderPracticeSlots(item);
}

function practiceGoToChar(charIndex) {
  const s = state.practice;
  const item = s.items[s.i];
  if (!item) return;
  const chars = item.chars && item.chars.length ? item.chars : [item.kanji];
  const next = Math.max(0, Math.min(chars.length - 1, Number(charIndex) || 0));
  item.charIndex = next;
  item.kanji = chars[next];
  updatePracticeModalHeader(item);
  loadHanzi(item.kanji);
  setTimeout(() => practiceStartGuidedWrite(), 280);
}

function practicePreviousKanji() {
  const s = state.practice;
  const item = s.items[s.i];
  if (!item || !item.word || !item.chars || item.charIndex <= 0) return;
  practiceGoToChar(item.charIndex - 1);
}

function openPracticeModal(idx) {
  if (!requireAuth()) return;
  const s = state.practice;
  const item = s.items[idx];
  if (!item) return;
  s.i = idx;
  if (typeof item.charIndex !== 'number') item.charIndex = 0;
  if (!item.chars || !item.chars.length) item.chars = [item.kanji];
  item.kanji = getCurrentPracticeChar(item);

  if ($('practiceModalTitle')) $('practiceModalTitle').textContent = 'Write the missing Kanji';
  updatePracticeModalHeader(item);

  document.body.classList.add('modal-open');
  $('practiceModal').classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      loadHanzi(item.kanji);
      setTimeout(() => { if (hanziWriter) practiceStartGuidedWrite(); }, 350);
    });
  });
}

function closePracticeModal() {
  try { if (typeof renderPath === 'function') renderPath(); } catch (_) {}
  try { if (typeof renderWords === 'function') renderWords(); } catch (_) {}
  try { if (typeof renderPractice === 'function') renderPractice(); } catch (_) {}
  destroyHanzi();
  const modal = $('practiceModal');
  if (modal) modal.classList.add('hidden');
  const setM = $('setModal');
  const resM = $('resultModal');
  const quitM = $('quitModal');
  const setHidden = !setM || setM.classList.contains('hidden');
  const resHidden = !resM || resM.classList.contains('hidden');
  const quitHidden = !quitM || quitM.classList.contains('hidden');
  if (setHidden && resHidden && quitHidden) {
    document.body.classList.remove('modal-open');
  }
}

function practiceStartGuidedWrite() {
  if (!hanziWriter) return;
  try { hanziWriter.cancelQuiz(); } catch (_) {}
  hanziWriter.hideCharacter();
  hanziWriter.showOutline();
  hanziWriter.quiz({
    onComplete: async () => {
      const s = state.practice;
      const item = s.items[s.i];
      if (!item) return;
      const writtenChar = getCurrentPracticeChar(item);
      const count = await recordKanjiWrite(writtenChar, item.setId);
      savePracticeHistory({ ...item, kanji: writtenChar });
      try { renderPractice(); } catch (_) {}
      try { renderWords(); } catch (_) {}
      try { if (typeof renderPath === 'function') renderPath(); } catch (_) {}

      const chars = item.chars && item.chars.length ? item.chars : [item.kanji];
      if (item.charIndex < chars.length - 1) {
        item.charIndex += 1;
        item.kanji = chars[item.charIndex];
        updatePracticeModalHeader(item);
        requestAnimationFrame(() => {
          loadHanzi(item.kanji);
          setTimeout(() => practiceStartGuidedWrite(), 300);
        });
      } else {
        item.charIndex = chars.length;
        renderPracticeSlots(item);
        const slotsEl = $('practiceSlots');
        if (slotsEl) {
          slotsEl.querySelectorAll('.practice-slot').forEach((el, i) => {
            el.classList.remove('current');
            el.classList.add('filled');
            el.textContent = chars[i] || '';
          });
        }
        const msg = count >= PRACTICE_GOAL
          ? writtenChar + ': Goal complete! ' + PRACTICE_GOAL + '/' + PRACTICE_GOAL
          : writtenChar + ': ' + count + '/' + PRACTICE_GOAL + ' writings';
        if ($('practiceProgress')) $('practiceProgress').textContent = msg;
        if ($('wordsProgress')) $('wordsProgress').textContent = msg;
      }
    }
  });
}

function practiceAnimate() {
  if (!hanziWriter) return;
  try { hanziWriter.cancelQuiz(); } catch (_) {}
  hanziWriter.hideCharacter();
  hanziWriter.showOutline();
  hanziWriter.animateCharacter();
}

function practiceWrite() {
  practiceStartGuidedWrite();
}

function practiceRewrite() {
  const s = state.practice;
  const item = s.items[s.i];
  if (!item) return;
  item.kanji = getCurrentPracticeChar(item);
  renderPracticeSlots(item);
  loadHanzi(item.kanji);
  setTimeout(() => practiceStartGuidedWrite(), 280);
}

function practiceNextKanji() {
  const s = state.practice;
  if (!s.items.length) return;
  openPracticeModal((s.i + 1) % s.items.length);
}

function practiceSkip() {
  practiceNextKanji();
}

function getUserStorageKey(baseKey) {
  const id = currentUser && (currentUser.id || currentUser.email)
    ? String(currentUser.id || currentUser.email)
    : 'device';
  return baseKey + ':' + id;
}

function savePracticeHistory(item) {
  const entry = {
    kanji: item.kanji,
    reading: item.reading,
    english: item.english,
    setId: item.setId,
        date: new Date().toISOString()
  };
  try {
    const h = loadPracticeHistory();
    h.unshift(entry);
    localStorage.setItem(getUserStorageKey('kanjiPracticeHistory'), JSON.stringify(h.slice(0, 200)));
  } catch (_) {}
  apiPostPractice(item).then(() => {
    if (mode === 'history') renderPracticeHistory();
  }).catch(err => console.warn(err));
  if (mode === 'history') renderPracticeHistory();
}

function loadPracticeHistory() {
  try { return JSON.parse(localStorage.getItem(getUserStorageKey('kanjiPracticeHistory')) || '[]'); }
  catch { return []; }
}

function renderPracticeHistoryItems(h) {
  $('practiceHistoryCount').textContent = `${h.length} practiced`;
  const list = $('practiceHistoryList');
  if (!h.length) {
    list.innerHTML = '<div class="empty-state">No practiced kanji yet. Finish a Write in Practice to save here.</div>';
    return;
  }
  list.innerHTML = h.map(x => {
    const date = new Date(x.date || x.created_at).toLocaleString();
    const setId = x.setId != null ? x.setId : x.set_id;
    const nick = x.full_name ? esc(x.full_name) : '—';
    return `<div class="history-item">
      <div class="history-head"><span style="font-size:1.4rem;font-weight:800">${esc(x.kanji)}</span><span>${date}</span></div>
      <div class="history-meta"><strong>${nick}</strong> · Set ${setId} · ${esc(x.reading || '')} · ${esc(x.english || '')}</div>
      <div class="history-score">Completed Write practice</div>
    </div>`;
  }).join('');
}

function renderPracticeHistory() {
  apiGetHistory('practice').then(data => {
    renderPracticeHistoryItems(data.practice || []);
  }).catch(() => {
    renderPracticeHistoryItems(loadPracticeHistory());
  });
}

function practiceShow() {
  if (!hanziWriter) return;
  try { hanziWriter.cancelQuiz(); } catch (_) {}
  hanziWriter.showCharacter();
  hanziWriter.showOutline();
}

function practiceReset() {
  practiceRewrite();
}

function cardFaceHTML(c, isFront, reverse) {
  const level = c[3] ? `<span class="badge" style="margin-top:8px">${esc(c[3])}</span>` : '';
  const audio = `<div class="study-audio">
    <button type="button" data-speak-ja="${esc(c[1] || c[0])}">🔊 JA</button>
    <button type="button" data-speak-en="${esc(c[2] || '')}">🔊 EN</button>
  </div>`;
  if (!reverse) {
    return isFront
      ? `<div class="kanji">${esc(c[0])}</div>${level}<div class="hint">Tap to flip</div>${audio}`
      : `<div class="reading">${esc(c[1])}</div><div class="english">${esc(c[2])}</div>${level}${audio}`;
  }
  return isFront
    ? `<div class="reading">${esc(c[1])}</div><div class="english">${esc(c[2])}</div>${level}<div class="hint">Tap to flip</div>${audio}`
    : `<div class="kanji">${esc(c[0])}</div>${level}${audio}`;
}

function quizPromptHTML(c, reverse) {
  // Front only for quiz prompt (no flip needed for answering)
  if (!reverse) {
    return `<div class="kanji">${esc(c[0])}</div><div class="hint">Choose the reading</div>`;
  }
  return `<div class="reading">${esc(c[1])}</div><div class="english">${esc(c[2])}</div><div class="hint">Choose the kanji</div>`;
}

function quizRevealHTML(c, reverse) {
  if (!reverse) {
    return `<div class="reading">${esc(c[1])}</div><div class="english">${esc(c[2])}</div>`;
  }
  return `<div class="kanji">${esc(c[0])}</div>`;
}

/* ---------- STUDY ---------- */
function studyCardLevel(c) { return isEverydayVocab(c?.[0]||'', c?.[2]||'') ? 'EVERYDAY' : 'OTHER'; }
function applyStudyLevelFilter() { const s=state.study; const all=Array.isArray(s.allCards)?s.allCards:[]; s.cards=all.filter(c=>studyCardLevel(c)==='EVERYDAY'); s.flips=new Array(s.cards.length).fill(false); }
function setupStudy(ids, shuffle = true) {
  const s = state.study;
  s.wordMode = false;
  s.wordSourceKanji = '';
  s.sets = [...ids];
  const raw = getCards(ids).map(c => {
    const row = Array.isArray(c) ? [...c] : [c];
    while (row.length < 3) row.push('');
    row[3] = wordJlptLevel(row[0], '');
    return row;
  });
  s.allCards = shuffle ? shuffled(raw) : raw;
  s.levelFilter='EVERYDAY';
  applyStudyLevelFilter();
  renderStudy();
}

function setupStudyWords(rows, sourceKanji = '') {
  const s = state.study;
  s.wordMode = true;
  s.wordSourceKanji = sourceKanji || '';
  s.sets = [];
  const clean = (Array.isArray(rows) ? rows : []).filter(r => Array.isArray(r) && r[0]);
  s.allCards = shuffled(clean.map(r => [String(r[0] || ''), String(r[1] || ''), String(r[2] || ''), wordJlptLevel(r[0], sourceKanji)]));
  s.levelFilter='EVERYDAY';
  applyStudyLevelFilter();
  renderStudy();
}

function wordJlptLevel(word, fallbackKanji = '') {
  const chars = [...String(word || '')].filter(isKanjiChar);
  if (!chars.length) return fallbackKanji ? (JLPT_LEVEL_MAP[fallbackKanji] || 'N5') : 'N5';
  const ranks = chars.map(k => ({N5:5,N4:4,N3:3,N2:2,N1:1}[JLPT_LEVEL_MAP[k]] || null)).filter(Boolean);
  if (!ranks.length) return 'N5';
  const hardest = Math.min(...ranks);
  return ['N1','N2','N3','N4','N5'][hardest - 1] || 'N5';
}

function renderStudy() {
  const s = state.study;
  const grid = $('studyGrid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!s.cards.length) {
    grid.innerHTML = '<div class="empty-state">Choose at least one set.</div>';
    return;
  }
  s.cards.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'study-card' + (s.flips[i] ? ' flipped' : '');
    el.innerHTML = `<div class="card-inner">
      <div class="face front">${cardFaceHTML(c, true, s.reverse)}</div>
      <div class="face back">${cardFaceHTML(c, false, s.reverse)}</div>
    </div>`;
    el.onclick = (ev) => {
      const btn = ev.target.closest('[data-speak-ja],[data-speak-en]');
      if (btn) {
        ev.preventDefault();
        ev.stopPropagation();
        if (btn.hasAttribute('data-speak-ja')) speak(btn.getAttribute('data-speak-ja'), 'ja-JP');
        else speak(btn.getAttribute('data-speak-en'), 'en-US');
        return;
      }
      s.flips[i] = !s.flips[i];
      el.classList.toggle('flipped', s.flips[i]);
      updateStudyProgress();
    };
    grid.appendChild(el);
  });
  updateStudyProgress();
  const title = $('studyTitle');
  const subtitle = $('studySubtitle');
  const backBtn = $('studyKanjiBtn');
  if (s.wordMode) {
    if (title) title.textContent = 'Study Words';
    if (subtitle) subtitle.textContent = s.wordSourceKanji ? `Useful vocabulary for ${s.wordSourceKanji} · tap a card to flip.` : 'Useful vocabulary · tap a card to flip.';
    if (backBtn) backBtn.style.display = '';
    $('studySetSummary').textContent = s.wordSourceKanji ? `${s.wordSourceKanji} · ${pathLevelOf(s.wordSourceKanji)}` : 'Vocabulary';
  } else {
    if (title) title.textContent = 'Study';
    if (subtitle) subtitle.textContent = 'Tap a card to flip. Shuffle or reverse anytime.';
    if (backBtn) backBtn.style.display = 'none';
    $('studySetSummary').textContent = setSummary(s.sets);
  }
  const totalAll = (s.allCards && s.allCards.length) ? s.allCards.length : s.cards.length;
  const level = 'Everyday';
  $('studyCount').textContent = totalAll !== s.cards.length
    ? `${s.cards.length} · ${level} / ${totalAll}`
    : `${s.cards.length} everyday cards`;
}

function updateStudyProgress() {
  const s = state.study;
  const n = s.flips.filter(Boolean).length;
  $('studyProgress').textContent = `${n} of ${s.cards.length} flipped`;
}

/* ---------- QUIZ ---------- */
function prepareQuiz(ids) {
  const s = state.quiz;
  clearTimer('quiz');
  s.sets = [...ids];
  s.cards = shuffled(getCards(ids));
  s.i = 0;
  s.score = 0;
  s.answered = false;
  s.results = [];
  s.lastMsg = '';
  s.playing = false;
  showQuizIntro();
}

function updateGameStartButtons() {
  const qReady = !!state.quiz.settingsConfigured && state.quiz.cards.length > 0;
  const btn = $('quizStartBtn');
  const hint = $('quizStartHint');
  if (btn) btn.disabled = !qReady;
  if (hint) hint.textContent = qReady ? '' : 'Open Settings and choose sets first.';
}

function showQuizIntro() {
  const s = state.quiz;
  clearTimer('quiz');
  s.playing = false;
  const intro = $('quizIntro');
  if (intro) intro.classList.remove('hidden');
  closePlayModal('quizPlay');
  const a = $('quizIntroSets'); if (a) a.textContent = setSummary(s.sets);
  const b = $('quizIntroTimer'); if (b) b.textContent = s.timerSeconds ? `${s.timerSeconds}s timer` : 'No timer';
  const c = $('quizIntroCount'); if (c) c.textContent = `${s.cards.length} cards`;
  updateGameStartButtons();
}

function beginQuiz() {
  if (!requireAuth()) return;
  const s = state.quiz;
  if (!s.cards.length) {
    openModal('quiz');
    return;
  }
  s.i = 0;
  s.score = 0;
  s.answered = false;
  s.results = [];
  s.lastMsg = '';
  s.playing = true;
  s.cards = shuffled(s.cards);
  $('quizIntro').classList.add('hidden');
  openPlayModal('quizPlay');
  renderQuiz();
  startTimer('quiz');
}

function renderQuiz() {
  const s = state.quiz;
  const c = s.cards[s.i];
  if (!c) return;
  $('quizFront').innerHTML = quizPromptHTML(c, s.reverse);
  $('quizBack').innerHTML = quizRevealHTML(c, s.reverse);
  $('quizCard').classList.remove('flipped');
  $('quizProgress').textContent = `Card ${s.i + 1} of ${s.cards.length}`;
  $('quizScore').textContent = `Score: ${s.score} / ${s.i + (s.answered ? 1 : 0)}`;
  $('quizFeedback').textContent = s.answered ? s.lastMsg : '';
  $('quizSetSummary').textContent = setSummary(s.sets);
  $('quizTimerSummary').textContent = s.timerSeconds ? `${s.timerSeconds}s timer` : 'No timer';
  const showT = !!s.timerSeconds;
  $('quizTimerBar').classList.toggle('hidden', !showT);
  $('quizTimerText').classList.toggle('hidden', !showT);
  buildQuizChoices();
}

function buildQuizChoices() {
  const s = state.quiz;
  const c = s.cards[s.i];
  if (!c) return;
  const correct = s.reverse ? c[0] : c[1];
  const pool = [...new Set(s.cards.map(x => s.reverse ? x[0] : x[1]).filter(x => x !== correct))];
  const opts = shuffled([correct, ...shuffled(pool).slice(0, 3)]);
  const box = $('quizChoices');
  box.innerHTML = '';
  opts.forEach(opt => {
    const b = document.createElement('button');
    b.className = 'choice';
    b.textContent = opt;
    b.disabled = s.answered;
    b.onclick = () => answerQuiz(b, opt, correct);
    box.appendChild(b);
  });
}

function answerQuiz(btn, opt, correct) {
  const s = state.quiz;
  if (s.answered) return;
  s.answered = true;
  clearTimer('quiz');
  const ok = opt === correct;
  if (ok) {
    s.score++;
    btn.classList.add('correct');
    s.lastMsg = '✓ Correct';
  } else {
    btn.classList.add('wrong');
    s.lastMsg = `✗ Correct: ${correct}`;
    [...$('quizChoices').children].forEach(b => {
      if (b.textContent === correct) b.classList.add('correct');
    });
  }
  s.results.push({
    kanji: s.cards[s.i][0],
    reading: s.cards[s.i][1],
    english: s.cards[s.i][2],
    status: ok ? 'correct' : 'wrong',
    selected: opt,
    correctAnswer: correct
  });
  $('quizCard').classList.add('flipped');
  $('quizScore').textContent = `Score: ${s.score} / ${s.i + 1}`;
  $('quizFeedback').textContent = s.lastMsg;
  setTimeout(() => nextQuiz(), 700);
}

function timeoutQuiz() {
  const s = state.quiz;
  if (s.answered) return;
  clearTimer('quiz');
  const c = s.cards[s.i];
  const correct = s.reverse ? c[0] : c[1];
  s.answered = true;
  s.lastMsg = '⏰ Time’s up';
  s.results.push({
    kanji: c[0], reading: c[1], english: c[2],
    status: 'unanswered', selected: '', correctAnswer: correct
  });
  [...$('quizChoices').children].forEach(b => {
    b.disabled = true;
    if (b.textContent === correct) b.classList.add('correct');
  });
  $('quizCard').classList.add('flipped');
  $('quizFeedback').textContent = s.lastMsg;
  setTimeout(() => nextQuiz(), 900);
}

function nextQuiz() {
  const s = state.quiz;
  if (s.i >= s.cards.length - 1) {
    finishStandardGame('quiz');
    return;
  }
  s.i++;
  s.answered = false;
  s.lastMsg = '';
  renderQuiz();
  startTimer('quiz');
}

/* ---------- GAMES ---------- */
const GAME_META = {
  sprint: { title: 'Kanji Sprint', desc: 'Choose the correct reading as quickly as you can.', seconds: 60, length: 20 },
  match: { title: 'Match Pairs', desc: 'Match each Kanji with its English meaning.', seconds: 0, length: 8 },
  meaning: { title: 'Meaning → Kanji', desc: 'Read the meaning and choose the correct Kanji.', seconds: 0, length: 10 },
  speed: { title: 'Speed Challenge', desc: 'Mixed questions. Answer as many as you can before time runs out.', seconds: 45, length: 30 }
};
let gameSetupType = 'sprint';
let gameSetupSelected = [1];

function openGameSetup(type) {
  if (!requireAuth()) return;
  gameSetupType = type;
  gameSetupSelected = SETS.map(set => set.id);
  const meta = GAME_META[type];
  $('gameConfigTitle').textContent = meta.title;
  $('gameConfigDescription').textContent = meta.desc;
  $('gameLengthConfig').classList.toggle('hidden', type === 'match');

  const defaultTimer = Number(state.games.timerSeconds || meta.seconds || 0);
  document.querySelectorAll('input[name="gameTimer"]').forEach(r => {
    r.checked = Number(r.value) === defaultTimer;
  });
  document.querySelectorAll('input[name="gameLength"]').forEach(r => {
    r.checked = Number(r.value) === (state.games.questionCount || meta.length || 10);
  });

  const firstDirectionConfig = $('gameDirectionFirstConfig');
  if (firstDirectionConfig) firstDirectionConfig.classList.toggle('hidden', type === 'match');
  if (type === 'meaning') {
    $('gameDirectionFirstNormal').textContent = 'Meaning → Kanji';
    $('gameDirectionFirstReverse').textContent = 'Kanji → Meaning';
  } else {
    $('gameDirectionFirstNormal').textContent = 'Kanji → Reading';
    $('gameDirectionFirstReverse').textContent = 'Reading → Kanji';
  }
  document.querySelectorAll('input[name="gameDirectionFirst"]').forEach(r => {
    r.checked = r.value === (state.games.reverse ? 'reverse' : 'normal');
  });

  document.body.classList.add('modal-open');
  $('gameConfigModal').classList.remove('hidden');
}

function closeGameSetup() {
  $('gameSetupModal').classList.add('hidden');
  $('gameConfigModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function openGameSetStep() {
  const timer = document.querySelector('input[name="gameTimer"]:checked');
  const length = document.querySelector('input[name="gameLength"]:checked');
  state.games.timerSeconds = timer ? Number(timer.value) : 0;
  state.games.questionCount = length ? Number(length.value) : (GAME_META[gameSetupType].length || 10);
  const firstDirection = document.querySelector('input[name="gameDirectionFirst"]:checked');
  if (gameSetupType !== 'match' && firstDirection) {
    state.games.reverse = firstDirection.value === 'reverse';
  }

  const meta = GAME_META[gameSetupType];
  $('gameSetupTitle').textContent = meta.title;
  $('gameSetupDescription').textContent = 'Choose your sets.';

  $('gameSetSearch').value = '';
  renderGameSetList();
  $('gameConfigModal').classList.add('hidden');
  $('gameSetupModal').classList.remove('hidden');
  setTimeout(() => { try { $('gameSetSearch').focus(); } catch (_) {} }, 40);
}

function renderGameSetList() {
  const list = $('gameSetList');
  const q = $('gameSetSearch').value.trim().toLowerCase();
  list.innerHTML = '';
  SETS.forEach(set => {
    const hay = [String(set.id), set.kanji, ...(set.cards || []).flatMap(c => c.slice(0,3))].join(' ').toLowerCase();
    if (q && !hay.includes(q)) return;
    const row = document.createElement('label');
    const selected = gameSetupSelected.includes(set.id);
    row.className = 'set-row' + (selected ? ' selected' : '');
    row.innerHTML = `<input type="checkbox" ${selected ? 'checked' : ''} data-game-set="${set.id}"><span><strong>Set ${set.id}</strong> · <span class="kj">${esc(set.kanji)}</span></span><small>${set.cards.length} cards</small>`;
    row.querySelector('input').onchange = e => {
      const id = Number(e.target.dataset.gameSet);
      if (e.target.checked) {
        if (!gameSetupSelected.includes(id)) gameSetupSelected.push(id);
      } else {
        gameSetupSelected = gameSetupSelected.filter(x => x !== id);
      }
      gameSetupSelected = [...new Set(gameSetupSelected)].sort((a,b)=>a-b);
      row.classList.toggle('selected', e.target.checked);
      updateGameSelectionNote();
    };
    list.appendChild(row);
  });
  updateGameSelectionNote();
}

function updateGameSelectionNote() {
  const ids = [...gameSetupSelected].sort((a,b)=>a-b);
  const total = ids.reduce((n,id) => n + (SETS[id-1] ? SETS[id-1].cards.length : 0), 0);
  $('gameSelectionNote').textContent = ids.length ? `${ids.length} set${ids.length>1?'s':''} · ${total} cards available` : 'Select at least one set';
}

function gameLength() {
  return Number(state.games.questionCount || GAME_META[gameSetupType].length || 10);
}

function startSelectedGame() {
  const ids = [...new Set(gameSetupSelected)].sort((a,b)=>a-b);
  if (!ids.length) { alert('Please choose at least one set.'); return; }
  const s = state.games;
  const meta = GAME_META[gameSetupType];
  const direction = document.querySelector('input[name="gameDirectionFirst"]:checked');
  s.type = gameSetupType;
  s.sets = ids;
  s.score = 0;
  s.i = 0;
  s.results = [];
  s.playing = true;
  s.matched = 0;
  s.selectedMatch = null;
  s.matchBoard = null;
  s.reverse = gameSetupType === 'match' ? false : !!(direction && direction.value === 'reverse');
  const cards = shuffled(getCards(ids));
  s.cards = cards.slice(0, gameSetupType === 'match' ? Math.min(8, cards.length) : Math.min(gameLength(), cards.length));
  closeGameSetup();
  const choiceBox = $('gameChoices');
  if (choiceBox) choiceBox.dataset.locked = '0';
  $('gamesMenu').classList.add('hidden');
  openPlayModal('gamesPlay');
  $('gameNameBadge').textContent = meta.title;
  $('gameTimerBadge').textContent = s.timerSeconds ? `${s.timerSeconds}s` : 'No timer';
  $('gamePrompt').classList.toggle('hidden', gameSetupType === 'match');
  $('gameChoices').classList.toggle('hidden', gameSetupType === 'match');
  $('matchGrid').classList.toggle('hidden', gameSetupType !== 'match');
  $('gameTimerBar').classList.toggle('hidden', !s.timerSeconds);
  renderGame();
  if (s.timerSeconds) startGameTimer();
}

function renderGame() {
  const s = state.games;
  if (!s.playing) return;
  $('gameScoreBadge').textContent = `Score: ${s.score}`;
  $('gameProgressBadge').textContent = `${Math.min(s.i + 1, s.cards.length)} / ${s.cards.length}`;
  $('gameFeedback').textContent = '';
  if (s.type === 'match') renderMatchGame();
  else renderChoiceGame();
}

function renderChoiceGame() {
  const s=state.games, c=s.cards[s.i];
  if (!c) return;
  let prompt, correct, pool, hint;
  if (s.type === 'meaning') {
    if (!s.reverse) {
      prompt = `<div class="big-meaning">${esc(c[2])}</div><div class="hint" style="margin-top:8px">Choose the Kanji</div>`;
      correct = c[0]; pool = s.cards.map(x=>x[0]); hint = 'Meaning → Kanji';
    } else {
      prompt = `<div class="big-kanji">${esc(c[0])}</div><div class="hint" style="margin-top:8px">Choose the meaning</div>`;
      correct = c[2]; pool = s.cards.map(x=>x[2]); hint = 'Kanji → Meaning';
    }
  } else {
    if (!s.reverse) {
      prompt = `<div class="big-kanji">${esc(c[0])}</div><div class="hint" style="margin-top:8px">Choose the reading</div>`;
      correct = c[1]; pool = s.cards.map(x=>x[1]); hint = 'Kanji → Reading';
    } else {
      prompt = `<div class="big-reading">${esc(c[1])}</div><div class="hint" style="margin-top:8px">Choose the Kanji</div>`;
      correct = c[0]; pool = s.cards.map(x=>x[0]); hint = 'Reading → Kanji';
    }
  }
  $('gamePrompt').innerHTML = prompt;
  $('gameDirectionBadge').textContent = hint;
  const opts = shuffled([correct, ...shuffled([...new Set(pool.filter(x=>x!==correct))]).slice(0,3)]);
  const box = $('gameChoices'); box.innerHTML = '';
  opts.forEach(opt => {
    const b = document.createElement('button'); b.className='choice'; b.textContent=opt;
    b.onclick=()=>answerGameChoice(opt, correct);
    box.appendChild(b);
  });
}

function answerGameChoice(selected, correct) {
  const s = state.games;
  if (!s.playing) return;
  const c = s.cards[s.i];
  if (!c) return;
  const box = $('gameChoices');
  if (!box || box.dataset.locked === '1') return;
  box.dataset.locked = '1';

  const ok = String(selected) === String(correct);
  if (ok) s.score++;

  // Highlight choices
  Array.from(box.querySelectorAll('.choice')).forEach(btn => {
    const val = btn.textContent;
    if (String(val) === String(correct)) btn.classList.add('correct');
    else if (String(val) === String(selected) && !ok) btn.classList.add('wrong');
    btn.disabled = true;
  });

  $('gameFeedback').textContent = ok ? 'Correct!' : `Wrong · ${correct}`;
  $('gameScoreBadge').textContent = `Score: ${s.score}`;

  // Store result — always include kanji/reading/english for review
  s.results.push({
    kanji: c[0],
    reading: c[1],
    english: c[2],
    selected: selected,
    correctAnswer: correct,
    status: ok ? 'correct' : 'wrong',
  });

  const advance = () => {
    s.i++;
    if (s.i >= s.cards.length) {
      finishGamesMode();
    } else {
      if (box) box.dataset.locked = '0';
      renderGame();
    }
  };
  setTimeout(advance, ok ? 450 : 900);
}

function renderMatchGame() {
  const s = state.games;
  if (!s.matchBoard) {
    // Build pairs: kanji + meaning
    const pairs = s.cards.map((c, idx) => [
      { id: idx, side: 'k', text: c[0], pair: idx },
      { id: idx + 1000, side: 'm', text: c[2], pair: idx },
    ]).flat();
    s.matchBoard = shuffled(pairs).map(p => ({ ...p, revealed: false, matched: false }));
    s.selectedMatch = null;
    s.matched = 0;
  }

  const grid = $('matchGrid');
  grid.innerHTML = '';
  s.matchBoard.forEach((card, index) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'match-card' + (card.matched ? ' matched' : card.revealed ? ' revealed' : '');
    b.textContent = (card.revealed || card.matched) ? card.text : '?';
    b.disabled = !!card.matched;
    b.onclick = () => onMatchTap(index);
    grid.appendChild(b);
  });
  $('gameProgressBadge').textContent = `${s.matched} / ${s.cards.length}`;
  $('gameScoreBadge').textContent = `Score: ${s.score}`;
}

function onMatchTap(index) {
  const s = state.games;
  if (!s.playing || !s.matchBoard) return;
  const card = s.matchBoard[index];
  if (!card || card.matched || card.revealed) return;

  card.revealed = true;
  renderMatchGame();

  if (s.selectedMatch == null) {
    s.selectedMatch = index;
    return;
  }

  const first = s.matchBoard[s.selectedMatch];
  const second = card;
  if (first.pair === second.pair && first.side !== second.side) {
    first.matched = true;
    second.matched = true;
    s.matched++;
    s.score++;
    s.selectedMatch = null;
    $('gameFeedback').textContent = 'Match!';
    renderMatchGame();
    if (s.matched >= s.cards.length) {
      // Mark all as correct results
      s.cards.forEach(c => {
        s.results.push({
          kanji: c[0], reading: c[1], english: c[2],
          selected: c[2], correctAnswer: c[2], status: 'correct'
        });
      });
      setTimeout(() => finishGamesMode(), 500);
    }
  } else {
    $('gameFeedback').textContent = 'Try again';
    const a = s.selectedMatch;
    s.selectedMatch = null;
    setTimeout(() => {
      if (s.matchBoard[a]) s.matchBoard[a].revealed = false;
      if (s.matchBoard[index]) s.matchBoard[index].revealed = false;
      renderMatchGame();
    }, 650);
  }
}

function startGameTimer() {
  const s = state.games;
  if (s.timer) {
    clearInterval(s.timer);
    s.timer = null;
  }
  if (!s.timerSeconds) return;
  s.endAt = Date.now() + s.timerSeconds * 1000;
  const fill = $('gameTimerFill');
  const text = $('gameTimerBadge');
  const bar = $('gameTimerBar');
  if (fill) fill.style.transform = 'scaleX(1)';
  s.timer = setInterval(() => {
    const left = Math.max(0, s.endAt - Date.now());
    const ratio = left / (s.timerSeconds * 1000);
    if (fill) fill.style.transform = `scaleX(${ratio})`;
    if (text) text.textContent = (left / 1000).toFixed(1) + 's';
    if (bar) {
      bar.classList.toggle('warn', ratio < 0.4 && ratio > 0.2);
      bar.classList.toggle('danger', ratio <= 0.2);
    }
    if (left <= 0) {
      clearInterval(s.timer);
      s.timer = null;
      // Mark remaining unanswered
      while (s.i < s.cards.length) {
        const c = s.cards[s.i];
        s.results.push({
          kanji: c[0], reading: c[1], english: c[2],
          selected: '', correctAnswer: s.reverse
            ? (s.type === 'meaning' ? c[2] : c[0])
            : (s.type === 'meaning' ? c[0] : c[1]),
          status: 'unanswered'
        });
        s.i++;
      }
      finishGamesMode();
    }
  }, 40);
}

function finishGamesMode() {
  const s = state.games;
  if (s.timer) {
    clearInterval(s.timer);
    s.timer = null;
  }
  s.playing = false;
  const total = s.results.length || s.cards.length;
  const correct = s.results.filter(r => r.status === 'correct').length;
  const wrong = s.results.filter(r => r.status === 'wrong').length;
  const unanswered = s.results.filter(r => r.status === 'unanswered').length;
  // Pad unanswered if results shorter than cards (e.g. early exit)
  let unansweredFinal = unanswered;
  if (s.results.length < s.cards.length) {
    for (let i = s.results.length; i < s.cards.length; i++) {
      const c = s.cards[i];
      s.results.push({
        kanji: c[0], reading: c[1], english: c[2],
        selected: '', correctAnswer: '', status: 'unanswered'
      });
      unansweredFinal++;
    }
  }
  const entry = {
    game: s.type,
    sets: [...s.sets],
    timer: s.timerSeconds,
    reverse: !!s.reverse,
    total: s.cards.length,
    correct,
    wrong,
    unanswered: unansweredFinal,
    date: new Date().toISOString(),
    mistakes: s.results.filter(r => r.status !== 'correct').map(r => ({ ...r }))
  };
  closePlayModal('gamesPlay');
  $('gamesMenu').classList.remove('hidden');
  saveHistory(entry);
  showResult(entry);
}

/* ---------- TIMER ---------- */
function clearTimer(key) {
  const s = state[key];
  if (!s) return;
  if (s.timer) {
    clearInterval(s.timer);
    s.timer = null;
  }
  if (key === 'quiz') {
    const fill = $('quizTimerFill');
    const text = $('quizTimerText');
    const bar = $('quizTimerBar');
    if (fill) fill.style.transform = 'scaleX(1)';
    if (text) text.textContent = s.timerSeconds ? `${s.timerSeconds}.0s` : '—';
    if (bar) bar.classList.remove('warn', 'danger');
  }
}

function startTimer(key) {
  const s = state[key];
  if (!s) return;
  clearTimer(key);
  if (!s.timerSeconds) return;
  s.endAt = Date.now() + s.timerSeconds * 1000;
  if (key !== 'quiz') return;
  const fill = $('quizTimerFill');
  const text = $('quizTimerText');
  const bar = $('quizTimerBar');
  s.timer = setInterval(() => {
    const left = Math.max(0, s.endAt - Date.now());
    const ratio = left / (s.timerSeconds * 1000);
    if (fill) fill.style.transform = `scaleX(${ratio})`;
    if (text) text.textContent = (left / 1000).toFixed(1) + 's';
    if (bar) {
      bar.classList.toggle('warn', ratio < 0.4 && ratio > 0.2);
      bar.classList.toggle('danger', ratio <= 0.2);
    }
    if (left <= 0) {
      clearTimer(key);
      timeoutQuiz();
    }
  }, 40);
}

/* ---------- FINISH / HISTORY ---------- */
function finishStandardGame(key) {
  const s = state[key];
  clearTimer(key);
  s.playing = false;
  const total = s.cards.length;
  const correct = s.results.filter(r => r.status === 'correct').length;
  const wrong = s.results.filter(r => r.status === 'wrong').length;
  const unanswered = s.results.filter(r => r.status === 'unanswered').length;
  const entry = {
    game: key,
    sets: [...s.sets],
    timer: s.timerSeconds,
    reverse: !!s.reverse,
    total, correct, wrong, unanswered,
    date: new Date().toISOString(),
    mistakes: s.results.filter(r => r.status !== 'correct').map(r => ({ ...r }))
  };
  saveHistory(entry);
  showResult(entry);
}

function saveHistory(entry) {
  // local backup
  try {
    const h = loadHistory();
    h.unshift(entry);
    localStorage.setItem(getUserStorageKey('kanjiGameHistory'), JSON.stringify(h.slice(0, 80)));
  } catch (_) {}
  apiPostGame(entry).then(() => renderHistory()).catch(err => {
    console.warn(err);
    renderHistory();
  });
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(getUserStorageKey('kanjiGameHistory')) || '[]'); }
  catch { return []; }
}

function renderGameHistoryItems(h) {
  const list = $('historyList');
  historyEntries = Array.isArray(h) ? h : [];
  $('historyCount').textContent = `${historyEntries.length} game${historyEntries.length === 1 ? '' : 's'}`;
  if (!historyEntries.length) {
    list.innerHTML = '<div class="empty-state">No games yet. Play Quiz or Games!</div>';
    return;
  }
  list.innerHTML = historyEntries.map((x, index) => {
    const gameKey = x.game || x.game_type;
    const gameNames = { quiz: 'Quiz', sprint: 'Kanji Sprint', match: 'Match Pairs', meaning: 'Meaning → Kanji', speed: 'Speed Challenge' };
    let name = gameNames[gameKey] || 'Game';
    if (gameKey === 'meaning' && x.reverse) name = 'Kanji → Meaning';
    else if (gameKey === 'sprint' && x.reverse) name = 'Reading → Kanji';
    else if (gameKey === 'speed' && x.reverse) name = 'Speed (Reverse)';
    const date = new Date(x.date || x.created_at).toLocaleString();
    const timer = x.timer ? `${x.timer}s timer` : 'No timer';
    const setsArr = Array.isArray(x.sets) ? x.sets : [];
    const sets = setsArr.length === 1
      ? `Set ${setsArr[0]} (${SETS[setsArr[0] - 1] ? SETS[setsArr[0] - 1].kanji : '?'})`
      : setSummary(setsArr.length ? setsArr : [0]) + (setsArr.length <= 6 && setsArr.length ? `: ${setsArr.join(', ')}` : '');
    const pct = x.total ? Math.round((x.correct / x.total) * 100) : 0;
    const nick = x.full_name ? esc(x.full_name) : '—';
    const mistakes = Array.isArray(x.mistakes) ? x.mistakes.length : 0;
    const dirLabel = gameKey === 'meaning'
      ? (x.reverse ? 'Kanji → Meaning' : 'Meaning → Kanji')
      : (x.reverse ? 'Reverse' : 'Normal');
    return `<div class="history-item" data-history-index="${index}" role="button" tabindex="0" aria-label="Open ${name} result details">
      <div class="history-head"><span>${name} · <em>${nick}</em></span><span>${date}</span></div>
      <div class="history-meta">${esc(sets)} · ${timer} · ${dirLabel} · ${x.total} cards</div>
      <div class="history-score">Score: ${x.correct}/${x.total} (${pct}%) · Mistakes: ${x.wrong} · Unanswered: ${x.unanswered}</div>
      <div class="history-tap-hint">Tap or click to view answers and corrections${mistakes ? ` · ${mistakes} to review` : ''}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-history-index]').forEach(item => {
    const open = () => {
      const index = Number(item.dataset.historyIndex);
      if (historyEntries[index]) showHistoryDetails(historyEntries[index]);
    };
    item.addEventListener('click', open);
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  });
}

function normalizeMistakes(entry) {
  if (Array.isArray(entry.mistakes)) return entry.mistakes;
  if (typeof entry.mistakes === 'string') {
    try {
      const parsed = JSON.parse(entry.mistakes);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {}
  }
  return [];
}

function showHistoryDetails(entry) {
  const gameKey = entry.game || entry.game_type;
  const gameNames = { quiz:'Quiz', sprint:'Kanji Sprint', match:'Match Pairs', meaning:'Meaning → Kanji', speed:'Speed Challenge' };
  const gameName = gameNames[gameKey] || 'Game';
  const pct = entry.total ? Math.round((Number(entry.correct || 0) / Number(entry.total || 0)) * 100) : 0;
  const mistakes = normalizeMistakes(entry);
  const date = new Date(entry.date || entry.created_at);
  const setsArr = Array.isArray(entry.sets) ? entry.sets : [];
  const setText = setsArr.length === 1
    ? `Set ${setsArr[0]} — ${SETS[setsArr[0] - 1] ? SETS[setsArr[0] - 1].kanji : '?'}`
    : setSummary(setsArr.length ? setsArr : [0]);

  $('historyDetailTitle').textContent = gameName + ' details';
  $('historyDetailDate').textContent = isNaN(date.getTime()) ? '' : date.toLocaleString();
  $('historyDetailSummary').innerHTML =
    `<strong>Score: ${Number(entry.correct || 0)} / ${Number(entry.total || 0)} (${pct}%)</strong><br>` +
    `Sets: ${esc(setText)}<br>` +
    `Settings: ${entry.timer ? entry.timer + 's timer' : 'No timer'} · ${entry.reverse ? 'Reverse' : 'Normal'}`;

  $('historyDetailStats').innerHTML = `
    <div class="result-stat"><strong>${Number(entry.correct || 0)}</strong><span>Right</span></div>
    <div class="result-stat"><strong>${Number(entry.wrong || 0)}</strong><span>Mistakes</span></div>
    <div class="result-stat"><strong>${Number(entry.unanswered || 0)}</strong><span>Unanswered</span></div>`;

  if (!mistakes.length) {
    $('historyDetailAnswers').innerHTML = '<h3>Review</h3><p style="text-align:center;color:#94a3b8">Perfect! No mistakes or unanswered cards.</p>';
  } else {
    $('historyDetailAnswers').innerHTML = '<h3>Mistakes & unanswered</h3>' + mistakes.map((m) => {
      const kanji = esc(m.kanji || '—');
      const reading = esc(m.reading || '—');
      const english = esc(m.english || '—');
      const unanswered = m.status === 'unanswered';
      const selected = unanswered ? 'No answer' : (m.selected || '—');
      const correct = m.correctAnswer || '—';
      return `<div class="history-detail-item">
        <div class="hd-kanji">${kanji}</div>
        <div class="hd-reading">${reading}</div>
        <div class="hd-line">Meaning: ${english}</div>
        <div class="hd-line ${unanswered ? 'hd-wrong' : ''}">${unanswered ? '⏰ No answer' : `Your answer: ${esc(selected)}`}</div>
        <div class="hd-line hd-correct">Correct answer: ${esc(correct)}</div>
      </div>`;
    }).join('');
  }

  document.body.classList.add('modal-open');
  $('historyDetailModal').classList.remove('hidden');
}

function renderHistory() {
  renderPracticeHistory();
  apiGetHistory('games').then(data => {
    const games = (data.games || []).map(g => ({
      ...g,
      game: g.game_type,
      date: g.created_at,
      mistakes: normalizeMistakes(g)
    }));
    renderGameHistoryItems(games);
  }).catch(() => {
    renderGameHistoryItems(loadHistory().map(g => ({ ...g, mistakes: normalizeMistakes(g) })));
  });
}

function showResult(entry) {
  const pct = entry.total ? Math.round((entry.correct / entry.total) * 100) : 0;
  const resultNames = { quiz: 'Quiz', sprint: 'Kanji Sprint', match: 'Match Pairs', meaning: 'Meaning → Kanji', speed: 'Speed Challenge' };
  const resultName = resultNames[entry.game] || 'Game';
  $('resultTitle').textContent = resultName + ' complete!';
  $('resultDate').textContent = new Date(entry.date).toLocaleString();
  const setText = entry.sets.length === 1
    ? `Set ${entry.sets[0]} — ${SETS[entry.sets[0] - 1].kanji}`
    : setSummary(entry.sets) + (entry.sets.length <= 8 ? ` (${entry.sets.join(', ')})` : '');
  $('resultSummary').innerHTML =
    `<strong>Score: ${entry.correct} / ${entry.total}</strong> (${pct}%)<br>` +
    `Sets: ${esc(setText)}<br>` +
    `Settings: ${entry.timer ? entry.timer + 's timer' : 'No timer'} · ${entry.reverse ? 'Reverse' : 'Normal'}`;
  $('resultStats').innerHTML = `
    <div class="result-stat"><strong>${entry.correct}</strong><span>Right</span></div>
    <div class="result-stat"><strong>${entry.wrong}</strong><span>Mistakes</span></div>
    <div class="result-stat"><strong>${entry.unanswered}</strong><span>Unanswered</span></div>`;
  const bad = entry.mistakes || [];
  $('mistakesSection').innerHTML = bad.length
    ? `<h3>Review</h3>${bad.map(m => `
      <div class="mistake-item">
        <div class="m-kanji">${esc(m.kanji)}</div>
        <div class="m-reading">${esc(m.reading)}</div>
        <div class="m-answer">${m.status === 'unanswered'
          ? 'Not answered'
          : `You: ${esc(m.selected)} · Correct: ${esc(m.correctAnswer)}`} · ${esc(m.english)}</div>
      </div>`).join('')}`
    : '<h3>Perfect!</h3><p style="text-align:center;color:#94a3b8">No mistakes.</p>';
  document.body.classList.add('modal-open');
  $('resultModal').classList.remove('hidden');
}

/* ---------- MODAL ---------- */
function openModal(target) {
  modalTarget = target;
  modalSelected = [...(state[target] && state[target].sets ? state[target].sets : [1])];
  $('modalTitle').textContent =
    target === 'study' ? 'Study sets' :
    target === 'practice' ? 'Practice sets' :
    target === 'words' ? 'Word practice sets' :
    target === 'quiz' ? 'Quiz settings' : 'Settings';
  $('modalText').textContent =
    target === 'study' ? 'Choose sets to study.' :
    target === 'practice' ? 'Choose sets for single-kanji writing.' :
    target === 'words' ? 'Choose sets — only multi-kanji words will appear.' :
    'Pick sets and timer, then Start.';
  $('timerConfig').classList.toggle('hidden', target === 'study' || target === 'practice' || target === 'words');
  document.querySelectorAll('input[name="modalTimer"]').forEach(r => {
    r.checked = Number(r.value) === Number((state[target] && state[target].timerSeconds) || 0);
  });
  $('setSearch').value = '';
  renderSetList();
  document.body.classList.add('modal-open');
  $('setModal').classList.remove('hidden');
  setTimeout(() => { try { $('setSearch').focus(); } catch (_) {} }, 40);
}

function renderSetList() {
  const q = ($('setSearch').value || '').trim().toLowerCase();
  const list = $('modalSetList');
  list.innerHTML = '';
  const filtered = SETS.filter(set => {
    if (!q) return true;
    const hay = [String(set.id), set.kanji, ...set.cards.flat()].join(' ').toLowerCase();
    return hay.includes(q);
  });
  if (!filtered.length) {
    list.innerHTML = '<div class="set-empty">No sets match.</div>';
    updateNote();
    return;
  }
  filtered.forEach(set => {
    const row = document.createElement('label');
    row.className = 'set-row' + (modalSelected.includes(set.id) ? ' selected' : '');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = modalSelected.includes(set.id);
    input.onchange = () => {
      if (input.checked) {
        if (!modalSelected.includes(set.id)) modalSelected.push(set.id);
      } else {
        modalSelected = modalSelected.filter(id => id !== set.id);
      }
      row.classList.toggle('selected', input.checked);
      updateNote();
    };
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `
      <div class="title"><strong>Set ${set.id}</strong><span class="kj">${esc(set.kanji)}</span></div>
      <div class="meta">${set.cards.length} cards · ${set.cards.slice(0, 4).map(c => c[0]).join(' · ')}${set.cards.length > 4 ? '…' : ''}</div>`;
    row.appendChild(input);
    row.appendChild(info);
    list.appendChild(row);
  });
  updateNote();
}

function updateNote() {
  const ids = [...modalSelected].sort((a, b) => a - b);
  const total = ids.reduce((n, id) => n + (SETS[id - 1] ? SETS[id - 1].cards.length : 0), 0);
  const note = $('selectionNote');
  if (!note) return;
  note.textContent = ids.length
    ? `${ids.length} set${ids.length > 1 ? 's' : ''} · ${total} cards`
    : 'Select at least one set';
}

/* ---------- THEME ---------- */
(function initTheme() {
  const saved = localStorage.getItem('kanjiTheme') || 'light';
  document.documentElement.dataset.theme = saved;
  const btn = $('themeToggle');
  if (!btn) return;
  const update = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    btn.textContent = dark ? '☀ Light' : '☾ Dark';
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  };
  update();
  btn.onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('kanjiTheme', next);
    update();
  };
})();

(function setupModalViewport() {
  const apply = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    const h = Math.max(320, Math.floor(vv.height));
    document.documentElement.style.setProperty('--visual-vh', h + 'px');
    ['gameConfigModal', 'gameSetupModal'].forEach(id => {
      const modal = $(id)?.querySelector('.modal');
      if (modal) modal.style.maxHeight = Math.min(h * 0.94, 900) + 'px';
    });
  };
  apply();
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', apply);
    window.visualViewport.addEventListener('scroll', apply);
  }
  window.addEventListener('resize', apply);
})();

/* ---------- NAV ---------- */

/* ---------- MNEMONIC PATH + SRS ---------- */
// Radical-first teaching data (common building blocks)
const RADICALS = {
  "一": { meaning: "one / horizontal", story: "A single horizontal stroke." },
  "丨": { meaning: "line / stick", story: "A vertical line." },
  "丶": { meaning: "dot", story: "A small drop or point." },
  "丿": { meaning: "slash", story: "A diagonal slash." },
  "乙": { meaning: "second / hook", story: "A bent hook shape." },
  "亅": { meaning: "hook", story: "A vertical with a hook." },
  "二": { meaning: "two", story: "Two parallel lines." },
  "人": { meaning: "person", story: "A person standing with two legs." },
  "亻": { meaning: "person (left)", story: "The person radical on the left side." },
  "入": { meaning: "enter", story: "A person stepping in." },
  "八": { meaning: "eight / divide", story: "Two lines opening apart." },
  "冂": { meaning: "upside-down box", story: "An open box from above." },
  "冖": { meaning: "cover / crown", story: "A roof or cover." },
  "冫": { meaning: "ice", story: "Two dots of ice." },
  "几": { meaning: "table", story: "A small table shape." },
  "凵": { meaning: "open box", story: "An open container." },
  "刀": { meaning: "sword / knife", story: "A curved blade." },
  "刂": { meaning: "knife (right)", story: "The knife radical on the right." },
  "力": { meaning: "power / strength", story: "A strong arm or plough." },
  "勹": { meaning: "wrap", story: "Something wrapping around." },
  "匕": { meaning: "spoon / sitting person", story: "A person sitting or a spoon." },
  "匚": { meaning: "box on side", story: "A sideways open box." },
  "匸": { meaning: "hiding enclosure", story: "Something hidden inside." },
  "十": { meaning: "ten / cross", story: "A complete cross." },
  "卜": { meaning: "divination", story: "A rod used for fortune-telling." },
  "卩": { meaning: "seal / kneeling", story: "A person kneeling." },
  "厂": { meaning: "cliff", story: "A steep cliff face." },
  "厶": { meaning: "private", story: "A private enclosure." },
  "又": { meaning: "again / right hand", story: "A right hand reaching." },
  "口": { meaning: "mouth", story: "An open mouth or opening." },
  "囗": { meaning: "enclosure", story: "A full square enclosure." },
  "土": { meaning: "earth / soil", story: "A plant growing from the ground." },
  "士": { meaning: "scholar / samurai", story: "A person of status." },
  "夂": { meaning: "go / winter", story: "A foot stepping forward." },
  "夕": { meaning: "evening", story: "The moon at dusk." },
  "大": { meaning: "big", story: "A person with arms outstretched — big!" },
  "女": { meaning: "woman", story: "A kneeling woman figure." },
  "子": { meaning: "child", story: "A child with arms up." },
  "宀": { meaning: "roof / house", story: "A roof over a building." },
  "寸": { meaning: "inch / measure", story: "A hand measuring a short length." },
  "小": { meaning: "small", story: "Something tiny, three strokes." },
  "尢": { meaning: "lame / bent legs", story: "Bent or weak legs." },
  "尸": { meaning: "corpse / flag", story: "A body or hanging flag." },
  "屮": { meaning: "sprout", story: "A plant sprouting." },
  "山": { meaning: "mountain", story: "Three peaks of a mountain." },
  "巛": { meaning: "river", story: "Flowing water lines." },
  "川": { meaning: "river", story: "Three streams of a river." },
  "工": { meaning: "work / craft", story: "A tool or workbench." },
  "己": { meaning: "oneself", story: "A self-coiled shape." },
  "巾": { meaning: "cloth", story: "A piece of hanging cloth." },
  "干": { meaning: "dry / shield", story: "A drying rack or shield." },
  "幺": { meaning: "short thread", story: "A tiny twisted thread." },
  "广": { meaning: "dotted cliff / building", story: "A building on a cliff." },
  "廴": { meaning: "long stride", story: "A long step forward." },
  "廾": { meaning: "two hands", story: "Two hands together." },
  "弋": { meaning: "arrow / stake", story: "A stake or shooting arrow." },
  "弓": { meaning: "bow", story: "A curved bow." },
  "彐": { meaning: "snout / hand", story: "A hand or animal snout." },
  "彡": { meaning: "bristle / hair", story: "Three hair-like strokes." },
  "彳": { meaning: "step / go", story: "A person taking a step." },
  "心": { meaning: "heart", story: "The heart with a beat." },
  "忄": { meaning: "heart (left)", story: "Heart radical on the left." },
  "戈": { meaning: "spear", story: "A long spear." },
  "戸": { meaning: "door", story: "A single door panel." },
  "手": { meaning: "hand", story: "An open hand." },
  "扌": { meaning: "hand (left)", story: "Hand radical on the left." },
  "支": { meaning: "branch / support", story: "A supporting branch." },
  "攵": { meaning: "strike / taskmaster", story: "A hand holding a stick." },
  "文": { meaning: "writing / culture", story: "Crossed strokes of writing." },
  "斗": { meaning: "dipper / measure", story: "A measuring dipper." },
  "斤": { meaning: "axe", story: "An axe head." },
  "方": { meaning: "direction / side", story: "A flag pointing a way." },
  "无": { meaning: "nothing", story: "Emptiness." },
  "日": { meaning: "sun / day", story: "The sun with a ray." },
  "曰": { meaning: "say", story: "A mouth speaking." },
  "月": { meaning: "moon / month / flesh", story: "A crescent moon (also used for body)." },
  "木": { meaning: "tree / wood", story: "A tree with branches and roots." },
  "欠": { meaning: "yawn / lack", story: "A person yawning — lacking air." },
  "止": { meaning: "stop", story: "A foot stopping." },
  "歹": { meaning: "death / bone", story: "Remains or death." },
  "殳": { meaning: "weapon / lance", story: "A striking weapon." },
  "毋": { meaning: "do not / mother", story: "A forbidding shape." },
  "比": { meaning: "compare", story: "Two people side by side." },
  "毛": { meaning: "hair / fur", story: "Hair strands." },
  "氏": { meaning: "clan / family name", story: "A family marker." },
  "气": { meaning: "steam / spirit", story: "Rising vapor." },
  "水": { meaning: "water", story: "Flowing water." },
  "氵": { meaning: "water (left)", story: "Three drops of water on the left." },
  "火": { meaning: "fire", story: "Flames rising." },
  "灬": { meaning: "fire (bottom)", story: "Four dots of fire underneath." },
  "爪": { meaning: "claw", story: "An animal claw." },
  "父": { meaning: "father", story: "A father figure with a stick." },
  "爻": { meaning: "intertwine", story: "Crossed lines." },
  "爿": { meaning: "split wood", story: "A piece of wood on its side." },
  "片": { meaning: "slice / one side", story: "A thin slice." },
  "牙": { meaning: "fang / tooth", story: "A sharp tooth." },
  "牛": { meaning: "cow", story: "A cow with horns." },
  "犬": { meaning: "dog", story: "A dog with a mark." },
  "犭": { meaning: "dog / animal (left)", story: "Animal radical on the left." },
  "玄": { meaning: "dark / mysterious", story: "A dark thread." },
  "玉": { meaning: "jade / ball", story: "A precious jewel." },
  "王": { meaning: "king", story: "A king with three levels." },
  "瓜": { meaning: "melon", story: "A hanging melon." },
  "瓦": { meaning: "tile", story: "A roof tile." },
  "甘": { meaning: "sweet", story: "Something held in the mouth — sweet." },
  "生": { meaning: "life / birth", story: "A plant growing from earth." },
  "用": { meaning: "use", story: "Something useful / a tool." },
  "田": { meaning: "rice field", story: "A divided rice paddy." },
  "疋": { meaning: "bolt of cloth", story: "A roll of cloth." },
  "疒": { meaning: "sickness", story: "A person lying sick under a roof." },
  "癶": { meaning: "footsteps", story: "Two feet stepping." },
  "白": { meaning: "white", story: "The sun with a ray — white light." },
  "皮": { meaning: "skin", story: "An animal hide." },
  "皿": { meaning: "dish / plate", story: "A flat dish." },
  "目": { meaning: "eye", story: "An eye shape." },
  "矛": { meaning: "halberd", story: "A long spear weapon." },
  "矢": { meaning: "arrow", story: "An arrow ready to fly." },
  "石": { meaning: "stone", story: "A rock under a cliff." },
  "示": { meaning: "show / altar", story: "An altar with offerings." },
  "礻": { meaning: "spirit / show (left)", story: "Altar radical on the left." },
  "禾": { meaning: "grain / rice plant", story: "A stalk of grain." },
  "穴": { meaning: "hole / cave", story: "A hole under a roof." },
  "立": { meaning: "stand", story: "A person standing upright." },
  "竹": { meaning: "bamboo", story: "Bamboo stalks." },
  "米": { meaning: "rice", story: "Grains of rice." },
  "糸": { meaning: "thread", story: "Twisted threads." },
  "缶": { meaning: "can / jar", story: "A pottery jar." },
  "网": { meaning: "net", story: "A fishing net." },
  "羊": { meaning: "sheep", story: "A sheep with horns." },
  "羽": { meaning: "feather / wing", story: "Two wings or feathers." },
  "老": { meaning: "old", story: "An old person with a cane." },
  "而": { meaning: "and / yet", story: "A beard or hanging shape." },
  "耒": { meaning: "plow", story: "A farming plow." },
  "耳": { meaning: "ear", story: "An ear shape." },
  "聿": { meaning: "brush / writing", story: "A writing brush." },
  "肉": { meaning: "meat / flesh", story: "Meat inside." },
  "臣": { meaning: "retainer / official", story: "A loyal servant." },
  "自": { meaning: "self", story: "A nose pointing to oneself." },
  "至": { meaning: "arrive", story: "Arriving at a destination." },
  "臼": { meaning: "mortar", story: "A grinding mortar." },
  "舌": { meaning: "tongue", story: "A tongue coming from a mouth." },
  "舟": { meaning: "boat", story: "A small boat." },
  "艮": { meaning: "stopping / good", story: "A stopping shape." },
  "色": { meaning: "color", story: "Color or appearance." },
  "艸": { meaning: "grass", story: "Grass or plants." },
  "艹": { meaning: "grass (top)", story: "Grass radical on top." },
  "虍": { meaning: "tiger", story: "A tiger head." },
  "虫": { meaning: "insect", story: "A small insect." },
  "血": { meaning: "blood", story: "Blood in a dish." },
  "行": { meaning: "go / walk", story: "A crossroads — going." },
  "衣": { meaning: "clothing", story: "A garment." },
  "衤": { meaning: "clothing (left)", story: "Clothing radical on the left." },
  "西": { meaning: "west", story: "A bird in a nest — west." },
  "見": { meaning: "see", story: "An eye on legs — seeing." },
  "角": { meaning: "horn / angle", story: "An animal horn." },
  "言": { meaning: "speech / words", story: "Words coming from a mouth." },
  "訁": { meaning: "speech (left)", story: "Speech radical on the left." },
  "谷": { meaning: "valley", story: "A valley between mountains." },
  "豆": { meaning: "bean", story: "A bean or altar." },
  "豕": { meaning: "pig", story: "A pig shape." },
  "豸": { meaning: "badger / beast", story: "A crawling beast." },
  "貝": { meaning: "shell / money", story: "A cowrie shell (ancient money)." },
  "赤": { meaning: "red", story: "Red earth or fire." },
  "走": { meaning: "run", story: "A person running." },
  "足": { meaning: "foot / enough", story: "A foot and leg." },
  "身": { meaning: "body", story: "A body shape." },
  "車": { meaning: "vehicle / car", story: "A cart with wheels." },
  "辛": { meaning: "spicy / hard", story: "A sharp or bitter taste." },
  "辰": { meaning: "dragon / zodiac", story: "A dragon or time marker." },
  "辵": { meaning: "walk / road", story: "Walking along a road." },
  "⻌": { meaning: "road (left)", story: "The road radical." },
  "邑": { meaning: "village", story: "A village enclosure." },
  "酉": { meaning: "alcohol / bird", story: "A wine jar." },
  "釆": { meaning: "distinguish", story: "Separating grains." },
  "里": { meaning: "village / mile", story: "A village with fields." },
  "金": { meaning: "gold / metal", story: "Metal under a cover." },
  "長": { meaning: "long / chief", story: "Long hair or a leader." },
  "門": { meaning: "gate", story: "Double doors of a gate." },
  "阜": { meaning: "mound", story: "A hill or mound." },
  "阝": { meaning: "mound / village", story: "Left = mound, right = village." },
  "隶": { meaning: "catch / slave", story: "Catching with a hand." },
  "隹": { meaning: "short-tailed bird", story: "A small bird." },
  "雨": { meaning: "rain", story: "Rain falling from clouds." },
  "青": { meaning: "blue / green", story: "Young plants under the moon — blue-green." },
  "非": { meaning: "not / wrong", story: "Two opposing sides." },
  "面": { meaning: "face / surface", story: "A face or surface." },
  "革": { meaning: "leather", story: "Animal hide." },
  "韋": { meaning: "tanned leather", story: "Processed leather." },
  "韭": { meaning: "leek", story: "A leek plant." },
  "音": { meaning: "sound", story: "Sound rising from a stand." },
  "頁": { meaning: "page / head", story: "A head or page." },
  "風": { meaning: "wind", story: "Insects in the wind." },
  "飛": { meaning: "fly", story: "Wings flying." },
  "食": { meaning: "eat / food", story: "Food under a cover." },
  "首": { meaning: "neck / head", story: "The head and neck." },
  "香": { meaning: "fragrance", story: "Sweet smell of grain under the sun." },
  "馬": { meaning: "horse", story: "A horse with legs and mane." },
  "骨": { meaning: "bone", story: "A bone structure." },
  "高": { meaning: "tall / high", story: "A tall building." },
  "髟": { meaning: "long hair", story: "Long hair flowing." },
  "鬥": { meaning: "fight", story: "Two people fighting." },
  "鬯": { meaning: "sacrificial wine", story: "A special wine." },
  "鬲": { meaning: "cauldron", story: "An ancient cooking pot." },
  "鬼": { meaning: "ghost / demon", story: "A ghostly figure." },
  "魚": { meaning: "fish", story: "A fish with scales." },
  "鳥": { meaning: "bird", story: "A bird with feathers." },
  "鹵": { meaning: "salt", story: "Salt crystals." },
  "鹿": { meaning: "deer", story: "A deer with antlers." },
  "麦": { meaning: "wheat", story: "A wheat plant." },
  "麻": { meaning: "hemp", story: "Hemp plants under a roof." },
  "黄": { meaning: "yellow", story: "Yellow earth or fields." },
  "黍": { meaning: "millet", story: "A millet plant." },
  "黒": { meaning: "black", story: "Black from fire under a window." },
  "黹": { meaning: "embroidery", story: "Needlework." },
  "黽": { meaning: "frog / turtle", story: "A frog or turtle." },
  "鼎": { meaning: "tripod", story: "A three-legged cauldron." },
  "鼓": { meaning: "drum", story: "A drum being struck." },
  "鼠": { meaning: "rat / mouse", story: "A mouse." },
  "鼻": { meaning: "nose", story: "A nose shape." },
  "齊": { meaning: "even / equal", story: "Things lined up evenly." }
};

// Common kanji → radical components (for radical-first display)
const KANJI_COMPONENTS = {
  "山": ["山"],
  "川": ["川"],
  "田": ["田"],
  "日": ["日"],
  "月": ["月"],
  "火": ["火"],
  "水": ["水"],
  "木": ["木"],
  "金": ["金"],
  "土": ["土"],
  "人": ["人"],
  "口": ["口"],
  "女": ["女"],
  "子": ["子"],
  "大": ["大"],
  "小": ["小"],
  "中": ["口", "丨"],
  "上": ["一", "卜"],
  "下": ["一", "卜"],
  "左": ["工", "𠂇"],
  "右": ["口", "𠂇"],
  "見": ["目", "儿"],
  "言": ["言"],
  "手": ["手"],
  "足": ["足"],
  "目": ["目"],
  "耳": ["耳"],
  "心": ["心"],
  "力": ["力"],
  "車": ["車"],
  "門": ["門"],
  "雨": ["雨"],
  "電": ["雨", "田"],
  "語": ["言", "五", "口"],
  "話": ["言", "舌"],
  "読": ["言", "売"],
  "書": ["聿", "日"],
  "時": ["日", "寺"],
  "間": ["門", "日"],
  "聞": ["門", "耳"],
  "問": ["門", "口"],
  "休": ["亻", "木"],
  "体": ["亻", "本"],
  "何": ["亻", "可"],
  "作": ["亻", "乍"],
  "住": ["亻", "主"],
  "使": ["亻", "吏"],
  "借": ["亻", "昔"],
  "働": ["亻", "動"],
  "持": ["扌", "寺"],
  "待": ["彳", "寺"],
  "行": ["行"],
  "来": ["来"],
  "食": ["食"],
  "飲": ["飠", "欠"],
  "買": ["買"],
  "売": ["士", "冖", "儿"],
  "安": ["宀", "女"],
  "家": ["宀", "豕"],
  "室": ["宀", "至"],
  "学": ["⺍", "冖", "子"],
  "校": ["木", "交"],
  "教": ["孝", "攵"],
  "習": ["羽", "白"],
  "国": ["囗", "玉"],
  "外": ["夕", "卜"],
  "名": ["夕", "口"],
  "前": ["䒑", "刖"],
  "後": ["彳", "幺", "夂"],
  "新": ["亲", "斤"],
  "古": ["十", "口"],
  "今": ["今"],
  "明": ["日", "月"],
  "星": ["日", "生"],
  "春": ["春"],
  "秋": ["禾", "火"],
  "冬": ["夂", "冫"],
  "夏": ["頁", "夂"],
  "東": ["木", "日"],
  "西": ["西"],
  "南": ["十", "冂", "丷", "干"],
  "北": ["北"],
  "海": ["氵", "毎"],
  "河": ["氵", "可"],
  "湖": ["氵", "胡"],
  "洋": ["氵", "羊"],
  "島": ["鳥", "山"],
  "岩": ["山", "石"],
  "石": ["石"],
  "花": ["艹", "化"],
  "草": ["艹", "早"],
  "茶": ["艹", "余"],
  "森": ["木", "木", "木"],
  "林": ["木", "木"],
  "村": ["木", "寸"],
  "町": ["田", "丁"],
  "道": ["⻌", "首"],
  "通": ["⻌", "甬"],
  "近": ["⻌", "斤"],
  "遠": ["⻌", "袁"],
  "運": ["⻌", "軍"],
  "開": ["門", "开"],
  "閉": ["門", "才"],
  "聞": ["門", "耳"],
  "空": ["穴", "工"],
  "立": ["立"],
  "早": ["日", "十"],
  "朝": ["朝"],
  "夜": ["亠", "夕", "夂"],
  "午": ["十", "干"],
  "半": ["半"],
  "分": ["八", "刀"],
  "切": ["七", "刀"],
  "別": ["另", "刂"],
  "医": ["匚", "矢"],
  "薬": ["艹", "楽"],
  "病": ["疒", "丙"],
  "痛": ["疒", "甬"],
  "熱": ["埶", "灬"],
  "冷": ["冫", "令"],
  "友": ["𠂇", "又"],
  "父": ["父"],
  "母": ["母"],
  "兄": ["口", "儿"],
  "弟": ["弟"],
  "姉": ["女", "市"],
  "妹": ["女", "未"],
  "私": ["禾", "厶"],
  "自": ["自"],
  "身": ["身"],
  "心": ["心"],
  "思": ["田", "心"],
  "考": ["老", "丂"],
  "知": ["矢", "口"],
  "意": ["音", "心"],
  "感": ["咸", "心"],
  "愛": ["愛"],
  "楽": ["楽"],
  "好": ["女", "子"],
  "悪": ["亜", "心"],
  "多": ["夕", "夕"],
  "少": ["小", "丿"],
  "長": ["長"],
  "短": ["矢", "豆"],
  "高": ["高"],
  "低": ["亻", "氐"],
  "広": ["广", "ム"],
  "狭": ["犭", "夹"],
  "太": ["大", "丶"],
  "細": ["糸", "田"],
  "強": ["弓", "虽"],
  "弱": ["弓", "冫", "弓", "冫"],
  "重": ["重"],
  "軽": ["車", "圣"],
  "速": ["⻌", "束"],
  "遅": ["⻌", "犀"],
  "早": ["日", "十"],
  "遅": ["⻌", "犀"]
};

const PATH_MEMORY={
"一":{story:"A single horizontal line — the simplest unit.",hook:"一 = one.",vocab:[["一","いち","one"],["一つ","ひとつ","one"],["一人","ひとり","one person"]]},
"二":{story:"Two parallel lines stacked.",hook:"二 = two.",vocab:[["二","に","two"],["二つ","ふたつ","two"],["二人","ふたり","two people"]]},
"三":{story:"Three horizontal lines.",hook:"三 = three.",vocab:[["三","さん","three"],["三つ","みっつ","three"]]},
"四":{story:"A box with legs — four sides.",hook:"四 = four.",vocab:[["四","よん","four"],["四つ","よっつ","four"]]},
"五":{story:"An open hand — five.",hook:"五 = five.",vocab:[["五","ご","five"],["五つ","いつつ","five"]]},
"六":{story:"A lid over a figure — six.",hook:"六 = six.",vocab:[["六","ろく","six"],["六つ","むっつ","six"]]},
"七":{story:"A crossed stroke — seven.",hook:"七 = seven.",vocab:[["七","なな","seven"],["七つ","ななつ","seven"]]},
"八":{story:"Two lines opening outward.",hook:"八 = eight.",vocab:[["八","はち","eight"],["八つ","やっつ","eight"]]},
"九":{story:"A bent hook almost closing — nine.",hook:"九 = nine.",vocab:[["九","きゅう","nine"],["九つ","ここのつ","nine"]]},
"十":{story:"A perfect cross — ten.",hook:"十 = ten.",vocab:[["十","じゅう","ten"],["十日","とおか","the 10th"]]},
"百":{story:"White under a lid — hundred.",hook:"百 = hundred.",vocab:[["百","ひゃく","hundred"],["百円","ひゃくえん","100 yen"]]},
"千":{story:"Person with top line — thousand.",hook:"千 = thousand.",vocab:[["千","せん","thousand"],["千円","せんえん","1000 yen"]]},
"万":{story:"Spreading plant — ten thousand.",hook:"万 = ten thousand.",vocab:[["万","まん","ten thousand"],["一万","いちまん","10000"]]},
"円":{story:"Round coin — yen.",hook:"円 = yen / circle.",vocab:[["円","えん","yen"],["百円","ひゃくえん","100 yen"]]},
"日":{story:"A bright sun in a square.",hook:"日 = sun / day.",vocab:[["日","ひ","sun/day"],["毎日","まいにち","every day"],["日本","にほん","Japan"]]},
"月":{story:"Curved moon in the night sky.",hook:"月 = moon / month.",vocab:[["月","つき","moon"],["月曜日","げつようび","Monday"]]},
"火":{story:"Flames rising upward.",hook:"火 = fire.",vocab:[["火","ひ","fire"],["火曜日","かようび","Tuesday"],["火山","かざん","volcano"]]},
"水":{story:"Water splashing outward.",hook:"水 = water.",vocab:[["水","みず","water"],["水曜日","すいようび","Wednesday"]]},
"木":{story:"Trunk with branches — tree.",hook:"木 = tree.",vocab:[["木","き","tree"],["木曜日","もくようび","Thursday"]]},
"金":{story:"Gold under a roof — money.",hook:"金 = gold / money.",vocab:[["金","かね","money"],["金曜日","きんようび","Friday"],["お金","おかね","money"]]},
"土":{story:"Ground supporting a plant.",hook:"土 = earth / soil.",vocab:[["土","つち","soil"],["土曜日","どようび","Saturday"]]},
"山":{story:"Three peaks — mountain.",hook:"山 = mountain.",vocab:[["山","やま","mountain"],["富士山","ふじさん","Mt. Fuji"]]},
"川":{story:"Three flowing streams — river.",hook:"川 = river.",vocab:[["川","かわ","river"]]},
"田":{story:"Four plots of a rice field.",hook:"田 = rice field.",vocab:[["田","た","rice field"],["田舎","いなか","countryside"]]},
"人":{story:"Two legs of a person.",hook:"人 = person.",vocab:[["人","ひと","person"],["日本人","にほんじん","Japanese person"]]},
"口":{story:"Open square — mouth.",hook:"口 = mouth.",vocab:[["口","くち","mouth"],["入口","いりぐち","entrance"]]},
"目":{story:"Rectangular eye.",hook:"目 = eye.",vocab:[["目","め","eye"],["目的","もくてき","purpose"]]},
"耳":{story:"Outline of an ear.",hook:"耳 = ear.",vocab:[["耳","みみ","ear"]]},
"手":{story:"Fingers from a palm.",hook:"手 = hand.",vocab:[["手","て","hand"],["手紙","てがみ","letter"]]},
"足":{story:"A foot taking a step.",hook:"足 = foot / leg.",vocab:[["足","あし","foot"],["足りる","たりる","be enough"]]},
"男":{story:"Field + power — man.",hook:"男 = man.",vocab:[["男","おとこ","man"],["男の子","おとこのこ","boy"]]},
"女":{story:"Graceful figure — woman.",hook:"女 = woman.",vocab:[["女","おんな","woman"],["女の子","おんなのこ","girl"]]},
"子":{story:"Small child with arms out.",hook:"子 = child.",vocab:[["子","こ","child"],["子ども","こども","child"]]},
"父":{story:"Axe shape — father.",hook:"父 = father.",vocab:[["父","ちち","father"],["お父さん","おとうさん","father"]]},
"母":{story:"Mother holding close.",hook:"母 = mother.",vocab:[["母","はは","mother"],["お母さん","おかあさん","mother"]]},
"友":{story:"Hands meeting — friend.",hook:"友 = friend.",vocab:[["友","とも","friend"],["友達","ともだち","friend"]]},
"雨":{story:"Cloud with four raindrops.",hook:"雨 = rain.",vocab:[["雨","あめ","rain"],["大雨","おおあめ","heavy rain"]]},
"車":{story:"Vehicle with axle.",hook:"車 = car.",vocab:[["車","くるま","car"],["電車","でんしゃ","train"]]},
"門":{story:"Temple gate.",hook:"門 = gate.",vocab:[["門","もん","gate"],["専門","せんもん","specialty"]]},
"学":{story:"Child under roof learning.",hook:"学 = study.",vocab:[["学","がく","study"],["学校","がっこう","school"],["学生","がくせい","student"]]},
"校":{story:"Tree + exchange — school.",hook:"校 = school.",vocab:[["校","こう","school"],["高校","こうこう","high school"]]},
"先":{story:"Person going first.",hook:"先 = previous / ahead.",vocab:[["先","せん","ahead"],["先生","せんせい","teacher"],["先週","せんしゅう","last week"]]},
"生":{story:"Sprout of life.",hook:"生 = life / birth.",vocab:[["生","せい","life"],["学生","がくせい","student"],["生きる","いきる","to live"]]},
"年":{story:"Heavy load of one year.",hook:"年 = year.",vocab:[["年","ねん","year"],["今年","ことし","this year"],["来年","らいねん","next year"]]},
"時":{story:"Sun over temple — time.",hook:"時 = time.",vocab:[["時","じ","time"],["時間","じかん","time"],["時計","とけい","clock"]]},
"間":{story:"Sun in a gate — interval.",hook:"間 = between.",vocab:[["間","あいだ","between"],["時間","じかん","time"],["人間","にんげん","human"]]},
"今":{story:"Present moment under a roof.",hook:"今 = now.",vocab:[["今","いま","now"],["今日","きょう","today"]]},
"何":{story:"Person asking a question.",hook:"何 = what.",vocab:[["何","なに","what"],["何人","なんにん","how many people"]]},
"上":{story:"Stroke rising above a line.",hook:"上 = up.",vocab:[["上","うえ","up"],["上手","じょうず","skillful"]]},
"下":{story:"Stroke hanging below a line.",hook:"下 = down.",vocab:[["下","した","down"],["下さい","ください","please"]]},
"中":{story:"Line through the center of a box.",hook:"中 = middle.",vocab:[["中","なか","middle"],["中国","ちゅうごく","China"]]},
"外":{story:"Outside where evening begins.",hook:"外 = outside.",vocab:[["外","そと","outside"],["外国","がいこく","foreign country"]]},
"前":{story:"Moving forward — front.",hook:"前 = before / front.",vocab:[["前","まえ","before"],["午前","ごぜん","a.m."],["名前","なまえ","name"]]},
"後":{story:"Coming after.",hook:"後 = after / behind.",vocab:[["後","あと","after"],["午後","ごご","p.m."]]},
"右":{story:"Right-hand side.",hook:"右 = right.",vocab:[["右","みぎ","right"],["右手","みぎて","right hand"]]},
"左":{story:"Left-hand side.",hook:"左 = left.",vocab:[["左","ひだり","left"],["左手","ひだりて","left hand"]]},
"東":{story:"Sun rising behind a tree.",hook:"東 = east.",vocab:[["東","ひがし","east"],["東京","とうきょう","Tokyo"]]},
"西":{story:"Where the sun settles.",hook:"西 = west.",vocab:[["西","にし","west"],["西口","にしぐち","west exit"]]},
"南":{story:"Facing the warm direction.",hook:"南 = south.",vocab:[["南","みなみ","south"],["南口","みなみぐち","south exit"]]},
"北":{story:"Facing away from the cold.",hook:"北 = north.",vocab:[["北","きた","north"],["北海道","ほっかいどう","Hokkaido"]]},
"本":{story:"Root of the tree — book / origin.",hook:"本 = book / origin.",vocab:[["本","ほん","book"],["日本","にほん","Japan"]]},
"語":{story:"Words of language.",hook:"語 = language.",vocab:[["語","ご","language"],["日本語","にほんご","Japanese"],["英語","えいご","English"]]},
"話":{story:"Tongue giving words.",hook:"話 = talk.",vocab:[["話","はなし","talk"],["話す","はなす","to speak"]]},
"読":{story:"Reading the meaning of words.",hook:"読 = read.",vocab:[["読","よむ","to read"],["読書","どくしょ","reading"]]},
"書":{story:"Brush writing under daylight.",hook:"書 = write.",vocab:[["書","かく","to write"],["辞書","じしょ","dictionary"]]},
"見":{story:"Eye with legs going out to look.",hook:"見 = see.",vocab:[["見","みる","to see"],["見せる","みせる","to show"]]},
"聞":{story:"Ear in a gate — hear.",hook:"聞 = hear.",vocab:[["聞","きく","to hear"],["新聞","しんぶん","newspaper"]]},
"食":{story:"Covered meal ready to eat.",hook:"食 = eat.",vocab:[["食","たべる","eat"],["食べる","たべる","to eat"],["食事","しょくじ","meal"]]},
"飲":{story:"Filling what is lacking — drink.",hook:"飲 = drink.",vocab:[["飲","のむ","to drink"],["飲み物","のみもの","drink"]]},
"買":{story:"Net over shell money — buy.",hook:"買 = buy.",vocab:[["買","かう","to buy"],["買い物","かいもの","shopping"]]},
"売":{story:"Putting goods on display.",hook:"売 = sell.",vocab:[["売","うる","to sell"]]},
"行":{story:"Steps on a path — go.",hook:"行 = go.",vocab:[["行","いく","go"],["行く","いく","to go"],["銀行","ぎんこう","bank"]]},
"来":{story:"Harvest arriving — come.",hook:"来 = come.",vocab:[["来","くる","to come"],["来る","くる","to come"],["来年","らいねん","next year"]]},
"出":{story:"Pushing outward — exit.",hook:"出 = exit.",vocab:[["出","でる","to exit"],["出口","でぐち","exit"]]},
"入":{story:"Wedge pointing inside — enter.",hook:"入 = enter.",vocab:[["入","はいる","to enter"],["入口","いりぐち","entrance"]]},
"休":{story:"Person resting under a tree.",hook:"休 = rest.",vocab:[["休","やすむ","to rest"],["休み","やすみ","holiday"]]},
"気":{story:"Rising energy / air.",hook:"気 = spirit / air.",vocab:[["気","き","spirit"],["元気","げんき","healthy"],["天気","てんき","weather"]]},
"天":{story:"Sky above everything.",hook:"天 = heaven / sky.",vocab:[["天","てん","heaven"],["天気","てんき","weather"]]},
"電":{story:"Storm energy — electricity.",hook:"電 = electricity.",vocab:[["電","でん","electricity"],["電車","でんしゃ","train"],["電話","でんわ","telephone"]]},
"名":{story:"Name spoken by the mouth.",hook:"名 = name.",vocab:[["名","な","name"],["名前","なまえ","name"],["有名","ゆうめい","famous"]]},
"字":{story:"Child under roof learning characters.",hook:"字 = character.",vocab:[["字","じ","character"],["漢字","かんじ","kanji"]]},
"文":{story:"Pattern of writing.",hook:"文 = writing / culture.",vocab:[["文","ぶん","sentence"],["文化","ぶんか","culture"]]},
"高":{story:"Tall building — high / expensive.",hook:"高 = high.",vocab:[["高","たかい","high"],["高校","こうこう","high school"]]},
"安":{story:"Woman under roof — cheap / safe.",hook:"安 = cheap / safe.",vocab:[["安","やすい","cheap"],["安全","あんぜん","safety"]]},
"新":{story:"Freshly cut — new.",hook:"新 = new.",vocab:[["新","あたらしい","new"],["新聞","しんぶん","newspaper"]]},
"古":{story:"Spoken for ten generations — old.",hook:"古 = old.",vocab:[["古","ふるい","old"]]},
"長":{story:"Long path or hair — long / leader.",hook:"長 = long.",vocab:[["長","ながい","long"],["社長","しゃちょう","president"]]},
"多":{story:"Two evenings — many.",hook:"多 = many.",vocab:[["多","おおい","many"]]},
"少":{story:"Tiny amount — few.",hook:"少 = few.",vocab:[["少","すこし","a little"],["少し","すこし","a little"]]},
"大":{story:"Person stretched wide — big.",hook:"大 = big.",vocab:[["大","おおきい","big"],["大学","だいがく","university"]]},
"小":{story:"Tiny marks — small.",hook:"小 = small.",vocab:[["小","ちいさい","small"],["小学校","しょうがっこう","elementary school"]]},
"早":{story:"Sun + ten — early.",hook:"早 = early.",vocab:[["早","はやい","early"]]},
"明":{story:"Sun + moon — bright.",hook:"明 = bright.",vocab:[["明","あかるい","bright"],["明日","あした","tomorrow"]]},
"白":{story:"Pure white light.",hook:"白 = white.",vocab:[["白","しろ","white"],["面白い","おもしろい","interesting"]]},
"黒":{story:"Deep darkness.",hook:"黒 = black.",vocab:[["黒","くろ","black"],["黒板","こくばん","blackboard"]]},
"赤":{story:"Color of fire / earth — red.",hook:"赤 = red.",vocab:[["赤","あか","red"],["赤ちゃん","あかちゃん","baby"]]},
"青":{story:"Clean life color — blue/green.",hook:"青 = blue.",vocab:[["青","あお","blue"]]},
"花":{story:"Grass transforming into beauty.",hook:"花 = flower.",vocab:[["花","はな","flower"],["花火","はなび","fireworks"]]},
"茶":{story:"Tea leaves from the plant.",hook:"茶 = tea.",vocab:[["茶","ちゃ","tea"],["お茶","おちゃ","tea"]]},
"道":{story:"Head on a path — the way.",hook:"道 = road / way.",vocab:[["道","みち","road"],["柔道","じゅうどう","judo"]]},
"会":{story:"People meeting under a roof.",hook:"会 = meet.",vocab:[["会","かい","meeting"],["会社","かいしゃ","company"]]},
"社":{story:"Shrine / company on the earth.",hook:"社 = company / shrine.",vocab:[["社","しゃ","company"],["会社","かいしゃ","company"]]},
"店":{story:"Building that is a shop.",hook:"店 = shop.",vocab:[["店","みせ","shop"],["店員","てんいん","clerk"]]},
"駅":{story:"Where horses/trains stop.",hook:"駅 = station.",vocab:[["駅","えき","station"]]},
"銀":{story:"Good metal — silver.",hook:"銀 = silver.",vocab:[["銀","ぎん","silver"],["銀行","ぎんこう","bank"]]},
"魚":{story:"Fish with fins.",hook:"魚 = fish.",vocab:[["魚","さかな","fish"]]},
"鳥":{story:"Bird standing.",hook:"鳥 = bird.",vocab:[["鳥","とり","bird"],["焼き鳥","やきとり","yakitori"]]},
"馬":{story:"Horse with mane.",hook:"馬 = horse.",vocab:[["馬","うま","horse"]]},
"牛":{story:"Cow with horns.",hook:"牛 = cow.",vocab:[["牛","うし","cow"],["牛肉","ぎゅうにく","beef"],["牛乳","ぎゅうにゅう","milk"]]},
"犬":{story:"Big animal + mark — dog.",hook:"犬 = dog.",vocab:[["犬","いぬ","dog"]]},
"漢":{story:"Han / Chinese characters.",hook:"漢 = China (kanji).",vocab:[["漢","かん","Han"],["漢字","かんじ","kanji"]]},
"私":{story:"Private self — I.",hook:"私 = I.",vocab:[["私","わたし","I"]]}
};
const JLPT_LEVEL_MAP=Object.create(null);
const JLPT_LEVELS={N5:"日一国人年大十二本中長出三時行見月後前生五間上東四今金九入学高円子外八六下来気小七山話女北午百書先名川千水半男西電校語土木聞食車何南万毎白天母火右読友左休父雨",N4:"会同事自社発者地業方新場員立開手力問代明動京目通言理体田主題意不作用度強公持野以思家世多正安院心界教文元重近考画海売知道集別物使品計死特私始朝運終台広住真有口少町料工建空急止送切転研足究楽起着店病質待試族銀早映親験英医仕去味写字答夜音注帰古歌買悪図週室歩風紙黒花春赤青館屋色走秋夏習駅洋旅服夕借曜飲肉貸堂鳥飯勉冬昼茶弟牛魚兄犬妹姉漢",N3:"政議民連対部合市内相定回選米実関決全表戦経最現調化当約首法性要制治務成期取都和機平加受続進数記初指権支産点報済活原共得解交資予向際勝面告反判認参利組信在件側任引求所次昨論官増係感情投示変打直両式確果容必演歳争談能位置流格疑過局放常状球職与供役構割費付由説難優夫収断石違消神番規術備宅害配警育席訪乗残想声念助労例然限追商葉伝働形景落好退頭負渡失差末守若種美命福望非観察段横深申様財港識呼達良候程満敗値突光路科積他処太客否師登易速存飛殺号単座破除完降責捕危給苦迎園具辞因馬愛富彼未舞亡冷適婦寄込顔類余王返妻背熱宿薬険頼覚船途許抜便留罪努精散静婚喜浮絶幸押倒等老曲払庭徒勤遅居雑招困欠更刻賛抱犯恐息遠戻願絵越欲痛笑互束似列探逃遊迷夢君閉緒折草暮酒悲晴掛到寝暗盗吸陽御歯忘雪吹娘誤洗慣礼窓昔貧怒泳祖杯疲皆鳴腹煙眠怖耳頂箱晩寒髪忙才靴恥偶偉猫幾",N2:"党協総区領県設改府査委軍団各島革村勢減再税営比防補境導副算輸述線農州武象域額欧担準賞辺造被技低復移個門課脳極含蔵量型況針専谷史階管兵接細効丸湾録省旧橋岸周材戸央券編捜竹超並療採森競介根販歴将幅般貿講林装諸劇河航鉄児禁印逆換久短油暴輪占植清倍均億圧芸署伸停爆陸玉波帯延羽固則乱普測豊厚齢囲卒略承順岩練軽了庁城患層版令角絡損募裏仏績築貨混昇池血温季星永著誌庫刊像香坂底布寺宇巨震希触依籍汚枚複郵仲栄札板骨傾届巻燃跡包駐弱紹雇替預焼簡章臓律贈照薄群秒奥詰双刺純翌快片敬悩泉皮漁荒貯硬埋柱祭袋筆訓浴童宝封胸砂塩賢腕兆床毛緑尊祝柔殿濃液衣肩零幼荷泊黄甘臣浅掃雲掘捨軟沈凍乳恋紅郊腰炭踊冊勇械菜珍卵湖喫干虫刷湯溶鉱涙匹孫鋭枝塗軒毒叫拝氷乾棒祈拾粉糸綿汗銅湿瓶咲召缶隻脂蒸肌耕鈍泥隅灯辛磨麦姓筒鼻粒詞胃畳机膚濯塔沸灰菓帽枯涼舟貝符憎皿肯燥畜挟曇滴伺"};
for(const[l,c]of Object.entries(JLPT_LEVELS))for(const ch of[...c])if(!JLPT_LEVEL_MAP[ch])JLPT_LEVEL_MAP[ch]=l;
let pathLevelFilter='N5',pathCurrent=0,PATH_JOYO_ORDER=[],PATH_META={},PATH_JOYO_READY=false,pathReviewMode=false;
function pathLevelOf(k){return JLPT_LEVEL_MAP[k]||'N1'}
function pathLevelItems(items){return items.filter(x=>pathLevelOf(x.kanji)===pathLevelFilter)}
function pathItems(){
  const byKanji=new Map(SETS.map(s=>[s.kanji,s]));
  return PATH_JOYO_ORDER.map((kanji,i)=>{
    const set=byKanji.get(kanji);
    const meta=PATH_META[kanji]||{};
    const cards=set&&Array.isArray(set.cards)?set.cards:[[kanji,meta.reading||'',meta.meaning||'']];
    const base=cards.find(c=>c&&c[0]===kanji)||cards[0]||[kanji,'',''];
    return {
      setId:set?set.id:null,
      kanji,
      reading:base[1]||meta.reading||'',
      english:base[2]||meta.meaning||'',
      cards
    };
  });
}
function pathLevelCounts(items){const c={N5:0,N4:0,N3:0,N2:0,N1:0};for(const x of items)c[pathLevelOf(x.kanji)]++;return c}
function pathStorageKey(){return currentUser?'kanjiMnemonicPath:user:'+currentUser.id:'kanjiMnemonicPath:guest'}
function loadPathProgress(){try{let raw=localStorage.getItem(pathStorageKey());if(!raw&&!currentUser)raw=localStorage.getItem('kanjiMnemonicPath');if(!raw)return{};const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object')return{};const out={};for(const[k,v]of Object.entries(parsed)){if(v===true)out[k]={stage:3,ease:2.5,interval:4,due:Date.now()+4*864e5,reps:3,lapses:0,last:Date.now()};else if(v&&typeof v==='object')out[k]=v}return out}catch(_){return{}}}
function savePathProgress(x){try{localStorage.setItem(pathStorageKey(),JSON.stringify(x));if(!currentUser)localStorage.setItem('kanjiMnemonicPath',JSON.stringify(x));}catch(_){} if(currentUser)savePathProgressToServer(x); }
function pathIsLearned(p,k){return!!(p[k]&&p[k].stage>0)}
function pathIsDue(p,k){const e=p[k];return!!(e&&e.stage>0&&(e.due||0)<=Date.now())}
function pathDueList(items,p){return items.filter(x=>pathIsDue(p,x.kanji))}
function pathRadicalsFor(kanji) {
  const comps = KANJI_COMPONENTS[kanji];
  if (!comps || !comps.length) return [];
  // De-dupe and map to radical info
  const seen = new Set();
  const out = [];
  for (const r of comps) {
    if (seen.has(r)) continue;
    seen.add(r);
    const info = RADICALS[r] || { meaning: 'component', story: '' };
    out.push({ radical: r, meaning: info.meaning, story: info.story });
  }
  return out;
}

function pathInfo(item){
  const d = PATH_MEMORY[item.kanji];
  const radicals = pathRadicalsFor(item.kanji);
  if (d) return { ...d, radicals };
  const cards = item.cards || [];
  const base = cards.find(c => c[0] === item.kanji) || cards[0] || [];
  const meaning = base[2] || item.english || 'this meaning';
  let story = `Look at ${item.kanji}. Connect its shape to “${meaning}”. Make a vivid mental picture, then say the reading three times.`;
  if (radicals.length) {
    const parts = radicals.map(r => `${r.radical} (${r.meaning})`).join(' + ');
    story = `Built from ${parts}. Connect the parts to “${meaning}”, then lock in the reading.`;
  }
  return {
    story,
    hook: `Shape → meaning → reading for ${item.kanji}.`,
    vocab: cards.slice(0, 3).map(c => [c[0], c[1], c[2]]),
    radicals
  };
}
const JOYO_LIST_URL='https://kanjiapi.dev/v1/kanji/joyo';
const JOYO_META_URL='https://kanjiapi.dev/v1/kanji/joyo-enriched';
const JOYO_COMPATIBILITY_ALIASES=new Set(['叱','填','剥','頬']);
const JOYO_OFFICIAL_VARIANTS={ '𠮟':'叱','塡':'填','剝':'剥','頰':'頬' };
const STATIC_JOYO_LIST=[...new Set([...`亜哀挨愛曖悪握圧扱宛嵐安案暗以衣位囲医依委威為畏胃尉異移萎偉椅彙意違維慰遺緯域育一壱逸茨芋引印因咽姻員院淫陰飲隠韻右宇羽雨唄鬱畝浦運雲永泳英映栄営詠影鋭衛易疫益液駅悦越謁閲円延沿炎怨宴媛援園煙猿遠鉛塩演縁艶汚王凹央応往押旺欧殴桜翁奥横岡屋億憶臆虞乙俺卸音恩温穏下化火加可仮何花佳価果河苛科架夏家荷華菓貨渦過嫁暇禍靴寡歌箇稼課蚊牙瓦我画芽賀雅餓介回灰会快戒改怪拐悔海界皆械絵開階塊楷解潰壊懐諧貝外劾害崖涯街慨蓋該概骸垣柿各角拡革格核殻郭覚較隔閣確獲嚇穫学岳楽額顎掛潟括活喝渇割葛滑褐轄且株釜鎌刈干刊甘汗缶完肝官冠巻看陥乾勘患貫寒喚堪換敢棺款間閑勧寛幹感漢慣管関歓監緩憾還館環簡観韓艦鑑丸含岸岩玩眼頑顔願企伎危机気岐希忌汽奇祈季紀軌既記起飢鬼帰基寄規亀喜幾揮期棋貴棄毀旗器畿輝機騎技宜偽欺義疑儀戯擬犠議菊吉喫詰却客脚逆虐九久及弓丘旧休吸朽臼求究泣急級糾宮救球給嗅窮牛去巨居拒拠挙虚許距魚御漁凶共叫狂京享供協況峡挟狭恐恭胸脅強教郷境橋矯鏡競響驚仰暁業凝曲局極玉巾斤均近金菌勤琴筋僅禁緊錦謹襟吟銀区句苦駆具惧愚空偶遇隅串屈掘窟熊繰君訓勲薫軍郡群兄刑形系径茎係型契計恵啓掲渓経蛍敬景軽傾携継詣慶憬稽憩警鶏芸迎鯨隙劇撃激桁欠穴血決結傑潔月犬件見券肩建研県倹兼剣拳軒健険圏堅検嫌献絹遣権憲賢謙鍵繭顕験懸元幻玄言弦限原現舷減源厳己戸古呼固股虎孤弧故枯個庫湖雇誇鼓錮顧五互午呉後娯悟碁語誤護口工公勾孔功巧広甲交光向后好江考行坑孝抗攻更効幸拘肯侯厚恒洪皇紅荒郊香候校耕航貢降高康控梗黄喉慌港硬絞項溝鉱構綱酵稿興衡鋼講購乞号合拷剛傲豪克告谷刻国黒穀酷獄骨駒込頃今困昆恨根婚混痕紺魂墾懇左佐沙査砂唆差詐鎖座挫才再災妻采砕宰栽彩採済祭斎細菜最裁債催塞歳載際埼在材剤財罪崎作削昨柵索策酢搾錯咲冊札刷刹拶殺察撮擦雑皿三山参桟蚕惨産傘散算酸賛残斬暫士子支止氏仕史司四市矢旨死糸至伺志私使刺始姉枝祉肢姿思指施師恣紙脂視紫詞歯嗣試詩資飼誌雌摯賜諮示字寺次耳自似児事侍治持時滋慈辞磁餌璽鹿式識軸七𠮟数失室疾執湿嫉漆質実芝写社車舎者射捨赦斜煮遮謝邪蛇尺借酌釈爵若弱寂手主守朱取狩首殊珠酒腫種趣寿受呪授需儒樹収囚州舟秀周宗拾秋臭修袖終羞習週就衆集愁酬醜蹴襲十汁充住柔重従渋銃獣縦叔祝宿淑粛縮塾熟出述術俊春瞬旬巡盾准殉純循順準潤遵処初所書庶暑署緒諸女如助序叙徐除小升少召匠床抄肖尚招承昇松沼昭宵将消症祥称笑唱商渉章紹訟勝掌晶焼焦硝粧詔証象傷奨照詳彰障憧衝賞償礁鐘上丈冗条状乗城浄剰常情場畳蒸縄壌嬢錠譲醸色拭食植殖飾触嘱織職辱尻心申伸臣芯身辛侵信津神唇娠振浸真針深紳進森診寝慎新審震薪親人刃仁尽迅甚陣尋腎須図水吹垂炊帥粋衰推酔遂睡穂随髄枢崇据杉裾寸瀬是井世正生成西声制姓征性青斉政星牲省凄逝清盛婿晴勢聖誠精製誓静請整醒税夕斥石赤昔析席脊隻惜戚責跡積績籍切折拙窃接設雪摂節説舌絶千川仙占先宣専泉浅洗染扇栓旋船戦煎羨腺詮践箋銭潜線遷選薦繊鮮全前善然禅漸膳繕狙阻祖租素措粗組疎訴塑遡礎双壮早争走奏相荘草送倉捜挿桑巣掃曹曽爽窓創喪痩葬装僧想層総遭槽踪操燥霜騒藻造像増憎蔵贈臓即束足促則息捉速側測俗族属賊続卒率存村孫尊損遜他多汰打妥唾堕惰駄太対体耐待怠胎退帯泰堆袋逮替貸隊滞態戴大代台第題滝宅択沢卓拓託濯諾濁但達脱奪棚誰丹旦担単炭胆探淡短嘆端綻誕鍛団男段断弾暖談壇地池知値恥致遅痴稚置緻竹畜逐蓄築秩窒茶着嫡中仲虫沖宙忠抽注昼柱衷酎鋳駐著貯丁弔庁兆町長挑帳張彫眺釣頂鳥朝貼超腸跳徴嘲潮澄調聴懲直勅捗沈珍朕陳賃鎮追椎墜通痛塚漬坪爪鶴低呈廷弟定底抵邸亭貞帝訂庭逓停偵堤提程艇締諦泥的笛摘滴適敵溺迭哲鉄徹撤天典店点展添転塡田伝殿電斗吐妬徒途都渡塗賭土奴努度怒刀冬灯当投豆東到逃倒凍唐島桃討透党悼盗陶塔搭棟湯痘登答等筒統稲踏糖頭謄藤闘騰同洞胴動堂童道働銅導瞳峠匿特得督徳篤毒独読栃凸突届屯豚頓貪鈍曇丼那奈内梨謎鍋南軟難二尼弐匂肉虹日入乳尿任妊忍認寧熱年念捻粘燃悩納能脳農濃把波派破覇馬婆罵拝杯背肺俳配排敗廃輩売倍梅培陪媒買賠白伯拍泊迫剝舶博薄麦漠縛爆箱箸畑肌八鉢発髪伐抜罰閥反半氾犯帆汎伴判坂阪板版班畔般販斑飯搬煩頒範繁藩晩番蛮盤比皮妃否批彼披肥非卑飛疲秘被悲扉費碑罷避尾眉美備微鼻膝肘匹必泌筆姫百氷表俵票評漂標苗秒病描猫品浜貧賓頻敏瓶不夫父付布扶府怖阜附訃負赴浮婦符富普腐敷膚賦譜侮武部舞封風伏服副幅復福腹複覆払沸仏物粉紛雰噴墳憤奮分文聞丙平兵併並柄陛閉塀幣弊蔽餅米壁璧癖別蔑片辺返変偏遍編弁便勉歩保哺捕補舗母募墓慕暮簿方包芳邦奉宝抱放法泡胞俸倣峰砲崩訪報蜂豊飽褒縫亡乏忙坊妨忘防房肪某冒剖紡望傍帽棒貿貌暴膨謀頰北木朴牧睦僕墨撲没勃堀本奔翻凡盆麻摩磨魔毎妹枚昧埋幕膜枕又末抹万満慢漫未味魅岬密蜜脈妙民眠矛務無夢霧娘名命明迷冥盟銘鳴滅免面綿麺茂模毛妄盲耗猛網目黙門紋問冶夜野弥厄役約訳薬躍闇由油喩愉諭輸癒唯友有勇幽悠郵湧猶裕遊雄誘憂融優与予余誉預幼用羊妖洋要容庸揚揺葉陽溶腰様瘍踊窯養擁謡曜抑沃浴欲翌翼拉裸羅来雷頼絡落酪辣乱卵覧濫藍欄吏利里理痢裏履璃離陸立律慄略柳流留竜粒隆硫侶旅虜慮了両良料涼猟陵量僚領寮療瞭糧力緑林厘倫輪隣臨瑠涙累塁類令礼冷励戻例鈴零霊隷齢麗暦歴列劣烈裂恋連廉練錬呂炉賂路露老労弄郎朗浪廊楼漏籠六録麓論和話賄脇惑枠湾腕`])];

function canonicalJoyoList(list){
  const out=[],seen=new Set();
  for(const raw of Array.isArray(list)?list:[]){
    const k=String(raw||'');
    if(!k||seen.has(k)||JOYO_COMPATIBILITY_ALIASES.has(k))continue;
    seen.add(k);out.push(k);
  }
  return out.slice(0,2136);
}
function applyJoyoList(list){
  PATH_JOYO_ORDER=canonicalJoyoList(list);
  for(const k of PATH_JOYO_ORDER){
    if(!SETS.some(s=>s.kanji===k)) SETS.push({id:SETS.length+1,kanji:k,cards:[[k,'','']]});
  }
  PATH_JOYO_READY=PATH_JOYO_ORDER.length===2136;
}
function applyJoyoMeta(entries){
  const metaMap=Object.create(null);
  for(const d of Array.isArray(entries)?entries:[]){
    const k=d&&d.kanji;if(!k)continue;
    metaMap[k]={meaning:(d.meanings||[]).slice(0,4).join(', '),reading:[...(d.on_readings||[]),...(d.kun_readings||[])].slice(0,8).join(' / '),vocab:[]};
  }
  for(const k of PATH_JOYO_ORDER){
    const meta=metaMap[k]||PATH_META[k]||{meaning:'',reading:'',vocab:[]};
    PATH_META[k]=meta;
    const set=SETS.find(x=>x.kanji===k);
    if(set){
      const exact=set.cards.find(c=>c[0]===k)||set.cards[0];
      if(exact){exact[1]=exact[1]||meta.reading;exact[2]=exact[2]||meta.meaning;}
    }
  }
}
function loadFullJoyoPath(){
  // Instant/offline-first boot: the complete 2,136-kanji list is embedded in the HTML.
  applyJoyoList(STATIC_JOYO_LIST);
  if(PATH_JOYO_ORDER.length===2136){
    renderPath();
    // Enrichment is deliberately deferred so it can never block the UI.
    setTimeout(async()=>{
      try{
        const metaRes=await fetch(JOYO_META_URL,{cache:'force-cache'});
        if(metaRes.ok){applyJoyoMeta(await metaRes.json());renderPath();}
      }catch(e){console.warn('Jōyō metadata enrichment unavailable:',e);}
    },0);
  }else{
    PATH_JOYO_ORDER=SETS.map(s=>s.kanji);
    PATH_JOYO_READY=false;
    renderPath();
    console.warn('Embedded Jōyō list validation failed:',PATH_JOYO_ORDER.length);
  }
}

async function ensurePathMeta(kanji){
  if(!kanji||PATH_META[kanji])return PATH_META[kanji]||null;
  try{
    const rr=await fetch('https://kanjiapi.dev/v1/kanji/'+encodeURIComponent(kanji),{cache:'force-cache'});
    if(!rr.ok)return null;
    const d=await rr.json();
    PATH_META[kanji]={meaning:(d.meanings||[]).slice(0,4).join(', '),reading:[...(d.on_readings||[]),...(d.kun_readings||[])].slice(0,8).join(' / '),vocab:[]};
    const set=SETS.find(x=>x.kanji===kanji);
    if(set&&set.cards[0]){set.cards[0][1]=set.cards[0][1]||PATH_META[kanji].reading;set.cards[0][2]=set.cards[0][2]||PATH_META[kanji].meaning;}
    return PATH_META[kanji];
  }catch(e){return null}
}
function srsSchedule(entry,quality){const now=Date.now();let{stage=0,ease=2.5,interval=0,reps=0,lapses=0}=entry||{};if(quality===0){stage=Math.max(0,stage-2);lapses++;interval=0;reps=0}else{reps++;if(stage<=0){stage=1;interval=quality>=3?1:0}else if(stage===1){stage=2;interval=quality>=3?3:1}else if(stage===2){stage=3;interval=quality>=3?7:3}else{stage=Math.min(8,stage+1);ease=Math.max(1.3,ease+(0.1-(3-quality)*(0.08+(3-quality)*0.02)));interval=Math.max(1,Math.round(interval*ease*(quality===1?0.8:quality===3?1.3:1)))}}const due=now+(interval<=0?10*60*1000:interval*864e5);return{stage,ease,interval,due,reps,lapses,last:now}}
const PATH_WORDS_CACHE=Object.create(null);
const PATH_WORDS_LOADING=Object.create(null);
let JOYO_VOCAB_PAGE=0,JOYO_VOCAB_QUERY='',JOYO_VOCAB_TOTAL=0,JOYO_VOCAB_ITEMS=[],JOYO_VOCAB_LOADING=false;
const JOYO_VOCAB_CACHE_KEY='kanjiPathVocabCacheV1';
let JOYO_VOCAB_CACHE=Object.create(null); // key -> {items,total,ts}
function vocabCacheKey(q,page){return (q||'')+'|'+page;}
function loadVocabCacheFromStorage(){
  try{
    const raw=JSON.parse(localStorage.getItem(JOYO_VOCAB_CACHE_KEY)||'{}');
    if(raw&&typeof raw==='object')JOYO_VOCAB_CACHE=raw;
  }catch(e){JOYO_VOCAB_CACHE=Object.create(null);}
}
function saveVocabCacheToStorage(){
  try{
    // keep only recent keys to avoid quota issues
    const keys=Object.keys(JOYO_VOCAB_CACHE);
    if(keys.length>40){
      keys.sort((a,b)=>(JOYO_VOCAB_CACHE[a].ts||0)-(JOYO_VOCAB_CACHE[b].ts||0));
      keys.slice(0,keys.length-30).forEach(k=>delete JOYO_VOCAB_CACHE[k]);
    }
    localStorage.setItem(JOYO_VOCAB_CACHE_KEY,JSON.stringify(JOYO_VOCAB_CACHE));
  }catch(e){console.warn('vocab cache save failed',e);}
}
loadVocabCacheFromStorage();

function pathWordEntryToRow(entry,kanji){
  if(!entry||!Array.isArray(entry.variants))return [];
  const rows=[];
  const meanings=Array.isArray(entry.meanings)?entry.meanings.flatMap(m=>Array.isArray(m.glosses)?m.glosses:[]).filter(Boolean):[];
  for(const v of entry.variants){
    if(!v||!v.written||!v.written.includes(kanji))continue;
    rows.push([v.written,v.pronounced||'',meanings.slice(0,3).join('; ')||'']);
  }
  return rows;
}
function normalizePathWords(data,kanji){
  const seen=new Set(),out=[];
  for(const entry of Array.isArray(data)?data:[])for(const row of pathWordEntryToRow(entry,kanji)){
    const key=row[0]+'\u0000'+row[1];if(seen.has(key))continue;seen.add(key);out.push(row);
  }
  out.sort((a,b)=>a[0].localeCompare(b[0]));return out;
}
async function ensurePathWords(kanji){
  if(!kanji)return [];
  if(Array.isArray(PATH_WORDS_CACHE[kanji]))return PATH_WORDS_CACHE[kanji];
  if(PATH_WORDS_LOADING[kanji])return PATH_WORDS_LOADING[kanji];
  PATH_WORDS_LOADING[kanji]=(async()=>{
    try{
      const r=await fetch('https://kanjiapi.dev/v1/words/'+encodeURIComponent(kanji),{cache:'force-cache'});
      if(r.ok){
        const data=await r.json();
        const rows=normalizePathWords(data,kanji);
        if(rows.length){PATH_WORDS_CACHE[kanji]=rows;return rows;}
      }
    }catch(e){console.warn('kanjiapi failed for',kanji,e);}
    try{
      const r=await fetch('/api/vocab?kanji='+encodeURIComponent(kanji)+'&limit=80',{credentials:'include'});
      if(r.ok){
        const data=await r.json();
        const rows=(data.items||[]).map(x=>[x.word,x.reading||'',x.meaning||'']);
        PATH_WORDS_CACHE[kanji]=rows;return rows;
      }
    }catch(e){console.warn('vocab API failed for',kanji,e);}
    PATH_WORDS_CACHE[kanji]=[];
    return [];
  })().finally(()=>{delete PATH_WORDS_LOADING[kanji]});
  return PATH_WORDS_LOADING[kanji];
}
function saveJoyoVocabCache(){ /* vocabulary is stored in Neon; no client export */ }
function updateSqlExportButton(){ /* removed: SQL export no longer needed */ }
function sqlQuote(value){return "'"+String(value??'').replace(/'/g,"''")+"'";}
function exportJoyoVocabularySql(){ alert("Vocabulary is already stored in the database."); }
function loadJoyoVocabCache(){ /* use API */ }

function vocabBankFiltered(){ return JOYO_VOCAB_ITEMS; }
function renderVocabBank(){
  const bank=$('vocabBank'),grid=$('vocabBankGrid'),status=$('vocabBankStatus');if(!bank||!grid)return;
  bank.classList.remove('hidden');
  const rows=JOYO_VOCAB_ITEMS;
  grid.innerHTML=rows.map((r,i)=>`<button type="button" class="vocab-bank-item" data-vocab-i="${i}"><strong>${esc(r.word||r[0]||'')}</strong><small>${esc(r.reading||r[1]||'')}${(r.meaning||r[2])?' · '+esc(r.meaning||r[2]):''}</small></button>`).join('');
  grid.querySelectorAll('.vocab-bank-item').forEach(b=>b.onclick=()=>{const r=JOYO_VOCAB_ITEMS[Number(b.dataset.vocabI)];if(!r)return;openWordFromVocab([r.word||r[0],r.reading||r[1]||'',r.meaning||r[2]||'']);});
  const totalPages=Math.max(1,Math.ceil((JOYO_VOCAB_TOTAL||rows.length)/50));
  if(status)status.textContent=JOYO_VOCAB_LOADING?'Loading…':`${(JOYO_VOCAB_TOTAL||0).toLocaleString()} words in database · page ${JOYO_VOCAB_PAGE+1}/${totalPages}`;
  const prev=$('vocabPrevPage'),next=$('vocabNextPage');if(prev)prev.disabled=JOYO_VOCAB_PAGE<=0||JOYO_VOCAB_LOADING;if(next)next.disabled=JOYO_VOCAB_LOADING||!((JOYO_VOCAB_PAGE+1)*50<JOYO_VOCAB_TOTAL);
}
async function fetchVocabPage(opts){
  opts=opts||{};
  const quiet=!!opts.quiet;
  const q=JOYO_VOCAB_QUERY.trim();
  const key=vocabCacheKey(q,JOYO_VOCAB_PAGE);
  const cached=JOYO_VOCAB_CACHE[key];
  const fresh=cached&&(Date.now()-(cached.ts||0)<1000*60*60*24); // 24h
  if(fresh&&Array.isArray(cached.items)){
    JOYO_VOCAB_ITEMS=cached.items;
    JOYO_VOCAB_TOTAL=cached.total||cached.items.length;
    if($('wordsCount'))$('wordsCount').textContent=(JOYO_VOCAB_TOTAL||0).toLocaleString()+' words';
    JOYO_VOCAB_LOADING=false;
    if(!quiet)renderVocabBank();
    return;
  }
  if(JOYO_VOCAB_LOADING&&!opts.force)return;
  JOYO_VOCAB_LOADING=true;
  const status=$('vocabBankStatus');
  if(status&&!quiet)status.textContent=cached?'Updating…':'Loading vocabulary from database…';
  // show stale cache immediately while refreshing
  if(cached&&Array.isArray(cached.items)&&!quiet){
    JOYO_VOCAB_ITEMS=cached.items;
    JOYO_VOCAB_TOTAL=cached.total||cached.items.length;
    renderVocabBank();
  }
  try{
    const url=`/api/vocab?page=${JOYO_VOCAB_PAGE}&limit=50${q?`&q=${encodeURIComponent(q)}`:''}`;
    const res=await fetch(url,{credentials:'include'});
    if(!res.ok)throw new Error('API '+res.status);
    const data=await res.json();
    JOYO_VOCAB_ITEMS=Array.isArray(data.items)?data.items:[];
    JOYO_VOCAB_TOTAL=data.total||JOYO_VOCAB_ITEMS.length;
    JOYO_VOCAB_CACHE[key]={items:JOYO_VOCAB_ITEMS,total:JOYO_VOCAB_TOTAL,ts:Date.now()};
    saveVocabCacheToStorage();
    if($('wordsCount'))$('wordsCount').textContent=(JOYO_VOCAB_TOTAL||0).toLocaleString()+' words';
  }catch(e){
    console.warn('Vocab API failed',e);
    if(!cached){
      JOYO_VOCAB_ITEMS=[];JOYO_VOCAB_TOTAL=0;
      if(status&&!quiet)status.textContent='Could not load vocabulary. Check database connection.';
    }
  }finally{
    JOYO_VOCAB_LOADING=false;
    if(!quiet)renderVocabBank();
  }
}
async function loadAllJoyoVocabulary(){ await fetchVocabPage(); }
function prefetchVocabBank(){
  // Vocabulary is loaded by ensureVocabularyLoaded() when the Word tab is opened.
  // IndexedDB keeps the full 40,000-entry dataset available for instant future opens.
}

function renderPathVocabulary(item,info){
  const el=$('pathVocabList');if(!el)return;
  const rows=Array.isArray(PATH_WORDS_CACHE[item.kanji])?PATH_WORDS_CACHE[item.kanji]:null;
  const fallback=Array.isArray(info.vocab)?info.vocab:[];
  const words=rows&&rows.length?rows:fallback;
  const studyBtn=$('pathStudyBtn');
  if(studyBtn)studyBtn.textContent=words.length?`📖 Study ${words.length.toLocaleString()} Words`:'📖 Study Vocabulary';
  if(!words.length){return;}
  if(!el)return;
  el.innerHTML=words.slice(0,120).map(x=>`<span class="path-vocab-chip"><strong>${esc(x[0])}</strong><small>${esc(x[1]||'')} · ${esc(x[2]||'')}</small></span>`).join('');
}

function updateReviewNotifBadge(){
  const badge=$('reviewNotifBadge');
  if(!badge)return;
  try{
    const items=pathItems();
    const p=loadPathProgress();
    const due=pathDueList(items,p);
    const n=due.length;
    badge.textContent=n>99?'99+':String(n);
    badge.classList.toggle('show',n>0);
    const btn=$('reviewNotifBtn');
    if(btn)btn.title=n?`${n} kanji review${n===1?'':'s'} due`:'No reviews due';
  }catch(e){badge.classList.remove('show');}
}
let reviewModalQueue=[];
function openReviewReminder(){
  const items=pathItems();
  const p=loadPathProgress();
  const due=pathDueList(items,p);
  if(!due.length){
    alert('No kanji reviews due right now. Keep learning — reviews appear with spaced repetition.');
    return;
  }
  reviewModalQueue=due.map(x=>x.kanji);
  showNextReviewCard();
}
function showNextReviewCard(){
  const modal=$('reviewModal');
  if(!modal)return;
  if(!reviewModalQueue.length){
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden','true');
    updateReviewNotifBadge();
    return;
  }
  const kanji=reviewModalQueue[0];
  const items=pathItems();
  const item=items.find(x=>x.kanji===kanji)||{kanji,reading:'',english:''};
  if($('reviewModalKanji'))$('reviewModalKanji').textContent=kanji;
  if($('reviewModalReading'))$('reviewModalReading').textContent=item.reading||'';
  if($('reviewModalMeaning'))$('reviewModalMeaning').textContent=item.english||'';
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden','false');
  // refresh meta if missing
  if(!item.reading||!item.english){
    ensurePathMeta(kanji).then(()=>{
      const it=pathItems().find(x=>x.kanji===kanji);
      if(it&&$('reviewModalKanji')&&$('reviewModalKanji').textContent===kanji){
        if($('reviewModalReading'))$('reviewModalReading').textContent=it.reading||'';
        if($('reviewModalMeaning'))$('reviewModalMeaning').textContent=it.english||'';
      }
    });
  }
}
function closeReviewModal(){
  const modal=$('reviewModal');
  if(modal){modal.classList.add('hidden');modal.setAttribute('aria-hidden','true');}
  reviewModalQueue=[];
  updateReviewNotifBadge();
}
function reviewRemember(){
  if(!reviewModalQueue.length)return;
  const kanji=reviewModalQueue.shift();
  const items=pathItems();
  const idx=items.findIndex(x=>x.kanji===kanji);
  if(idx>=0){
    pathCurrent=idx;
    // quality 2 = remembered, schedule next review without writing
    pathAnswer(2);
  }
  updateReviewNotifBadge();
  if(reviewModalQueue.length)showNextReviewCard();
  else closeReviewModal();
}
function reviewForgot(){
  if(!reviewModalQueue.length)return;
  const kanji=reviewModalQueue.shift();
  const items=pathItems();
  const idx=items.findIndex(x=>x.kanji===kanji);
  if(idx>=0){
    pathCurrent=idx;
    pathAnswer(0); // lapse — needs re-learn
  }
  closeReviewModal();
  // Open write practice for this kanji
  const set=SETS.find(s=>s.kanji===kanji);
  if(set){
    setupPractice([set.id]);
    showMode('practice');
    setTimeout(()=>{
      try{ openPracticeModal(0); }catch(e){ console.warn(e); }
    },120);
  }else{
    showMode('path');updateReviewNotifBadge();
    renderPath();
  }
  updateReviewNotifBadge();
}

function renderPath(){const items=pathItems(),p=loadPathProgress(),due=pathDueList(items,p),learned=items.filter(x=>pathIsLearned(p,x.kanji)).length;if(!items.length)return;if(pathReviewMode&&due.length){const idx=items.findIndex(x=>x.kanji===due[0].kanji);pathCurrent=idx>=0?idx:pathCurrent}else{pathCurrent=Math.max(0,Math.min(pathCurrent,items.length-1));if(!PATH_JOYO_READY&&pathCurrent===0){const first=items.findIndex(x=>!pathIsLearned(p,x.kanji));if(first>=0)pathCurrent=first}}const item=items[pathCurrent];if(!item)return;const info=pathInfo(item),isDue=pathIsDue(p,item.kanji),isLearned=pathIsLearned(p,item.kanji);if($('pathLearnedCount'))$('pathLearnedCount').textContent=learned;if($('pathCurrentNumber'))$('pathCurrentNumber').textContent=pathCurrent+1;if($('pathDueCount'))$('pathDueCount').textContent=due.length;if($('pathProgressLabel'))$('pathProgressLabel').textContent=`${learned.toLocaleString()} of 2,136 learned`+(due.length?` · ${due.length} due`:'');if($('pathProgressFill'))$('pathProgressFill').style.width=Math.min(100,(learned/2136)*100)+'%';if($('pathSetBadge'))$('pathSetBadge').textContent=`Kanji ${pathCurrent+1}`;if($('pathLessonNumber'))$('pathLessonNumber').textContent=`Lesson ${pathCurrent+1} · ${pathLevelOf(item.kanji)}`+(isDue?' · REVIEW':'');if($('pathKanji'))$('pathKanji').textContent=item.kanji;if($('pathMeaning'))$('pathMeaning').textContent=item.english||'Loading English meaning…';if($('pathReading'))$('pathReading').textContent=item.reading||'Loading Japanese reading…';if($('pathStory'))$('pathStory').textContent=info.story;if($('pathHook'))$('pathHook').textContent=info.hook;renderPathVocabulary(item,info);
// Radical-first display
const rads=info.radicals||[];
const radWrap=$('pathRadicals'),radList=$('pathRadicalsList'),radNote=$('pathRadicalsNote');
if(radWrap&&radList){if(rads.length){radWrap.style.display='';radList.innerHTML=rads.map(r=>`<span class="path-radical-chip"><strong>${esc(r.radical)}</strong><small>${esc(r.meaning)}</small></span>`).join('');if(radNote)radNote.textContent=rads.filter(r=>r.story).map(r=>r.radical+' = '+r.story).join(' · ')||'Learn these building blocks first, then combine them into the kanji.';}else{radWrap.style.display='none';radList.innerHTML='';if(radNote)radNote.textContent='';}}
const writeCount=getKanjiWriteCount(item.kanji);const writesDone=writeCount>=PRACTICE_GOAL;const learnBtn=$('pathLearnBtn');if(learnBtn){if(isDue){learnBtn.textContent='✓ I remembered it';learnBtn.dataset.mode='review-good';learnBtn.disabled=false;learnBtn.title=''}else if(isLearned){learnBtn.textContent='✓ Learned — continue →';learnBtn.dataset.mode='continue';learnBtn.disabled=false;learnBtn.title=''}else{learnBtn.dataset.mode='learn';if(writesDone){learnBtn.textContent='Mark as learned →';learnBtn.disabled=false;learnBtn.title=''}else{learnBtn.textContent=`Write ${writeCount}/${PRACTICE_GOAL} to unlock →`;learnBtn.disabled=true;learnBtn.title=`Write this kanji ${PRACTICE_GOAL} times in Practice before marking learned`}}}const writeHint=$('pathWriteHint');if(writeHint){if(isDue||isLearned){writeHint.style.display='none'}else{writeHint.style.display='';writeHint.textContent=writesDone?`Writing goal complete (${PRACTICE_GOAL}/${PRACTICE_GOAL})`:`Writing progress: ${writeCount} / ${PRACTICE_GOAL}`}}const revBtn=$('pathReviewToggle');if(revBtn){revBtn.style.display=due.length?'':'none';revBtn.textContent=pathReviewMode?'← Back to new kanji':`🔄 ${due.length} reviews due`}const againBtn=$('pathAgainBtn');if(againBtn)againBtn.style.display=isDue?'':'none';renderPathRoadmap(items,p);updateReviewNotifBadge();if(!item.reading||!item.english)ensurePathMeta(item.kanji).then(()=>renderPath());if(!PATH_WORDS_CACHE[item.kanji]){renderPathVocabulary(item,info);ensurePathWords(item.kanji).then(()=>{if(pathItems()[pathCurrent]?.kanji===item.kanji)renderPathVocabulary(item,pathInfo(item));});}}
function renderPathRoadmap(items,p){const grid=$('pathRoadmap');if(!grid)return;const visible=pathLevelItems(items),counts=pathLevelCounts(items);grid.innerHTML='';for(let vi=0;vi<visible.length;vi++){const x=visible[vi],i=items.indexOf(x),b=document.createElement('button');b.type='button';b.className='path-node';if(pathIsLearned(p,x.kanji))b.classList.add('learned');if(pathIsDue(p,x.kanji))b.classList.add('due');if(i===pathCurrent)b.classList.add('current');const prevInLevel=vi>0?visible[vi-1]:null;const unlocked=vi===0||(prevInLevel&&pathIsLearned(p,prevInLevel.kanji))||pathIsLearned(p,x.kanji);if(!unlocked)b.classList.add('locked');b.disabled=!unlocked;b.innerHTML=`<strong>${esc(x.kanji)}</strong><small>${vi+1} · ${pathLevelOf(x.kanji)}</small>`;b.onclick=()=>{pathReviewMode=false;pathCurrent=i;renderPath()};grid.appendChild(b)}if($('pathRoadmapCount'))$('pathRoadmapCount').textContent=`${visible.length.toLocaleString()} kanji · ${pathLevelFilter}`;if($('pathLevelSummary'))$('pathLevelSummary').innerHTML=`Learning <strong>${pathLevelFilter}</strong> · N5 ${counts.N5} · N4 ${counts.N4} · N3 ${counts.N3} · N2 ${counts.N2} · N1 ${counts.N1}`}
function pathAnswer(quality){const items=pathItems(),p=loadPathProgress(),x=items[pathCurrent];if(!x)return;const prev=p[x.kanji]||{stage:0,ease:2.5,interval:0,reps:0,lapses:0};p[x.kanji]=srsSchedule(prev,quality);savePathProgress(p);if(quality===0){renderPath();return}pathReviewMode=false;const visible=pathLevelItems(items);const vi=visible.findIndex(v=>v.kanji===x.kanji);if(vi>=0&&vi<visible.length-1){pathCurrent=items.indexOf(visible[vi+1]);}else if(pathCurrent<items.length-1){pathCurrent++;}renderPath()}
function pathMarkLearned(){
  if(!requireAuth()) return;
  const btn = $('pathLearnBtn');
  const mode = (btn && btn.dataset && btn.dataset.mode) || 'learn';
  if (mode === 'review-good') { pathAnswer(2); return; }
  if (mode === 'continue') {
    const items = pathItems();
    if (pathCurrent < items.length - 1) pathCurrent++;
    pathReviewMode = false;
    renderPath();
    return;
  }
  const items = pathItems();
  const x = items[pathCurrent];
  if (!x) return;
  const writes = getKanjiWriteCount(x.kanji);
  if (writes < PRACTICE_GOAL) {
    alert('Write 「' + x.kanji + '」 ' + PRACTICE_GOAL + ' times in Practice first. (' + writes + '/' + PRACTICE_GOAL + ')');
    return;
  }
  pathAnswer(2);
}
async function pathStudy(){
  const x=pathItems()[pathCurrent];
  if(!x)return;
  const cached=Array.isArray(PATH_WORDS_CACHE[x.kanji])?PATH_WORDS_CACHE[x.kanji]:[];
  if(cached.length){setupStudyWords(cached,x.kanji);showMode('study');return;}
  const studyBtn=$('pathStudyBtn'); if(studyBtn)studyBtn.textContent='📖 Loading Words…';
  setupStudyWords([],x.kanji);
  showMode('study');
  try{
    const rows=await ensurePathWords(x.kanji);
    if($('pathStudyBtn'))$('pathStudyBtn').textContent=rows.length?`📖 Study ${rows.length.toLocaleString()} Words`:'📖 Study Vocabulary';
    setupStudyWords(rows,x.kanji);
  }catch(e){
    console.warn('Unable to load vocabulary for Study:',e);
  }
}
function pathWrite(){const x=pathItems()[pathCurrent];if(!x)return;setupPractice([x.setId]);showMode('practice');setTimeout(()=>openPracticeModal(0),80)}

function showMode(next) {
  // Close practice writing modal and other lingering modals when switching modes
  if (typeof closePracticeModal === 'function') closePracticeModal();
  ['setModal', 'resultModal', 'quitModal', 'reviewModal', 'gameConfigModal', 'gameSetupModal'].forEach(id => {
    const m = document.getElementById(id);
    if (m && !m.classList.contains('hidden')) m.classList.add('hidden');
  });
  document.body.classList.remove('modal-open');

  mode = next;
  ['path', 'study', 'practice', 'words'].forEach(k => {
    const el = document.getElementById(k + 'Mode');
    if (el) el.classList.toggle('hidden', k !== mode);
  });
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  if (mode === 'path' && typeof renderPath === 'function') renderPath();
  if (mode === 'words') {
    if (typeof renderWords === 'function') renderWords();
    if (typeof ensureVocabularyLoaded === 'function') ensureVocabularyLoaded();
  }
  if (mode === 'practice' && typeof renderPractice === 'function') renderPractice();
}

/* ---------- EVENTS ---------- */
document.querySelectorAll('.game-menu-card').forEach(btn => {
  btn.onclick = () => openGameSetup(btn.dataset.game);
});
bind('gameConfigCloseX', 'onclick', closeGameSetup);
bind('gameConfigCancel', 'onclick', closeGameSetup);
(() => { const m=$('gameConfigModal'); if(m) m.addEventListener('click', e => { if(e.target === m) closeGameSetup(); }); })();
bind('gameConfigNext', 'onclick', openGameSetStep);
bind('gameSetupCloseX', 'onclick', closeGameSetup);
(() => { const m=$('gameSetupModal'); if(m) m.addEventListener('click', e => { if(e.target === m) closeGameSetup(); }); })();
bind('gameSetupBack', 'onclick', () => { const a=$('gameSetupModal'), b=$('gameConfigModal'); if(a)a.classList.add('hidden'); if(b)b.classList.remove('hidden'); });
bind('gameSetSearch', 'oninput', renderGameSetList);
bind('gameSelectAllSets', 'onclick', () => { gameSetupSelected = SETS.map(x=>x.id); renderGameSetList(); });
bind('gameClearAllSets', 'onclick', () => { gameSetupSelected = []; renderGameSetList(); });
bind('gameSetupStart', 'onclick', startSelectedGame);
bind('gameQuit', 'onclick', () => askQuit('games'));




bind('studyChooseSets', 'onclick', () => openModal('study'));
bind('studyKanjiBtn', 'onclick', () => { const x=pathItems()[pathCurrent]; if(x){ setupStudy([x.setId],true); } });
bind('practiceChooseSets', 'onclick', () => openModal('practice'));

// Path controls
bind('pathLearnBtn', 'onclick', () => pathMarkLearned());
bind('pathStudyBtn', 'onclick', () => pathStudy());
bind('pathWriteBtn', 'onclick', () => pathWrite());
bind('pathAgainBtn', 'onclick', () => pathAnswer(0));

bind('reviewNotifBtn', 'onclick', openReviewReminder);
bind('reviewModalClose', 'onclick', closeReviewModal);
bind('reviewRememberBtn', 'onclick', reviewRemember);
bind('reviewForgotBtn', 'onclick', reviewForgot);

bind('pathReviewToggle', 'onclick', () => { pathReviewMode = !pathReviewMode; renderPath(); });
document.querySelectorAll('#pathLevelFilter .path-level-btn').forEach(btn => {
  btn.onclick = () => {
    pathLevelFilter = btn.getAttribute('data-level') || 'N5';
    document.querySelectorAll('#pathLevelFilter .path-level-btn').forEach(b => b.classList.toggle('active', b === btn));
    pathReviewMode = false;
    const items = pathItems();
    const visible = pathLevelItems(items);
    const p = loadPathProgress();
    let idx = -1;
    for (const x of visible) {
      if (!pathIsLearned(p, x.kanji)) { idx = items.indexOf(x); break; }
    }
    if (idx < 0 && visible.length) idx = items.indexOf(visible[0]);
    if (idx >= 0) pathCurrent = idx;
    renderPath();
  };
});

bind('studyShuffle', 'onclick', () => {
  if (state.study.allCards && state.study.allCards.length) {
    state.study.allCards = shuffled(state.study.allCards);
    applyStudyLevelFilter();
  } else {
    state.study.cards = shuffled(state.study.cards);
    state.study.flips = new Array(state.study.cards.length).fill(false);
  }
  renderStudy();
});
bind('studyReverse', 'onchange', e => {
  state.study.reverse = e.target.checked;
  state.study.flips = new Array(state.study.cards.length).fill(false);
  renderStudy();
});
bind('studyFlipAll', 'onclick', () => {
  const all = state.study.flips.every(Boolean);
  state.study.flips = new Array(state.study.cards.length).fill(!all);
  renderStudy();
});
bind('studyResetFlips', 'onclick', () => {
  state.study.flips = new Array(state.study.cards.length).fill(false);
  renderStudy();
});


bind('quizStartBtn', 'onclick', () => {
  if (!state.quiz.settingsConfigured || !state.quiz.cards.length) {
    $('quizStartHint').textContent = 'Please open Settings and choose sets first.';
    return;
  }
  beginQuiz();
});
bind('histTabGames', 'onclick', () => {
  $('histTabGames').classList.add('active-tab');
  $('histTabPractice').classList.remove('active-tab');
  $('gamesHistoryPanel').classList.remove('hidden');
  $('practiceHistoryPanel').classList.add('hidden');
});
bind('histTabPractice', 'onclick', () => {
  $('histTabPractice').classList.add('active-tab');
  $('histTabGames').classList.remove('active-tab');
  $('practiceHistoryPanel').classList.remove('hidden');
  $('gamesHistoryPanel').classList.add('hidden');
  renderPracticeHistory();
});
bind('clearPracticeHistory', 'onclick', () => {
  if (!confirm('Clear all practice history saved on this device?')) return;
  localStorage.removeItem('kanjiPracticeHistory');
  renderPracticeHistory();
});
bind('quizSettingsIntro', 'onclick', () => openModal('quiz'));
bind('quizQuit', 'onclick', () => askQuit('quiz'));
bind('quitCancel', 'onclick', () => {
  $('quitModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  quitTarget = null;
});
bind('quitConfirm', 'onclick', () => {
  $('quitModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  const key = quitTarget;
  quitTarget = null;
  if (key === 'quiz') {
    clearTimer('quiz');
    state.quiz.playing = false;
    state.quiz.results = [];
    showQuizIntro();
  } else if (key === 'games') {
    quitGame();
  }
});

function quitGame() {
  const s = state.games;
  if (s.timer) {
    clearInterval(s.timer);
    s.timer = null;
  }
  s.playing = false;
  s.results = [];
  s.cards = [];
  s.i = 0;
  s.score = 0;
  s.matchBoard = null;
  s.selectedMatch = null;
  s.matched = 0;
  const bar = $('gameTimerBar');
  if (bar) {
    bar.classList.add('hidden');
    bar.classList.remove('warn', 'danger');
  }
  const fill = $('gameTimerFill');
  if (fill) fill.style.transform = 'scaleX(1)';
  const choiceBox = $('gameChoices');
  if (choiceBox) {
    choiceBox.innerHTML = '';
    choiceBox.dataset.locked = '0';
  }
  const grid = $('matchGrid');
  if (grid) grid.innerHTML = '';
  closePlayModal('gamesPlay');
  $('gamesMenu').classList.remove('hidden');
  showMode('games');
}


function openPlayModal(id) {
  const el = $(id);
  if (!el) return;
  el.classList.remove('hidden');
  el.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}
function closePlayModal(id) {
  const el = $(id);
  if (!el) return;
  el.classList.add('hidden');
  el.setAttribute('aria-hidden', 'true');
  // Keep body locked if another modal is open
  const stillOpen = ['quizPlay','gamesPlay','quitModal','resultModal','setModal','gameConfigModal','gameSetupModal']
    .some(mid => {
      const m = $(mid);
      return m && !m.classList.contains('hidden');
    });
  if (!stillOpen) document.body.classList.remove('modal-open');
}

function askQuit(key) {
  if (!state[key] || !state[key].playing) return;
  quitTarget = key;
  document.body.classList.add('modal-open');
  $('quitModal').classList.remove('hidden');
}

bind('practiceModalClose', 'onclick', closePracticeModal);
bind('practiceModalDone', 'onclick', closePracticeModal);
bind('practiceAnimate', 'onclick', practiceAnimate);
bind('practiceWrite', 'onclick', practiceWrite);
bind('practiceShow', 'onclick', practiceShow);
bind('practicePrevious', 'onclick', practicePreviousKanji);
bind('practiceRewrite', 'onclick', practiceRewrite);
bind('practiceNext', 'onclick', practiceNextKanji);
bind('practiceSkip', 'onclick', practiceSkip);
bind('vocabBankHide', 'onclick', ()=>{
  const bank=$('vocabBank'),show=$('vocabBankShow');
  if(bank)bank.classList.add('hidden');
  if(show)show.classList.remove('hidden');
});
bind('vocabBankShow', 'onclick', ()=>{
  const bank=$('vocabBank'),show=$('vocabBankShow');
  // instant from cache if present
  const key=vocabCacheKey(JOYO_VOCAB_QUERY.trim(),JOYO_VOCAB_PAGE);
  if(JOYO_VOCAB_CACHE[key]&&JOYO_VOCAB_CACHE[key].items){
    JOYO_VOCAB_ITEMS=JOYO_VOCAB_CACHE[key].items;
    JOYO_VOCAB_TOTAL=JOYO_VOCAB_CACHE[key].total||JOYO_VOCAB_ITEMS.length;
    renderVocabBank();
  }
  if(bank)bank.classList.remove('hidden');
  if(show)show.classList.add('hidden');
  fetchVocabPage(); // refresh in background / first load
});
bind('vocabSearch', 'oninput', () => { JOYO_VOCAB_QUERY = $('vocabSearch')?.value || ''; JOYO_VOCAB_PAGE=0; fetchVocabPage(); });
bind('vocabPrevPage', 'onclick', () => { if(JOYO_VOCAB_PAGE>0){ JOYO_VOCAB_PAGE--; fetchVocabPage(); } });
bind('vocabNextPage', 'onclick', () => { JOYO_VOCAB_PAGE++; fetchVocabPage(); });


bind('wordsLoadAll', 'onclick', () => ensureVocabularyLoaded(true));

// Prevent clicks inside the practice dialog from being treated as backdrop clicks.
$('practiceModal').addEventListener('click', e => {
  if (e.target === $('practiceModal')) closePracticeModal();
});

bind('modalCloseX', 'onclick', () => {
  $('setModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
});
$('setModal').addEventListener('click', e => {
  if (e.target === $('setModal')) {
    $('setModal').classList.add('hidden');
    document.body.classList.remove('modal-open');
  }
});

bind('modalCancel', 'onclick', () => {
  $('setModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
});
bind('selectAllSets', 'onclick', () => {
  modalSelected = SETS.map(s => s.id);
  renderSetList();
});
bind('clearAllSets', 'onclick', () => {
  modalSelected = [];
  renderSetList();
});
bind('setSearch', 'oninput', () => renderSetList());

bind('modalStart', 'onclick', () => {
  const ids = [...modalSelected].sort((a, b) => a - b);
  if (!ids.length) {
    alert('Please choose at least one set.');
    return;
  }
  if (modalTarget === 'study') {
    setupStudy(ids, true);
  } else if (modalTarget === 'practice') {
    setupPractice(ids);
  } else if (modalTarget === 'words') {
    setupWords(ids);
  } else if (modalTarget === 'quiz') {
    const timerEl = document.querySelector('input[name="modalTimer"]:checked');
    if (timerEl) state.quiz.timerSeconds = Number(timerEl.value);
    state.quiz.settingsConfigured = true;
    prepareQuiz(ids);
  }
  $('setModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  showMode(modalTarget);
});

bind('historyDetailCloseX', 'onclick', () => {
  $('historyDetailModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
});
bind('historyDetailClose', 'onclick', () => {
  $('historyDetailModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
});
$('historyDetailModal').addEventListener('click', e => {
  if (e.target === $('historyDetailModal')) {
    $('historyDetailModal').classList.add('hidden');
    document.body.classList.remove('modal-open');
  }
});

bind('resultClose', 'onclick', () => {
  $('resultModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  if (mode === 'quiz') showQuizIntro();
  else if (mode === 'games') {
    closePlayModal('gamesPlay');
    $('gamesMenu').classList.remove('hidden');
  }
});
bind('resultHistory', 'onclick', () => {
  $('resultModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  showMode('history');
});
bind('clearHistory', 'onclick', () => {
  if (!confirm('Clear all game history saved on this device?')) return;
  localStorage.removeItem('kanjiGameHistory');
  renderGameHistoryItems([]);
});

document.querySelectorAll('.nav-btn').forEach(b => {
  b.onclick = () => {
    showMode(b.dataset.mode);
  };
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    $('setModal').classList.add('hidden');
    $('gameSetupModal').classList.add('hidden');
    $('gameConfigModal').classList.add('hidden');
    $('resultModal').classList.add('hidden');
    $('historyDetailModal').classList.add('hidden');
    $('quitModal').classList.add('hidden');
    if ($('practiceModal')) closePracticeModal();
    else destroyHanzi();
    document.body.classList.remove('modal-open');
  }
});

window.addEventListener('resize', () => {
  if (!$('practiceModal').classList.contains('hidden') && state.practice.items[state.practice.i]) {
    clearTimeout(window._practiceResizeTimer);
    window._practiceResizeTimer = setTimeout(() => {
      if (hanziWriter) resizePracticeHanzi();
      else loadHanzi(state.practice.items[state.practice.i].kanji);
    }, 100);
  }
});
// Boot — wait for kanji data, then initialize.
// Guest works offline; login optional (admin at /admin.html).
(async () => {
  try {
    await loadKanjiData();
  } catch (err) {
    console.error('Failed to load kanji data:', err);
    // Minimal fallback so the UI does not stay blank
    if (!SETS.length) {
      SETS = [{ id: 1, kanji: '山', cards: [['山', 'やま', 'mountain']] }];
      DATA_LOADED = true;
    }
  }

  setupStudy([1], true);
  setupPractice([1]);
  setupWords([]);
  showMode('path');
  if (typeof loadFullJoyoPath === 'function') loadFullJoyoPath();
  if (typeof bindAuthUi === 'function') bindAuthUi();
  if (typeof refreshCurrentUser === 'function') refreshCurrentUser();
  try { if (typeof prefetchVocabBank === 'function') prefetchVocabBank(); } catch (e) {}
})();
