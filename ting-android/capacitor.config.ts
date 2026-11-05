import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.asgard.ting.room',
  appName: 'Тинг Переговорка',
  webDir: 'www',
  server: {
    // Production CRM — APK loads remote TV shell (same LiveKit / guest API)
    url: 'https://asgard-crm.ru/ting-tv/',
    cleartext: false
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0a0c10'
  }
};

export default config;
