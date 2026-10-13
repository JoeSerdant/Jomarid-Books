// České tvary podle počtu: 1 den, 2-4 dny, 5 a víc dní (nula patří k „víc“).
export const plural = (n, one, few, many) => {
  const a = Math.abs(Number(n) || 0);
  return a === 1 ? one : a >= 2 && a <= 4 ? few : many;
};
