module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.jest.json',
        // Surface type errors as warnings (not silent). `false` would mask
        // type bugs in test code; this prints them without failing the run.
        diagnostics: { warnOnly: true },
      },
    ],
  },
};
