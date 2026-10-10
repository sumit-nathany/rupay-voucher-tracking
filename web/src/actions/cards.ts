'use server';
import { revalidatePath } from 'next/cache';
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
  const res = await d.createCard(await getCtx(), input);
  revalidatePath('/', 'layout');
  return res;
}
export async function updateCard(input: unknown) {
  const res = await d.updateCard(await getCtx(), input);
  revalidatePath('/', 'layout');
  return res;
}
export async function deleteCard(input: unknown) {
  const res = await d.deleteCard(await getCtx(), input);
  revalidatePath('/', 'layout');
  return res;
}
