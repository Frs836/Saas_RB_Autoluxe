import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rbautoluxe.app',
  appName: 'RB AUTOLUXE',
  webDir: 'public',
  server: {
    // Live Server URL untuk auto-update instan
    url: 'https://rb-autoluxe.vercel.app',
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#eff4fb',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: true,
      androidSpinnerStyle: 'large',
      spinnerColor: '#2563eb',
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
