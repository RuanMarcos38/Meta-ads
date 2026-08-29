export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#f4f6f2',
          card: '#ffffff',
          border: '#e1e8dd',
          blue: '#0b6b45',
          purple: '#123d2d',
          neon: '#62b783',
        },
      },
      boxShadow: {
        soft: '0 18px 45px rgba(22, 44, 32, 0.08)',
      },
    },
  },
  plugins: [],
};
