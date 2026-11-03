import { fail } from './errors.mjs';

const encode = value => Buffer.from(value).toString('base64url');
const decode = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 100_000) fail('invalid_request');
  return Buffer.from(value, 'base64url');
};
const aad = context => new TextEncoder().encode(JSON.stringify(context));

/** Standard hybrid encryption: only the enrolled controller has the RSA private key. */
export async function sealDelivery(payload, publicKey, context) {
  if (publicKey?.kty !== 'RSA' || publicKey.d || publicKey.p || publicKey.q) fail('invalid_request');
  const recipient = await crypto.subtle.importKey('jwk', publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  if (recipient.algorithm.modulusLength < 2048) fail('invalid_request');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(context) }, key, new TextEncoder().encode(JSON.stringify(payload)));
  const wrappedKey = await crypto.subtle.encrypt('RSA-OAEP', recipient, await crypto.subtle.exportKey('raw', key));
  return { version: 1, context, iv: encode(iv), wrappedKey: encode(wrappedKey), ciphertext: encode(ciphertext) };
}

/** Called only by the trusted controller helper, never by MCP. */
export async function openDelivery(envelope, privateKey, expected) {
  if (envelope?.version !== 1 || !envelope.context || Object.entries(expected).some(([key, value]) => envelope.context[key] !== value)) fail('forbidden');
  const recipient = await crypto.subtle.importKey('jwk', privateKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  const raw = await crypto.subtle.decrypt('RSA-OAEP', recipient, decode(envelope.wrappedKey));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv), additionalData: aad(envelope.context) }, key, decode(envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}
