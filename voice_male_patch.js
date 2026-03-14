const fs = require('fs');

// 1. Update voice-agent.js — change marina → madirus
const VA = '/var/www/asgard-crm/src/services/voice-agent.js';
let va = fs.readFileSync(VA, 'utf8');
va = va.replace(/voice: 'marina'/g, "voice: 'madirus'");
va = va.replace(/speed: '1\.0'/g, "speed: '0.95'");
fs.writeFileSync(VA, va);
console.log('voice-agent.js: marina → madirus, speed 0.95');

// 2. Update agi-server.js — change marina → madirus in any direct TTS calls
const AGI = '/var/www/asgard-crm/scripts/agi-server.js';
let agi = fs.readFileSync(AGI, 'utf8');
agi = agi.replace(/voice: 'marina'/g, "voice: 'madirus'");
agi = agi.replace(/speed: '1\.0'/g, "speed: '0.95'");
fs.writeFileSync(AGI, agi);
console.log('agi-server.js: marina → madirus, speed 0.95');

// 3. Update prompt — change feminine forms to masculine
const PROMPT = '/var/www/asgard-crm/src/prompts/voice-secretary-prompt.js';
let prompt = fs.readFileSync(PROMPT, 'utf8');
prompt = prompt.replace('не расслышала', 'не расслышал');
prompt = prompt.replace('Простите, не расслышала. Подскажите ещё раз?', 'Простите, не расслышал. Подскажите ещё раз?');
prompt = prompt.replace('не нашла', 'не нашёл');
// Keep general style but make it masculine
fs.writeFileSync(PROMPT, prompt);
console.log('prompt: feminine → masculine forms');

console.log('All voice changes applied — Viking male voice (madirus)');
