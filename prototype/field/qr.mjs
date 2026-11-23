// A QR code for a short text (byte mode, error correction level M, versions 1 to 10),
// drawn as SVG: the venue card's code that opens a work's page. Written after ISO/IEC
// 18004 and Project Nayuki's reference description of it.
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

const multiply = (x, y) => {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
};

function divisor(degree) {
  const result = Array.from({ length: degree }, () => 0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = multiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = multiply(root, 2);
  }
  return result;
}

export function remainder(data, div) {
  const result = div.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    div.forEach((coef, i) => (result[i] ^= multiply(coef, factor)));
  }
  return result;
}

const rawModules = v => {
  let result = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const align = Math.floor(v / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (v >= 7) result -= 36;
  }
  return result;
};
const dataCodewords = v => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * BLOCKS[v];

function alignments(v) {
  if (v === 1) return [];
  const count = Math.floor(v / 7) + 2;
  const step = Math.ceil((v * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = v * 4 + 17 - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** The modules of the QR code for `text` (true: dark), row by row. */
export function qrModules(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  const bitsFor = v => 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
  while (version <= 10 && bitsFor(version) > dataCodewords(version) * 8) version++;
  if (version > 10) throw new Error('The text is too long for this QR code.');
  const capacity = dataCodewords(version) * 8;
  const bits = [];
  const put = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Error correction blocks, interleaved.
  const blocks = BLOCKS[version];
  const eccLength = ECC_PER_BLOCK[version];
  const raw = Math.floor(rawModules(version) / 8);
  const short = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const div = divisor(eccLength);
  const parts = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const length = shortLength - eccLength + (i < short ? 0 : 1);
    const block = data.slice(k, k + length);
    k += length;
    const ecc = remainder(block, div);
    if (i < short) block.push(0);
    parts.push(block.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < parts[0].length; i++)
    parts.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= short) codewords.push(block[i]);
    });

  // The function patterns.
  const size = version * 4 + 17;
  const dark = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const fixed = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  const set = (x, y, on) => {
    dark[y][x] = on;
    fixed[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx,
          y = cy + dy;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
      }
  const align = alignments(version);
  align.forEach((ay, i) =>
    align.forEach((ax, j) => {
      const last = align.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  const format = mask => {
    const value = mask; // level M is 00
    let rem = value;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((value << 10) | rem) ^ 0x5412;
    const bit = i => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const on = ((v >>> i) & 1) === 1;
      const a = size - 11 + (i % 3),
        b = Math.floor(i / 3);
      set(a, b, on);
      set(b, a, on);
    }
  }

  // The codewords, in two-module columns from the bottom right, up and down.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fixed[y][x] && i < codewords.length * 8) {
          dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }

  // The mask that leaves the fewest long runs, 2×2 blocks and imbalance.
  const masks = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    x => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const flip = m => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) if (!fixed[y][x] && masks[m](x, y)) dark[y][x] = !dark[y][x];
  };
  const penalty = () => {
    let score = 0,
      darkCount = 0;
    for (let a = 0; a < size; a++)
      for (const line of [b => dark[a][b], b => dark[b][a]]) {
        let run = 1;
        for (let b = 1; b <= size; b++) {
          if (b < size && line(b) === line(b - 1)) run++;
          else {
            if (run >= 5) score += run - 2;
            run = 1;
          }
        }
      }
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        if (dark[y][x]) darkCount++;
        if (x < size - 1 && y < size - 1) {
          const c = dark[y][x];
          if (c === dark[y][x + 1] && c === dark[y + 1][x] && c === dark[y + 1][x + 1]) score += 3;
        }
      }
    const total = size * size;
    return score + (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
  };
  let best = 0,
    bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    flip(m);
    format(m);
    const score = penalty();
    if (score < bestScore) [best, bestScore] = [m, score];
    flip(m);
  }
  flip(best);
  format(best);
  return dark;
}

/** The QR code for `text` as SVG, with its quiet zone. */
export function qrSvg(text) {
  const modules = qrModules(text);
  const size = modules.length + 8;
  let path = '';
  modules.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) path += `M${x + 4} ${y + 4}h1v1h-1z`;
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
