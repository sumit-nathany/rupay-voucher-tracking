'use server';
// Thin wrappers. `getCtx` comes from src/lib/session.ts (other agent). The
// authoritative system_admins check runs inside each domain function from
// ctx.userId, so `requireSystemAdmin` is intentionally not called here (its
// signature was unknown); add it as an early-fail layer if desired.
import { getCtx } from '@/lib/session';
import * as d from '@/domain/catalog-admin';

export async function createBenefitAction(input: Parameters<typeof d.createBenefit>[1]) {
  return d.createBenefit(await getCtx(), input);
}
export async function correctVersionAction(input: Parameters<typeof d.correctVersion>[1]) {
  return d.correctVersion(await getCtx(), input);
}
export async function createVersionAction(input: Parameters<typeof d.createVersion>[1]) {
  return d.createVersion(await getCtx(), input);
}
export async function changeFrequencyAction(input: Parameters<typeof d.changeFrequency>[1]) {
  return d.changeFrequency(await getCtx(), input);
}
export async function closeVersionAction(input: Parameters<typeof d.closeVersion>[1]) {
  return d.closeVersion(await getCtx(), input);
}
export async function setCurationStatusAction(input: Parameters<typeof d.setCurationStatus>[1]) {
  return d.setCurationStatus(await getCtx(), input);
}
export async function listCatalogForAdminAction() {
  return d.listCatalogForAdmin(await getCtx());
}
export async function listCardTypeBenefitsAction(bankCardTypeId: string) {
  return d.listCardTypeBenefits(await getCtx(), { bankCardTypeId });
}
export async function createVariantAction(input: Parameters<typeof d.createVariant>[1]) {
  return d.createVariant(await getCtx(), input);
}
export async function updateVariantAction(input: Parameters<typeof d.updateVariant>[1]) {
  return d.updateVariant(await getCtx(), input);
}
export async function addCardTypesAction(input: Parameters<typeof d.addCardTypes>[1]) {
  return d.addCardTypes(await getCtx(), input);
}
export async function updateCardTypeAction(input: Parameters<typeof d.updateCardType>[1]) {
  return d.updateCardType(await getCtx(), input);
}
