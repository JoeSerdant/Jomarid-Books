/* bots.js - soupeři: síla (parametry hledání), osobnost, hlášky, čas na rozmyšlenou, vzdávání a remízy.
   Boty nejsou jen "hloubka hledání": každý má vlastní styl, zahájení, tempo a charakter. */
const Bots = (function () {
  // Rating je "ligový" - určuje pořadí a Elo výpočty. Rozestupy 350 vycházejí z měření vzájemných
  // zápasů úrovní (stovky partií mezi sousedními boty): silnější bot vyhrává přibližně 88 % partií.
  // Znovu změřit jde přes "npm run chess:ladder" (viz tests/ladder.mjs).
  // Síla se skládá z hloubky hledání, vidění braní (qd), kvality hodnocení a malého šumu.
  const BOTS = [
    {
      key: "beginner", name: "Pip", emoji: "🐣", colorSoft: "var(--gold-soft)", stars: 1, rating: 500, role: "Nováček",
      blurb: "Právě se vylíhl a pořád se učí, kterým směrem táhnou pěšci.",
      traits: ["Nepředvídatelný", "Chamtivý"],
      // hloubka 2 bez rozšíření braní: bere i chráněné figury (chamtivost) a občas udělá nesmysl
      params: { depth: 2, nodes: 6000, timeMs: 1500, qd: 0, evalLevel: 0, margin: 60, temperature: 20, blunder: 0.06, blunderRange: 350, ttBits: 14, key: "beginner" },
      book: { tags: ["open", "closed"], maxPly: 2, odd: { chance: 0.3, moves: ["a3", "h3", "Nc3", "g3", "e3", "b3"] } },
      think: { base: 700, spread: 0.5, min: 350, max: 2200 },
      resign: null, drawMargin: 150
    },
    {
      key: "easy", name: "Shelly", emoji: "🐢", colorSoft: "var(--green-soft)", stars: 2, rating: 850, role: "Opatrná", fem: true,
      blurb: "Pomalá, ale jistá. Stejnou chybu zopakuje jen zřídka.",
      traits: ["Pomalá", "Opatrná"],
      params: { depth: 1, nodes: 20000, timeMs: 1800, qd: 4, evalLevel: 0, margin: 20, temperature: 0, blunder: 0, ttBits: 15, bias: { castle: 25 }, key: "easy" },
      book: { tags: ["open", "closed", "solid"], maxPly: 4 },
      think: { base: 1800, spread: 0.4, min: 700, max: 4200 },
      resign: null, drawMargin: 80
    },
    {
      key: "medium", name: "Fenwick", emoji: "🦊", colorSoft: "var(--blue-soft)", stars: 3, rating: 1200, role: "Taktik",
      blurb: "Mazaný a taktický — dávej pozor na vidličky.",
      traits: ["Taktik", "Lstivý"],
      params: { depth: 2, nodes: 40000, timeMs: 2000, qd: 5, evalLevel: 1, margin: 25, temperature: 8, blunder: 0, ttBits: 16, bias: { check: 15 }, key: "medium" },
      book: { tags: ["open", "sicilian", "semi", "sharp", "closed"], maxPly: 8 },
      think: { base: 1300, spread: 0.45, min: 500, max: 3400 },
      resign: { score: -1100, count: 3, minMove: 18 }, drawMargin: 40
    },
    {
      key: "hard", name: "Profesor Hůůů", emoji: "🦉", colorSoft: "#F3E6FF", stars: 4, rating: 1550, role: "Stratég",
      blurb: "Myslí několik tahů dopředu a výhody se jen tak nevzdává.",
      traits: ["Stratég", "Důkladný"],
      params: { depth: 3, nodes: 100000, timeMs: 2200, qd: 6, evalLevel: 2, margin: 50, temperature: 15, blunder: 0, ttBits: 17, style: { mob: 1.3, pawn: 1.4, ka: 1, kaOpp: 1.2 }, key: "hard" },
      book: { tags: ["open", "closed", "indian", "flank", "solid", "semi"], maxPly: 12 },
      think: { base: 1600, spread: 0.4, min: 600, max: 3800 },
      resign: { score: -1150, count: 3, minMove: 18 }, drawMargin: 30
    },
    {
      key: "expert", name: "Drak", emoji: "🐉", colorSoft: "var(--red-soft)", stars: 5, rating: 1900, role: "Útočník",
      blurb: "Nemilosrdný kalkulátor. Přines svou nejlepší hru.",
      traits: ["Útočník", "Nemilosrdný"],
      params: { depth: 4, nodes: 300000, timeMs: 2800, qd: 8, evalLevel: 2, margin: 40, temperature: 12, blunder: 0, ttBits: 18, contempt: 25, style: { ka: 1.6, kaOpp: 0.9, mob: 1.1 }, bias: { check: 10 }, key: "expert" },
      book: { tags: ["open", "sicilian", "sharp", "indian", "closed"], maxPly: 16 },
      think: { base: 1200, spread: 0.35, min: 500, max: 3000 },
      resign: null, drawMargin: 0
    }
  ];

  // Odměna v Jomarid Coins za výhru (skutečné udělení hlídá server).
  const COIN_REWARDS = { beginner: 5, easy: 10, medium: 16, hard: 25, expert: 40 };

  // ---------- Hlášky ----------
  const TALK = {
    beginner: {
      start: ["Pip pip! Hrajeme? 🐣", "Já mám bílé... nebo černé? Uvidíme!", "Pípí! Snad vím, jak táhne jezdec."],
      capture: ["Ham! Pípí!", "Ups, to jsem snědl já!", "Hehe, to byla svačinka."],
      lostPiece: ["Hej! To byl můj kamarád!", "Pípí... to bolelo.", "Au! Tohle jsem neviděl."],
      check: ["Pip! Šach! Doufám.", "Hele, tvůj král se zlobí!"],
      inCheck: ["Eeek! Šach?!", "Pípí, mám se bát?"],
      blunder: ["Hele, nechceš to vzít zpátky? 🙈", "Páni, tomu nerozumím."],
      winning: ["Já vedu?! Pípí!", "Wow, to mi jde!"],
      losing: ["Pomóc, já prohrávám!", "To je ale zlé..."],
      hint: ["Ty ses na něco koukal? 👀"],
      undo: ["Můžu to taky? Prosím?"],
      win: ["Vyhrál jsem?! PÍPÍ!", "Hurá! Mami, vyhrál jsem!"],
      loss: ["Gratuluju! Příště se zlepším!", "Ty jsi ale dobrý! Pip pip!"],
      draw: ["Remíza? To je skoro výhra!", "Nikdo nevyhrál... tak jo."],
      drawAccept: ["Tak jo, remíza! 🤝"], drawDecline: ["Ne, ještě chci hrát!"], drawEarly: ["Ale my jsme sotva začali!"]
    },
    easy: {
      start: ["Nikam nespěchejme... 🐢", "Dobrý den. Dej si čas.", "Mám celý den."],
      capture: ["Pomalu, ale jistě.", "Díky za figurku."],
      lostPiece: ["Hm. Zapamatuju si to.", "To jsem opravdu neviděla."],
      check: ["Šach. V klidu."],
      inCheck: ["Hm, šach. Ustoupím."],
      blunder: ["Možná sis to měl rozmyslet déle.", "Hmm, to mě překvapilo."],
      winning: ["Pomalu se to láme na mou stranu."],
      losing: ["Vypadá to zle... ale nevzdávám se."],
      hint: ["Tahle nápověda je trochu rychlá..."],
      undo: ["Vrátit tah? To jde?"],
      win: ["Pomalu, ale jistě. 🐢"],
      loss: ["Dobře zahráno. Opravdu."],
      draw: ["Remíza. Taky v pořádku."],
      drawAccept: ["Dobrá, remíza."], drawDecline: ["Ještě chvíli počkám."], drawEarly: ["Je moc brzy. Hrajme dál."]
    },
    medium: {
      start: ["Hihi, tak si zahrajeme. 🦊", "Pozor na vidličky!", "Dnes mám dobrý den."],
      capture: ["Ham! Lišák bere.", "Tohle jsi čekal?"],
      lostPiece: ["Au. Příště budu mazanější.", "Hm, to byla past... ne na tebe."],
      check: ["Šach! Hihi.", "Král se musí hýbat!"],
      inCheck: ["Šach? No jo."],
      blunder: ["Oh, ty mi dáváš dárky? 🎁", "To se mi líbí!"],
      winning: ["Past sklapla!", "Vidlička je připravená..."],
      losing: ["Nevadí, mám v rukávu ještě trik."],
      hint: ["Hej, to je podvádění!"],
      undo: ["Zpátky? Dobrý trik. 😏"],
      win: ["Mazanost vítězí! 🦊"],
      loss: ["Dobře, dobře, tentokrát ty."],
      draw: ["Remíza... nuda."],
      resign: ["Tak jo, vzdávám to. Dobrá práce! 🦊"],
      drawAccept: ["Fajn, remíza."], drawDecline: ["Ne, ne, ještě jsem neskončil."], drawEarly: ["Tak brzy? To není zábava."]
    },
    hard: {
      start: ["Hůůů. Zahájíme partii. 🦉", "Teorie říká, že bílý má malou výhodu.", "Dobrá. Soustřeďme se."],
      capture: ["Materiální zisk. Hůů.", "Podle teorie se to dalo čekat."],
      lostPiece: ["Zajímavé. Tohle jsem započítal... špatně.", "Hůů. Ztráta materiálu."],
      check: ["Šach. Hůů.", "Králi, hýbej se."],
      inCheck: ["Šach. Zajímavé."],
      blunder: ["Hůů, tohle je chyba, mladý příteli.", "Podle analýzy je to nepřesnost."],
      winning: ["Pozice se mi pozvolna zlepšuje.", "Mám výhodu, hůů."],
      losing: ["Hmm, pozice je těžká. Hůů."],
      hint: ["Využít pomoc? Zajímavé... hůů."],
      undo: ["Vrátit tah? Neobvyklé."],
      win: ["Hůůů. Vyhrál jsem. Poučíme se z toho.", "Teorie zvítězila."],
      loss: ["Skvělá partie! Gratuluji, hůůů.", "Vzdávám hold. Dobrá hra."],
      draw: ["Remíza. Vyrovnaný boj, hůů."],
      resign: ["Vzdávám se. Gratuluji, hůůů."],
      drawAccept: ["Souhlasím s remízou."], drawDecline: ["Nesouhlasím. Pozice je pro mě příznivější."], drawEarly: ["Příliš brzy na remízu, hůů."]
    },
    expert: {
      start: ["Přines mi svou nejlepší hru. 🐉", "Zvedni figurky. Zničím je.", "Hrrr. Začněme."],
      capture: ["Chroupu tvoje figurky!", "Další kořist."],
      lostPiece: ["Hmpf. Ztráta nic neznamená.", "To tě bude stát."],
      check: ["Šach. Utíkej.", "Tvůj král hoří!"],
      inCheck: ["Šach? Drzost."],
      blunder: ["Chyba. Žádné slitování.", "Děkuju za dar."],
      winning: ["Cítím krev.", "Už je to jen otázka času."],
      losing: ["Ještě jsem neřekl poslední slovo!"],
      hint: ["Pomoc? Slabost."],
      undo: ["Vracíš tahy? Žádná čest."],
      win: ["Další kořist. 🔥", "Žádné slitování."],
      loss: ["Překvapivé... Respektuji tě.", "Hmpf. Dnes tvoje zlato. Příště ne."],
      draw: ["Remíza... neuspokojivé."],
      drawAccept: ["Hmpf. Remíza."], drawDecline: ["Draci remízu nepřijímají."], drawEarly: ["Boj teprve začíná."]
    }
  };

  function talkLine(botKey, kind, rng) {
    const lines = TALK[botKey] && TALK[botKey][kind];
    if (!lines || !lines.length) return null;
    return lines[Math.floor(rng() * lines.length)];
  }

  // ---------- Čas na rozmyšlenou ----------
  function gauss(rng) {
    const u = Math.max(1e-9, rng()), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  // Kolik milisekund má bot "přemýšlet", než táhne: teorie jde rychle, jediný tah okamžitě,
  // složité pozice déle, odvetné braní rychle. Se zapnutými hodinami nespotřebuje všechno.
  // info: { book, forced, legal, recapture, inCheck, ply }
  function thinkDelay(bot, info, rng, remainingMs) {
    const t = bot.think;
    let ms;
    if (info.book) ms = 300 + rng() * 550;
    else if (info.forced) ms = 220 + rng() * 280;
    else {
      ms = t.base;
      ms *= Math.min(1.6, Math.max(0.45, (info.legal || 30) / 30));
      if (info.recapture) ms *= 0.55;
      if (info.inCheck) ms *= 0.7;
      if ((info.ply || 0) < 12) ms *= 0.75;
      ms *= Math.exp(gauss(rng) * t.spread);
      ms = Math.min(t.max, Math.max(t.min, ms));
    }
    if (remainingMs != null) ms = Math.min(ms, Math.max(150, remainingMs / 25));
    return Math.round(ms);
  }

  // ---------- Remíza ----------
  // score = skóre z pohledu bota (setiny pěšce), moveNo = číslo tahu. Vrací "accept" | "decline" | "early".
  function drawDecision(bot, score, moveNo, rng) {
    if (moveNo < 12) return "early";
    if (score > bot.drawMargin) return "decline";
    if (score >= -40 && rng() < 0.2) return "decline"; // občas ještě chce hrát
    return "accept";
  }

  // Bot se vzdá, když je opravdu beznadějně pozadu několik tahů po sobě. Vrací true, pokud se má vzdát.
  function shouldResign(bot, scores, moveNo) {
    const r = bot.resign;
    if (!r || moveNo < r.minMove || scores.length < r.count) return false;
    for (let i = scores.length - r.count; i < scores.length; i++) if (scores[i] > r.score) return false;
    return true;
  }

  return { BOTS, COIN_REWARDS, TALK, talkLine, thinkDelay, drawDecision, shouldResign, gauss };
})();
