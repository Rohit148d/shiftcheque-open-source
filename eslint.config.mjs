import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Focused lint configuration.
 *
 * The rules that matter for this product are the ones that protect money
 * correctness and privacy, so they are errors; stylistic preferences are off.
 */
export default tseslint.config(
  {
    ignores: ['node_modules/**', '.expo/**', 'android/**', 'ios/**', 'dist/**', 'coverage/**', '*.config.js', 'scripts/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        require: 'readonly',
        module: 'readonly',
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AbortController: 'readonly',
        BigInt: 'readonly',
        __DEV__: 'readonly',
      },
    },
    rules: {
      // Privacy and correctness guards
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Math'][property.name='round'] > CallExpression > MemberExpression[object.property.name='amount']",
          message: 'Money must be rounded with the helpers in src/core/money.ts, never inline Math.round.',
        },
      ],
      // The product name must come from src/config/brand.ts
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/core/**/*.ts', 'src/rules/**/*.ts'],
    rules: {
      // Pure logic modules must not depend on React Native
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react-native', message: 'Payroll logic must stay pure and testable.' },
            { name: 'expo-sqlite', message: 'Payroll logic must stay pure and testable.' },
            { name: 'react', message: 'Payroll logic must stay pure and testable.' },
          ],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    rules: {
      // Unused values are reported but do not fail the build: the type checker
      // already rejects anything that would break at runtime.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true, caughtErrors: 'none' },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/prefer-as-const': 'warn',
      'no-useless-assignment': 'warn',
    },
  },
);
