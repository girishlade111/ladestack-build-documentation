// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CryptoKey = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BufferSource = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KeyUsage = any

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

function base64Encode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64Decode(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function utf8Encode(str: string): ArrayBuffer {
  const encoder = new TextEncoder();
  return encoder.encode(str).buffer;
}

function utf8Decode(buffer: ArrayBuffer): string {
  const decoder = new TextDecoder();
  return decoder.decode(buffer);
}

async function getKeyMaterial(password: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return keyMaterial;
}

async function deriveKey(
  keyMaterial: CryptoKey,
  salt: BufferSource,
  usage: KeyUsage[]
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 600000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    usage
  );
}

export class EncryptionService {
  async encrypt(plaintext: string, key: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const keyMaterial = await getKeyMaterial(key);
    const aesKey = await deriveKey(keyMaterial, salt, ["encrypt"]);

    const encrypted = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      aesKey,
      utf8Encode(plaintext)
    );

    const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, SALT_LENGTH);
    combined.set(new Uint8Array(encrypted), SALT_LENGTH + IV_LENGTH);

    return base64Encode(combined.buffer as ArrayBuffer);
  }

  async decrypt(encryptedData: string, key: string): Promise<string> {
    const combined = new Uint8Array(base64Decode(encryptedData));

    const salt = combined.slice(0, SALT_LENGTH);
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const data = combined.slice(SALT_LENGTH + IV_LENGTH);

    const keyMaterial = await getKeyMaterial(key);
    const aesKey = await deriveKey(keyMaterial, salt, ["decrypt"]);

    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      aesKey,
      data.buffer as ArrayBuffer
    );

    return utf8Decode(decrypted);
  }

  async encryptApiKey(apiKey: string, userPublicKey: string): Promise<string> {
    return this.encrypt(apiKey, userPublicKey);
  }

  async decryptApiKey(encryptedKey: string, userPrivateKey: string): Promise<string> {
    return this.decrypt(encryptedKey, userPrivateKey);
  }

  async generateEncryptionKey(): Promise<string> {
    const key = crypto.getRandomValues(new Uint8Array(32));
    return base64Encode(key.buffer);
  }

  async hashKey(key: string): Promise<string> {
    const enc = new TextEncoder();
    const hash = await crypto.subtle.digest("SHA-256", enc.encode(key));
    return base64Encode(hash);
  }
}

export const encryptionService = new EncryptionService();
