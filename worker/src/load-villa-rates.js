import * as villaRatesModule from '../../data/villa-rates.js';

// data/villa-rates.js is a classic script: it sets globalThis.VillaRates and,
// under Node's CommonJS loader, module.exports. It has no ESM default export.
// esbuild treats the file as ESM when a parent package.json says "type": "module",
// so a default import fails the Worker bundle. The namespace import keeps the
// script in the bundle, and the fallback reads the global the script always sets.
function ratesApi(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  if (typeof candidate.buildQuote === 'function' && typeof candidate.parseISODate === 'function') {
    return candidate;
  }
  return null;
}

export function loadVillaRates() {
  return ratesApi(villaRatesModule && villaRatesModule.default)
    || ratesApi(villaRatesModule)
    || ratesApi(globalThis.VillaRates)
    || null;
}

export const villaRates = loadVillaRates();

if (!villaRates) {
  throw new Error('Villa rates failed to load');
}
