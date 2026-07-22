import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand:      '#F1642E',
        'brand-dk': '#D9531F',
        bg:         '#F6F4EF',   // พื้นหลังหลัก (ครีมอ่อน)
        surface:    '#FFFFFF',   // การ์ด/แผง
        line:       '#E7E2D9',   // เส้นขอบ
        border:     '#E7E2D9',   // alias เดิม
        ink:        '#1C1917',   // ตัวหนังสือหลัก
        sub:        '#57534E',   // ตัวหนังสือรอง
        faint:      '#A29D93',   // ป้าย/label
      },
      boxShadow: {
        soft:  '0 1px 2px rgba(28,25,23,.06), 0 2px 8px rgba(28,25,23,.05)',
        float: '0 2px 6px rgba(28,25,23,.07), 0 12px 32px rgba(28,25,23,.10)',
        brand: '0 2px 10px rgba(241,100,46,.35)',
      },
      fontFamily: {
        thai: ['Kanit', 'sans-serif'],
        en:   ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
