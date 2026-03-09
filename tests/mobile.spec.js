// @ts-check
const { test, expect } = require('@playwright/test');

const BASE_URL = 'https://deckydecks.pages.dev';

// Real touch swipe via CDP — fires actual touch events through the browser
async function touchSwipe(page, { startX, startY, endX, endY, steps = 10, duration = 300 }) {
  const cdp = await page.context().newCDPSession(page);

  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y: startY }],
  });

  for (let i = 1; i <= steps; i++) {
    const ratio = i / steps;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: Math.round(startX + (endX - startX) * ratio),
        y: Math.round(startY + (endY - startY) * ratio),
      }],
    });
    await new Promise(r => setTimeout(r, duration / steps));
  }

  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });

  await cdp.detach();
}

// Real touch tap via CDP
async function touchTap(page, x, y) {
  const cdp = await page.context().newCDPSession(page);

  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  });
  await new Promise(r => setTimeout(r, 80));
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });

  await cdp.detach();
}

async function waitForSlide(page) {
  await page.waitForTimeout(900);
}

async function getActiveNodeId(page) {
  return page.evaluate(() => {
    const active = document.querySelector('.slide.active');
    return active ? active.dataset.nodeId : null;
  });
}

function vp(page) {
  return page.viewportSize();
}

async function swipeLeft(page) {
  const v = vp(page);
  await touchSwipe(page, {
    startX: v.width * 0.8, startY: v.height / 2,
    endX: v.width * 0.15, endY: v.height / 2,
  });
  await waitForSlide(page);
}

async function swipeRight(page) {
  const v = vp(page);
  await touchSwipe(page, {
    startX: v.width * 0.2, startY: v.height / 2,
    endX: v.width * 0.85, endY: v.height / 2,
  });
  await waitForSlide(page);
}

// ============================================================
// ROOT DECK
// ============================================================
test.describe('Root deck navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await waitForSlide(page);
  });

  test('renders root deck on load', async ({ page }) => {
    expect(await getActiveNodeId(page)).toBe('root-welcome');
    await expect(page.locator('.slide.active .slide-title')).toBeVisible();
  });

  test('swipe left advances', async ({ page }) => {
    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('root-choose');
  });

  test('swipe right goes back', async ({ page }) => {
    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('root-choose');
    await swipeRight(page);
    expect(await getActiveNodeId(page)).toBe('root-welcome');
  });

  test('vertical scroll does NOT navigate', async ({ page }) => {
    const v = vp(page);
    await touchSwipe(page, {
      startX: v.width / 2, startY: v.height * 0.8,
      endX: v.width / 2, endY: v.height * 0.2,
    });
    await waitForSlide(page);
    expect(await getActiveNodeId(page)).toBe('root-welcome');
  });

  test('diagonal swipe (mostly vertical) does NOT navigate', async ({ page }) => {
    const v = vp(page);
    await touchSwipe(page, {
      startX: v.width / 2, startY: v.height * 0.7,
      endX: v.width / 2 + 80, endY: v.height * 0.3,
    });
    await waitForSlide(page);
    expect(await getActiveNodeId(page)).toBe('root-welcome');
  });
});

// ============================================================
// BRANCH INTERACTION
// ============================================================
test.describe('Branch interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await waitForSlide(page);
    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('root-choose');
  });

  test('tapping a branch option navigates', async ({ page }) => {
    // Tap "See how it works" (4th)
    const option = page.locator('.slide.active .branch-option').nth(3);
    await expect(option).toBeVisible();
    const box = await option.boundingBox();
    await touchTap(page, box.x + box.width / 2, box.y + box.height / 2);
    await waitForSlide(page);
    expect(await getActiveNodeId(page)).toBe('opening');
  });

  test('branch options fit within viewport width', async ({ page }) => {
    const v = vp(page);
    const options = page.locator('.slide.active .branch-option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < count; i++) {
      const box = await options.nth(i).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(v.width + 10);
    }
  });
});

// ============================================================
// SAMPLE DECK
// ============================================================
test.describe('Sample deck', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await waitForSlide(page);
    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('root-choose');

    // Tap "See how it works"
    const option = page.locator('.slide.active .branch-option').nth(3);
    await expect(option).toBeVisible();
    const box = await option.boundingBox();
    await touchTap(page, box.x + box.width / 2, box.y + box.height / 2);
    await waitForSlide(page);
    expect(await getActiveNodeId(page)).toBe('opening');
  });

  test('multi-slide swipe', async ({ page }) => {
    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('problem');
    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('branch-pain');
  });

  test('branch tap selects path', async ({ page }) => {
    await swipeLeft(page);
    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('branch-pain');

    const option = page.locator('.slide.active .branch-option').first();
    await expect(option).toBeVisible();
    const box = await option.boundingBox();
    await touchTap(page, box.x + box.width / 2, box.y + box.height / 2);
    await waitForSlide(page);

    const nodeId = await getActiveNodeId(page);
    expect(nodeId).not.toBe('branch-pain');
    expect(nodeId).toBeTruthy();
  });

  test('vertical swipe does not change slide', async ({ page }) => {
    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('problem');

    const v = vp(page);
    await touchSwipe(page, {
      startX: v.width / 2, startY: v.height * 0.7,
      endX: v.width / 2, endY: v.height * 0.3,
      steps: 15, duration: 400,
    });
    await waitForSlide(page);
    expect(await getActiveNodeId(page)).toBe('problem');
  });

  test('no horizontal overflow', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      const hasOverflow = await page.evaluate(() => {
        const active = document.querySelector('.slide.active');
        return active ? active.scrollWidth > active.clientWidth : false;
      });
      expect(hasOverflow).toBe(false);
      if (i < 2) await swipeLeft(page);
    }
  });
});

