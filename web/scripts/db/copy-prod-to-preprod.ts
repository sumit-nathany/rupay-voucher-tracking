import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

const PROD_PROJECT = process.env.PROD_SUPABASE_PROJECT_REF || 'kdtkvzbkppdqjjqzinbi';
const SUPABASE_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';

// Crypto helpers for AES-256-GCM
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

const val = (v: any) => (v === undefined ? null : v);

async function queryProd<T>(sql: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROD_PROJECT}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Prod query failed: ${res.status} ${txt}`);
  }
  return res.json() as Promise<T[]>;
}

async function main() {
  console.log('[copy-data] Starting data copy from Production to Pre-Production...');

  // 1. Read keys
  let prodKeyRaw = process.env.PROD_VOUCHER_ENCRYPTION_KEY;
  if (!prodKeyRaw) {
    const prodBakCandidates = [
      resolve(process.cwd(), '.env.local.prod.bak'),
      resolve(process.cwd(), 'web/.env.local.prod.bak'),
    ];
    const prodBakPath = prodBakCandidates.find((p) => existsSync(p));
    if (prodBakPath) {
      const prodBak = readFileSync(prodBakPath, 'utf8');
      const prodKeyMatch = prodBak.match(/VOUCHER_ENCRYPTION_KEY=(.*)/);
      if (prodKeyMatch) prodKeyRaw = prodKeyMatch[1].trim();
    }
  }
  const prodKey = prodKeyRaw ? parseKey(prodKeyRaw) : null;

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

  // 2. Connect to pre-prod
  const preprod = postgres(preprodDbUrl, { prepare: false });

  try {
    // Get pre-prod workspace
    const [wsRow] = await preprod`SELECT workspace_id FROM app.workspace_members LIMIT 1`;
    if (!wsRow) throw new Error('No preprod workspace found!');
    const preprodWorkspaceId = wsRow.workspace_id as string;
    console.log(`[copy-data] Target Pre-Prod Workspace ID: ${preprodWorkspaceId}`);

    // Fetch prod shared catalog
    console.log('[copy-data] Fetching shared catalog from Production...');
    const cardVariants = await queryProd<any>('SELECT * FROM app.card_variants ORDER BY sort_order');
    const bankCardTypes = await queryProd<any>('SELECT * FROM app.bank_card_types');
    const benefits = await queryProd<any>('SELECT * FROM app.benefits');
    const catalogVersions = await queryProd<any>('SELECT * FROM app.benefit_catalog_versions');
    const benefitOptions = await queryProd<any>('SELECT * FROM app.benefit_options');

    // Fetch prod workspace-scoped data
    console.log('[copy-data] Fetching cards, holders, and instances from Production...');
    const cardHolders = await queryProd<any>('SELECT * FROM app.card_holders');
    const cards = await queryProd<any>('SELECT * FROM app.cards');
    const benefitInstances = await queryProd<any>('SELECT * FROM app.benefit_instances');

    console.log('[copy-data] Summary of data to import:', {
      cardVariants: cardVariants.length,
      bankCardTypes: bankCardTypes.length,
      benefits: benefits.length,
      catalogVersions: catalogVersions.length,
      benefitOptions: benefitOptions.length,
      cardHolders: cardHolders.length,
      cards: cards.length,
      benefitInstances: benefitInstances.length,
    });

    await preprod.begin(async (tx) => {
      // 1. card_variants
      const variantIdMap = new Map<string, string>();
      for (const cv of cardVariants) {
        const [row] = await tx`
          INSERT INTO app.card_variants (name, sort_order, active, portal_card_type)
          VALUES (${val(cv.name)}, ${val(cv.sort_order)}, ${val(cv.active)}, ${val(cv.portal_card_type)})
          ON CONFLICT (name) DO UPDATE SET
            sort_order = EXCLUDED.sort_order,
            active = EXCLUDED.active,
            portal_card_type = EXCLUDED.portal_card_type
          RETURNING id
        `;
        variantIdMap.set(cv.id, row.id);
      }
      console.log(`[copy-data] ✓ Upserted ${cardVariants.length} card variants`);

      // 2. bank_card_types
      for (const bct of bankCardTypes) {
        const mappedVariantId = bct.variant_id ? variantIdMap.get(bct.variant_id) ?? bct.variant_id : null;
        await tx`
          INSERT INTO app.bank_card_types (
            id, display_name, bank_name, card_type, network, curation_status, active,
            created_at, variant_id, portal_card_id
          ) VALUES (
            ${val(bct.id)}, ${val(bct.display_name)}, ${val(bct.bank_name)}, ${val(bct.card_type)},
            ${val(bct.network)}, ${val(bct.curation_status)}, ${val(bct.active)}, ${val(bct.created_at)},
            ${mappedVariantId}, ${val(bct.portal_card_id)}
          )
          ON CONFLICT (id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            curation_status = EXCLUDED.curation_status,
            variant_id = EXCLUDED.variant_id,
            portal_card_id = EXCLUDED.portal_card_id
        `;
      }
      console.log(`[copy-data] ✓ Upserted ${bankCardTypes.length} bank card types`);

      // 3. benefits
      for (const b of benefits) {
        await tx`
          INSERT INTO app.benefits (id, bank_card_type_id, created_at)
          VALUES (${val(b.id)}, ${val(b.bank_card_type_id)}, ${val(b.created_at)})
          ON CONFLICT (id) DO UPDATE SET bank_card_type_id = EXCLUDED.bank_card_type_id
        `;
      }
      console.log(`[copy-data] ✓ Upserted ${benefits.length} benefits`);

      // 4. benefit_catalog_versions
      for (const v of catalogVersions) {
        await tx`
          INSERT INTO app.benefit_catalog_versions (
            id, benefit_id, benefit_type, benefit_provider, exact_benefit, frequency,
            instance_count, offer_kind, effective_from, effective_to, default_cash_value, created_at
          ) VALUES (
            ${val(v.id)}, ${val(v.benefit_id)}, ${val(v.benefit_type)}, ${val(v.benefit_provider)}, ${val(v.exact_benefit)},
            ${val(v.frequency)}, ${val(v.instance_count)}, ${val(v.offer_kind)}, ${val(v.effective_from)}, ${val(v.effective_to)},
            ${val(v.default_cash_value)}, ${val(v.created_at)}
          )
          ON CONFLICT (id) DO UPDATE SET
            benefit_type = EXCLUDED.benefit_type,
            benefit_provider = EXCLUDED.benefit_provider,
            exact_benefit = EXCLUDED.exact_benefit,
            frequency = EXCLUDED.frequency,
            instance_count = EXCLUDED.instance_count,
            offer_kind = EXCLUDED.offer_kind,
            effective_from = EXCLUDED.effective_from,
            effective_to = EXCLUDED.effective_to,
            default_cash_value = EXCLUDED.default_cash_value
        `;
      }
      console.log(`[copy-data] ✓ Upserted ${catalogVersions.length} catalog versions`);

      // 5. benefit_options
      for (const o of benefitOptions) {
        await tx`
          INSERT INTO app.benefit_options (
            id, version_id, provider, offer_name, cash_value, portal_offer_id, sort_order, created_at
          ) VALUES (
            ${val(o.id)}, ${val(o.version_id)}, ${val(o.provider)}, ${val(o.offer_name)}, ${val(o.cash_value)},
            ${val(o.portal_offer_id)}, ${val(o.sort_order)}, ${val(o.created_at)}
          )
          ON CONFLICT (id) DO UPDATE SET
            provider = EXCLUDED.provider,
            offer_name = EXCLUDED.offer_name,
            cash_value = EXCLUDED.cash_value,
            portal_offer_id = EXCLUDED.portal_offer_id,
            sort_order = EXCLUDED.sort_order
        `;
      }
      console.log(`[copy-data] ✓ Upserted ${benefitOptions.length} benefit options`);

      // 6. card_holders
      for (const h of cardHolders) {
        await tx`
          INSERT INTO app.card_holders (id, workspace_id, name, email, active, created_at)
          VALUES (${val(h.id)}, ${preprodWorkspaceId}, ${val(h.name)}, ${val(h.email)}, ${val(h.active)}, ${val(h.created_at)})
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            active = EXCLUDED.active
        `;
      }
      console.log(`[copy-data] ✓ Upserted ${cardHolders.length} card holders in pre-prod`);

      // 7. cards with prefix: "pre-prod "
      for (const c of cards) {
        const prefixedName = c.display_name.startsWith('pre-prod ')
          ? c.display_name
          : `pre-prod ${c.display_name}`;

        await tx`
          INSERT INTO app.cards (
            id, workspace_id, holder_id, bank_card_type_id, display_name, last_digits,
            tracking_from, active, created_at, inactive_from
          ) VALUES (
            ${val(c.id)}, ${preprodWorkspaceId}, ${val(c.holder_id)}, ${val(c.bank_card_type_id)},
            ${prefixedName}, ${val(c.last_digits)}, ${val(c.tracking_from)}, ${val(c.active)}, ${val(c.created_at)},
            ${val(c.inactive_from)}
          )
          ON CONFLICT (id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            last_digits = EXCLUDED.last_digits,
            tracking_from = EXCLUDED.tracking_from,
            active = EXCLUDED.active,
            inactive_from = EXCLUDED.inactive_from
        `;
      }
      console.log(`[copy-data] ✓ Upserted ${cards.length} cards with prefix "pre-prod "`);

      // 8. benefit_instances (with re-encrypted voucher codes)
      let reencryptedCount = 0;
      for (const bi of benefitInstances) {
        let codeEncrypted = bi.code_encrypted;
        if (codeEncrypted && prodKey) {
          try {
            const plain = decrypt(codeEncrypted, bi.id, prodKey);
            codeEncrypted = encrypt(plain, bi.id, preprodKey);
            reencryptedCount++;
          } catch (e) {
            console.warn(`[copy-data] Warning: failed to re-encrypt code for instance ${bi.id}`);
          }
        }

        await tx`
          INSERT INTO app.benefit_instances (
            id, workspace_id, card_id, bank_card_type_id, benefit_id, override_id,
            generated_from_version, period_start, period_end, period_label, instance_number,
            order_status, sold_for, cash_value, order_date, expiry_date, order_deadline,
            rupay_booking_id, code_encrypted, comments, created_at, updated_at, chosen_option_id
          ) VALUES (
            ${val(bi.id)}, ${preprodWorkspaceId}, ${val(bi.card_id)}, ${val(bi.bank_card_type_id)},
            ${val(bi.benefit_id)}, ${val(bi.override_id)}, ${val(bi.generated_from_version)},
            ${val(bi.period_start)}, ${val(bi.period_end)}, ${val(bi.period_label)}, ${val(bi.instance_number)},
            ${val(bi.order_status)}, ${val(bi.sold_for)}, ${val(bi.cash_value)}, ${val(bi.order_date)},
            ${val(bi.expiry_date)}, ${val(bi.order_deadline)}, ${val(bi.rupay_booking_id)}, ${val(codeEncrypted)},
            ${val(bi.comments)}, ${val(bi.created_at)}, ${val(bi.updated_at)}, ${val(bi.chosen_option_id)}
          )
          ON CONFLICT (id) DO UPDATE SET
            order_status = EXCLUDED.order_status,
            rupay_booking_id = EXCLUDED.rupay_booking_id,
            code_encrypted = EXCLUDED.code_encrypted,
            expiry_date = EXCLUDED.expiry_date,
            order_date = EXCLUDED.order_date,
            cash_value = EXCLUDED.cash_value,
            sold_for = EXCLUDED.sold_for,
            comments = EXCLUDED.comments,
            chosen_option_id = EXCLUDED.chosen_option_id
        `;
      }
      console.log(`[copy-data] ✓ Upserted ${benefitInstances.length} benefit instances (${reencryptedCount} voucher codes re-encrypted with preprod key)`);
    });

    console.log('[copy-data] SUCCESS: All data successfully migrated from Production to Pre-Production!');
  } finally {
    await preprod.end();
  }
}

main().catch((err) => {
  console.error('[copy-data] Migration failed:', err);
  process.exit(1);
});
