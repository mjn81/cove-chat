import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';

export default tseslint.config(
  // The Stageshow kit is vendored third-party code (MIT); we use it as shipped rather than lint-fix it.
  { ignores: ['dist/', '.astro/', 'node_modules/', 'scripts/', 'src/components/stageshow/kit/'] },
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
