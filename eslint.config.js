import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// The layer dependency rule (src/README.md) is enforced with scoped
// `no-restricted-imports` rather than an import-resolver plugin — fewer moving parts.
const layerBoundary = (group, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group, message }] }],
});

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'admin/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: layerBoundary(
      ['**/application/**', '**/infrastructure/**', '**/http/**', '**/entrypoints/**'],
      'domain/ is pure and must not import from any other layer (CLAUDE.md dependency rule).',
    ),
  },
  {
    files: ['src/application/**/*.ts'],
    rules: layerBoundary(
      ['**/infrastructure/**', '**/http/**', '**/entrypoints/**'],
      'application/ may depend on domain and ports only — never on a concrete adapter.',
    ),
  },
  {
    files: ['src/http/**/*.ts'],
    rules: layerBoundary(
      ['**/infrastructure/**', '**/entrypoints/**'],
      'http/ delegates to application use cases; it must not import infrastructure.',
    ),
  },
  {
    files: ['src/infrastructure/**/*.ts'],
    rules: layerBoundary(
      ['**/http/**', '**/entrypoints/**'],
      'infrastructure/ implements ports; it must not import http or entrypoints.',
    ),
  },
  prettier,
);
