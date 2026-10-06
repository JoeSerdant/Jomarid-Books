// 4. stupeň: ručně navržené vrcholové třídy a pomocné úpravy tříd.
/* ---------- 4. stupeň: nejvyšší vývoj (jedna vrcholová třída ke každé třídě 3. stupně) ---------- */
const BUL_KINDS = { bullet: 1, missile: 1, bomb: 1 };
const t4 = {
  clone: id => { const c = CLASSES[id]; return Object.assign({}, c, { barrels: c.barrels.map(b => Object.assign({}, b)) }); },
  st: (c, o) => { for (const k in o) c[k] *= o[k]; },
  bul: (c, o) => {
    for (const b of c.barrels) {
      if (b.turret || !BUL_KINDS[b.kind]) continue;
      if (o.dmg) b.dmg *= o.dmg; if (o.spd) b.spd *= o.spd; if (o.size) b.size *= o.size;
      if (o.pierce) { b.pierce += o.pierce; if (o.pierce >= 2) b.streak = b.streak || b.kind === 'bullet' && b.w < 0.5; }
      if (o.bounce) b.bounce += o.bounce;
      if (o.blast) b.blast = b.blast ? b.blast * (o.blastMul || 1.4) : o.blast;
    }
  },
  rear: (c, k) => { const add = []; for (const b of c.barrels) if (!b.turret && (b.kind === 'bullet' || b.kind === 'missile' || b.kind === 'trap')) add.push(Object.assign({}, b, { a: b.a + PI, dmg: b.dmg * k, delay: (b.delay + 0.5) % 1 })); c.barrels.push(...add); },
  tur: (c, n, dmg, dist, tsize) => { c.barrels.push(...ring(n, { turret: true, dist: dist || 0.7, len: 1.0, w: 0.5, tsize: tsize || 0.3, dmg: dmg || 0.55, spd: 1.1, size: 0.85, recoil: 0 })); },
  add: (c, base, o) => { c.barrels.push(Object.assign({}, c.barrels[base], o)); },
};
function T4(id, from, name, info, fn) {
  const c = t4.clone(from); c.name = name; c.info = info; c.tier = 4; fn(c);
  CLASSES[id] = C(c); (TREE[from] = TREE[from] || []).push(id);
}
/* dvojčata a kulomety */
T4('zenit', 'penta', 'Zenit', 'Pětice střel a tři věže', c => t4.tur(c, 3, 0.55, 0.3));
T4('bourka', 'spreadshot', 'Bouře', 'Hustý vějíř i dozadu', c => { t4.rear(c, 0.6); t4.st(c, { reload: 1.05 }); });
T4('dvanact', 'hexa', 'Dvanáctihlaveň', 'Střílí na všechny strany', c => { t4.rear(c, 0.85); t4.st(c, { reload: 1.1 }); });
T4('bitevni', 'cruiser', 'Bitevní křižník', 'Rychlé střely a pancíř', c => { t4.bul(c, { dmg: 1.15, spd: 1.25 }); t4.st(c, { hp: 1.4 }); });
T4('tornado', 'vulcan', 'Tornádo', 'Extrémní rychlost palby', c => { t4.st(c, { reload: 0.62, range: 1.1 }); t4.bul(c, { dmg: 0.9 }); });
T4('armada', 'salvo', 'Armáda', 'Salvy s výbušnými střelami', c => t4.bul(c, { blast: 55, dmg: 1.1 }));
/* ostřelci */
T4('orel', 'ranger', 'Orel', 'Nekonečný dostřel, střely pronikají', c => { t4.bul(c, { pierce: 3 }); t4.st(c, { range: 1.25, zoom: 0.86 }); });
T4('duch', 'stalker', 'Duch', 'Rychlejší lovec s většími ranami', c => { t4.st(c, { speed: 1.2, reload: 0.85 }); t4.bul(c, { dmg: 1.2 }); });
T4('kat', 'predator', 'Kat', 'Trojice průrazných střel', c => t4.bul(c, { pierce: 2, dmg: 1.25 }));
T4('kometa', 'streamliner', 'Kometa', 'Proud střel se zpětným výstřelem', c => { t4.rear(c, 0.5); t4.st(c, { reload: 1.1 }); });
/* drony */
T4('imperator', 'overlord', 'Imperátor', 'Dvanáct dronů a dvě věže', c => { t4.st(c, { maxDrones: 1.5 }); t4.tur(c, 2, 0.6); });
T4('mracno', 'swarm', 'Mračno', 'Nekonečný roj dronů', c => t4.st(c, { maxDrones: 1.7, reload: 0.8 }));
T4('apokalypsa', 'annihilator', 'Apokalypsa', 'Gigantická střela s výbuchem', c => { t4.bul(c, { blast: 110, dmg: 1.3 }); });
T4('chimera', 'hybrid', 'Chiméra', 'Dělo, drony i věže', c => { t4.st(c, { maxDrones: 1.7 }); t4.tur(c, 2, 0.6); });
/* rozprašovače a plameny */
T4('cyklon', 'hurricane', 'Cyklón', 'Rychlé střely dopředu i dozadu', c => t4.rear(c, 0.7));
T4('bombarder', 'cannonade', 'Bombardér', 'Výbušné střely na dálku', c => t4.bul(c, { blast: 48, dmg: 1.1 }));
T4('peklo', 'inferno', 'Peklo', 'Plameny s větším dosahem', c => { t4.st(c, { range: 1.5 }); t4.bul(c, { dmg: 1.3 }); });
T4('ohnivyvir', 'vichr', 'Ohnivý vír', 'Plameny na všechny strany', c => t4.rear(c, 1));
T4('zhouba', 'ravager', 'Zhouba', 'Brokovnice s průrazem', c => t4.bul(c, { pierce: 1, dmg: 1.3 }));
T4('raznice', 'canister', 'Ráznice', 'Kartáč s výbuchem', c => t4.bul(c, { blast: 40, dmg: 1.2 }));
/* křídla a pevnosti */
T4('slunce', 'octo', 'Slunce', 'Osm hlavní a čtyři věže', c => { t4.tur(c, 4, 0.5, 0.35); t4.st(c, { reload: 1.1 }); });
T4('hvezdokup', 'pentagram', 'Hvězdokup', 'Pentagram s věžemi uprostřed', c => t4.tur(c, 3, 0.6, 0.3));
T4('eso', 'fighter', 'Eso', 'Rychlý a nebezpečný', c => { t4.st(c, { speed: 1.15, reload: 0.85 }); t4.bul(c, { dmg: 1.15 }); });
T4('raketoplan', 'thruster', 'Raketoplán', 'Ohromná rychlost a střely dozadu', c => { t4.st(c, { speed: 1.2 }); t4.rear(c, 0.6); });
T4('bastion', 'citadel', 'Bastion', 'Obří pevnost se čtyřmi věžemi', c => { t4.st(c, { hp: 1.5 }); t4.tur(c, 4, 0.55); });
T4('zurivec', 'berserker', 'Zuřivec', 'Nezničitelný a smrtící', c => { t4.st(c, { ram: 1.8, hp: 1.4 }); t4.bul(c, { dmg: 1.2 }); });
/* pasti */
T4('zakopy', 'minefield', 'Zákopy', 'Dvakrát tolik min', c => t4.st(c, { maxTraps: 1.7, reload: 0.85 }));
T4('fantom', 'sneak', 'Fantom', 'Rychlé a silné pasti', c => { t4.st(c, { speed: 1.2, maxTraps: 1.5 }); t4.bul(c, { dmg: 1.2 }); });
T4('architekt', 'engineer', 'Architekt', 'Odolná stavba s věžemi', c => { t4.st(c, { maxTraps: 1.4, hp: 1.2 }); t4.tur(c, 2, 0.6); });
T4('hradby', 'barricader', 'Hradby', 'Nekonečné barikády', c => { t4.st(c, { maxTraps: 1.8 }); for (const b of c.barrels) b.hp *= 1.5; });
T4('obleceni', 'siege', 'Obléhací stroj', 'Pasti a střely s výbuchem', c => t4.bul(c, { blast: 48 }));
T4('velitel', 'guardian', 'Velitel pastí', 'Pasti doplněné věžemi', c => { t4.st(c, { maxTraps: 1.4 }); t4.tur(c, 3, 0.6); });
/* věže */
T4('osmivez', 'auto5', 'Osmivěž', 'Osm samočinných věží', c => t4.tur(c, 3, 0.55, 0.3));
T4('vezhuri', 'autoStorm', 'Věžový hurikán', 'Devět rychlých věží', c => t4.tur(c, 3, 0.42, 0.55, 0.26));
T4('vezdel', 'autoTwin', 'Dělostřelecké dvojče', 'Dvojče a čtyři věže', c => { t4.tur(c, 2, 0.55, 0.6); t4.bul(c, { dmg: 1.1 }); });
T4('vezitan', 'autoBattle', 'Titánská věž', 'Těžké dělo a osm věží', c => { t4.tur(c, 4, 0.45, 0.4); t4.st(c, { hp: 1.3 }); t4.bul(c, { dmg: 1.2 }); });
T4('sokol', 'autoGuard', 'Sokolí oko', 'Průrazný ostřelec s věžemi', c => { t4.bul(c, { pierce: 3 }); t4.st(c, { range: 1.15 }); });
T4('basta', 'autoFort', 'Nedobytná bašta', 'Pevnost s osmi věžemi', c => { t4.tur(c, 4, 0.55, 0.35); t4.st(c, { hp: 1.3 }); });
/* odraz, průraz, rakety, bomby */
T4('automat', 'pinball', 'Automat', 'Osm odrážejících se střel', c => { t4.rear(c, 1); t4.bul(c, { bounce: 1 }); });
T4('snooker', 'billiard', 'Snooker', 'Odrazivé koule s výbuchem', c => t4.bul(c, { blast: 48, bounce: 1 }));
T4('rail3', 'rail2', 'Tříkolejnice', 'Tři průrazné hlavně', c => { t4.add(c, 0, { off: 0, delay: 0.25 }); t4.bul(c, { dmg: 0.95 }); });
T4('paprsek', 'lancer', 'Paprsek', 'Prorazí úplně vším', c => t4.bul(c, { pierce: 16, spd: 1.2, dmg: 1.15 }));
T4('salva', 'swarmer', 'Raketová salva', 'Deset naváděných střel', c => { t4.rear(c, 1); });
T4('nemesis', 'seeker', 'Nemesis', 'Obří střela s dvojitým výbuchem', c => { t4.bul(c, { blast: 1, blastMul: 1.6, dmg: 1.3 }); t4.st(c, { reload: 0.9 }); });
T4('bomba', 'howitzer', 'Bomba', 'Nejtěžší dělostřelectvo', c => { t4.bul(c, { blast: 1, blastMul: 1.5, dmg: 1.4 }); t4.st(c, { range: 1.2 }); });
T4('baterie', 'grenadier', 'Dělostřelecká baterie', 'Pět bomb v řadě', c => { t4.add(c, 0, { a: -0.6, delay: 0.5 }); t4.add(c, 2, { a: 0.6, delay: 0.75 }); });
