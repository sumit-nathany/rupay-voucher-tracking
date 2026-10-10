import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

const VERSION = 'v1';
const IV_LEN = 12;
const TAG_LEN = 16;

function parseKey(raw: string): Buffer {
  const b64 = raw.startsWith('base64:') ? raw.slice('base64:'.length) : raw;
  return Buffer.from(b64, 'base64');
}

function decrypt(ciphertext: string, rowId: string, key: Buffer): string {
  const prefix = `${VERSION}.`;
  if (!ciphertext.startsWith(prefix)) throw new Error('Unsupported ciphertext format');
  const buf = Buffer.from(ciphertext.slice(prefix.length), 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  decipher.setAAD(Buffer.from(rowId, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

function encrypt(plaintext: string, rowId: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(Buffer.from(rowId, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${Buffer.concat([iv, tag, ct]).toString('base64')}`;
}

async function main() {
  const args = process.argv.slice(2);
  const isMock = args.includes('--mock');
  const prodKeyArg = args.find((a) => a.startsWith('--prod-key='))?.split('=')[1] || process.env.PROD_VOUCHER_ENCRYPTION_KEY;

  // Load preprod env
  const preprodCandidates = [
    resolve(process.cwd(), '.env.preprod'),
    resolve(process.cwd(), 'web/.env.preprod'),
  ];
  const preprodPath = preprodCandidates.find((p) => existsSync(p));
  if (!preprodPath) throw new Error('Could not find .env.preprod');
  const preprodEnv = readFileSync(preprodPath, 'utf8');
  const preprodKeyMatch = preprodEnv.match(/VOUCHER_ENCRYPTION_KEY=(.*)/);
  const preprodDbMatch = preprodEnv.match(/DATABASE_URL=(.*)/);
  if (!preprodKeyMatch || !preprodDbMatch) throw new Error('Could not parse preprod env');
  const preprodKey = parseKey(preprodKeyMatch[1].trim());
  const preprodDbUrl = preprodDbMatch[1].trim();

  const preprod = postgres(preprodDbUrl, { prepare: false });

  try {
    const instances = await preprod`
      SELECT id, code_encrypted, order_status, rupay_booking_id
      FROM app.benefit_instances
      WHERE code_encrypted IS NOT NULL
    `;
    console.log(`[reencrypt] Found ${instances.length} instances with code_encrypted in preprod.`);

    if (isMock) {
      console.log('[reencrypt] Generating mock test vouchers encrypted with preprod key...');
      let updated = 0;
      for (const inst of instances) {
        const shortId = inst.id.slice(0, 8).toUpperCase();
        const mockCode = `PREPROD-${shortId} 9999`;
        const newCipher = encrypt(mockCode, inst.id, preprodKey);
        await preprod`
          UPDATE app.benefit_instances
          SET code_encrypted = ${newCipher}
          WHERE id = ${inst.id}
        `;
        updated++;
      }
      console.log(`[reencrypt] ✓ Successfully set ${updated} mock vouchers readable in preprod!`);
      return;
    }

    if (!prodKeyArg) {
      console.error('[reencrypt] Error: No production key provided.');
      console.error('Usage options:');
      console.error('  npx tsx scripts/db/reencrypt-vouchers.ts --prod-key=<PROD_VOUCHER_ENCRYPTION_KEY>');
      console.error('  npx tsx scripts/db/reencrypt-vouchers.ts --mock (to populate readable mock vouchers)');
      process.exit(1);
    }

    const prodKey = parseKey(prodKeyArg);
    console.log('[reencrypt] Decrypting with prod key and re-encrypting with preprod key...');
    let successCount = 0;
    let failCount = 0;

    for (const inst of instances) {
      try {
        const plain = decrypt(inst.code_encrypted, inst.id, prodKey);
        const newCipher = encrypt(plain, inst.id, preprodKey);
        await preprod`
          UPDATE app.benefit_instances
          SET code_encrypted = ${newCipher}
          WHERE id = ${inst.id}
        `;
        successCount++;
      } catch (e: any) {
        failCount++;
        console.warn(`[reencrypt] Failed to decrypt instance ${inst.id}: ${e.message}`);
      }
    }

    console.log(`[reencrypt] Done: ${successCount} successfully re-encrypted, ${failCount} failed.`);
  } finally {
    await preprod.end();
  }
}

main().catch((err) => {
  console.error('[reencrypt] Error:', err);
  process.exit(1);
});
