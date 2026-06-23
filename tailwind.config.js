/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        forge: {
          50: '#fdf6f0',
          100: '#f9e8d9',
          200: '#f1ccae',
          300: '#e7a97c',
          400: '#dd8550',
          500: '#cf6a36',
          600: '#bb522b',
          700: '#9b3f26',
          800: '#7d3425',
          900: '#662d22',
        },
      },
      fontFamily: {
        display: ['"Fraunces"', 'Georgia', 'serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
