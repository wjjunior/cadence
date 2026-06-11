import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// FSD-lite: a layer may import only from layers strictly below it.
const fsdZones = [
  { target: './src/shared', from: ['./src/app', './src/pages', './src/widgets', './src/features', './src/entities'] },
  { target: './src/entities', from: ['./src/app', './src/pages', './src/widgets', './src/features'] },
  { target: './src/features', from: ['./src/app', './src/pages', './src/widgets'] },
  { target: './src/widgets', from: ['./src/app', './src/pages'] },
  { target: './src/pages', from: ['./src/app'] },
];

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      import: importPlugin,
    },
    settings: {
      'import/resolver': { typescript: { project: './tsconfig.app.json' } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'import/no-restricted-paths': ['error', { zones: fsdZones }],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    rules: { 'import/no-restricted-paths': 'off' },
  },
);
