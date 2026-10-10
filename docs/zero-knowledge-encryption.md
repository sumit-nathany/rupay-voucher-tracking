# Zero-Knowledge Voucher Code Encryption Plan

## 1. Objective

When launching the portal for public self-service signups, protect user privacy by ensuring that **the server administrator, host, and database have zero access to users' plaintext voucher codes**.

Even with full access to the production database and application server, it must be cryptographically impossible for anyone other than the account owner to view or decrypt stored voucher codes.

---

## 2. Threat Model & Security Guarantees

| Threat Vector | Current Model (Server-side AES) | Zero-Knowledge Model (E2EE) |
| :--- | :--- | :--- |
| **Database Compromise / Leak** | Protected only if `VOUCHER_ENCRYPTION_KEY` is not leaked. | **Protected**: Only uncrackable ciphertexts exist in the DB. |
| **Malicious Server Admin / Insider** | Admin has keys and can decrypt all codes. | **Protected**: Admin has zero keys to decrypt user vouchers. |
| **Legal Subpoena / Compelled Disclosure** | Server owner could be compelled to decrypt user data. | **Protected**: Server owner does not possess the keys. |
| **User Loses Credentials** | Admin can reset password and restore voucher access. | **Data is permanently lost** unless user has a recovery key. |

---

## 3. Cryptographic Architecture

Zero-knowledge requires **Client-Side Encryption** via the browser's native `window.crypto.subtle` (Web Crypto API):

```
User Master Password / Vault PIN
               │
               ▼  Argon2id / PBKDF2 (Client Browser)
┌───────────────────────────────────────────────┐
│              Master Key (256-bit)             │
└──────────────┬─────────────────┬──────────────┘
               │                 │
       HKDF-Expand (Salt A)   HKDF-Expand (Salt B)
               │                 │
               ▼                 ▼
   Auth Key (Sent to server)  Encryption Key (NEVER sent to server)
   (Used to log into Supabase)           │
                                         ▼
                               Unlocks User Vault Key
                                         │
                                         ▼
                         Encrypts/Decrypts Voucher Codes
                         (Directly in User's Browser via Web Crypto)
```

### Key Principles:
1. **Never Send Secrets**: Plaintext passwords, passphrases, and raw encryption keys never leave the user's browser.
2. **Envelope Encryption**:
   - Each user has a unique 256-bit **User Vault Key** (UVK).
   - The UVK is encrypted with the user's derived key and stored in the database as `encrypted_vault_key`.
   - Voucher codes are encrypted with the UVK using `AES-256-GCM` with a random 12-byte IV per voucher and the instance ID as AAD (Additional Authenticated Data).
3. **Session Lifespan**:
   - The decrypted UVK resides only in browser memory (JavaScript state).
   - Discarded when the user logs out, closes the tab, or after an inactivity timeout (e.g., 10 minutes).

---

## 4. Evaluation of Architectural Approaches

### Approach A: Dedicated Client-Side "Vault PIN / Passphrase" (Recommended)
* **Design**:
  - Keep Supabase Auth for login (supports Email/Password, Google OAuth, Magic Links).
  - On first visit to vouchers, user configures a 6-to-8 character Vault PIN or passphrase.
  - User's browser derives the UVK from this PIN + a user salt.
* **Pros**:
  - Completely decouples account authentication from encryption.
  - Supports Google / Apple / Magic Link login seamlessly.
  - Clean UX for "Lock Vault" timeouts without kicking the user out of the app.
* **Cons**:
  - User has two credentials: login password and vault PIN.

### Approach B: Single Unified Master Password (Bitwarden / 1Password Model)
* **Design**:
  - Disallow social login; require email + master password only.
  - Client splits master password into `AuthKey` (for Supabase) and `EncryptionKey` (for vouchers).
* **Pros**:
  - Only one password for the user to remember.
* **Cons**:
  - Incompatible with social OAuth (Google/Apple) or passwordless links.
  - Significant customization needed on top of Supabase Auth.

### Approach C: WebAuthn / Passkeys with PRF Extension (Biometrics)
* **Design**:
  - Use browser WebAuthn (TouchID, FaceID, Windows Hello) with the `prf` (Pseudo-Random Function) extension to generate a hardware-backed symmetric key.
* **Pros**:
  - Passwordless, biometric, state-of-the-art UX.
* **Cons**:
  - Browser support for the WebAuthn PRF extension is still evolving (primarily Chromium and modern Safari).

---

## 5. Critical Product Trade-offs & Decisions

### 1. Account Recovery ("Forgot Password")
* In a true zero-knowledge system, **the server cannot reset a lost vault PIN/password**.
* **Requirement**: Provide an **Emergency Recovery Kit** on setup:
  - Generate a 128-bit random recovery code (e.g. `ABCD-1234-EFGH-5678`).
  - Encrypt the User Vault Key with this recovery code and store it in the DB.
  - Instruct the user to save/download the recovery code.
  - If the user forgets their PIN and loses the recovery code, voucher data is cryptographically unrecoverable.

### 2. Automated Emails & Background Notifications
* The server **cannot** read voucher codes to include them in automated reminder emails (e.g. *"Your Uber code is XYZ"*).
* The server **can** still send notifications about non-sensitive metadata (e.g. *"Your Uber benefit expires in 3 days; log in to redeem it."*).

### 3. Search & Database Indexing
* Voucher codes cannot be searched using SQL `LIKE` or database indexes.
* Search on brand, category, status, and dates remains fully operational because metadata is not encrypted.

### 4. Multi-Device Synchronization
* When a user logs in on a new device (e.g. mobile phone), they enter their Vault PIN.
* The device derives the same key, decrypts the stored `encrypted_vault_key`, and gains access to all vouchers immediately.

---

## 6. Implementation Roadmap (When Ready to Build)

1. **Phase 1: Client Crypto Utility**
   - Implement `web/src/lib/client-crypto.ts` using `window.crypto.subtle`.
   - Functions: `deriveKey(pin, salt)`, `encryptVoucher(code, key, id)`, `decryptVoucher(ciphertext, key, id)`.

2. **Phase 2: Database Schema & Migration**
   - Add `vault_salt`, `encrypted_vault_key`, and `recovery_encrypted_vault_key` to `app.workspaces` or user profile.
   - Retain `code_encrypted` column format (`v2.<base64>`).

3. **Phase 3: Vault Setup & Unlock UI**
   - Create a `VaultContext` provider in React.
   - Modal to set up Vault PIN + generate downloadable Recovery Kit PDF/text.
   - In-drawer "Unlock Vault" prompt when viewing or entering voucher codes.
   - Auto-lock after inactivity timeout.

4. **Phase 4: Deprecate Server-Side AES**
   - Remove `VOUCHER_ENCRYPTION_KEY` from server environment variables.
   - Remove `revealCodeAction` and `setCodeAction` server-side encryption logic, turning them into pure ciphertext storage actions.
