#!/usr/bin/env node

/**
 * ASGARD CRM - Generate VAPID keys for Push Notifications
 * Run once: node scripts/generate-vapid-keys.js
 * Add the output to your .env file
 */

const webpush = require('web-push');
const vapidKeys = webpush.generateVAPIDKeys();

console.log('VAPID Keys Generated!');
console.log('Add these to your .env file:\n');
console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
console.log(`VAPID_EMAIL=mailto:admin@asgard-crm.ru`);
