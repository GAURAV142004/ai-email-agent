export interface PiiPattern {
  type: string;
  pattern: RegExp;
  replacement: string;
}

export const PII_PATTERNS: PiiPattern[] = [
  // Passwords
  { type: 'password', pattern: /password\s*[:=]\s*\S+/gi,            replacement: 'password: [MASKED]' },
  { type: 'password', pattern: /pwd\s*[:=]\s*\S+/gi,                 replacement: 'pwd: [MASKED]' },
  { type: 'password', pattern: /pass\s*[:=]\s*\S+/gi,                replacement: 'pass: [MASKED]' },

  // API keys and tokens
  { type: 'api_key',  pattern: /api[_-]?key\s*[:=]\s*[A-Za-z0-9_\-]{16,}/gi, replacement: 'api_key: [MASKED_KEY]' },
  { type: 'api_key',  pattern: /sk-[A-Za-z0-9]{32,}/g,               replacement: '[MASKED_SK_KEY]' },
  { type: 'api_key',  pattern: /AIza[0-9A-Za-z\-_]{35}/g,            replacement: '[MASKED_GOOGLE_KEY]' },
  { type: 'api_key',  pattern: /AKIA[0-9A-Z]{16}/g,                  replacement: '[MASKED_AWS_KEY]' },
  { type: 'token',    pattern: /bearer\s+[A-Za-z0-9_\-\.]{20,}/gi,   replacement: 'Bearer [MASKED_TOKEN]' },
  { type: 'token',    pattern: /token\s*[:=]\s*[A-Za-z0-9_\-\.]{16,}/gi, replacement: 'token: [MASKED_TOKEN]' },
  { type: 'secret',   pattern: /secret\s*[:=]\s*\S{8,}/gi,           replacement: 'secret: [MASKED_SECRET]' },

  // Usernames and credentials
  { type: 'username', pattern: /username\s*[:=]\s*\S+/gi,            replacement: 'username: [MASKED]' },

  // Connection strings
  { type: 'conn_str', pattern: /(mongodb|postgresql|mysql|redis|mssql):\/\/[^\s]+/gi, replacement: '[MASKED_CONN_STRING]' },

  // Private keys
  { type: 'private_key', pattern: /-----BEGIN [A-Z ]+ KEY-----[\s\S]+?-----END [A-Z ]+ KEY-----/g, replacement: '[MASKED_PRIVATE_KEY]' },

  // Indian phone numbers
  { type: 'phone',    pattern: /(\+91[\s\-]?)?[6-9]\d{9}/g,          replacement: '[MASKED_PHONE]' },

  // Credit/debit cards
  { type: 'card',     pattern: /\b(?:\d{4}[\s\-]?){3}\d{4}\b/g,      replacement: '[MASKED_CARD]' },

  // Indian government IDs
  { type: 'aadhaar',  pattern: /\b\d{4}\s\d{4}\s\d{4}\b/g,           replacement: '[MASKED_AADHAAR]' },
  { type: 'pan',      pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,         replacement: '[MASKED_PAN]' },
];
