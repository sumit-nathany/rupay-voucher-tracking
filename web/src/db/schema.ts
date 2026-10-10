/**
 * Drizzle schema for the RuPay Voucher Tracker (PLAN.md v8.0, "Database").
 *
 * All 12 tables live in the non-public `app` Postgres schema, which PostgREST
 * must NOT expose (PLAN.md Security model #1, preferred lockdown). The
 * REVOKE / default-privilege half of the lockdown is in a hand-written
 * migration (drizzle/*_lockdown.sql).
 *
 * No table has a foreign key to auth.users (PLAN.md Database notes).
 * Every UNIQUE ... NULLS NOT DISTINCT is expressed natively via
 * `.nullsNotDistinct()`; composite FKs via foreignKey().
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const app = pgSchema("app");

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow();


// ── Layer 0: tenant ─────────────────────────────────────────────────────────

export const workspaces = app.table("workspaces", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const workspaceMembers = app.table(
  "workspace_members",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    // Supabase auth.users.id. Deliberately NO FK to auth.users.
    userId: uuid("user_id").notNull().unique("workspace_members_user_id_key"),
    role: text("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [check("workspace_members_role_check", sql`${t.role} IN ('admin','member')`)],
);

// ── Layer 1: holders ────────────────────────────────────────────────────────

export const cardHolders = app.table(
  "card_holders",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    email: text("email"),
    active: boolean("active").default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("card_holders_workspace_id_name_key").on(t.workspaceId, t.name),
    unique("card_holders_workspace_id_id_key").on(t.workspaceId, t.id),
  ],
);

// ── Global reference data (no workspace_id) ─────────────────────────────────

// Card variants as shown on the RuPay portal (Select Debit, Select Credit, ...).
// Data, not code: system admins add or rename them from the admin page.
export const cardVariants = app.table(
  "card_variants",
  {
    id: id(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    // The RuPay portal's `cardtype` number for this variant (41 = Select Debit). See docs/rupay-portal-api.md.
    portalCardType: integer("portal_card_type"),
    active: boolean("active").default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("card_variants_name_key").on(t.name),
    unique("card_variants_portal_card_type_key").on(t.portalCardType),
  ],
);

export const bankCardTypes = app.table(
  "bank_card_types",
  {
    id: id(),
    // Full card name exactly as listed by the portal, e.g. "PNB Salary Excel RuPay Select Card".
    // Bank and card are not split: the listed names cannot be split reliably.
    displayName: text("display_name").notNull(),
    // NULL only for rows created before variants existed; admins assign one.
    variantId: uuid("variant_id").references(() => cardVariants.id),
    // Legacy columns from the spreadsheet seed. New rows leave them NULL.
    bankName: text("bank_name"),
    cardType: text("card_type"),
    // The RuPay portal's card `id` (e.g. 151 = PNB Salary Imperial). See docs/rupay-portal-api.md.
    portalCardId: integer("portal_card_id"),
    network: text("network").notNull().default("RuPay"),
    curationStatus: text("curation_status").notNull().default("uncurated"),
    active: boolean("active").default(true),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "bank_card_types_curation_status_check",
      sql`${t.curationStatus} IN ('uncurated','curated','no_benefits')`,
    ),
    unique("bank_card_types_bank_name_card_type_network_key").on(
      t.bankName,
      t.cardType,
      t.network,
    ),
    unique("bank_card_types_portal_card_id_key").on(t.portalCardId),
    unique("bank_card_types_variant_display_name_key")
      .on(t.variantId, t.displayName)
      .nullsNotDistinct(),
  ],
);

export const benefits = app.table(
  "benefits",
  {
    id: id(),
    bankCardTypeId: uuid("bank_card_type_id")
      .notNull()
      .references(() => bankCardTypes.id),
    createdAt: createdAt(),
  },
  (t) => [unique("benefits_id_bank_card_type_id_key").on(t.id, t.bankCardTypeId)],
);

export const benefitCatalogVersions = app.table(
  "benefit_catalog_versions",
  {
    id: id(),
    benefitId: uuid("benefit_id")
      .notNull()
      .references(() => benefits.id),
    benefitType: text("benefit_type").notNull(),
    benefitProvider: text("benefit_provider"),
    exactBenefit: text("exact_benefit").notNull(),
    frequency: text("frequency").notNull(),
    instanceCount: integer("instance_count").notNull().default(1),
    defaultCashValue: numeric("default_cash_value", { precision: 10, scale: 2 }),
    /** `voucher` = gift card / redeemable benefit; `discount` = coupon-style offer. */
    offerKind: text("offer_kind").notNull().default("voucher"),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    effectiveTo: date("effective_to", { mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "benefit_catalog_versions_offer_kind_check",
      sql`${t.offerKind} IN ('voucher','discount')`,
    ),
    check(
      "benefit_catalog_versions_frequency_check",
      sql`${t.frequency} IN ('Annual','6 months','Quarterly','Monthly')`,
    ),
    check("benefit_catalog_versions_instance_count_check", sql`${t.instanceCount} >= 1`),
    check(
      "benefit_catalog_versions_effective_range_check",
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
    unique("benefit_catalog_versions_id_benefit_id_key").on(t.id, t.benefitId),
    index("idx_benefit_catalog_versions_lookup").on(
      t.benefitId,
      t.effectiveFrom,
      t.effectiveTo,
    ),
  ],
);

