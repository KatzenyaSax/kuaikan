import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'openapi/**', '**/*.gen.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // scripts/ 是 Node 环境（生成器与冒烟脚本），需要 Node 全局量
    files: ['scripts/**/*.{js,mjs,mts,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // TS 自己就会检查未定义标识符，eslint 的 no-undef 在 TS 上只会误报
    // （官方 typescript-eslint 文档明确建议关闭）
    files: ['**/*.{ts,tsx,mts}'],
    rules: { 'no-undef': 'off' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
)
