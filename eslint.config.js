import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    // Built output, vendored third-party bundles, static assets and local scratch folders.
    ignores: ['dist/', 'src/vendor/', 'public/', 'node_modules/', 'work/', 'outputs/', 'local-converter/', '.notes/'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {...globals.browser, ...globals.node, __APP_VERSION__: 'readonly', __APP_COMMIT__: 'readonly'},
    },
    rules: {
      'no-unused-vars': ['warn', {args: 'none', caughtErrors: 'none', ignoreRestSiblings: true}],
      'no-empty': ['error', {allowEmptyCatch: true}],
      // Style-level checks from the recommended set: reported, but not CI-blocking.
      'no-useless-assignment': 'warn',
      'no-useless-escape': 'warn',
      'preserve-caught-error': 'warn',
    },
  },
];
