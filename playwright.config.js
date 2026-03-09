const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  retries: 0,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'iPhone 14',
      use: {
        // Chromium with iPhone viewport/DPR for real CDP touch events
        browserName: 'chromium',
        viewport: devices['iPhone 14'].viewport,
        deviceScaleFactor: devices['iPhone 14'].deviceScaleFactor,
        isMobile: true,
        hasTouch: true,
        userAgent: devices['iPhone 14'].userAgent,
      },
    },
    {
      name: 'Pixel 7',
      use: {
        browserName: 'chromium',
        viewport: devices['Pixel 7'].viewport,
        deviceScaleFactor: devices['Pixel 7'].deviceScaleFactor,
        isMobile: true,
        hasTouch: true,
        userAgent: devices['Pixel 7'].userAgent,
      },
    },
  ],
});
