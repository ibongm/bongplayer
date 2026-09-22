/** Standard iterative radix-2 Cooley-Tukey FFT, in place. `real`/`imag` length must be a power of 2. */
export function fft(real: Float64Array, imag: Float64Array): void {
  const n = real.length;

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tempReal = real[i];
      real[i] = real[j];
      real[j] = tempReal;
      const tempImag = imag[i];
      imag[i] = imag[j];
      imag[j] = tempImag;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angleStep = (-2 * Math.PI) / len;
    const wReal = Math.cos(angleStep);
    const wImag = Math.sin(angleStep);
    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;
      const half = len / 2;
      for (let j = 0; j < half; j++) {
        const uReal = real[i + j];
        const uImag = imag[i + j];
        const vReal = real[i + j + half] * curReal - imag[i + j + half] * curImag;
        const vImag = real[i + j + half] * curImag + imag[i + j + half] * curReal;
        real[i + j] = uReal + vReal;
        imag[i + j] = uImag + vImag;
        real[i + j + half] = uReal - vReal;
        imag[i + j + half] = uImag - vImag;
        const nextReal = curReal * wReal - curImag * wImag;
        const nextImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
        curImag = nextImag;
      }
    }
  }
}

/** Smallest power of 2 that is >= n. */
export function nextPowerOfTwo(n: number): number {
  let power = 1;
  while (power < n) power *= 2;
  return power;
}
