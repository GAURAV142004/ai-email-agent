import crypto from 'crypto'

// TOKEN_ENCRYPTION_KEY must be exactly 32 ASCII characters (32 bytes for AES-256)
const SECRET = process.env.TOKEN_ENCRYPTION_KEY!

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(SECRET), iv)
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

export function decryptToken(encrypted: string): string {
  const [ivHex, encHex] = encrypted.split(':')
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(SECRET),
    Buffer.from(ivHex, 'hex')
  )
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]).toString()
}

export function safeDecrypt(token: string): string {
  // Encrypted tokens are hex:hex format (iv:ciphertext)
  // Plain Google tokens start with ya29. or have no colon
  const looksEncrypted = token.includes(':') &&
                         !token.startsWith('ya29.') &&
                         !token.startsWith('1/')
  return looksEncrypted ? decryptToken(token) : token
}
