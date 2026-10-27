# Encrypted personal study room

Static GitHub Pages entry point. The document and download archive are encrypted before publication.

- Encryption: AES-256-GCM, independent 96-bit nonces, authenticated asset identifiers.
- Key derivation: PBKDF2-HMAC-SHA-256, 600,000 iterations, random 128-bit salt.
- The passcode is not included in the repository or sent to a server.
- Decryption keys stay in page memory; refreshing or locking requires the passcode again.
- Study progress remains local to each browser.

Published files contain only the loader, styles, encryption metadata and ciphertext.
Unencrypted source material and encryption tooling are maintained outside this repository.

Changing the passcode requires re-encrypting both assets and publishing a new version.
Previously downloaded encrypted files remain decryptable with the passcode used for that version.
