'use server';
// Thin wrappers. `getCtx` is provided by src/lib/session.ts (written by another
// agent): assumed signature `getCtx(): Promise<Ctx>`. Never accepts workspace_id.
import { getCtx } from '@/lib/session';
import * as d from '@/domain/instances';

export async function getInstanceAction(instanceId: string) {
  return d.getInstance(await getCtx(), instanceId);
}
export async function revealCodeAction(instanceId: string) {
  return d.revealCode(await getCtx(), instanceId);
}
export async function setStatusAction(input: Parameters<typeof d.setStatus>[1]) {
  return d.setStatus(await getCtx(), input);
}
export async function skipInstanceAction(instanceId: string) {
  return d.skipInstance(await getCtx(), instanceId);
}
export async function unskipInstanceAction(instanceId: string) {
  return d.unskipInstance(await getCtx(), instanceId);
}
export async function recordSaleAction(input: Parameters<typeof d.recordSale>[1]) {
  return d.recordSale(await getCtx(), input);
}
export async function updateDetailsAction(input: Parameters<typeof d.updateDetails>[1]) {
  return d.updateDetails(await getCtx(), input);
}
export async function setCodeAction(input: Parameters<typeof d.setCode>[1]) {
  return d.setCode(await getCtx(), input);
}
export async function getInstanceOptionsAction(instanceId: string) {
  return d.getInstanceOptions(await getCtx(), instanceId);
}
export async function chooseOptionAction(input: Parameters<typeof d.chooseOption>[1]) {
  return d.chooseOption(await getCtx(), input);
}