// ============================================================
// SHARED DECK WITH INPUTS
// ============================================================
test.describe('Shared deck with inputs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/d/decks-about-decks-it-s-turtles-all-the-way-down-mmim1spm`, {
      waitUntil: 'networkidle',
    });
    await waitForSlide(page);
  });

  test('loads shared deck', async ({ page }) => {
    expect(await getActiveNodeId(page)).toBe('hero-inception');
  });

  test('navigate to slider via designer path', async ({ page }) => {
    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('what-is-deck');
    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('branch-your-vibe');

    const option = page.locator('.slide.active .branch-option').nth(1);
    await expect(option).toBeVisible();
    const box = await option.boundingBox();
    await touchTap(page, box.x + box.width / 2, box.y + box.height / 2);
    await waitForSlide(page);
    expect(await getActiveNodeId(page)).toBe('designer-path');

    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('designer-flows');
  });

  test('slider visible and wrapper has touch-friendly height', async ({ page }) => {
    // Navigate to designer-flows
    await swipeLeft(page);
    await swipeLeft(page);
    const option = page.locator('.slide.active .branch-option').nth(1);
    await expect(option).toBeVisible();
    const box = await option.boundingBox();
    await touchTap(page, box.x + box.width / 2, box.y + box.height / 2);
    await waitForSlide(page);
    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('designer-flows');

    const slider = page.locator('.slide.active input[type="range"]');
    await expect(slider).toBeVisible();

    // Wrapper should be touch-friendly
    const wrapper = page.locator('.slide.active .input-slider-track');
    const wrapperBox = await wrapper.boundingBox();
    expect(wrapperBox.height).toBeGreaterThanOrEqual(20);

    expect(await getActiveNodeId(page)).toBe('designer-flows');
  });

  test('slider drag stays on same slide', async ({ page }) => {
    await swipeLeft(page);
    await swipeLeft(page);
    const option = page.locator('.slide.active .branch-option').nth(1);
    await expect(option).toBeVisible();
    const box = await option.boundingBox();
    await touchTap(page, box.x + box.width / 2, box.y + box.height / 2);
    await waitForSlide(page);
    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('designer-flows');

    // Drag across slider track
    const slider = page.locator('.slide.active input[type="range"]');
    const sliderBox = await slider.boundingBox();
    await touchSwipe(page, {
      startX: sliderBox.x + sliderBox.width * 0.2,
      startY: sliderBox.y + sliderBox.height / 2,
      endX: sliderBox.x + sliderBox.width * 0.8,
      endY: sliderBox.y + sliderBox.height / 2,
      steps: 12, duration: 350,
    });
    await waitForSlide(page);

    // Should NOT have navigated away
    expect(await getActiveNodeId(page)).toBe('designer-flows');
  });

  test('continue button advances from input slide', async ({ page }) => {
    await swipeLeft(page);
    await swipeLeft(page);
    const option = page.locator('.slide.active .branch-option').nth(1);
    await expect(option).toBeVisible();
    const box = await option.boundingBox();
    await touchTap(page, box.x + box.width / 2, box.y + box.height / 2);
    await waitForSlide(page);
    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('designer-flows');

    const continueBtn = page.locator('.slide.active .input-interactive-continue');
    await expect(continueBtn).toBeVisible({ timeout: 5000 });

    const v = vp(page);
    let btnBox = await continueBtn.boundingBox();

    // Scroll if needed
    if (btnBox && btnBox.y + btnBox.height > v.height) {
      await touchSwipe(page, {
        startX: v.width / 2, startY: v.height * 0.8,
        endX: v.width / 2, endY: v.height * 0.3,
      });
      await page.waitForTimeout(400);
      btnBox = await continueBtn.boundingBox();
    }

    if (btnBox) {
      await touchTap(page, btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
      await waitForSlide(page);
      expect(await getActiveNodeId(page)).not.toBe('designer-flows');
    }
  });
});

// ============================================================
// UI ELEMENTS
// ============================================================
test.describe('UI elements', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await waitForSlide(page);
  });

  test('nav-hints hidden on mobile', async ({ page }) => {
    await expect(page.locator('#nav-hints')).toBeHidden();
  });

  test('back button appears and works', async ({ page }) => {
    const backBtn = page.locator('#back-btn');
    await expect(backBtn).not.toHaveClass(/visible/);

    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('root-choose');
    await expect(backBtn).toHaveClass(/visible/);

    const box = await backBtn.boundingBox();
    await touchTap(page, box.x + box.width / 2, box.y + box.height / 2);
    await waitForSlide(page);
    expect(await getActiveNodeId(page)).toBe('root-welcome');
  });
});

// ============================================================
// CHART SLIDES
// ============================================================
test.describe('Chart slides', () => {
  test('bar chart renders without overflow', async ({ page }) => {
    await page.goto(`${BASE_URL}/d/decks-about-decks-it-s-turtles-all-the-way-down-mmim1spm`, {
      waitUntil: 'networkidle',
    });
    await waitForSlide(page);

    await swipeLeft(page);
    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('branch-your-vibe');

    const option = page.locator('.slide.active .branch-option').first();
    await expect(option).toBeVisible();
    const box = await option.boundingBox();
    await touchTap(page, box.x + box.width / 2, box.y + box.height / 2);
    await waitForSlide(page);

    await swipeLeft(page);
    expect(await getActiveNodeId(page)).toBe('builder-architecture');

    await page.waitForTimeout(1200);

    const bars = page.locator('.slide.active .chart-bar-fill');
    expect(await bars.count()).toBeGreaterThanOrEqual(3);

    const hasOverflow = await page.evaluate(() => {
      const active = document.querySelector('.slide.active');
      return active ? active.scrollWidth > active.clientWidth : false;
    });
    expect(hasOverflow).toBe(false);
  });
});