// Choices inside a "redeem any one" benefit: the card gets ONE redemption per
// period and the holder picks which of these offers to take. A version with no
// options is an ordinary single-offer benefit.
export const benefitOptions = app.table(
  "benefit_options",
  {
    id: id(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => benefitCatalogVersions.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    offerName: text("offer_name").notNull(),
    cashValue: numeric("cash_value", { precision: 10, scale: 2 }),
    // Portal `productid`, so a re-import can match offers. See docs/rupay-portal-api.md.
    portalOfferId: integer("portal_offer_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("benefit_options_version_provider_offer_key").on(t.versionId, t.provider, t.offerName),
    index("idx_benefit_options_version").on(t.versionId),
  ],
);

export const systemAdmins = app.table("system_admins", {
  id: id(),
  // Supabase auth.users.id. Deliberately NO FK to auth.users.
  userId: uuid("user_id").notNull().unique("system_admins_user_id_key"),
  createdAt: createdAt(),
});

// ── Per-workspace data ──────────────────────────────────────────────────────

export const cards = app.table(
  "cards",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    holderId: uuid("holder_id").notNull(),
    bankCardTypeId: uuid("bank_card_type_id")
      .notNull()
      .references(() => bankCardTypes.id),
    displayName: text("display_name").notNull(),
    lastDigits: text("last_digits").notNull().default("0000"),
    // Convenience default only; the app overwrites with the Asia/Kolkata today.
    trackingFrom: date("tracking_from", { mode: "string" })
      .notNull()
      .default(sql`CURRENT_DATE`),
    active: boolean("active").default(true),
    inactiveFrom: date("inactive_from", { mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("cards_workspace_id_id_key").on(t.workspaceId, t.id),
    unique("cards_workspace_id_id_bank_card_type_id_key").on(
      t.workspaceId,
      t.id,
      t.bankCardTypeId,
    ),
    foreignKey({
      name: "cards_workspace_id_holder_id_fkey",
      columns: [t.workspaceId, t.holderId],
      foreignColumns: [cardHolders.workspaceId, cardHolders.id],
    }),
  ],
);

export const cardBenefitOverrides = app.table(
  "card_benefit_overrides",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    cardId: uuid("card_id").notNull(),
    bankCardTypeId: uuid("bank_card_type_id").notNull(),
    kind: text("kind").notNull(),
    benefitId: uuid("benefit_id"),
    benefitType: text("benefit_type"),
    benefitProvider: text("benefit_provider"),
    exactBenefit: text("exact_benefit"),
    frequency: text("frequency"),
    instanceCount: integer("instance_count"),
    defaultCashValue: numeric("default_cash_value", { precision: 10, scale: 2 }),
    offerKind: text("offer_kind").notNull().default("voucher"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    check("card_benefit_overrides_offer_kind_check", sql`${t.offerKind} IN ('voucher','discount')`),
    check("card_benefit_overrides_kind_check", sql`${t.kind} IN ('add','suppress')`),
    check(
      "card_benefit_overrides_frequency_check",
      sql`${t.frequency} IS NULL OR ${t.frequency} IN ('Annual','6 months','Quarterly','Monthly')`,
    ),
    check(
      "card_benefit_overrides_instance_count_check",
      sql`${t.instanceCount} IS NULL OR ${t.instanceCount} >= 1`,
    ),
    check(
      "card_benefit_overrides_kind_shape_check",
      sql`(${t.kind} = 'suppress' AND ${t.benefitId} IS NOT NULL AND ${t.benefitType} IS NULL)
        OR
        (${t.kind} = 'add' AND ${t.benefitId} IS NULL AND ${t.benefitType} IS NOT NULL AND ${t.exactBenefit} IS NOT NULL AND ${t.frequency} IS NOT NULL AND ${t.instanceCount} IS NOT NULL)`,
    ),
    unique("card_benefit_overrides_workspace_id_id_key").on(t.workspaceId, t.id),
    unique("card_benefit_overrides_workspace_id_card_id_id_key").on(
      t.workspaceId,
      t.cardId,
      t.id,
    ),
    // UNIQUE NULLS NOT DISTINCT — required; default NULLS DISTINCT would never fire.
    unique("card_benefit_overrides_identity_key")
      .on(t.cardId, t.kind, t.benefitId, t.benefitType, t.benefitProvider, t.exactBenefit)
      .nullsNotDistinct(),
    foreignKey({
      name: "card_benefit_overrides_workspace_id_card_id_fkey",
      columns: [t.workspaceId, t.cardId],
      foreignColumns: [cards.workspaceId, cards.id],
    }),
    foreignKey({
      name: "card_benefit_overrides_card_type_fkey",
      columns: [t.workspaceId, t.cardId, t.bankCardTypeId],
      foreignColumns: [cards.workspaceId, cards.id, cards.bankCardTypeId],
    }),
    foreignKey({
      name: "card_benefit_overrides_benefit_type_fkey",
      columns: [t.benefitId, t.bankCardTypeId],
      foreignColumns: [benefits.id, benefits.bankCardTypeId],
    }),
  ],
);

export const benefitInstances = app.table(
  "benefit_instances",
  {
    id: id(),
    workspaceId: uuid("workspace_id").notNull(),
    cardId: uuid("card_id").notNull(),
    bankCardTypeId: uuid("bank_card_type_id").notNull(),
    benefitId: uuid("benefit_id"),
    overrideId: uuid("override_id"),
    generatedFromVersion: uuid("generated_from_version"),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    periodLabel: text("period_label").notNull(),
    instanceNumber: integer("instance_number").notNull().default(1),
    orderStatus: text("order_status").notNull().default("Not Ordered"),
    soldFor: numeric("sold_for", { precision: 10, scale: 2 }),
    cashValue: numeric("cash_value", { precision: 10, scale: 2 }),
    orderDate: date("order_date", { mode: "string" }),
    expiryDate: date("expiry_date", { mode: "string" }),
    orderDeadline: date("order_deadline", { mode: "string" }).notNull(),
    rupayBookingId: text("rupay_booking_id"),
    codeEncrypted: text("code_encrypted"),
    comments: text("comments"),
    // Which offer was taken, for a "redeem any one" benefit. Must belong to generated_from_version (checked in app).
    chosenOptionId: uuid("chosen_option_id").references(() => benefitOptions.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    check("benefit_instances_instance_number_check", sql`${t.instanceNumber} >= 1`),
    check(
      "benefit_instances_order_status_check",
      sql`${t.orderStatus} IN ('Not Ordered','Ordered but Coupon not received','Coupon Received','Coupon Redeemed','Skipped','Withdrawn')`,
    ),
    check(
      "benefit_instances_one_source_check",
      sql`num_nonnulls(${t.benefitId}, ${t.overrideId}) = 1`,
    ),
    unique("benefit_instances_identity_key")
      .on(t.cardId, t.benefitId, t.overrideId, t.periodStart, t.instanceNumber)
      .nullsNotDistinct(),
    foreignKey({
      name: "benefit_instances_workspace_id_card_id_fkey",
      columns: [t.workspaceId, t.cardId],
      foreignColumns: [cards.workspaceId, cards.id],
    }),
    foreignKey({
      name: "benefit_instances_override_fkey",
      columns: [t.workspaceId, t.cardId, t.overrideId],
      foreignColumns: [
        cardBenefitOverrides.workspaceId,
        cardBenefitOverrides.cardId,
        cardBenefitOverrides.id,
      ],
    }),
    foreignKey({
      name: "benefit_instances_benefit_card_type_fkey",
      columns: [t.benefitId, t.bankCardTypeId],
      foreignColumns: [benefits.id, benefits.bankCardTypeId],
    }),
    foreignKey({
      name: "benefit_instances_card_type_fkey",
      columns: [t.workspaceId, t.cardId, t.bankCardTypeId],
      foreignColumns: [cards.workspaceId, cards.id, cards.bankCardTypeId],
    }),
    foreignKey({
      name: "benefit_instances_version_fkey",
      columns: [t.generatedFromVersion, t.benefitId],
      foreignColumns: [benefitCatalogVersions.id, benefitCatalogVersions.benefitId],
    }),
  ],
);

// ── Reminders (schema only; wired up in a later phase) ──────────────────────

export const notificationPreferences = app.table(
  "notification_preferences",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    holderId: uuid("holder_id").notNull().unique("notification_preferences_holder_id_key"),
    emailEnabled: boolean("email_enabled").default(true),
    daysBefore: integer("days_before").array().default(sql`'{7, 3, 1}'`),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "notification_preferences_workspace_id_holder_id_fkey",
      columns: [t.workspaceId, t.holderId],
      foreignColumns: [cardHolders.workspaceId, cardHolders.id],
    }),
  ],
);

export const reminderLog = app.table(
  "reminder_log",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => benefitInstances.id),
    reminderType: text("reminder_type").notNull(),
    daysBefore: integer("days_before"),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow(),
    channel: text("channel").default("email"),
  },
  (t) => [
    check(
      "reminder_log_reminder_type_check",
      sql`${t.reminderType} IN ('expiry','order_lapse','stale_order')`,
    ),
    unique("reminder_log_instance_id_reminder_type_days_before_key").on(
      t.instanceId,
      t.reminderType,
      t.daysBefore,
    ),
  ],
);

