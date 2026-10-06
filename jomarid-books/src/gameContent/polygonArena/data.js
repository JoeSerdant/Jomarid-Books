// Data: výhody, bonusy na mapě, zkušenosti, tvary.
/* ---------- výhody (perky) ---------- */
const PERK_LEVELS = [5, 12, 20, 30, 40];
const PERKS = [
  { id: 'vamp', name: 'Upíří střely', info: 'Zásahy tanků tě léčí (12 %)', ic: 'heart' },
  { id: 'armor', name: 'Pancéřové střely', info: 'Střely vydrží o 70 % víc', ic: 'arrow' },
  { id: 'bounce', name: 'Odrazivé střely', info: 'Střely se odrážejí od okrajů', ic: 'zig' },
  { id: 'explode', name: 'Výbušné střely', info: 'Střely při zániku vybuchnou', ic: 'burst' },
  { id: 'crit', name: 'Kritické zásahy', info: '18 % střel zraní dvojnásobně', ic: 'target' },
  { id: 'thorn', name: 'Ostny', info: 'Náraz zraňuje o 80 % víc', ic: 'spike' },
  { id: 'shield', name: 'Energetický štít', info: 'Dobíjecí štít (30 % zdraví)', ic: 'shield' },
  { id: 'tough', name: 'Obrněné tělo', info: '+30 % zdraví, −6 % rychlosti', ic: 'plus' },
  { id: 'swift', name: 'Rychlonožka', info: '+14 % rychlosti pohybu', ic: 'wing' },
  { id: 'rapid', name: 'Rychlé nabíjení', info: 'Střílíš o 14 % rychleji', ic: 'clock' },
  { id: 'far', name: 'Dalekonosné střely', info: '+30 % dostřel, +10 % rychlost střel', ic: 'arrow' },
  { id: 'hunter', name: 'Lovec hlav', info: '+25 % zranění tankům', ic: 'target' },
  { id: 'farmer', name: 'Farmář', info: '+40 % zranění tvarům, +20 % XP z nich', ic: 'coin' },
  { id: 'adren', name: 'Adrenalin', info: 'Pod 40 % zdraví: +25 % rychlost a +20 % zranění', ic: 'bolt' },
  { id: 'greed', name: 'Hltavec', info: 'Za zničení tanku +25 % zdraví', ic: 'heart' },
  { id: 'regen', name: 'Regenerace+', info: 'Dvojnásobná regenerace', ic: 'plus' },
  { id: 'magnet', name: 'Magnet', info: 'Bonusy tě samy přitahují', ic: 'magnet' },
  { id: 'dashp', name: 'Bleskový skok', info: 'Skok se dobíjí o 45 % rychleji', ic: 'wing' },
  { id: 'slow', name: 'Mrazivé střely', info: 'Zasažení soupeři zpomalí', ic: 'snow' },
  { id: 'minion', name: 'Velitel', info: '+50 % dronů a pastí, odolnější', ic: 'swarm' },
  { id: 'knock', name: 'Odpal', info: 'Střely odhazují soupeře', ic: 'fist' },
  { id: 'scholar', name: 'Učenec', info: '+15 % veškerých zkušeností', ic: 'star' },
];
const PERK_BY = {}; for (const p of PERKS) PERK_BY[p.id] = p;

/* ---------- bonusy na mapě ---------- */
const PICKS = {
  heal: { name: 'Oprava', color: '#5fdc7a', w: 30, ic: 'plus' },
  xp: { name: 'Zkušenosti', color: '#f5c542', w: 30, ic: 'star' },
  speed: { name: 'Turbo', color: '#5fd6f2', w: 14, ic: 'wing' },
  dmg: { name: 'Síla', color: '#f2695f', w: 14, ic: 'burst' },
  shield: { name: 'Štít', color: '#9aa8ff', w: 12, ic: 'shield' },
};

/* ---------- XP ---------- */
const xpFor = L => (L <= 1 ? 0 : Math.round(11 * Math.pow(L - 1, 2) * (1 + (L - 1) / 70)));
function levelFor(score, from) { let L = from || 1; while (L < MAX_LEVEL && score >= xpFor(L + 1)) L++; return L; }

/* ---------- tvary ---------- */
const SHAPES = {
  square: { n: 4, r: 22, hp: 12, xp: 10, dps: 8, loss: 5, color: '#f0c14b' },
  tri:    { n: 3, r: 25, hp: 32, xp: 25, dps: 14, loss: 7, color: '#ea6f69' },
  pent:   { n: 5, r: 40, hp: 110, xp: 130, dps: 22, loss: 11, color: '#8f88ea' },
  hex:    { n: 6, r: 62, hp: 320, xp: 520, dps: 32, loss: 16, color: '#4fd1a5' },
  gold:    { n: 4, r: 20, hp: 16, xp: 70, dps: 6, loss: 4, color: '#ffd34d' },
  crystal: { n: 6, r: 24, hp: 170, xp: 320, dps: 18, loss: 10, color: '#5cc8ff' },
  bomb:    { n: 8, r: 28, hp: 60, xp: 80, dps: 26, loss: 8, color: '#48546a' },
  alpha:   { n: 5, r: 96, hp: 1500, xp: 2600, dps: 40, loss: 22, color: '#b46cf2' },
};
