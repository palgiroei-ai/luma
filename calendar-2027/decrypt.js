// Decrypts the calendar payload with the access code (format: academy-calendar/src/crypto.mjs).
// Returns null for a wrong code.
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function decryptJSON(box, code) {
  try {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(box.salt), iterations: box.iter, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}
