# Encrypted personal study room

Static GitHub Pages entry point. The document and download archive are encrypted before publication.

- Encryption: AES-256-GCM, independent 96-bit nonces, authenticated asset identifiers.
- Key derivation: PBKDF2-HMAC-SHA-256, 600,000 iterations, random 128-bit salt.
- The passcode is not included in the repository or sent to a server.
- Decryption keys stay in page memory; refreshing or locking requires the passcode again.
- Study progress, quiz answers, notes and the current chapter synchronize through a dedicated Supabase project. Browser-local copies support offline work; cloud payloads use independent AES-GCM encryption.

Published files contain only the loader, styles, encryption metadata and ciphertext.
Unencrypted source material, encryption tooling, the scoped synchronization capability and data encryption key are maintained outside this repository. Synchronization settings are published only in passcode-encrypted sync.enc. No database administrator or service-role key is used in the browser.

Changing the passcode requires re-encrypting all assets, including sync.enc, and publishing a new version. To revoke a compromised old passcode, also rotate the scoped sync capability and data encryption key and migrate the cloud state; re-encrypting the page alone cannot revoke old downloaded copies.
Previously downloaded encrypted files remain decryptable with the passcode used for that version.

## Synchronization

Changes are saved locally immediately and queued for cloud synchronization. The client merges per-field logical clocks, retries revision conflicts and retains recent distinct note versions. Other active devices check for updates every 15 seconds and when returning to the tab. A manual sync button is also available.

The database has row-level security. Invoker functions set a transaction-local scoped capability; only its hash is stored in the authorization row. Direct table reads return no rows, and an incorrect capability cannot read or update the state. The passcode is never sent to the synchronization service.

The hosted version supplies synchronization to the decrypted book. The downloadable offline HTML retains local storage and import/export; it does not contain cloud credentials. A new browser should open the hosted study room to continue across devices.

The mobile layout was checked at 393×852 CSS pixels. Physical iPhone Safari testing is separate. Supabase free projects may pause after prolonged inactivity; the app retains local changes and shows a retry state when the server is unavailable.

The original app.js is retained for older cached HTML. New pages load the versioned module app-sync-v2.mjs.
