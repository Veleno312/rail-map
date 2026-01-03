// Mulberry32 PRNG (deterministic given seed)
export function makeRng(seedU32) {
  let a = (seedU32 >>> 0);

  function nextU32() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0);
  }

  return {
    seed: a >>> 0,
    nextU32,
    next01() {
      return nextU32() / 4294967296;
    },
    fork(tag) {
      return makeRng((a ^ hashStringToU32(tag)) >>> 0);
    },
  };
}

function hashStringToU32(s) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
