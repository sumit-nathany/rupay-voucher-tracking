'use server';
import { getCtx } from '@/lib/session';
import * as d from '@/domain/workspace-data';

export async function listHolders() {
  return d.listHolders(await getCtx());
}
export async function getHolder(input: unknown) {
  return d.getHolder(await getCtx(), input);
}
export async function createHolder(input: unknown) {
  return d.createHolder(await getCtx(), input);
}
export async function updateHolder(input: unknown) {
  return d.updateHolder(await getCtx(), input);
}
export async function deleteHolder(input: unknown) {
  return d.deleteHolder(await getCtx(), input);
}
