// Skryté pole (číslo verze úplně dole v menu) a cheat menu. Kód je u všech her stejný: 67MILUJU.
// Cheaty slouží k testování odznaků a postupu bez hodin hraní, takže mění skutečný postup: ukládají se a hlásí appce jako jakýkoli jiný výsledek.
const CHEAT_CODE = '67MILUJU';
const elCheat = $('cheat'), elCheatMsg = $('cheatMsg'), elVersionField = $('versionField');
let cheatMsgTimer = 0;

function openCheat() {
  elCheatMsg.textContent = '';
  elCheat.classList.remove('hidden');
}
function closeCheat() { elCheat.classList.add('hidden'); }
function cheatSay(text) {
  elCheatMsg.textContent = text;
  clearTimeout(cheatMsgTimer);
  cheatMsgTimer = setTimeout(() => { elCheatMsg.textContent = ''; }, 2500);
}

const CHEAT_BOSSES = 5, CHEAT_WAVE = 10, CHEAT_CLASSES = 400, CHEAT_HELL_LEVEL = 25;   // aspoň tolik, aby šly vyzkoušet odznaky z catalog.js
const CHEATS = {
  level: () => { save.st.bestLevel = Math.max(save.st.bestLevel || 1, MAX_LEVEL); return 'Nejvyšší dosažená úroveň je ' + MAX_LEVEL + '.'; },
  boss: () => { save.st.bosses = (save.st.bosses || 0) + CHEAT_BOSSES; return 'Poražených bossů: ' + save.st.bosses + '.'; },
  win: () => { save.st.wins = (save.st.wins || 0) + 1; return 'Vyhraných zápasů: ' + save.st.wins + '.'; },
  // výhry v režimech a vlny v Přežití
  modes: () => {
    const st = save.st;
    st.hillWins = (st.hillWins || 0) + 1; st.royaleWins = (st.royaleWins || 0) + 1; st.rushWins = (st.rushWins || 0) + 1;
    st.bestWave = Math.max(st.bestWave || 0, CHEAT_WAVE);
    for (const m of MODE_IDS) st.modesPlayed[m] = true;
    return 'Vyhrané režimy: Král kopce, Poslední přeživší, Hon na bossy. Přežití: ' + st.bestWave + ' vln.';
  },
  // sbírka: všechny druhy bossů, objevené třídy, nejvyšší stupeň třídy a úroveň na Pekle
  collect: () => {
    const st = save.st;
    for (const id of BOSS_IDS) st.bossKinds[id] = true;
    for (const id of CLASS_IDS.slice(0, CHEAT_CLASSES)) save.codex[id] = true;
    st.bestTier = Math.max(st.bestTier || 0, TIER_LEVELS.length);
    st.hellBest = Math.max(st.hellBest || 0, CHEAT_HELL_LEVEL);
    return 'Sbírka: všechny druhy bossů, ' + codexCount() + ' tříd, ' + st.bestTier + '. stupeň a úroveň ' + st.hellBest + ' na Pekle.';
  }
};
$('cheatList').addEventListener('click', e => {
  const btn = evTarget(e).closest ? evTarget(e).closest('[data-cheat]') : null;
  if (!btn || !own(CHEATS, btn.dataset.cheat)) return;
  const text = CHEATS[btn.dataset.cheat]();
  persist();                       // uloží postup a nahlásí rekordy appce (odznaky)
  trackProgress();                 // zapíše objevené třídy, úroveň a stupeň
  refreshMenu();
  cheatSay(text);
});
$('cheatClose').addEventListener('click', closeCheat);
document.addEventListener('keydown', e => { if (e.code === 'Escape' && !elCheat.classList.contains('hidden')) closeCheat(); });

// Znak z klávesy nezávisle na rozložení: na české klávesnici dává řada čísel bez Shiftu písmena s háčky, proto se číslice berou podle e.code.
function cheatKeyChar(e) {
  const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code || '');
  if (m) return m[1];
  return typeof e.key === 'string' && /^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : null;
}
function applyCheatCode(value) {
  if (String(value || '').replace(/\s+/g, '').toUpperCase() !== CHEAT_CODE) return false;
  elVersionField.value = '';
  elVersionField.blur();
  openCheat();
  return true;
}
// Psaní z měkké klávesnice nebo vložení: hotový text v poli; z klávesnice počítače: posledních znaků podle kódu klávesy.
let cheatKeyBuf = '';
elVersionField.addEventListener('input', () => { applyCheatCode(elVersionField.value); });
elVersionField.addEventListener('keydown', e => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const ch = cheatKeyChar(e);
  if (!ch) return;
  cheatKeyBuf = (cheatKeyBuf + ch).slice(-CHEAT_CODE.length);
  if (cheatKeyBuf === CHEAT_CODE) { cheatKeyBuf = ''; applyCheatCode(CHEAT_CODE); }
});
elVersionField.addEventListener('blur', () => { elVersionField.value = ''; cheatKeyBuf = ''; });
