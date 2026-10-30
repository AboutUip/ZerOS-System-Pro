/** 测试内存按 4 KiB 页稀疏分配，覆盖 -slot 0..7；不是产品内存或性能替代实现。 */
export function guestMemory() {
  const pages = new Map();
  const limitBit = 1n << 32n;
  let readOctets = 0;
  let writeOctets = 0;
  const visible = new Map();
  function address(bit) {
    if (bit < 0n || bit >= limitBit || bit % 8n !== 0n) throw Error('guest memory bounds/alignment');
    return Number(bit / 8n);
  }
  function load(bit) {
    const at = address(bit);
    ++readOctets;
    return pages.get(Math.floor(at / 4096))?.[at % 4096] ?? 0;
  }
  function store(bit, value) {
    const at = address(bit);
    if (!Number.isInteger(value) || value < 0 || value > 255) throw Error('guest octet outside 0..255');
    const key = Math.floor(at / 4096);
    if (!pages.has(key)) pages.set(key, new Uint8Array(4096));
    pages.get(key)[at % 4096] = value;
    if (bit < 1048576n) visible.set(at, value);
    ++writeOctets;
  }
  function word(bit, width, value) {
    if (width === 1) {
      if (value === undefined) return BigInt((load(bit - bit % 8n) >> Number(bit % 8n)) & 1);
      if (value !== 0n && value !== 1n) throw Error('guest bit outside 0..1');
      const base = bit - bit % 8n;
      const mask = 1 << Number(bit % 8n);
      store(base, (load(base) & ~mask) | (Number(value) << Number(bit % 8n)));
      return 0n;
    }
    address(bit); address(bit + BigInt(width - 8));
    const bits = BigInt(width);
    if (value !== undefined) {
      const low = width === 8 ? 0n : -(1n << (bits - 1n));
      const high = width === 8 ? 255n : (1n << (bits - 1n)) - 1n;
      if (value < low || value > high) throw Error('guest integer does not fit memory width');
      const raw = BigInt.asUintN(width, value);
      for (let index = 0; index < width / 8; ++index) store(bit + BigInt(index * 8), Number((raw >> BigInt(index * 8)) & 255n));
      return 0n;
    }
    let raw = 0n;
    for (let index = 0; index < width / 8; ++index) raw |= BigInt(load(bit + BigInt(index * 8))) << BigInt(index * 8);
    return width === 8 ? raw : BigInt.asIntN(width, raw);
  }
  function seed(bytes, base = 0n) {
    for (let index = 0; index < bytes.length; ++index) store(base + BigInt(index * 8), bytes[index]);
    visible.clear(); readOctets = writeOctets = 0;
  }
  return {limitBit,load,store,word,seed,visible:()=>Array.from(visible).sort((a,b)=>a[0]-b[0]),counters:()=>({readOctets,writeOctets,pages:pages.size})};
}
