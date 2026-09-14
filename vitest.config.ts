import { defineConfig } from 'vitest/config';

// Only the security-rules suite lives under tests/, and it needs the Firestore
// emulator running: use `npm run test:rules`, which starts one around it.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Every test clears the same emulator database.
    fileParallelism: false,
  },
});
