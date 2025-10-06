export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        strip: {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '30px 0' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-5px)' },
          '75%': { transform: 'translateX(5px)' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'strip': 'strip 1s linear infinite',
        'shake': 'shake 0.5s ease-in-out',
      },
      colors: {
        brand: {
          primary: '#667eea',
          secondary: '#764ba2',
        },
        status: {
          queued: '#ffa500',
          processing: '#2196F3',
          completed: '#4CAF50',
          failed: '#f44336',
          cancelled: '#9e9e9e',
        },
      },
      boxShadow: {
        'card': '0 2px 8px rgba(0,0,0,0.1)',
      },
      borderRadius: {
        'xl': '12px',
      },
    },
  },
  plugins: [],
};
