import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.asgard.huginn',
  appName: 'Huginn',
  webDir: '../public/h',
  server: {
    // Production CRM host — APK loads remote /h for one backend
    url: 'https://crm.asgard-it.ru/h/',
    cleartext: false
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
