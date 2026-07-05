/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        vivere: {
          teal:  '#0D7377',
          dark:  '#1A1A2E',
          slate: '#3D3D3A',
          muted: '#73726C',
          bg:    '#F4F3F0',
        },
      },
    },
  },
  plugins: [],
};
