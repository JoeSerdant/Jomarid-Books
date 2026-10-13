module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['react', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:react/jsx-runtime', 'plugin:react-hooks/recommended'],
  settings: { react: { version: '18.2' } },
  // Minihry v src/gameContent jsou samostatné skripty s vlastními globálními proměnnými.
  ignorePatterns: ['dist', 'node_modules', 'src/gameContent/**'],
  rules: {
    'react/prop-types': 'off',
    'react/no-unescaped-entities': 'off',
    'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
  },
  overrides: [{ files: ['vite.config.js'], env: { node: true } }],
};
