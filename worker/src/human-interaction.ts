import { Page, Locator } from 'playwright';

/**
 * Returns a promise that resolves after a randomized delay between minMs and maxMs.
 */
export async function humanDelay(minMs: number = 800, maxMs: number = 2000): Promise<void> {
  const delay = Math.floor(minMs + Math.random() * (maxMs - minMs));
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Simulates a natural human hesitation while reading or scanning the page.
 */
export async function humanHesitate(minMs: number = 1200, maxMs: number = 2800): Promise<void> {
  await humanDelay(minMs, maxMs);
}

/**
 * Generates smooth intermediate control points along a cubic Bézier curve for mouse movement.
 */
function getBezierPoints(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  steps: number = 20,
): { x: number; y: number }[] {
  // Generate random control points to give a slight curve
  const dx = endX - startX;
  const dy = endY - startY;

  const controlX1 = startX + dx * 0.25 + (Math.random() - 0.5) * 60;
  const controlY1 = startY + dy * 0.25 + (Math.random() - 0.5) * 60;
  const controlX2 = startX + dx * 0.75 + (Math.random() - 0.5) * 40;
  const controlY2 = startY + dy * 0.75 + (Math.random() - 0.5) * 40;

  const points: { x: number; y: number }[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const inv = 1 - t;

    // Cubic Bézier formula
    const x =
      inv * inv * inv * startX +
      3 * inv * inv * t * controlX1 +
      3 * inv * t * t * controlX2 +
      t * t * t * endX;

    const y =
      inv * inv * inv * startY +
      3 * inv * inv * t * controlY1 +
      3 * inv * t * t * controlY2 +
      t * t * t * endY;

    points.push({ x: Math.round(x), y: Math.round(y) });
  }

  return points;
}

// Track approximate cursor position per page
const cursorPositions = new WeakMap<Page, { x: number; y: number }>();

/**
 * Smoothly moves the mouse cursor to target coordinates along a natural curved trajectory.
 */
export async function humanMoveMouse(
  page: Page,
  targetX: number,
  targetY: number,
  steps: number = 18,
): Promise<void> {
  const currentPos = cursorPositions.get(page) || { x: 300, y: 300 };
  const points = getBezierPoints(currentPos.x, currentPos.y, targetX, targetY, steps);

  for (const pt of points) {
    await page.mouse.move(pt.x, pt.y);
    await humanDelay(10, 25);
  }

  cursorPositions.set(page, { x: targetX, y: targetY });
}

/**
 * Naturally clicks an element:
 * 1. Scrolls it smoothly into view.
 * 2. Glides the mouse cursor to a random point within the element's bounding box.
 * 3. Hesitates briefly before clicking.
 * 4. Presses and releases with realistic mouse-down duration.
 * 5. Pauses slightly after click.
 */
export async function humanClick(
  locator: Locator,
  options?: {
    hesitateBeforeMs?: number;
    pauseAfterMs?: number;
  },
): Promise<void> {
  await locator.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
  await humanDelay(200, 500);

  const box = await locator.boundingBox();
  if (box) {
    const page = locator.page();
    // Pick a point near the center with natural variation (within 20% to 80% of width/height)
    const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
    const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

    await humanMoveMouse(page, targetX, targetY);

    if (options?.hesitateBeforeMs) {
      await humanDelay(options.hesitateBeforeMs, options.hesitateBeforeMs + 400);
    } else {
      await humanDelay(150, 400);
    }

    // Realistic click with click delay
    await page.mouse.click(targetX, targetY, {
      delay: Math.floor(60 + Math.random() * 80),
    });
  } else {
    // Fallback if bounding box isn't available
    await locator.click({ timeout: 5000 });
  }

  const postDelay = options?.pauseAfterMs ?? 600;
  await humanDelay(postDelay, postDelay + 500);
}

/**
 * Naturally types into an input field:
 * 1. Clicks the input with human mouse motion.
 * 2. Types character by character with randomized keystroke intervals.
 * 3. Adds slight pauses between words/chunks.
 */
export async function humanType(
  locator: Locator,
  text: string,
  options?: {
    clearFirst?: boolean;
    minCharDelayMs?: number;
    maxCharDelayMs?: number;
  },
): Promise<void> {
  await humanClick(locator, { hesitateBeforeMs: 200, pauseAfterMs: 300 });

  if (options?.clearFirst) {
    const page = locator.page();
    const isMac = process.platform === 'darwin';
    await page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');
    await humanDelay(100, 250);
    await page.keyboard.press('Backspace');
    await humanDelay(200, 400);
  }

  const minDelay = options?.minCharDelayMs ?? 80;
  const maxDelay = options?.maxCharDelayMs ?? 180;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    await locator.page().keyboard.type(char);

    // Keystroke delay with random variance
    let charDelay = Math.floor(minDelay + Math.random() * (maxDelay - minDelay));

    // Slight extra pause between words or punctuation
    if (char === ' ' || char === '@' || char === '.') {
      charDelay += Math.floor(150 + Math.random() * 200);
    }

    await new Promise((resolve) => setTimeout(resolve, charDelay));
  }

  await humanDelay(300, 700);
}
