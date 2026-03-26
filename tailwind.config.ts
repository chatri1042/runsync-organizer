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
        surface: '#1A1D27',
        border: '#2A2D3A',
        bg: '#0F1117',
      },
    },
  },
  plugins: [],
};
export default config;
