import type { BrowserContext } from 'playwright';

/**
 * Install the globals the page is missing.
 *
 * esbuild's `keepNames` helper rewrites every named function into
 * `__name(fn, "fn")`. The worker is bundled with esbuild, which leaves that
 * helper off, but it is also run straight through tsx, which turns it on —
 * and a function that gets serialised into the page (a `page.evaluate`
 * body) then refers to `__name`, which does not exist in the page. The
 * result is "ReferenceError: __name is not defined" at the first evaluate
 * that happens to contain a named inner function.
 *
 * The helper is added as a string so that it is not itself rewritten.
 */
export async function installPageGlobals(context: BrowserContext): Promise<void> {
  await context.addInitScript({
    content: 'globalThis.__name = globalThis.__name || function (t) { return t; };',
  });
}
