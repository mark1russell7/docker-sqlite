import { defineConfig } from "vitest/config";

// The tests of the package. The site in site/ has its own tests and its own config.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
