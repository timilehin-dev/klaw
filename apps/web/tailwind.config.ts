import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Architectural Workbench Palette
        background: '#FAFAFA',
        surface: '#FFFFFF',
        border: '#E5E5E5',
        primary: '#4338CA',
        'primary-hover': '#3730A3',
        text: {
          DEFAULT: '#111111',
          muted: '#6B7280',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
