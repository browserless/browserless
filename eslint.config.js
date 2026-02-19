import tseslint from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: [
      'node_modules/**',
      'static/**',
      '**/*.spec.ts',
      'build/**',
      '.no-git/**',
      'extensions/**',
      'scripts/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  ...tseslint.configs['flat/recommended'],
  {
    rules: {
      semi: [2, 'always'],
      'no-async-promise-executor': 0,
      '@typescript-eslint/ban-ts-comment': 0,
      '@typescript-eslint/no-var-requires': 0,
      'sort-imports': [
        'error',
        {
          ignoreCase: false,
          ignoreDeclarationSort: false,
          ignoreMemberSort: false,
          memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
          allowSeparatedGroups: true,
        },
      ],
    },
  },
];
