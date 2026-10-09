'use server';
import { getCtx } from '@/lib/session';
import * as d from '@/domain/workspace-data';

export async function listCardVariants() {
  return d.listCardVariants(await getCtx());
}
export async function listBankCardTypes() {
  return d.listBankCardTypes(await getCtx());
}
export async function listCards(input?: unknown) {
  return d.listCards(await getCtx(), input);
}
export async function getCard(input: unknown) {
  return d.getCard(await getCtx(), input);
}
export async function createCard(input: unknown) {
  return d.createCard(await getCtx(), input);
}
export async function updateCard(input: unknown) {
  return d.updateCard(await getCtx(), input);
}
export async function deleteCard(input: unknown) {
  return d.deleteCard(await getCtx(), input);
}
