import js from '@eslint/js'
import react from 'eslint-plugin-react'

const browserGlobals = {
  window: 'readonly', document: 'readonly', console: 'readonly',
  navigator: 'readonly', location: 'readonly',
  crypto: 'readonly', ResizeObserver: 'readonly', MutationObserver: 'readonly',
  alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly',
  URL: 'readonly', fetch: 'readonly', Event: 'readonly',
}

const nodeGlobals = {
  process: 'readonly', require: 'readonly', module: 'writable', exports: 'writable',
  __dirname: 'readonly', __filename: 'readonly', Buffer: 'readonly',
  console: 'readonly', setTimeout: 'readonly', setInterval: 'readonly',
  clearInterval: 'readonly', clearTimeout: 'readonly',
}

export default [
  { ignores: ['out/**', 'release/**', 'node_modules/**', 'dist/**'] },

  // Electron main process (CJS)
  {
    files: ['electron/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // React renderer (ESM + JSX)
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...js.configs.recommended.rules,
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off', // terminal code intentionally uses ANSI escape sequences
    },
  },
]
