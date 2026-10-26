/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        overlay: {
          DEFAULT: "hsl(var(--overlay))",
          foreground: "hsl(var(--overlay-foreground))",
        },
        mention: {
          DEFAULT: "hsl(var(--mention-background))",
          foreground: "hsl(var(--mention-foreground))",
          border: "hsl(var(--mention-border))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        // Brief highlight on a message whose text was just copied, plus the "Copied" pill popping in.
        "copy-flash": { "0%": { backgroundColor: "hsl(var(--primary) / 0.28)" }, "100%": { backgroundColor: "hsl(var(--primary) / 0)" } },
        "copy-pop": { "0%": { opacity: "0", transform: "translateY(6px) scale(0.9)" }, "15%": { opacity: "1", transform: "translateY(0) scale(1)" }, "80%": { opacity: "1" }, "100%": { opacity: "0", transform: "translateY(-2px)" } },
      },
      animation: {
        "copy-flash": "copy-flash 900ms ease-out",
        "copy-pop": "copy-pop 1400ms ease-out forwards",
      },
      fontFamily: {
        sans: ["Vazirmatn", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "Noto Sans", "sans-serif"],
      },
    },
  },
  plugins: [],
}
