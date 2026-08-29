export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#f5f7f5',
          card: '#ffffff',
          border: '#dce3dd',
          blue: '#1f6b4f',
          purple: '#163f31',
          neon: '#5c9b7c',
        },
      },
      boxShadow: {
        soft: '0 12px 34px rgba(20, 48, 34, 0.08)',
      },
    },
  },
  plugins: [],
};
