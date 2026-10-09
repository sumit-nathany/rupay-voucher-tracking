'use server';
import { getCtx } from '@/lib/session';
import * as d from '@/domain/workspace-data';

export async function listOverrides(input?: unknown) {
  return d.listOverrides(await getCtx(), input);
}
export async function getOverride(input: unknown) {
  return d.getOverride(await getCtx(), input);
}
export async function createOverride(input: unknown) {
  return d.createOverride(await getCtx(), input);
}
export async function updateOverride(input: unknown) {
  return d.updateOverride(await getCtx(), input);
}
export async function setOverrideActive(input: unknown) {
  return d.setOverrideActive(await getCtx(), input);
}
export async function deleteOverride(input: unknown) {
  return d.deleteOverride(await getCtx(), input);
}
