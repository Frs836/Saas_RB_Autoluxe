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
      "primary": "#1E3A8A",
      "primary-hover": "#172554",
      "accent": "#0284C7",
      "surface-container-high": "#E2E8F0",
      "outline": "#64748B",
      "success-base": "#15803D",
      "surface-container-lowest": "#FFFFFF",
      "inverse-primary": "#DBEAFE",
      "brand-100": "#DBEAFE",
      "surface-variant": "#F1F5F9",
      "success-text": "#15803D",
      "on-secondary-container": "#FFFFFF",
      "brand-400": "#38BDF8",
      "brand-700": "#172554",
      "on-primary-fixed": "#0F172A",
      "secondary-container": "#1E40AF",
      "surface-dim": "#E2E8F0",
      "danger-surface": "#FEF2F2",
      "inverse-on-surface": "#F8FAFC",
      "on-tertiary-container": "#FFFFFF",
      "error-container": "#FEF2F2",
      "on-secondary-fixed": "#0F172A",
      "text-muted": "#64748B",
      "brand-500": "#1E40AF",
      "surface-container": "#F1F5F9",
      "on-tertiary-fixed-variant": "#7D2D00",
      "tertiary-fixed-dim": "#FFB596",
      "on-error-container": "#B91C1C",
      "brand-600": "#1E3A8A",
      "surface-overlay": "#F1F5F9",
      "inverse-surface": "#0F172A",
      "canvas": "#F8FAFC",
      "outline-variant": "#E2E8F0",
      "primary-fixed-dim": "#BFDBFE",
      "whatsapp": "#16A34A",
      "on-surface-variant": "#475569",
      "tertiary-container": "#B45309",
      "surface-tint": "#1E3A8A",
      "on-tertiary": "#FFFFFF",
      "brand-200": "#BFDBFE",
      "surface": "#FFFFFF",
      "on-primary-container": "#FFFFFF",
      "danger-text": "#B91C1C",
      "on-secondary": "#FFFFFF",
      "on-error": "#FFFFFF",
      "text-primary": "#0F172A",
      "secondary-fixed-dim": "#BFDBFE",
      "warning-text": "#B45309",
      "on-secondary-fixed-variant": "#1E3A8A",
      "success-surface": "#F0FDF4",
      "primary-container": "#1E3A8A",
      "warning-surface": "#FFFBEB",
      "text-secondary": "#475569",
      "on-tertiary-fixed": "#360F00",
      "surface-container-low": "#F1F5F9",
      "danger-base": "#B91C1C",
      "on-primary": "#FFFFFF",
      "tertiary-fixed": "#FFFBEB",
      "brand-50": "#EFF6FF",
      "border-strong": "#CBD5E1",
      "secondary": "#1E40AF",
      "primary-fixed": "#DBEAFE",
      "surface-bright": "#FFFFFF",
      "background": "#F8FAFC",
      "surface-container-highest": "#E2E8F0",
      "secondary-fixed": "#DBEAFE",
      "on-background": "#0F172A",
      "on-primary-fixed-variant": "#1E3A8A",
      "on-surface": "#0F172A",
      "border-subtle": "#E2E8F0",
      "error": "#B91C1C",
      "warning-base": "#B45309",
      "tertiary": "#B45309",
      "": {
        "brand": {
          "50": "#EFF6FF",
          "100": "#DBEAFE",
          "200": "#BFDBFE",
          "400": "#38BDF8",
          "500": "#1E40AF",
          "600": "#1E3A8A",
          "700": "#172554"
        },
        "text": {
          "primary": "#0F172A",
          "secondary": "#475569",
          "muted": "#64748B"
        },
        "status": {
          "success": "#15803D",
          "success-bg": "#F0FDF4",
          "success-text": "#15803D",
          "warning": "#B45309",
          "warning-bg": "#FFFBEB",
          "warning-text": "#B45309",
          "danger": "#B91C1C",
          "danger-bg": "#FEF2F2",
          "danger-text": "#B91C1C"
        }
      },
      "clay-overlay": "#F1F5F9"
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
      "DEFAULT": "6px",
      "sm": "4px",
      "md": "6px",
      "lg": "8px",
      "xl": "10px",
      "card": "10px",
      "control": "8px",
      "badge": "6px",
      "full": "9999px"
    },
    "boxShadow": {
      "clay_card": "0 1px 2px rgba(15,23,42,0.04)",
      "clay_glow": "0 2px 6px rgba(30,58,138,0.18)",
      "subtle": "0 1px 2px rgba(15,23,42,0.04)",
      "inner_highlight": "none",
      "whatsapp_glow": "0 2px 6px rgba(22,163,74,0.2)",
      "modal": "0 12px 32px -4px rgba(15,23,42,0.16)"
    }
  }
},
  plugins: [],
};

export default config;

