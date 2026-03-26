import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: '#F1642E',
        surface: '#FFF3C4',
        border: '#E0CFA0',
        bg: '#FFF8E1',
      },
    },
  },
  plugins: [],
};
export default config;
