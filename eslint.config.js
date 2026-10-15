import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'dist-desktop/**', 'release/**', 'node_modules/**', 'src/**/*.js', 'server/**/*.js', 'perf/**', '*.md'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs['recommended-latest'].rules },
  },
  {
    // UI code goes through React; only the engines and the projector page may touch the DOM by id.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/engine/**', 'src/output.ts', 'src/main.tsx'],
    rules: {
      'no-restricted-properties': ['error',
        { object: 'document', property: 'getElementById', message: 'Use a ref or React state; only engine/ and output.ts may query the DOM.' },
        { object: 'document', property: 'querySelector', message: 'Use a ref; only engine/ and output.ts may query the DOM.' },
        { object: 'document', property: 'querySelectorAll', message: 'Use refs; only engine/ and output.ts may query the DOM.' },
      ],
    },
  },
);
