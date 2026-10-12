import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
  "extend": {
    "colors": {
      "primary": "#004ac6",
      "surface-container-high": "#e7e7f3",
      "outline": "#737686",
      "success-base": "#10B981",
      "surface-container-lowest": "#ffffff",
      "inverse-primary": "#b4c5ff",
      "brand-100": "#DBEAFE",
      "surface-variant": "#e1e2ed",
      "success-text": "#065F46",
      "on-secondary-container": "#fffbff",
      "brand-400": "#60A5FA",
      "brand-700": "#1E40AF",
      "on-primary-fixed": "#00174b",
      "secondary-container": "#4069f2",
      "surface-dim": "#d9d9e5",
      "danger-surface": "#FEE2E2",
      "inverse-on-surface": "#f0f0fb",
      "on-tertiary-container": "#ffede6",
      "error-container": "#ffdad6",
      "on-secondary-fixed": "#001551",
      "text-muted": "#94A3B8",
      "brand-500": "#2563EB",
      "surface-container": "#ededf9",
      "on-tertiary-fixed-variant": "#7d2d00",
      "tertiary-fixed-dim": "#ffb596",
      "on-error-container": "#93000a",
      "brand-600": "#1D4ED8",
      "surface-overlay": "#EBF2FA",
      "inverse-surface": "#2e3039",
      "canvas": "#F0F4FA",
      "outline-variant": "#c3c6d7",
      "primary-fixed-dim": "#b4c5ff",
      "whatsapp": "#25D366",
      "on-surface-variant": "#434655",
      "tertiary-container": "#bc4800",
      "surface-tint": "#0053db",
      "on-tertiary": "#ffffff",
      "brand-200": "#BFDBFE",
      "surface": "#FFFFFF",
      "on-primary-container": "#eeefff",
      "danger-text": "#991B1B",
      "on-secondary": "#ffffff",
      "on-error": "#ffffff",
      "text-primary": "#0F172A",
      "secondary-fixed-dim": "#b7c4ff",
      "warning-text": "#78350F",
      "on-secondary-fixed-variant": "#0039b5",
      "success-surface": "#ECFDF5",
      "primary-container": "#2563eb",
      "warning-surface": "#FEF3C7",
      "text-secondary": "#475569",
      "on-tertiary-fixed": "#360f00",
      "surface-container-low": "#f3f3fe",
      "danger-base": "#EF4444",
      "on-primary": "#ffffff",
      "tertiary-fixed": "#ffdbcd",
      "brand-50": "#EFF6FF",
      "border-strong": "#CBD5E1",
      "secondary": "#1d4ed8",
      "primary-fixed": "#dbe1ff",
      "surface-bright": "#faf8ff",
      "background": "#faf8ff",
      "surface-container-highest": "#e1e2ed",
      "secondary-fixed": "#dce1ff",
      "on-background": "#191b23",
      "on-primary-fixed-variant": "#003ea8",
      "on-surface": "#191b23",
      "border-subtle": "#E2E8F0",
      "error": "#ba1a1a",
      "warning-base": "#F59E0B",
      "tertiary": "#943700",
      "": {
        "brand": {
          "50": "#EFF6FF",
          "100": "#DBEAFE",
          "200": "#BFDBFE",
          "400": "#60A5FA",
          "500": "#2563EB",
          "600": "#1D4ED8",
          "700": "#1E40AF"
        },
        "text": {
          "primary": "#0F172A",
          "secondary": "#475569",
          "muted": "#94A3B8"
        },
        "status": {
          "success": "#10B981",
          "success-bg": "#ECFDF5",
          "success-text": "#065F46",
          "warning": "#F59E0B",
          "warning-bg": "#FEF3C7",
          "warning-text": "#78350F",
          "danger": "#EF4444",
          "danger-bg": "#FEE2E2",
          "danger-text": "#991B1B"
        }
      },
      "clay-overlay": "#EBF2FA"
    },
    "fontSize": {
      "body-regular": [
        "14px",
        {
          "lineHeight": "20px",
          "letterSpacing": "0em",
          "fontWeight": "400"
        }
      ],
      "headline-2": [
        "16px",
        {
          "lineHeight": "22px",
          "letterSpacing": "0em",
          "fontWeight": "600"
        }
      ],
      "caption": [
        "12px",
        {
          "lineHeight": "16px",
          "letterSpacing": "+0.01em",
          "fontWeight": "500"
        }
      ],
      "micro-badge": [
        "10px",
        {
          "lineHeight": "12px",
          "letterSpacing": "+0.02em",
          "fontWeight": "700"
        }
      ],
      "metric-display": [
        "28px",
        {
          "lineHeight": "34px",
          "letterSpacing": "-0.02em",
          "fontWeight": "700"
        }
      ],
      "body-bold": [
        "14px",
        {
          "lineHeight": "20px",
          "letterSpacing": "0em",
          "fontWeight": "600"
        }
      ],
      "headline-1": [
        "20px",
        {
          "lineHeight": "26px",
          "letterSpacing": "-0.01em",
          "fontWeight": "600"
        }
      ]
    },
    "fontFamily": {
      "body-regular": [
        "Plus Jakarta Sans"
      ],
      "headline-2": [
        "Plus Jakarta Sans"
      ],
      "caption": [
        "Plus Jakarta Sans"
      ],
      "micro-badge": [
        "Plus Jakarta Sans"
      ],
      "metric-display": [
        "Plus Jakarta Sans"
      ],
      "body-bold": [
        "Plus Jakarta Sans"
      ],
      "headline-1": [
        "Plus Jakarta Sans"
      ],
      "sans": [
        "Plus Jakarta Sans",
        "sans-serif"
      ]
    },
    "spacing": {
      "space-sm": "0.5rem",
      "margin": "1.5rem",
      "space-lg": "1.5rem",
      "space-xl": "2rem",
      "gutter": "1rem",
      "space-md": "1rem",
      "space-xs": "0.25rem"
    },
    "borderRadius": {
      "DEFAULT": "0.25rem",
      "lg": "0.5rem",
      "xl": "0.75rem",
      "full": "9999px"
    },
    "boxShadow": {
      "clay_card": "0 12px 28px -6px rgba(37,99,235,0.12), 0 8px 12px -4px rgba(15,23,42,0.03)",
      "clay_glow": "0 10px 22px rgba(37,99,235,0.32)",
      "subtle": "0 2px 4px rgba(15,23,42,0.03)",
      "inner_highlight": "inset 0 2px 4px rgba(255,255,255,0.95), inset 0 -2px 4px rgba(37,99,235,0.05)",
      "whatsapp_glow": "0 8px 16px rgba(37,211,102,0.28)",
      "modal": "0 16px 36px -4px rgba(15,23,42,0.16)"
    }
  }
},
  plugins: [],
};

export default config;

