function appendBits(bits: boolean[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i -= 1) bits.push(((value >>> i) & 1) !== 0);
}

function multiplyGf(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ (((z >>> 7) & 1) * 0x11d);
    if (((y >>> i) & 1) !== 0) z ^= x;
  }
  return z & 0xff;
}

function reedSolomonDivisor(degree: number) {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = multiplyGf(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = multiplyGf(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: number[], divisor: number[]) {
  const result = new Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    for (let i = 0; i < divisor.length; i += 1) result[i] ^= multiplyGf(divisor[i], factor);
  }
  return result;
}

function formatBits(mask: number) {
  const data = (1 << 3) | mask; // Error correction level L = 01.
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function numericCodewords(code: string) {
  const bits: boolean[] = [];
  appendBits(bits, 0x1, 4); // Numeric mode.
  appendBits(bits, code.length, 10); // Version 1-9 numeric character count.
  for (let i = 0; i < code.length; i += 3) {
    const chunk = code.slice(i, i + 3);
    appendBits(bits, Number(chunk), chunk.length === 3 ? 10 : chunk.length === 2 ? 7 : 4);
  }
  const dataCapacityBits = 19 * 8; // Version 1-L.
  appendBits(bits, 0, Math.min(4, dataCapacityBits - bits.length));
  while (bits.length % 8) bits.push(false);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | (bits[i + j] ? 1 : 0);
    data.push(value);
  }
  for (let pad = 0; data.length < 19; pad += 1) data.push(pad % 2 === 0 ? 0xec : 0x11);
  return [...data, ...reedSolomonRemainder(data, reedSolomonDivisor(7))];
}

export function createNumericQrMatrix(value: string) {
  const code = value.replace(/\D/g, "").slice(0, 8);
  if (!/^\d{8}$/.test(code)) return [] as boolean[][];

  const size = 21;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const functions = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setFunction = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    functions[y][x] = true;
  };

  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  for (let i = 8; i < size - 8; i += 1) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }

  const mask = 0;
  const fmt = formatBits(mask);
  const bit = (i: number) => ((fmt >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i += 1) setFunction(8, i, bit(i));
  setFunction(8, 7, bit(6));
  setFunction(8, 8, bit(7));
  setFunction(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) setFunction(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) setFunction(8, size - 15 + i, bit(i));
  setFunction(8, size - 8, true);

  const codewords = numericCodewords(code);
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let vert = 0; vert < size; vert += 1) {
      const y = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        if (functions[y][x]) continue;
        const raw = bitIndex < codewords.length * 8
          ? ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0
          : false;
        bitIndex += 1;
        modules[y][x] = raw !== ((x + y) % 2 === 0);
      }
    }
    upward = !upward;
  }
  return modules;
}
