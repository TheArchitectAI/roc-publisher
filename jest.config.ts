import type { Config } from 'jest';

const config: Config = {
  preset: './jest.preset.js',
  rootDir: '.',
  testMatch: ['<rootDir>/**/*.spec.{ts,tsx}', '<rootDir>/**/*.test.{ts,tsx}'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/.next/',
    '/coverage/',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/.next/',
    '/coverage/',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@gitroom/backend/(.*)$': '<rootDir>/apps/backend/src/$1',
    '^@gitroom/frontend/(.*)$': '<rootDir>/apps/frontend/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
    '^@gitroom/nestjs-libraries/(.*)$':
      '<rootDir>/libraries/nestjs-libraries/src/$1',
    '^@gitroom/react/(.*)$':
      '<rootDir>/libraries/react-shared-libraries/src/$1',
    '^@gitroom/plugins/(.*)$': '<rootDir>/libraries/plugins/src/$1',
    '^@gitroom/orchestrator/(.*)$': '<rootDir>/apps/orchestrator/src/$1',
    '^@gitroom/extension/(.*)$': '<rootDir>/apps/extension/src/$1',
  },
};

export default config;
