import path from 'node:path';
import os from 'node:os';

export const base = (p) => (p ? path.basename(String(p)) : '');

// une ligne, espaces compactés : pour les bulles et les libellés
export const cut = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// garde la mise en forme (retours à la ligne, listes) contrairement à cut()
export const clip = (s, n) => { s = String(s ?? '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export const host = (u) => { try { return new URL(u).host; } catch { return ''; } };

export const expandHome = (p) => path.resolve(String(p || '').replace(/^~(?=\/|$)/, os.homedir()));
