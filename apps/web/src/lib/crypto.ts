export async function generateKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey("raw", key);
  const exportedKeyBuffer = new Uint8Array(exported);
  const base64String = btoa(String.fromCharCode(...exportedKeyBuffer));
  // Make base64 URL safe
  return base64String.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function importKey(base64String: string): Promise<CryptoKey> {
  let b64 = base64String.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) {
    b64 += '=';
  }
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return await crypto.subtle.importKey(
    "raw",
    bytes,
    "AES-GCM",
    true,
    ["encrypt", "decrypt"]
  );
}

export async function encryptForTransfer(chunk: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, chunk);
  
  const payload = new Uint8Array(12 + ciphertext.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(ciphertext), 12);
  
  return payload.buffer;
}

export async function decryptFromTransfer(payload: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
  const payloadArray = new Uint8Array(payload);
  const iv = payloadArray.slice(0, 12);
  const ciphertext = payloadArray.slice(12);
  
  return await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
}
