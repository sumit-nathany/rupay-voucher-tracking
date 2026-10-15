// Read-only probe: show portal account status and the candidate the browser runner would pick.
// Prints no credentials. Run: npx tsx --env-file ../.env.local src/check-account.ts --account=<label>
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../web/src/db/schema';
import type { Database } from '../../web/src/lib/context';
import { findCandidatesForAccount } from '../../web/src/domain/automation';

async function main() {
  const dbUrl = process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('WORKER_DATABASE_URL or DATABASE_URL required');

  const accountArg = process.argv.find((a) => a.startsWith('--account='))?.split('=')[1]?.trim();
  if (!accountArg) throw new Error('Pass --account=<id or label>');

  const client = postgres(dbUrl, { max: 1 });
  const db = drizzle(client, { schema }) as unknown as Database;

  const accounts = await db.select().from(schema.portalAccounts);
  console.log(`Connected/known portal accounts (${accounts.length}):`);
  for (const a of accounts) {
    console.log(` - "${a.label}" | status=${a.status} | id=${a.id} | cooldownUntil=${a.cooldownUntil ?? 'none'} | phone=${a.phoneNumber ?? 'n/a'} | workspace=${a.workspaceId}`);
  }

  const account = accounts.find((a) => a.id === accountArg || a.label.toLowerCase() === accountArg.toLowerCase());
  if (!account) {
    console.log(`\nAccount "${accountArg}" NOT found.`);
    await client.end();
    return;
  }

  const [settings] = await db
    .select()
    .from(schema.automationSettings)
    .where(eq(schema.automationSettings.workspaceId, account.workspaceId));
  console.log(`\nAutomation settings for workspace: paused=${settings?.paused ?? '?'} | telegramChatId=${settings?.telegramChatId ? 'set' : 'none'}`);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  console.log(`Today (IST): ${today}`);

  const candidate = await findCandidatesForAccount(db, account.id, today, {});
  if (!candidate) {
    console.log('\nNo candidate nominated for this account today (all ordered, suppressed, or cooldown).');
  } else {
    console.log(`\nCandidate nominated: instanceId=${candidate.instanceId} cardId=${candidate.cardId} ruleId=${candidate.ruleId} chosenOptionId=${candidate.chosenOptionId ?? 'none'}`);

    const [cardRow] = await db
      .select({ last4: schema.cards.lastDigits, name: schema.bankCardTypes.displayName, hasPayment: schema.cards.paymentDetailsEncrypted })
      .from(schema.cards)
      .innerJoin(schema.bankCardTypes, eq(schema.cards.bankCardTypeId, schema.bankCardTypes.id))
      .where(eq(schema.cards.id, candidate.cardId));
    console.log(`Card: ${cardRow?.name} (••${cardRow?.last4}) | payment details stored: ${cardRow?.hasPayment ? 'yes' : 'NO'}`);

    const [inst] = await db
      .select({ versionId: schema.benefitInstances.generatedFromVersion, status: schema.benefitInstances.orderStatus, periodStart: schema.benefitInstances.periodStart, periodEnd: schema.benefitInstances.periodEnd })
      .from(schema.benefitInstances)
      .where(eq(schema.benefitInstances.id, candidate.instanceId));
    console.log(`Instance status: ${inst?.status} | period ${inst?.periodStart} → ${inst?.periodEnd}`);

    if (inst?.versionId) {
      const [v] = await db.select().from(schema.benefitCatalogVersions).where(eq(schema.benefitCatalogVersions.id, inst.versionId));
      console.log(`Benefit: ${v?.benefitType} - ${v?.exactBenefit} (${v?.benefitProvider ?? ''}) ₹${v?.defaultCashValue ?? '0'}`);
    }
    if (candidate.chosenOptionId) {
      const [opt] = await db.select().from(schema.benefitOptions).where(eq(schema.benefitOptions.id, candidate.chosenOptionId));
      if (opt) console.log(`Chosen option: ${opt.offerName} (${opt.provider}) ₹${opt.cashValue ?? '0'}`);
    }
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
