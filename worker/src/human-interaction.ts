import { Page, Locator } from 'playwright';

/**
 * Returns a promise that resolves after a randomized delay between minMs and maxMs.
 */
export async function humanDelay(minMs: number = 200, maxMs: number = 600): Promise<void> {
  const delay = Math.floor(minMs + Math.random() * (maxMs - minMs));
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Simulates a natural human hesitation while reading or scanning the page,
 * with subtle natural mouse wander if a Page is passed.
 */
export async function humanHesitate(
  targetOrMin?: Page | number,
  minOrMaxMs?: number,
  maxMs?: number,
): Promise<void> {
  let page: Page | undefined;
  let min = 400;
  let max = 900;

  if (typeof targetOrMin === 'object' && targetOrMin !== null && 'mouse' in targetOrMin) {
    page = targetOrMin as Page;
    min = minOrMaxMs ?? 400;
    max = maxMs ?? 900;
  } else {
    min = (targetOrMin as number) ?? 400;
    max = minOrMaxMs ?? 900;
  }

  if (page) {
    try {
      await installVisualMouseCursor(page);
      const cur = cursorPositions.get(page) || { x: 450, y: 350 };
      const jitterX = Math.max(100, Math.min(1000, cur.x + (Math.random() - 0.5) * 90));
      const jitterY = Math.max(100, Math.min(650, cur.y + (Math.random() - 0.5) * 70));
      await humanMoveMouse(page, jitterX, jitterY, 8);
    } catch {}
  }

  await humanDelay(min, max);
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

/**
 * Installs a visual human cursor onto the page so the user watching the screen
 * sees the realistic cursor pointer gliding across elements, hovering, and clicking.
 */
export async function installVisualMouseCursor(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const existing = document.getElementById('human-visual-cursor');
      if (existing) return;

      const cursor = document.createElement('div');
      cursor.id = 'human-visual-cursor';
      cursor.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="#f97316" stroke="white" stroke-width="1.5" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
          <path d="M3 3l7 18 3-7 7-3L3 3z"/>
        </svg>
        <div id="human-cursor-click-ring" style="
          position: absolute;
          top: -8px;
          left: -8px;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 2.5px solid #ea580c;
          opacity: 0;
          pointer-events: none;
          transition: transform 0.22s ease-out, opacity 0.22s ease-out;
        "></div>
      `;
      cursor.style.position = 'fixed';
      cursor.style.top = '0';
      cursor.style.left = '0';
      cursor.style.width = '24px';
      cursor.style.height = '24px';
      cursor.style.pointerEvents = 'none';
      cursor.style.zIndex = '2147483647';
      cursor.style.transform = 'translate(120px, 120px)';
      cursor.style.transition = 'transform 0.04s ease-out';
      document.body.appendChild(cursor);

      window.addEventListener('mousemove', (e) => {
        cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      }, { passive: true });

      window.addEventListener('mousedown', () => {
        const ring = document.getElementById('human-cursor-click-ring');
        if (ring) {
          ring.style.transform = 'scale(1.9)';
          ring.style.opacity = '0.9';
        }
      }, { passive: true });

      window.addEventListener('mouseup', () => {
        const ring = document.getElementById('human-cursor-click-ring');
        if (ring) {
          ring.style.transform = 'scale(0.8)';
          ring.style.opacity = '0';
        }
      }, { passive: true });
    });
  } catch {}
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
  steps: number = 8,
): Promise<void> {
  await installVisualMouseCursor(page);
  const currentPos = cursorPositions.get(page) || { x: 300, y: 300 };
  const points = getBezierPoints(currentPos.x, currentPos.y, targetX, targetY, steps);

  for (const pt of points) {
    await page.mouse.move(pt.x, pt.y);
    await humanDelay(4, 10);
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
  await humanDelay(60, 150);

  const box = await locator.boundingBox();
  if (box) {
    const page = locator.page();
    // Pick a point near the center with natural variation (within 20% to 80% of width/height)
    const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
    const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

    await humanMoveMouse(page, targetX, targetY, 8);

    if (options?.hesitateBeforeMs) {
      await humanDelay(Math.min(options.hesitateBeforeMs, 200), Math.min(options.hesitateBeforeMs + 80, 300));
    } else {
      await humanDelay(40, 100);
    }

    // Realistic click with click delay
    await page.mouse.click(targetX, targetY, {
      delay: Math.floor(30 + Math.random() * 50),
    });
  } else {
    // Fallback if bounding box isn't available
    await locator.click({ timeout: 5000 });
  }

  const postDelay = options?.pauseAfterMs ? Math.min(options.pauseAfterMs, 300) : 150;
  await humanDelay(postDelay, postDelay + 150);
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

  const minDelay = options?.minCharDelayMs ?? 25;
  const maxDelay = options?.maxCharDelayMs ?? 60;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    await locator.page().keyboard.type(char);

    // Keystroke delay with random variance
    let charDelay = Math.floor(minDelay + Math.random() * (maxDelay - minDelay));

    // Slight extra pause between words or punctuation
    if (char === ' ' || char === '@' || char === '.') {
      charDelay += Math.floor(40 + Math.random() * 50);
    }

    await new Promise((resolve) => setTimeout(resolve, charDelay));
  }

  await humanDelay(100, 250);
}
