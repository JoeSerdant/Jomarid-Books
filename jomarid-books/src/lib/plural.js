// České tvary podle počtu: 1 den, 2-4 dny, 5 a víc dní (nula patří k „víc“). Platí poslední číslice:
// 22-24 jsou „dny“, 12-14 „dní“, 21 „dní“, 102 „dny“.
export const plural = (n, one, few, many) => {
  const a = Math.abs(Number(n) || 0);
  const last = a % 10;
  const lastTwo = a % 100;
  return a === 1 ? one : last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14) ? few : many;
};
