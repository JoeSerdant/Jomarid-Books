// Značka pro české texty v konstantách na úrovni modulu (seznamy štítků, katalogy odznaků...): vrátí text beze změny.
// Kontrola překladů (src/tests/i18n.test.mjs) podle ní pozná, že text patří mezi klíče slovníku; přeložit se musí až při
// vykreslení: t(polozka.label). Je v samostatném souboru, ať ji mohou používat i datové moduly bez zbytku překladové vrstvy.
export const tk = (cs) => cs;
