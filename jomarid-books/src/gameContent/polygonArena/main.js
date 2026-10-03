// Start hry: zpřístupní ladicí rozhraní window.__arena a po načtení stránky spustí hru.
document.addEventListener('DOMContentLoaded', () => {
  window.__arena = document.documentElement.__arena = { TREE, offerOf, perkOfferOf, choosePerk, STAT_CAP, STAT_MAX, BONUS_XP, MAX_LEVEL, xpFor, addScore, tanks, shapes, bullets, parts, cam, view, input, update, render, startGame, toMenu, buyStat, chooseClass, setAuto, setPause, buildBots, setupMatch, CLASSES, CLASS_IDS, BOSS_IDS, TIER5_IDS, MAP_PRESETS, PERKS, PICKS, DIFFS, SHAPES, world, save, ACH, SKINS, dash, spawnBoss, runEvent, spawnPickup, sandboxEquip, sandboxPrep, checkAch, openColl, closeColl, recalc,
    get state() { return state; }, get player() { return player; }, get time() { return time; }, get paused() { return paused; }, get mode() { return mode; }, set mode(v) { mode = v; refreshMenu(); }, get shake() { return shake; }, setDiff(k) { diffKey = k; refreshMenu(); } };
  boot();
});
