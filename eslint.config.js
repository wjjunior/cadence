import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Dependency rule (CLAUDE.md "Backend: layered, hexagonal-lite"):
//   domain/         -> depends on nothing
//   application/    -> domain + ports only
//   http/           -> delegates to application use cases (no infrastructure)
//   infrastructure/ -> implements ports (no http, no entrypoints)
//   entrypoints/    -> composition root (may import everything; never a restricted target)
// Enforced as a lint boundary via scoped `no-restricted-imports`, deliberately
// without an extra import-resolver plugin (fewer moving parts).
const layerBoundary = (group, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group, message }] }],
});

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'admin/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
