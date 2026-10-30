const base = { preset: 'ts-jest', testEnvironment: 'node', setupFiles: ['<rootDir>/tests/setupEnv.ts'] };
module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/tests/unit/**/*.test.ts'] },
    {
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      testTimeout: 30000,
    },
  ],
};
