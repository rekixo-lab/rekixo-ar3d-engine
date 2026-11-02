import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["production-floor-controls.spec.ts"],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: 1,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--use-angle=swiftshader", "--enable-webgl"],
        },
      },
    },
  ],
  webServer: [
    {
      command: "npm run dev:admin",
      url: "http://127.0.0.1:5173/3Dprojects/studio",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npm run dev:public",
      url: "http://127.0.0.1:5174/3Dprojects",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
