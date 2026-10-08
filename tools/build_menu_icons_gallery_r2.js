#!/usr/bin/env node
/**
 * Menu icons R2.3 — custom soft silhouette family (ASGARD), full CRM shell.
 * - No permanent rail labels (hover tip only)
 * - Right rail: 4 identical soft-plate mono icons
 * - Glyphs: hand-tuned soft paths (not stock Fluent dump)
 * CRM palette only: blue/gold/red/ink
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_design', 'menu-icons-r2');
const R1_INV = path.join(ROOT, '_design', 'menu-icons-r1', 'inventory.json');

const ACCENT = { none: null, blue: '#2E7BC0', gold: '#B8841A', red: '#A82030' };

/** Soft filled paths in 24×24 — ASGARD family (rounded, thick, minimal) */
const G = {
  home: `<path d="M12 3.2c.4 0 .77.15 1.06.44l7.1 7.1a1.2 1.2 0 0 1-1.7 1.7l-.46-.47V19a2.2 2.2 0 0 1-2.2 2.2h-2.1a1.1 1.1 0 0 1-1.1-1.1v-3.3c0-.6-.5-1.1-1.1-1.1h-1.2c-.6 0-1.1.5-1.1 1.1v3.3c0 .6-.5 1.1-1.1 1.1H6.2A2.2 2.2 0 0 1 4 19v-7.03l-.46.47a1.2 1.2 0 1 1-1.7-1.7l7.1-7.1c.29-.29.66-.44 1.06-.44Z"/>`,
  clipboard: `<path d="M9.2 3.5h1.1A2.2 2.2 0 0 1 12.5 2h0A2.2 2.2 0 0 1 14.7 3.5h1.1A2.3 2.3 0 0 1 18.1 5.8v14A2.3 2.3 0 0 1 15.8 22H8.2A2.3 2.3 0 0 1 5.9 19.8v-14A2.3 2.3 0 0 1 8.2 3.5Zm3.3 0a.9.9 0 1 0 0 1.8a.9.9 0 0 0 0-1.8ZM8.8 9.2h6.4a1 1 0 1 1 0 2H8.8a1 1 0 1 1 0-2Zm0 4h6.4a1 1 0 1 1 0 2H8.8a1 1 0 1 1 0-2Zm0 4h4.2a1 1 0 1 1 0 2H8.8a1 1 0 1 1 0-2Z"/>`,
  briefcase: `<path d="M9 4.5A2.5 2.5 0 0 1 11.5 2h1A2.5 2.5 0 0 1 15 4.5V6h3.2A2.8 2.8 0 0 1 21 8.8v9.4A2.8 2.8 0 0 1 18.2 21H5.8A2.8 2.8 0 0 1 3 18.2V8.8A2.8 2.8 0 0 1 5.8 6H9V4.5Zm2-.7c-.4 0-.7.3-.7.7V6h2.4V4.5c0-.4-.3-.7-.7-.7h-1ZM4.8 11.2v1.3c0 .7.5 1.3 1.2 1.4l5.5.7c.3 0 .7 0 1 0l5.5-.7c.7-.1 1.2-.7 1.2-1.4v-1.3H4.8Z"/>`,
  money: `<path d="M4.5 7.2A3.2 3.2 0 0 1 7.7 4h8.6a3.2 3.2 0 0 1 3.2 3.2v9.6a3.2 3.2 0 0 1-3.2 3.2H7.7a3.2 3.2 0 0 1-3.2-3.2V7.2Zm7.5.6c-2 0-3.4 1-3.4 2.6c0 1.1.7 1.9 2.1 2.3l1.1.3c.7.2 1 .4 1 .8c0 .5-.5.9-1.3.9c-.7 0-1.2-.3-1.4-.8a1 1 0 1 0-1.9.4c.4 1.2 1.5 1.9 2.8 2.1V17a1 1 0 1 0 2 0v-.8c1.7-.3 3-1.4 3-3c0-1.4-.9-2.3-2.5-2.7l-1.1-.3c-.6-.2-.9-.4-.9-.8c0-.5.5-.8 1.2-.8c.6 0 1.1.2 1.3.7a1 1 0 0 0 1.9-.5c-.4-1.1-1.5-1.8-2.7-1.9V7.8a1 1 0 1 0-2 0v.1Z"/>`,
  box: `<path d="M11.1 2.4a2.2 2.2 0 0 1 1.8 0l7.2 3.3A2 2 0 0 1 21.5 7.5v9a2 2 0 0 1-1.1 1.8l-7.2 3.3a2.2 2.2 0 0 1-1.8 0l-7.2-3.3A2 2 0 0 1 2.5 16.5v-9a2 2 0 0 1 1.1-1.8l7.5-3.3ZM4.5 9.1v6.9l7 3.2V12.2L4.5 9.1Zm15 0l-7 3.1v6.9l7-3.1V9.1ZM12 4.2L5.6 7.1L12 10l6.4-2.9L12 4.2Z"/>`,
  people: `<path d="M9.2 7a3.2 3.2 0 1 1 0-6.4a3.2 3.2 0 0 1 0 6.4Zm8.4 1.2a2.7 2.7 0 1 1 0-5.4a2.7 2.7 0 0 1 0 5.4ZM3.2 14.4c0-2.3 2.3-4 6-4s6 1.7 6 4v.4c0 1.4-1.1 2.5-2.5 2.5H5.7A2.5 2.5 0 0 1 3.2 14.8v-.4Zm11.3-.2c0-1 .3-1.9.9-2.6c.9.3 1.9.5 3 .5c2.5 0 4.4 1.1 4.4 3v.2c0 1.1-.9 2-2 2h-4.1a3.2 3.2 0 0 1-2.2-2.9v-.2Z"/>`,
  chat: `<path d="M12 2.5c5.1 0 9.2 3.5 9.2 7.8c0 4.3-4.1 7.8-9.2 7.8c-.9 0-1.8-.1-2.6-.3l-3.4 1.9a1.1 1.1 0 0 1-1.6-1l.5-3.1C3.4 14.2 2.8 12.8 2.8 10.3C2.8 6 6.9 2.5 12 2.5Zm-3.2 6.2a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 0 0 0-2.4Zm3.2 0a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 0 0 0-2.4Zm3.2 0a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 0 0 0-2.4Z"/>`,
  bars: `<path d="M6.2 10.5A1.7 1.7 0 0 1 7.9 8.8h.4A1.7 1.7 0 0 1 10 10.5v8.3A1.7 1.7 0 0 1 8.3 20.5h-.4A1.7 1.7 0 0 1 6.2 18.8v-8.3Zm7-6A1.7 1.7 0 0 1 14.9 2.8h.4A1.7 1.7 0 0 1 17 4.5v14.3A1.7 1.7 0 0 1 15.3 20.5h-.4A1.7 1.7 0 0 1 13.2 18.8V4.5Zm-3.5 10.2A1.7 1.7 0 0 1 11.4 13h.4a1.7 1.7 0 0 1 1.7 1.7v4.1a1.7 1.7 0 0 1-1.7 1.7h-.4a1.7 1.7 0 0 1-1.7-1.7v-4.1Z"/>`,
  gear: `<path d="M10.1 2.6a2 2 0 0 1 3.8 0l.2 1.1c.2.1.4.2.6.3l1-.5a2 2 0 0 1 2.7 1.1l.5 1.5a2 2 0 0 1-.7 2.2l-.8.7c0 .2.1.4.1.6l1.1.2a2 2 0 0 1 0 3.8l-1.1.2c0 .2-.1.4-.1.6l.8.7a2 2 0 0 1 .7 2.2l-.5 1.5a2 2 0 0 1-2.7 1.1l-1-.5c-.2.1-.4.2-.6.3l-.2 1.1a2 2 0 0 1-3.8 0l-.2-1.1a6 6 0 0 1-.6-.3l-1 .5a2 2 0 0 1-2.7-1.1l-.5-1.5a2 2 0 0 1 .7-2.2l.8-.7a6 6 0 0 1-.1-.6l-1.1-.2a2 2 0 0 1 0-3.8l1.1-.2c0-.2.1-.4.1-.6l-.8-.7a2 2 0 0 1-.7-2.2l.5-1.5a2 2 0 0 1 2.7-1.1l1 .5c.2-.1.4-.2.6-.3l.2-1.1ZM12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6Z"/>`,
  sparkle: `<path d="M11.2 2.4c.3-.9 1.6-.9 1.9 0l1.1 3.3a4.2 4.2 0 0 0 2.7 2.7l3.3 1.1c.9.3.9 1.6 0 1.9l-3.3 1.1a4.2 4.2 0 0 0-2.7 2.7l-1.1 3.3c-.3.9-1.6.9-1.9 0l-1.1-3.3a4.2 4.2 0 0 0-2.7-2.7L3.1 11.5c-.9-.3-.9-1.6 0-1.9l3.3-1.1a4.2 4.2 0 0 0 2.7-2.7l1.1-3.4ZM18.2 15.2c.2-.5.9-.5 1.1 0l.5 1.5c.2.5.6.9 1.1 1.1l1.5.5c.5.2.5.9 0 1.1l-1.5.5c-.5.2-.9.6-1.1 1.1l-.5 1.5c-.2.5-.9.5-1.1 0l-.5-1.5a2 2 0 0 0-1.1-1.1l-1.5-.5c-.5-.2-.5-.9 0-1.1l1.5-.5c.5-.2.9-.6 1.1-1.1l.5-1.5Z"/>`,
  video: `<path d="M3.8 7.2A3.2 3.2 0 0 1 7 4h7.2A3.2 3.2 0 0 1 17.4 7.2v9.6A3.2 3.2 0 0 1 14.2 20H7a3.2 3.2 0 0 1-3.2-3.2V7.2Zm14.2 1.3l2.5-1.7A1.6 1.6 0 0 1 23 8.1v7.8a1.6 1.6 0 0 1-2.5 1.3l-2.5-1.7V8.5Z"/>`,
  phone: `<path d="M8.2 2.8c.7-.3 1.5 0 1.8.7l1.2 2.7c.3.6.1 1.4-.4 1.8L9.4 9.2a10.5 10.5 0 0 0 5.4 5.4l1.2-1.4c.4-.5 1.2-.7 1.8-.4l2.7 1.2c.7.3 1 1.1.7 1.8l-.8 2.1a2.4 2.4 0 0 1-2.5 1.5C9.6 19 5 14.4 4.6 6.3a2.4 2.4 0 0 1 1.5-2.5l2.1-.9Z"/>`,
  pie: `<path d="M12.8 3.1a1.2 1.2 0 0 1 1.3 1.2v7.2a1.2 1.2 0 0 1-.7 1.1l-6.2 3.1A8.2 8.2 0 0 0 19.5 12a1.2 1.2 0 0 1 2.4 0A10.6 10.6 0 0 1 5.2 20.3a1.2 1.2 0 0 1-.5-1.6l6.8-14.2c.2-.4.6-.7 1.3-1.4Z"/><path d="M10.6 4.2a8.2 8.2 0 0 0-5.9 12.3l5.2-2.6V5.1c0-.3.1-.6.7-.9Z"/>`,
  grid: `<path d="M5.2 4h4.2A2.2 2.2 0 0 1 11.6 6.2v4.2A2.2 2.2 0 0 1 9.4 12.6H5.2A2.2 2.2 0 0 1 3 10.4V6.2A2.2 2.2 0 0 1 5.2 4Zm9.4 0h4.2A2.2 2.2 0 0 1 21 6.2v4.2a2.2 2.2 0 0 1-2.2 2.2h-4.2a2.2 2.2 0 0 1-2.2-2.2V6.2A2.2 2.2 0 0 1 14.6 4ZM5.2 13.4h4.2a2.2 2.2 0 0 1 2.2 2.2v4.2A2.2 2.2 0 0 1 9.4 22H5.2A2.2 2.2 0 0 1 3 19.8v-4.2a2.2 2.2 0 0 1 2.2-2.2Zm9.4 0h4.2a2.2 2.2 0 0 1 2.2 2.2v4.2a2.2 2.2 0 0 1-2.2 2.2h-4.2a2.2 2.2 0 0 1-2.2-2.2v-4.2a2.2 2.2 0 0 1 2.2-2.2Z"/>`,
  calendar: `<path d="M8.2 3a1.2 1.2 0 0 1 2.4 0v.6h2.8V3a1.2 1.2 0 1 1 2.4 0v.6h1.4A3.2 3.2 0 0 1 20.4 6.8v11A3.2 3.2 0 0 1 17.2 21H6.8A3.2 3.2 0 0 1 3.6 17.8v-11A3.2 3.2 0 0 1 6.8 3.6h1.4V3Zm-2.2 6.2h12v8.6c0 .6-.5 1-1 1H7c-.5 0-1-.4-1-1V9.2Z"/>`,
  check: `<path d="M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 0 1 0-19Zm4.1 6.2a1.2 1.2 0 0 0-1.7 0l-3.7 3.7l-1.4-1.4a1.2 1.2 0 0 0-1.7 1.7l2.3 2.3c.5.5 1.2.5 1.7 0l4.5-4.5c.5-.5.5-1.2 0-1.7Z"/>`,
  doc: `<path d="M7 2.8A2.8 2.8 0 0 0 4.2 5.6v12.8A2.8 2.8 0 0 0 7 21.2h10a2.8 2.8 0 0 0 2.8-2.8V9.1c0-.7-.3-1.4-.8-1.9l-3.6-3.6a2.8 2.8 0 0 0-2-.8H7Zm7.2 2.2l3.4 3.4h-2.2A1.2 1.2 0 0 1 14.2 7V5Zm-6 6.2h7.6a1 1 0 1 1 0 2H8.2a1 1 0 1 1 0-2Zm0 4h5.2a1 1 0 1 1 0 2H8.2a1 1 0 1 1 0-2Z"/>`,
  building: `<path d="M6.2 3.5A2.2 2.2 0 0 0 4 5.7v14.1c0 .7.6 1.2 1.2 1.2h3.1V17a1.5 1.5 0 0 1 1.5-1.5h3.4A1.5 1.5 0 0 1 14.7 17v4h3.1c.7 0 1.2-.5 1.2-1.2V5.7a2.2 2.2 0 0 0-2.2-2.2H6.2ZM8 7.2h2v2H8v-2Zm4 0h2v2h-2v-2ZM8 11h2v2H8v-2Zm4 0h2v2h-2v-2Z"/>`,
  calc: `<path d="M7.2 2.5A2.7 2.7 0 0 0 4.5 5.2v13.6a2.7 2.7 0 0 0 2.7 2.7h9.6a2.7 2.7 0 0 0 2.7-2.7V5.2a2.7 2.7 0 0 0-2.7-2.7H7.2Zm1.3 3.2h7a1 1 0 0 1 1 1v2.2a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V6.7a1 1 0 0 1 1-1ZM7.8 12h2.2v2.2H7.8V12Zm4.1 0h2.2v2.2h-2.2V12Zm4.1 0H18v2.2h-2V12ZM7.8 16.1h2.2V18.3H7.8v-2.2Zm4.1 0h2.2V18.3h-2.2v-2.2Zm4.1 0H18V18.3h-2v-2.2Z"/>`,
  gift: `<path d="M10.3 3.2c.7-.9 2.1-.9 2.8 0l.6.8h1.8A2.5 2.5 0 0 1 18 6.5v1.2h1.2A1.8 1.8 0 0 1 21 9.5v2.2h-8.2V7.7H11.2v4H3V9.5a1.8 1.8 0 0 1 1.8-1.8H6V6.5A2.5 2.5 0 0 1 8.5 4h1.2l.6-.8ZM3.5 13.2H11v7.3H6.2A2.7 2.7 0 0 1 3.5 17.8v-4.6Zm9.5 0h7.5v4.6a2.7 2.7 0 0 1-2.7 2.7H13v-7.3Z"/>`,
  flag: `<path d="M6.2 2.8a1.2 1.2 0 0 1 1.2 1.2v.4h9.1c1.3 0 2 .1 2 1.8c0 .9-.7 1.4-1.4 1.8l-.5.3c-.6.3-.9.5-.9 1s.3.7.9 1l.5.3c.7.4 1.4.9 1.4 1.8c0 1.6-1.2 2.2-2.8 2.2H7.4v5.6a1.2 1.2 0 1 1-2.4 0V4A1.2 1.2 0 0 1 6.2 2.8Z"/>`,
  stack: `<path d="M11.1 3.1a2 2 0 0 1 1.8 0l7 3.4a1.6 1.6 0 0 1 0 2.9l-7 3.4a2 2 0 0 1-1.8 0l-7-3.4a1.6 1.6 0 0 1 0-2.9l7-3.4Zm-7.6 8.2a1.6 1.6 0 0 0 0 2.9l7 3.4a2 2 0 0 0 1.8 0l7-3.4a1.6 1.6 0 0 0 0-2.9l-.7.3-6.3 3.1a2.8 2.8 0 0 1-2.4 0L4.2 11.6l-.7-.3Zm0 4.6a1.6 1.6 0 0 0 0 2.9l7 3.4a2 2 0 0 0 1.8 0l7-3.4a1.6 1.6 0 0 0 0-2.9l-.7.3-6.3 3.1a2.8 2.8 0 0 1-2.4 0l-6.3-3.1-.7-.3Z"/>`,
  gantt: `<path d="M4.5 5.2A1.2 1.2 0 0 1 5.7 4h4.6a1.2 1.2 0 0 1 0 2.4H5.7A1.2 1.2 0 0 1 4.5 5.2Zm0 6.8A1.2 1.2 0 0 1 5.7 10.8h10.6a1.2 1.2 0 1 1 0 2.4H5.7A1.2 1.2 0 0 1 4.5 12Zm0 6.8A1.2 1.2 0 0 1 5.7 17.6h7.6a1.2 1.2 0 1 1 0 2.4H5.7A1.2 1.2 0 0 1 4.5 18.8ZM17.2 4a1.2 1.2 0 0 1 1.2 1.2v2.4a1.2 1.2 0 0 1-2.4 0V5.2A1.2 1.2 0 0 1 17.2 4Zm2.8 6.8a1.2 1.2 0 0 1 1.2 1.2v2.4a1.2 1.2 0 1 1-2.4 0v-2.4a1.2 1.2 0 0 1 1.2-1.2Z"/>`,
  kanban: `<path d="M4.8 3.5A1.8 1.8 0 0 0 3 5.3v13.4A1.8 1.8 0 0 0 4.8 20.5h2.4A1.8 1.8 0 0 0 9 18.7V5.3A1.8 1.8 0 0 0 7.2 3.5H4.8Zm7.2 0A1.8 1.8 0 0 0 10.2 5.3v9.4a1.8 1.8 0 0 0 1.8 1.8h2.4a1.8 1.8 0 0 0 1.8-1.8V5.3a1.8 1.8 0 0 0-1.8-1.8H12Zm7.2 0A1.8 1.8 0 0 0 17.4 5.3v5.4a1.8 1.8 0 0 0 1.8 1.8h2.4a1.8 1.8 0 0 0 1.8-1.8V5.3a1.8 1.8 0 0 0-1.8-1.8h-2.4Z"/>`,
  inbox: `<path d="M4.4 5.2A2.7 2.7 0 0 1 7.1 2.5h9.8a2.7 2.7 0 0 1 2.7 2.7v5.1h-4.1a2.2 2.2 0 0 0-2.1 1.5l-.3.8H11l-.3-.8a2.2 2.2 0 0 0-2.1-1.5H4.4V5.2Zm0 8.3h3.8c.4 1.5 1.8 2.6 3.5 2.6h.6c1.7 0 3.1-1.1 3.5-2.6h3.8v5.3a2.7 2.7 0 0 1-2.7 2.7H7.1a2.7 2.7 0 0 1-2.7-2.7v-5.3Z"/>`,
  shield: `<path d="M12 2.3c.4 0 .8.1 1.2.3l6.1 2.7c.8.4 1.3 1.2 1.3 2.1v5.2c0 4.4-2.9 7.5-7.7 9.3a2 2 0 0 1-1.8 0C6.3 19.8 3.4 16.7 3.4 12.3V7.4c0-.9.5-1.7 1.3-2.1L10.8 2.6c.4-.2.8-.3 1.2-.3Zm3.3 7a1.2 1.2 0 0 0-1.7-1.7l-2.8 2.8l-1-1a1.2 1.2 0 0 0-1.7 1.7l1.9 1.9c.5.5 1.2.5 1.7 0l3.6-3.7Z"/>`,
  receipt: `<path d="M6.5 2.6A1.6 1.6 0 0 0 4.9 4.2v16.2c0 .9 1 1.4 1.7.9l1.4-1.1l1.4 1.1c.6.5 1.5.5 2.1 0l1.3-1.1l1.3 1.1c.6.5 1.5.5 2.1 0l1.4-1.1l1.4 1.1c.7.5 1.7 0 1.7-.9V4.2A1.6 1.6 0 0 0 17.5 2.6H6.5ZM8 7.2h8a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Zm0 4h8a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Zm0 4h5a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2Z"/>`,
  folder: `<path d="M3.8 6.2A2.7 2.7 0 0 1 6.5 3.5h3.1c.7 0 1.3.3 1.8.8l.9 1h5.4a2.7 2.7 0 0 1 2.7 2.7v9.8a2.7 2.7 0 0 1-2.7 2.7H6.5a2.7 2.7 0 0 1-2.7-2.7V6.2Z"/>`,
  lock: `<path d="M8.2 9.2V7.5a3.8 3.8 0 0 1 7.6 0v1.7h.7A2.7 2.7 0 0 1 19.2 12v6.3a2.7 2.7 0 0 1-2.7 2.7H7.5A2.7 2.7 0 0 1 4.8 18.3V12a2.7 2.7 0 0 1 2.7-2.8h.7Zm2.2-1.7v1.7h3.2V7.5a1.6 1.6 0 0 0-3.2 0Z"/>`,
  card: `<path d="M4.5 6.2A2.7 2.7 0 0 1 7.2 3.5h9.6a2.7 2.7 0 0 1 2.7 2.7v11.6a2.7 2.7 0 0 1-2.7 2.7H7.2a2.7 2.7 0 0 1-2.7-2.7V6.2Zm1.8 2.2v1.8h11.4V8.4H6.3Zm0 5.2a1 1 0 0 0 1 1h3.2a1 1 0 1 0 0-2H7.3a1 1 0 0 0-1 1Z"/>`,
  clock: `<path d="M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 0 1 0-19Zm0 3.2a1.2 1.2 0 0 0-1.2 1.2v4.3c0 .4.2.8.5 1l2.8 2.1a1.2 1.2 0 1 0 1.4-1.9l-2.3-1.7V6.9A1.2 1.2 0 0 0 12 5.7Z"/>`,
  id: `<path d="M4.5 6A2.5 2.5 0 0 1 7 3.5h10A2.5 2.5 0 0 1 19.5 6v12a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 18V6Zm4.2 3.2a2.3 2.3 0 1 0 3.2 0a2.3 2.3 0 0 0-3.2 0ZM8 15.2c0-1.3 1.4-2.2 4-2.2s4 .9 4 2.2v.3c0 .8-.7 1.5-1.5 1.5h-5c-.8 0-1.5-.7-1.5-1.5v-.3Z"/>`,
  ticket: `<path d="M3.5 7.2A2.7 2.7 0 0 1 6.2 4.5h11.6a2.7 2.7 0 0 1 2.7 2.7v2.1a2.1 2.1 0 0 0 0 4.2v2.1a2.7 2.7 0 0 1-2.7 2.7H6.2a2.7 2.7 0 0 1-2.7-2.7v-2.1a2.1 2.1 0 0 0 0-4.2V7.2Zm5.2 1.5v6.6a1 1 0 1 0 2 0V8.7a1 1 0 1 0-2 0Z"/>`,
  key: `<path d="M14.8 3.2a6.2 6.2 0 0 1 1.4 12.2l.7.7h1.4v1.6h1.6v2.2a1.6 1.6 0 0 1-1.6 1.6h-3.4a1.6 1.6 0 0 1-1.6-1.6v-2.5l2.3-2.3A6.2 6.2 0 0 1 14.8 3.2Zm0 3.2a3 3 0 1 0 0 6a3 3 0 0 0 0-6Z"/>`,
  cart: `<path d="M3.2 4.2a1.2 1.2 0 0 1 1.2-1.2h1.1c.9 0 1.6.6 1.8 1.4L8 7.5h10.7a1.8 1.8 0 0 1 1.8 2.1l-.8 4.2a2.7 2.7 0 0 1-2.7 2.2H9.3a2.7 2.7 0 0 1-2.7-2.3L5.4 5.6H4.4a1.2 1.2 0 0 1-1.2-1.4ZM9 19.2a1.8 1.8 0 1 0 0-3.6a1.8 1.8 0 0 0 0 3.6Zm8.2 0a1.8 1.8 0 1 0 0-3.6a1.8 1.8 0 0 0 0 3.6Z"/>`,
  bag: `<path d="M9 3.8A3 3 0 0 1 12 2a3 3 0 0 1 3 1.8l.3.6h2.4A2.8 2.8 0 0 1 20.5 7.2v11a2.8 2.8 0 0 1-2.8 2.8H6.3A2.8 2.8 0 0 1 3.5 18.2v-11A2.8 2.8 0 0 1 6.3 4.4h2.4L9 3.8Zm1.3 2.2h3.4A1.2 1.2 0 0 0 12 4.6c-.5 0-.9.3-1.1.8l-.6.6Z"/>`,
  tag: `<path d="M11.4 3.2a2.2 2.2 0 0 1 1.6.7l7.1 7.1a2.2 2.2 0 0 1 0 3.1l-5.9 5.9a2.2 2.2 0 0 1-3.1 0L3.9 12.8a2.2 2.2 0 0 1-.7-1.6V5.4A2.2 2.2 0 0 1 5.4 3.2h6Zm-3.6 4a1.6 1.6 0 1 0 0-3.2a1.6 1.6 0 0 0 0 3.2Z"/>`,
  puzzle: `<path d="M9.2 3.5c.8 0 1.5.5 1.8 1.2h2a2.2 2.2 0 1 1 0 2.8h-2c-.3.7-1 1.2-1.8 1.2c-1.1 0-2-.9-2-2s.9-2 2-2Zm-4.7 6h2c.3-.7 1-1.2 1.8-1.2c1.1 0 2 .9 2 2s-.9 2-2 2c-.8 0-1.5-.5-1.8-1.2h-2A2.3 2.3 0 0 0 2.2 13v5.2A2.3 2.3 0 0 0 4.5 20.5h5.2c0-.8.5-1.5 1.2-1.8c0-.2 0-.3 0-.4a2 2 0 1 1 3.8.4c.7.3 1.2 1 1.2 1.8h3.6a2.3 2.3 0 0 0 2.3-2.3v-3.6c-.8 0-1.5-.5-1.8-1.2a2 2 0 1 1 .4-3.8c.2 0 .3 0 .4 0c.3-.7 1-1.2 1.8-1.2V6.8A2.3 2.3 0 0 0 17.2 4.5h-3.5Z"/>`,
  wrench: `<path d="M14.6 2.8a5.4 5.4 0 0 1 5.2 6.6a1.2 1.2 0 0 1-.7.7l-3.1 1.1l-1.6 1.6l4.8 4.8a2.2 2.2 0 0 1-3.1 3.1l-4.8-4.8l-1.6 1.6l-1.1 3.1a1.2 1.2 0 0 1-.7.7a5.4 5.4 0 0 1-6.6-5.2c0-1.2.4-2.4 1.1-3.4L8.5 8l1.7-.3l.3-1.7l2.4-5.1c.3-.2.6-.2 1.1-.1Z"/>`,
  mail: `<path d="M4.5 6.2A2.7 2.7 0 0 1 7.2 3.5h9.6a2.7 2.7 0 0 1 2.7 2.7v11.6a2.7 2.7 0 0 1-2.7 2.7H7.2a2.7 2.7 0 0 1-2.7-2.7V6.2Zm2.1.6l5.1 3.6c.2.1.5.1.7 0l5.1-3.6H6.6Z"/>`,
  pen: `<path d="M16.8 2.9a2.4 2.4 0 0 1 3.4 3.4L9.1 17.4a2.4 2.4 0 0 1-1.1.6l-3.6.9a1.2 1.2 0 0 1-1.4-1.4l.9-3.6c.1-.4.3-.8.6-1.1L16.8 2.9Z"/>`,
  stamp: `<path d="M9.2 3.5a2.8 2.8 0 0 1 5.6 0v3.2h.7A2.3 2.3 0 0 1 17.8 9v1.6H6.2V9a2.3 2.3 0 0 1 2.3-2.3h.7V3.5ZM5.5 13.2h13a2.2 2.2 0 0 1 2.2 2.2v1.1a2.2 2.2 0 0 1-2.2 2.2h-13a2.2 2.2 0 0 1-2.2-2.2v-1.1a2.2 2.2 0 0 1 2.2-2.2Zm-1 7.1h15a1.2 1.2 0 1 1 0 2.4h-15a1.2 1.2 0 1 1 0-2.4Z"/>`,
  star: `<path d="M12 2.6c.5 0 .9.3 1.1.7l1.9 4.2l4.6.5c1 .1 1.4 1.3.6 2l-3.4 3.1l1 4.5c.2 1-.8 1.7-1.6 1.2L12 16.7l-3.9 2.3c-.9.5-1.9-.3-1.6-1.2l1-4.5l-3.4-3.1c-.8-.7-.3-1.9.6-2l4.6-.5l1.9-4.2c.2-.4.6-.7 1.1-.7Z"/>`,
  truck: `<path d="M3.5 6.2A2.2 2.2 0 0 1 5.7 4h8.1A2.2 2.2 0 0 1 16 6.2V8h1.3c.7 0 1.3.3 1.7.9l2.2 3.3c.3.4.4.9.4 1.4v3.2a2 2 0 0 1-2 2h-.6a2.6 2.6 0 0 1-5.1 0H9.5a2.6 2.6 0 0 1-5.1 0H4a2 2 0 0 1-2-2V6.2h1.5ZM16 10.2v2.6h3.1l-1.5-2.3c-.1-.1-.2-.2-.4-.2H16Zm-9.2 8a1.2 1.2 0 1 0 0-2.4a1.2 1.2 0 0 0 0 2.4Zm10.4 0a1.2 1.2 0 1 0 0-2.4a1.2 1.2 0 0 0 0 2.4Z"/>`,
  pin: `<path d="M12 2.5c3.4 0 6.2 2.7 6.2 6.1c0 3.8-4.3 9.1-5.6 10.7a.9.9 0 0 1-1.4 0C9.9 17.7 5.8 12.4 5.8 8.6C5.8 5.2 8.6 2.5 12 2.5Zm0 4.2a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 0 0 0-4.4Z"/>`,
  heart: `<path d="M12 20.4c-.4 0-.8-.2-1.1-.5C6.2 15.6 3.2 12.5 3.2 9a4.6 4.6 0 0 1 8-3.1A4.6 4.6 0 0 1 20.8 9c0 3.5-3 6.6-7.7 10.9c-.3.3-.7.5-1.1.5Z"/>`,
  map: `<path d="M14.7 3.1a1.5 1.5 0 0 1 1.1.2l4.4 2.5c.7.4 1.1 1.1 1.1 1.9v11.6a1.6 1.6 0 0 1-2.3 1.4L14.6 18l-5.2 2.7a1.5 1.5 0 0 1-1.3 0L3.6 18.2A1.9 1.9 0 0 1 2.5 16.5V5.2c0-.9.5-1.6 1.3-1.9l4.8-2a1.5 1.5 0 0 1 1.2 0l5 1.8Zm.1 2.3l-5-1.8v12.7l5 2.1V5.4Z"/>`,
  scale: `<path d="M11 2.8a1.2 1.2 0 0 1 2.4 0v1.1h3.3a1.2 1.2 0 0 1 .5 2.3L14.5 9l2.4 5.4a3.4 3.4 0 1 1-2.2.9L12 10.2L9.3 15.3a3.4 3.4 0 1 1-2.2-.9L9.5 9L6.8 6.2A1.2 1.2 0 0 1 7.3 3.9H11V2.8Z"/>`,
  mic: `<path d="M12 2.8A3.2 3.2 0 0 1 15.2 6v5.2a3.2 3.2 0 0 1-6.4 0V6A3.2 3.2 0 0 1 12 2.8Zm-6.2 8.4a1.2 1.2 0 0 1 2.4 0a3.8 3.8 0 0 0 7.6 0a1.2 1.2 0 1 1 2.4 0a6.2 6.2 0 0 1-5 6.1v2.1h2.2a1.2 1.2 0 1 1 0 2.4H9.6a1.2 1.2 0 1 1 0-2.4h2.2v-2.1a6.2 6.2 0 0 1-5-6.1Z"/>`,
  bell: `<path d="M12 2.5c.7 0 1.3.5 1.4 1.2c2.4.6 4.1 2.8 4.1 5.4v2.5c0 1.3.4 2.2 1.1 3.1c.4.5.1 1.3-.6 1.3H5.9c-.7 0-1-.8-.6-1.3c.7-.9 1.1-1.8 1.1-3.1V9.1c0-2.6 1.7-4.8 4.1-5.4c.2-.7.8-1.2 1.5-1.2Zm-2.2 15.2a2.2 2.2 0 0 0 4.4 0H9.8Z"/>`,
  send: `<path d="M4.1 4.3a1.6 1.6 0 0 1 1.8-.3l14.2 7.1c.9.4.9 1.7 0 2.2L5.9 20.4a1.6 1.6 0 0 1-2.3-1.5v-4.4c0-.5.3-.9.8-1.1l6.5-2.2l-6.5-2.2a1.2 1.2 0 0 1-.8-1.1V5.5c0-.5.2-.9.5-1.2Z"/>`,
  speaker: `<path d="M4.5 9.2h2.2l3.5-3.5A1.5 1.5 0 0 1 12.8 6.8v10.4a1.5 1.5 0 0 1-2.6 1.1L6.7 14.8H4.5A1.5 1.5 0 0 1 3 13.3v-2.6A1.5 1.5 0 0 1 4.5 9.2Zm11.2-.9a1.2 1.2 0 0 1 1.7 0a5.2 5.2 0 0 1 0 7.4a1.2 1.2 0 1 1-1.7-1.7a2.8 2.8 0 0 0 0-4a1.2 1.2 0 0 1 0-1.7Z"/>`,
  sliders: `<path d="M7.2 4a1.2 1.2 0 0 1 2.4 0v4.2h1.2a1.2 1.2 0 1 1 0 2.4H9.6v9.4a1.2 1.2 0 1 1-2.4 0v-9.4H6a1.2 1.2 0 1 1 0-2.4h1.2V4Zm7.6 0a1.2 1.2 0 0 1 2.4 0v9.4H18a1.2 1.2 0 1 1 0 2.4h-1.2v4.2a1.2 1.2 0 1 1-2.4 0v-4.2H13a1.2 1.2 0 1 1 0-2.4h1.8V4Z"/>`,
  cloud: `<path d="M12.2 5.2a5.3 5.3 0 0 1 5.1 4.1a3.8 3.8 0 0 1 .7 7.5H7.8a4.3 4.3 0 0 1-.5-8.5a5.3 5.3 0 0 1 4.9-3.1Zm-.2 4.1a1.2 1.2 0 0 0-1.2 1.2v2.1H9.3a1.2 1.2 0 1 0 0 2.4h5.4a1.2 1.2 0 1 0 0-2.4h-1.5V10.5A1.2 1.2 0 0 0 12 9.3Z"/>`,
  sync: `<path d="M12 3.2a8.8 8.8 0 0 1 7.6 4.4l.7-.7a1.2 1.2 0 0 1 2 1.2l-.2 3.2a1.2 1.2 0 0 1-1.3 1.1l-3.2-.3a1.2 1.2 0 0 1-.3-2.3l.9-.1A6.4 6.4 0 0 0 6.8 8.6a1.2 1.2 0 1 1-2.1-1.2A8.8 8.8 0 0 1 12 3.2Zm-8.1 8.3a1.2 1.2 0 0 1 1.3 1.1l.1.9a6.4 6.4 0 0 0 10.8 2.4a1.2 1.2 0 1 1 1.8 1.6A8.8 8.8 0 0 1 4.3 16l-.7.7a1.2 1.2 0 0 1-2-1.2l.2-3.2a1.2 1.2 0 0 1 1.1-1.1l1-.1Z"/>`,
  beaker: `<path d="M9.2 2.8a1.2 1.2 0 0 1 2.4 0v.6h1.2V2.8a1.2 1.2 0 1 1 2.4 0v.6h.6A1.6 1.6 0 0 1 17.4 5v1.1l2.3 9.4a3.4 3.4 0 0 1-3.3 4.2H7.6a3.4 3.4 0 0 1-3.3-4.2L6.6 6.1V5A1.6 1.6 0 0 1 8.2 3.4h1V2.8Zm-1 8.4h7.6l-.6 2.4H8.8l-.6-2.4Z"/>`,
  server: `<path d="M4.5 4.2A2.2 2.2 0 0 1 6.7 2h10.6A2.2 2.2 0 0 1 19.5 4.2v3.1A2.2 2.2 0 0 1 17.3 9.5H6.7A2.2 2.2 0 0 1 4.5 7.3V4.2Zm2.2 1.1a1.1 1.1 0 1 0 0 2.2a1.1 1.1 0 0 0 0-2.2ZM4.5 13.2A2.2 2.2 0 0 1 6.7 11h10.6a2.2 2.2 0 0 1 2.2 2.2v3.1a2.2 2.2 0 0 1-2.2 2.2H6.7a2.2 2.2 0 0 1-2.2-2.2v-3.1Zm2.2 1.1a1.1 1.1 0 1 0 0 2.2a1.1 1.1 0 0 0 0-2.2ZM6.7 18.8h10.6a2.2 2.2 0 0 1 0 4.4H6.7a2.2 2.2 0 0 1 0-4.4Z"/>`,
  trend: `<path d="M3.8 16.2a1.2 1.2 0 0 1 0-1.7l5.5-5.5c.5-.5 1.2-.5 1.7 0L13 11l4.5-4.5h-2.1a1.2 1.2 0 1 1 0-2.4H19a1.6 1.6 0 0 1 1.6 1.6v5.6a1.2 1.2 0 1 1-2.4 0V9.2L13.9 13a1.2 1.2 0 0 1-1.7 0L10.2 11l-4.7 4.7a1.2 1.2 0 0 1-1.7 0Z"/>`,
  trophy: `<path d="M8.2 3.2h7.6v2.1h2.1A2.1 2.1 0 0 1 20 7.4v1.3a4.4 4.4 0 0 1-3.5 4.3A4.6 4.6 0 0 1 13.4 16v1.3h2.1a1.2 1.2 0 1 1 0 2.4H8.5a1.2 1.2 0 1 1 0-2.4h2.1V16a4.6 4.6 0 0 1-3.1-3a4.4 4.4 0 0 1-3.5-4.3V7.4A2.1 2.1 0 0 1 6.1 5.3h2.1V3.2Zm-2.1 4.2v1.3a2 2 0 0 0 2 2h.2A4.4 4.4 0 0 1 6.1 7.4Zm9.7 3.3h.2a2 2 0 0 0 2-2V7.4a4.4 4.4 0 0 1-2.2 3.3Z"/>`,
  fire: `<path d="M12.6 2.6c.5.4 1.4 1.5 1.4 3.2c0 1.2-.5 2-1.1 2.7c1.9-.4 4.3-2 4.3-5.1c0-.4.4-.8 1-.5C20.3 4.5 21.5 7 21.5 10c0 4.8-3.6 9.5-9.5 9.5S2.5 14.8 2.5 10c0-2.6 1.2-4.8 2.8-6.2c.4-.3.9.1.8.6c-.3 1.5.2 3.3 1.5 4.4c-.1-.9.1-2.1.8-3.2c.7-1.2 1.9-2.2 3.2-2.9c.4-.2.8 0 1 .6Z"/>`,
  terminal: `<path d="M4.5 5.2A2.7 2.7 0 0 1 7.2 2.5h9.6a2.7 2.7 0 0 1 2.7 2.7v13.6a2.7 2.7 0 0 1-2.7 2.7H7.2a2.7 2.7 0 0 1-2.7-2.7V5.2Zm3.1 3.1a1 1 0 0 0 0 1.4l1.8 1.8L7.6 13a1 1 0 1 0 1.4 1.4l2.5-2.5c.4-.4.4-1 0-1.4L9 8.3a1 1 0 0 0-1.4 0Zm4.4 5.6h4.2a1 1 0 1 1 0 2h-4.2a1 1 0 1 1 0-2Z"/>`,
  link: `<path d="M10.1 13.9a1.2 1.2 0 0 1 0-1.7l3.2-3.2a1.2 1.2 0 1 1 1.7 1.7l-3.2 3.2a1.2 1.2 0 0 1-1.7 0Zm-3.4-1.1a3.6 3.6 0 0 1 0-5.1l2.1-2.1a3.6 3.6 0 0 1 5.1 0a1.2 1.2 0 1 0 1.7-1.7a6 6 0 0 0-8.5 0L4.9 6a6 6 0 0 0 0 8.5a1.2 1.2 0 1 0 1.7-1.7Zm12.6-1.6a1.2 1.2 0 0 0-1.7 1.7a3.6 3.6 0 0 1 0 5.1l-2.1 2.1a3.6 3.6 0 0 1-5.1 0a1.2 1.2 0 1 0-1.7 1.7a6 6 0 0 0 8.5 0l2.1-2.1a6 6 0 0 0 0-8.5Z"/>`,
  book: `<path d="M6.2 3.5A2.7 2.7 0 0 0 3.5 6.2v12.1c0 .9.7 1.7 1.6 1.7h13.2a1.2 1.2 0 1 0 0-2.4H6.2a.4.4 0 0 1 0-.8h12.1A2.2 2.2 0 0 0 20.5 15V6.2A2.7 2.7 0 0 0 17.8 3.5H6.2Zm2.3 3.2h8.8v6.6H8.5V6.7Z"/>`,
  bulb: `<path d="M12 2.5a6.2 6.2 0 0 1 3.8 11.1l-.4.3V16a1.5 1.5 0 0 1-1.5 1.5h-3.8A1.5 1.5 0 0 1 8.6 16v-1.9a6.2 6.2 0 0 1 3.4-11.6ZM9.8 19.2h4.4a1.2 1.2 0 1 1 0 2.4H9.8a1.2 1.2 0 1 1 0-2.4Z"/>`,
  chip: `<path d="M8.5 4.5h7A4 4 0 0 1 19.5 8.5v7a4 4 0 0 1-4 4h-7a4 4 0 0 1-4-4v-7a4 4 0 0 1 4-4Zm1.5 3v9h4V7.5h-4ZM9 2.5a1 1 0 0 1 2 0V4H9V2.5Zm4 0a1 1 0 0 1 2 0V4h-2V2.5ZM9 20a1 1 0 1 1 2 0v1.5H9V20Zm4 0a1 1 0 1 1 2 0v1.5h-2V20ZM2.5 9a1 1 0 0 1 0 2H4V9H2.5Zm0 4a1 1 0 1 1 0 2H4v-2H2.5ZM20 9a1 1 0 1 1 0 2h1.5V9H20Zm0 4a1 1 0 1 1 0 2h1.5v-2H20Z"/>`,
  monitor: `<path d="M4.5 4.2A2.2 2.2 0 0 1 6.7 2h10.6A2.2 2.2 0 0 1 19.5 4.2v9.1A2.2 2.2 0 0 1 17.3 15.5H6.7A2.2 2.2 0 0 1 4.5 13.3V4.2ZM8.2 17.8h7.6a1.2 1.2 0 1 1 0 2.4H8.2a1.2 1.2 0 1 1 0-2.4Z"/>`,
  globe: `<path d="M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 0 1 0-19Zm0 2.2c-.7 0-1.6 1.6-2.1 4.1h4.2C13.6 6.3 12.7 4.7 12 4.7Zm-4.5 5.3c-.1.6-.2 1.3-.2 2s.1 1.4.2 2h3.3v-4H7.5Zm5.7 0v4h3.3c.1-.6.2-1.3.2-2s-.1-1.4-.2-2h-3.3Zm3.7 5.7h-3.7v.1c.5 2.1 1.3 3.5 2.1 3.5c.7 0 1.5-1.3 1.9-3.2l-.3-.4Zm-8.3.4c.4 1.9 1.2 3.2 1.9 3.2c.8 0 1.6-1.4 2.1-3.5v-.1H8.6l-.3.4Z"/>`,
  hand: `<path d="M8.6 9.2V6.4a1.6 1.6 0 0 1 3.2 0v2.8h.4V5.2a1.6 1.6 0 0 1 3.2 0v4h.4V6.8a1.6 1.6 0 0 1 3.2 0v6.7c0 3.4-2.3 6-5.6 6.5c-2.7.4-5.3-.7-6.6-2.9L5.2 13a1.8 1.8 0 0 1 3-1.9l.4.6V9.2Z"/>`,
  userPlus: `<path d="M10 3.5a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7ZM3.5 16c0-2.5 2.6-4.3 6.5-4.3S16.5 13.5 16.5 16v.4c0 1.4-1.1 2.5-2.5 2.5H6A2.5 2.5 0 0 1 3.5 16.4V16Zm14.2-5.2a1.2 1.2 0 0 1 2.4 0v1.3H21a1.2 1.2 0 1 1 0 2.4h-1.3V16a1.2 1.2 0 1 1-2.4 0v-1.5H16a1.2 1.2 0 1 1 0-2.4h1.5v-1.3Z"/>`,
  bookmark: `<path d="M7.2 2.8A2.7 2.7 0 0 0 4.5 5.5v14.2c0 .9 1 1.4 1.7.9l5.3-3.8a1 1 0 0 1 1.2 0l5.3 3.8c.7.5 1.7 0 1.7-.9V5.5a2.7 2.7 0 0 0-2.7-2.7H7.2Z"/>`,
  cake: `<path d="M12 2.5c.7 0 1.2.6 1.1 1.2l-.3 1.5h2.7A2.5 2.5 0 0 1 18 7.7V9H6V7.7A2.5 2.5 0 0 1 8.5 5.2h2.7l-.3-1.5c-.1-.6.4-1.2 1.1-1.2ZM4.8 10.5h14.4v2.2c0 .4-.1.7-.4 1l-1.5 1.3v4.5A2.5 2.5 0 0 1 14.8 22H9.2a2.5 2.5 0 0 1-2.5-2.5v-4.5L5.2 13.7a1.5 1.5 0 0 1-.4-1V10.5Z"/>`,
  at: `<path d="M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 0 1 0-19Zm0 2.4a7.1 7.1 0 0 0 0 14.2c1.5 0 2.8-.4 3.7-1.2v.2a1.2 1.2 0 1 0 2.4 0v-5.3a1.2 1.2 0 0 0-1.1-1.2h-.2a4.7 4.7 0 1 0 .6 4.8c-.5.5-1.3.7-2.2.7a4.7 4.7 0 1 1 0-9.4c1.1 0 2.1.4 2.8 1v-.2A1.2 1.2 0 0 0 12 4.9Zm0 3.5a2.4 2.4 0 1 0 0 4.8a2.4 2.4 0 0 0 0-4.8Z"/>`,
};

const META = {
  'group-home': { g: 'home', m: 'Дом', a: 'none', tip: 'Главная' },
  'group-tenders': { g: 'clipboard', m: 'Планшет', a: 'none', tip: 'Тендеры' },
  'group-works': { g: 'briefcase', m: 'Портфель', a: 'none', tip: 'Работы' },
  'group-finance': { g: 'money', m: 'Деньги', a: 'none', tip: 'Финансы' },
  'group-resources': { g: 'box', m: 'Ящик', a: 'none', tip: 'Ресурсы' },
  'group-personnel': { g: 'people', m: 'Люди', a: 'none', tip: 'Персонал' },
  'group-comm': { g: 'chat', m: 'Чат', a: 'none', tip: 'Коммуникации' },
  'group-analytics': { g: 'bars', m: 'График', a: 'none', tip: 'Аналитика' },
  'group-system': { g: 'gear', m: 'Шестерёнка', a: 'none', tip: 'Система' },

  home: { g: 'home', m: 'Зал Ярла', a: 'blue', tip: 'Зал Ярла' },
  dashboard: { g: 'pie', m: 'Дашборд', a: 'none', tip: 'Дашборд' },
  'my-dashboard': { g: 'grid', m: 'Мой дашборд', a: 'none', tip: 'Мой дашборд' },
  'big-screen': { g: 'monitor', m: 'Большой экран', a: 'none', tip: 'Большой экран' },
  'command-map': { g: 'globe', m: 'Командный экран', a: 'none', tip: 'Командный экран' },
  calendar: { g: 'calendar', m: 'Календарь', a: 'none', tip: 'Календарь' },
  birthdays: { g: 'cake', m: 'Дни рождения', a: 'none', tip: 'Дни рождения' },
  tasks: { g: 'check', m: 'Задачи', a: 'none', tip: 'Задачи' },
  help: { g: 'hand', m: 'Помощь', a: 'none', tip: 'Помощь' },

  tenders: { g: 'doc', m: 'Сага тендеров', a: 'blue', tip: 'Сага Тендеров' },
  customers: { g: 'building', m: 'Контрагенты', a: 'none', tip: 'Контрагенты' },
  'pm-calculations': { g: 'doc', m: 'Просчёты', a: 'none', tip: 'Просчёты РП' },
  calculator: { g: 'calc', m: 'Калькулятор', a: 'blue', tip: 'Калькулятор' },
  'bonus-approval': { g: 'gift', m: 'Премии', a: 'none', tip: 'Премии' },
  'pm-works': { g: 'briefcase', m: 'Мои работы', a: 'none', tip: 'Мои работы' },
  readiness: { g: 'flag', m: 'Готовность', a: 'none', tip: 'Готовность' },
  'all-works': { g: 'stack', m: 'Свод контрактов', a: 'none', tip: 'Свод контрактов' },
  'gantt-calcs': { g: 'gantt', m: 'Гантт просчёты', a: 'none', tip: 'Гантт просчёты' },
  'gantt-works': { g: 'gantt', m: 'Гантт работы', a: 'none', tip: 'Гантт работы' },
  'tasks-admin': { g: 'clipboard', m: 'Админ задач', a: 'none', tip: 'Управление задачами' },
  kanban: { g: 'kanban', m: 'Канбан', a: 'none', tip: 'Канбан' },
  'personal-kanban-v3': { g: 'kanban', m: 'Мой канбан', a: 'none', tip: 'Мой канбан' },
  'director-inbox': { g: 'inbox', m: 'Маркетплейс', a: 'red', tip: 'Маркетплейс заявок' },
  'director-tender-approvals': { g: 'shield', m: 'Согласование', a: 'none', tip: 'Согласование тендеров' },

  finances: { g: 'money', m: 'Финансы', a: 'gold', tip: 'Финансы' },
  billing: { g: 'receipt', m: 'Счета', a: 'none', tip: 'Счета и акты' },
  'buh-registry': { g: 'clipboard', m: 'Реестр расходов', a: 'none', tip: 'Реестр расходов' },
  'doc-hub': { g: 'folder', m: 'Документы', a: 'none', tip: 'Реестр документов' },
  'office-expenses': { g: 'building', m: 'Офис расходы', a: 'none', tip: 'Офисные расходы' },
  cash: { g: 'money', m: 'Касса', a: 'gold', tip: 'Касса' },
  'cash-admin': { g: 'lock', m: 'Касса админ', a: 'none', tip: 'Касса управление' },
  'approval-payment': { g: 'card', m: 'Оплата', a: 'none', tip: 'Очередь оплаты' },
  'my-timesheet': { g: 'clock', m: 'Мой табель', a: 'none', tip: 'Табель дружины' },
  'self-employed': { g: 'id', m: 'Самозанятые', a: 'none', tip: 'Самозанятые' },
  'one-time-pay': { g: 'ticket', m: 'Разовые', a: 'none', tip: 'Разовые оплаты' },
  'reports-payroll': { g: 'bars', m: 'Отчёты ФОТ', a: 'none', tip: 'Отчёты по выплатам' },

  tkp: { g: 'doc', m: 'ТКП', a: 'none', tip: 'ТКП' },
  'pass-requests': { g: 'key', m: 'Пропуск', a: 'none', tip: 'Заявки на пропуск' },
  procurement: { g: 'cart', m: 'Закупки', a: 'blue', tip: 'Закупки' },
  'my-procurement': { g: 'bag', m: 'Мои заявки', a: 'none', tip: 'Мои заявки' },
  'suppliers-catalog': { g: 'tag', m: 'Поставщики', a: 'none', tip: 'Поставщики' },
  assembly: { g: 'puzzle', m: 'Сбор', a: 'none', tip: 'Сбор на складе' },
  'warehouse-v2': { g: 'box', m: 'Склад', a: 'blue', tip: 'Склад' },
  'my-equipment': { g: 'wrench', m: 'Оборудование', a: 'none', tip: 'Моё оборудование' },
  correspondence: { g: 'mail', m: 'Корреспонденция', a: 'none', tip: 'Корреспонденция' },
  contracts: { g: 'doc', m: 'Договоры', a: 'none', tip: 'Договоры' },
  seals: { g: 'stamp', m: 'Печати', a: 'none', tip: 'Печати' },
  proxies: { g: 'pen', m: 'Доверенности', a: 'none', tip: 'Доверенности' },

  personnel: { g: 'people', m: 'Дружина', a: 'blue', tip: 'Дружина' },
  'hr-requests': { g: 'userPlus', m: 'HR заявки', a: 'none', tip: 'Заявки персонала' },
  collections: { g: 'bookmark', m: 'Подборки', a: 'none', tip: 'Подборки' },
  permits: { g: 'shield', m: 'Допуски', a: 'none', tip: 'Допуски' },
  'nd-permits': { g: 'shield', m: 'Наряды', a: 'none', tip: 'Электронные наряды' },
  'permit-applications': { g: 'clipboard', m: 'Оформление', a: 'none', tip: 'Заявки на оформление' },
  training: { g: 'book', m: 'Обучение', a: 'none', tip: 'Обучение' },
  'office-academy': { g: 'book', m: 'Академия', a: 'gold', tip: 'Академия Асгарда' },
  'office-schedule': { g: 'calendar', m: 'График офис', a: 'none', tip: 'График офис' },
  'workers-schedule': { g: 'people', m: 'График рабочие', a: 'none', tip: 'График рабочие' },
  'hr-rating': { g: 'star', m: 'Рейтинг', a: 'none', tip: 'Рейтинг дружины' },
  travel: { g: 'truck', m: 'Логистика', a: 'none', tip: 'Логистика' },
  timesheet: { g: 'clipboard', m: 'Табель', a: 'none', tip: 'Табель' },
  'timesheet-warehouse': { g: 'box', m: 'Табель склад', a: 'none', tip: 'Табель склад' },
  'timesheet-medical': { g: 'heart', m: 'Табель МО', a: 'none', tip: 'Табель МО' },
  'timesheet-travel': { g: 'map', m: 'Табель дорога', a: 'none', tip: 'Табель дорога' },
  'site-crew': { g: 'pin', m: 'На объектах', a: 'none', tip: 'Кто на объектах' },
  'payroll-dashboard': { g: 'money', m: 'ФОТ', a: 'none', tip: 'Финансы персонала' },
  'official-employees': { g: 'id', m: 'Официальные', a: 'none', tip: 'Официально устроенные' },
  'training-board': { g: 'bulb', m: 'Обучение/допуски', a: 'none', tip: 'Обучение и допуски' },
  'pm-balance': { g: 'scale', m: 'Баланс', a: 'none', tip: 'Баланс подотчётников' },

  messenger: { g: 'chat', m: 'Хугинн', a: 'blue', tip: 'Хугинн' },
  meetings: { g: 'mic', m: 'Совещания', a: 'none', tip: 'Совещания' },
  ting: { g: 'video', m: 'Тинг', a: 'none', tip: 'Тинг' },
  alerts: { g: 'bell', m: 'Уведомления', a: 'none', tip: 'Уведомления' },
  telegram: { g: 'send', m: 'Telegram', a: 'none', tip: 'Telegram' },
  telephony: { g: 'phone', m: 'Телефония', a: 'blue', tip: 'Телефония' },
  'call-reports': { g: 'speaker', m: 'Аналитика звонков', a: 'none', tip: 'Аналитика звонков' },

  analytics: { g: 'pie', m: 'Аналитика', a: 'blue', tip: 'Аналитика Ярла' },
  'user-requests': { g: 'userPlus', m: 'Заявки юзеров', a: 'none', tip: 'Заявки пользователей' },
  settings: { g: 'sliders', m: 'Настройки', a: 'none', tip: 'Настройки' },
  'admin-timesheet-settings': { g: 'gear', m: 'Баллы табеля', a: 'none', tip: 'Баллы табеля' },
  backup: { g: 'cloud', m: 'Бэкап', a: 'none', tip: 'Резервные копии' },
  sync: { g: 'sync', m: 'Sync', a: 'none', tip: 'PostgreSQL Sync' },
  diag: { g: 'beaker', m: 'Диагностика', a: 'none', tip: 'Диагностика' },
  'system-panel': { g: 'server', m: 'Сервер', a: 'none', tip: 'Панель сервера' },
  'to-analytics': { g: 'trend', m: 'Хроники ТО', a: 'none', tip: 'Хроники ТО' },
  'pm-analytics': { g: 'bars', m: 'Хроники РП', a: 'none', tip: 'Хроники РП' },
  'readiness-board': { g: 'check', m: 'Готовность РП', a: 'none', tip: 'Готовность по РП' },
  'engineer-dashboard': { g: 'chip', m: 'Кузница', a: 'none', tip: 'Кузница инженера' },
  'pm-prizes': { g: 'trophy', m: 'Призы', a: 'none', tip: 'Призы рабочих' },
  'gamification-dashboard': { g: 'fire', m: 'Геймификация', a: 'red', tip: 'Геймификация' },
  'gamification-leaderboard': { g: 'trophy', m: 'Рейтинг рабочих', a: 'none', tip: 'Рейтинг рабочих' },
  'gamification-admin': { g: 'terminal', m: 'Админ игры', a: 'none', tip: 'Управление геймификацией' },
  'object-map': { g: 'map', m: 'Карта объектов', a: 'none', tip: 'Карта объектов' },
  'my-mail': { g: 'at', m: 'Моя почта', a: 'none', tip: 'Моя почта' },
  mailbox: { g: 'inbox', m: 'Почта и заявки', a: 'none', tip: 'Почта и заявки' },
  'mail-settings': { g: 'mail', m: 'Настройки почты', a: 'none', tip: 'Настройки почты' },
  integrations: { g: 'link', m: 'Интеграции', a: 'none', tip: 'Интеграции' },

  'right-mimir': { g: 'sparkle', m: 'Мимир', a: 'none', tip: 'Мимир' },
  'right-huginn': { g: 'chat', m: 'Хугинн', a: 'none', tip: 'Хугинн' },
  'right-ting': { g: 'video', m: 'Тинг', a: 'none', tip: 'Тинг' },
  'right-phone': { g: 'phone', m: 'Телефон', a: 'none', tip: 'Телефон' },
};

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

function softSvg(glyphKey, { accent, uid }) {
  const body = G[glyphKey];
  if (!body) throw new Error('Missing glyph ' + glyphKey);
  const pill = accent && ACCENT[accent] ? ACCENT[accent] : null;
  const fill = pill ? '#FFFFFF' : 'currentColor';
  const fid = `sh-${uid}`;
  const gid = `hi-${uid}`;
  const filter = `<filter id="${fid}" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="1" stdDeviation="1.05" flood-color="#1C1914" flood-opacity="0.18"/></filter>`;

  if (pill) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
  <defs>${filter}<linearGradient id="${gid}" x1="20" y1="2" x2="20" y2="38" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#fff" stop-opacity=".34"/><stop offset="60%" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
  <rect x="3" y="3" width="34" height="34" rx="12" fill="${pill}" filter="url(#${fid})"/>
  <rect x="3" y="3" width="34" height="34" rx="12" fill="url(#${gid})"/>
  <g transform="translate(8,8)" fill="${fill}">${body}</g>
</svg>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
  <defs>${filter}</defs>
  <g filter="url(#${fid})" transform="translate(8,8)" fill="${fill}">${body}</g>
</svg>`;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
}

function normalizeAccents() {
  // RULE: color ONLY first-line rails (left groups + right huginn). Flyout items = mono.
  const FIRST = {
    'group-home': 'blue',
    'group-tenders': 'blue',
    'group-works': 'blue',
    'group-finance': 'gold',
    'group-resources': 'blue',
    'group-personnel': 'blue',
    'group-comm': 'blue',
    'group-analytics': 'gold',
    'group-system': 'blue',
    'right-mimir': 'gold',
    'right-huginn': 'blue',
    'right-ting': 'blue',
    'right-phone': 'red',
  };
  for (const [slug, m] of Object.entries(META)) {
    m.a = FIRST[slug] || 'none';
  }
}

function buildGallery(entries) {
  const groups = entries.filter((e) => e.kind === 'group');
  const rights = entries.filter((e) => e.kind === 'right');
  const byGroup = {};
  for (const e of entries.filter((x) => x.kind === 'item')) {
    (byGroup[e.group] ||= []).push({
      ...e,
      metaphor: META[e.slug].m,
      accent: META[e.slug].a,
    });
  }
  const data = JSON.stringify({
    groups: groups.map((g) => ({ ...g, accent: META[g.slug].a, tip: META[g.slug].tip || g.label })),
    rights: rights.map((r) => ({ ...r, accent: META[r.slug].a, tip: META[r.slug].tip || r.label })),
    byGroup,
    all: entries.map((e) => ({ ...e, metaphor: META[e.slug].m, accent: META[e.slug].a })),
  });

  const html = `<!DOCTYPE html>
<html lang="ru" data-theme="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>ASGARD CRM — Icons R2.4 (как у тебя)</title>
<style>
  /* Токены ASGARD dark (как на твоём скрине) */
  html[data-theme="dark"]{
    --bg0:#0a0e16; --bg1:#0f141f; --bg2:#151b28; --bg3:#1c2433; --bg4:#243044;
    --t1:#E8EEF6; --t2:#A8B4C4; --t3:#7A8799;
    --icon-ink:#C8D2DF; --icon-accent:#4FA3E0;
    --blue:#4FA3E0; --gold:#D4A843; --red:#C8293B;
    --brd:rgba(120,140,170,.18); --rail:#121826;
    --shadow:0 2px 8px rgba(0,0,0,.35);
  }
  html[data-theme="light"]{
    /* как на твоём светлом скрине: белый rail + тёплый крем workspace */
    --bg0:#EDE8DC; --bg1:#F5F2EA; --bg2:#FFFFFF; --bg3:#F0EBE0; --bg4:#E8E2D4;
    --t1:#1C1914; --t2:#4B5563; --t3:#6B7280;
    --icon-ink:#1F2A3A; --icon-accent:#2E7BC0;
    --blue:#1A3F74; --gold:#B8841A; --red:#A82030;
    --brd:rgba(139,120,90,.18); --rail:#FFFFFF;
    --shadow:0 2px 10px rgba(40,30,10,.07);
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,Segoe UI,sans-serif;background:var(--bg0);color:var(--t1);height:100vh;display:flex;flex-direction:column}
  .bar{display:flex;gap:10px;align-items:center;padding:8px 12px;background:var(--bg2);border-bottom:1px solid var(--brd);font-size:12px}
  .bar button{padding:6px 10px;border-radius:8px;border:1px solid var(--brd);background:var(--bg3);color:var(--t1);cursor:pointer}
  .bar .note{color:var(--t3)}
  .shell{flex:1;display:flex;min-height:0;position:relative}
  .left{width:60px;background:var(--rail);border-right:1px solid var(--brd);display:flex;flex-direction:column;align-items:center;padding:10px 0;gap:6px;z-index:5;position:relative}
  .logo{width:42px;height:42px;border-radius:10px;border:1px solid color-mix(in srgb,var(--red) 45%,var(--brd));background:var(--bg2);display:flex;flex-direction:column;align-items:center;justify-content:center;margin-bottom:8px}
  .logo .a{font-weight:900;font-size:18px;line-height:1;background:linear-gradient(135deg,var(--red),var(--blue));-webkit-background-clip:text;color:transparent}
  .logo .crm{font-size:7px;color:var(--t3);letter-spacing:.04em}
  .rail-btn{width:42px;height:42px;border:0;border-radius:10px;background:transparent;color:var(--icon-ink);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;position:relative}
  .rail-btn img{width:22px;height:22px;display:block;pointer-events:none}
  .rail-btn:hover,.rail-btn.is-open{background:var(--bg3)}
  .rail-btn.is-active{background:color-mix(in srgb,var(--blue) 22%,var(--bg3));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--blue) 50%,transparent)}
  /* tip only hover — never permanent under icon */
  .rail-btn[data-tip]::after{content:attr(data-tip);position:absolute;left:50px;top:50%;transform:translateY(-50%);background:#1a2030;color:#fff;font-size:11px;font-weight:600;padding:5px 8px;border-radius:6px;white-space:nowrap;opacity:0;pointer-events:none;z-index:40;box-shadow:var(--shadow)}
  .rail-btn:hover::after{opacity:1}
  .main{flex:1;display:flex;flex-direction:column;min-width:0;background:var(--bg1);position:relative}
  .crumb{padding:10px 18px 0;color:var(--t3);font-size:12px}
  .page-title{padding:4px 18px 12px;font-size:28px;font-weight:800;color:var(--red);letter-spacing:.04em}
  .hero{margin:0 18px 16px;padding:16px 18px;border:1px solid var(--brd);border-radius:12px;background:var(--bg2)}
  .hero h2{margin:0;font-size:22px;color:var(--gold);font-family:Georgia,serif}
  .hero .sub{margin-top:8px;padding:8px 10px;border:1px solid rgba(255,255,255,.35);border-radius:8px;display:inline-block;font-size:13px}
  /* FLYOUT — like your ФИНАНСЫ panel */
  .flyout{position:absolute;left:60px;top:70px;width:280px;background:var(--bg2);border:1px solid var(--brd);border-radius:12px;box-shadow:var(--shadow);z-index:20;display:none;max-height:70vh;overflow:auto}
  .flyout.open{display:block}
  .flyout h3{margin:0;padding:12px 14px 8px;font-size:11px;letter-spacing:.08em;color:var(--t3);text-transform:uppercase;border-bottom:1px solid var(--brd)}
  .fly-item{display:flex;align-items:center;gap:10px;padding:10px 12px;color:var(--t1);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--brd) 70%,transparent)}
  .fly-item:hover{background:var(--bg3)}
  .fly-ico{width:32px;height:32px;border-radius:8px;background:var(--bg3);display:flex;align-items:center;justify-content:center;color:var(--icon-ink);flex-shrink:0}
  .fly-ico img{width:18px;height:18px}
  .fly-name{font-size:13px;font-weight:600}
  .fly-desc{font-size:11px;color:var(--t3)}
  /* RIGHT HUGINN */
  .dock{display:flex;margin-left:auto}
  .hg-panel{width:0;overflow:hidden;transition:width .15s;background:var(--bg2);border-left:1px solid var(--brd)}
  .hg-panel.open{width:320px}
  .right{width:56px;background:var(--rail);border-left:1px solid var(--brd);display:flex;flex-direction:column;align-items:center;padding:10px 0;gap:8px}
  .right .rail-btn[data-tip]::after{left:auto;right:50px}
  .right .rail-btn .badge{position:absolute;top:2px;right:2px;min-width:16px;height:16px;border-radius:999px;background:var(--red);color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 3px}
  .right .rail-btn .badge.y{background:var(--gold);color:#111}
  .row-bottom{display:flex;flex:1;min-height:0}
  .workspace{flex:1;overflow:auto}
</style>
</head>
<body>
<div class="bar">
  <strong>R2.4 · как в твоей CRM</strong>
  <button type="button" id="themeBtn">Тема: тёмная</button>
  <span class="note">Цвет: только первая линия (левый rail + правый rail). Flyout-вкладки — только mono.</span>
</div>
<div class="shell">
  <aside class="left" id="leftRail"></aside>
  <div class="flyout" id="flyout"><h3 id="flyTitle"></h3><div id="flyBody"></div></div>
  <section class="main">
    <div class="row-bottom">
      <div class="workspace">
        <div class="crumb">Главная</div>
        <div class="page-title">ГЛАВНАЯ</div>
        <div class="hero">
          <h2>ЗАЛ ЯРЛА</h2>
          <div class="sub">Вы дежурный РП · 01.10.2026</div>
        </div>
        <p style="padding:0 18px;color:var(--t3);font-size:13px;max-width:560px">Наведи на иконку слева (например Финансы) — откроется flyout с <b>mono</b> иконками вкладок. Справа: Мимир/Хугинн/Тинг/Телефон — цветные, подпись только по hover.</p>
      </div>
      <div class="dock">
        <div class="hg-panel" id="hgPanel"><div style="padding:12px;font-size:13px;color:var(--t2)">Панель Хугинн</div></div>
        <aside class="right" id="rightRail"></aside>
      </div>
    </div>
  </section>
</div>
<script>
const DATA = ${data};
const left = document.getElementById('leftRail');
const right = document.getElementById('rightRail');
const fly = document.getElementById('flyout');
const flyTitle = document.getElementById('flyTitle');
const flyBody = document.getElementById('flyBody');

left.innerHTML = '<div class="logo"><div class="a">A</div><div class="crm">CRM</div></div>' +
  DATA.groups.map((g,i)=>'<button type="button" class="rail-btn'+(g.group==='finance'?' is-active is-open':'')+'" data-group="'+g.group+'" data-tip="'+g.tip+'" aria-label="'+g.label+'"><img src="new/'+g.file+'" alt=""/></button>').join('');

right.innerHTML = DATA.rights.map((r,i)=>{
  const badge = r.slug==='right-huginn' ? '<span class="badge y">3</span>' : (r.slug==='right-phone' ? '<span class="badge">25</span>' : '');
  return '<button type="button" class="rail-btn'+(i===1?' is-active':'')+'" data-tip="'+r.tip+'" aria-label="'+r.label+'"><img src="new/'+r.file+'" alt=""/>'+badge+'</button>';
}).join('');

function openFly(groupId){
  const g = DATA.groups.find(x=>x.group===groupId);
  const items = DATA.byGroup[groupId]||[];
  flyTitle.textContent = g ? g.label : groupId;
  flyBody.innerHTML = items.map(it=>'<a class="fly-item" href="#"><span class="fly-ico"><img src="new/'+it.file+'" alt=""/></span><span><div class="fly-name">'+it.label+'</div><div class="fly-desc">'+it.desc+'</div></span></a>').join('');
  fly.classList.add('open');
  document.querySelectorAll('.left .rail-btn').forEach(b=>b.classList.toggle('is-open', b.dataset.group===groupId));
}
openFly('finance');

left.addEventListener('mouseover', (e)=>{
  const btn = e.target.closest('.rail-btn');
  if(!btn||!btn.dataset.group) return;
  openFly(btn.dataset.group);
});
document.getElementById('themeBtn').onclick=()=>{
  const h=document.documentElement;
  const n=h.getAttribute('data-theme')==='dark'?'light':'dark';
  h.setAttribute('data-theme',n);
  document.getElementById('themeBtn').textContent='Тема: '+(n==='dark'?'тёмная':'светлая');
};
</script>
</body></html>`;
  fs.writeFileSync(path.join(OUT, 'gallery.html'), html, 'utf8');
}

function main() {
  normalizeAccents();
  mkdirp(path.join(OUT, 'new'));
  const entries = JSON.parse(fs.readFileSync(R1_INV, 'utf8'));
  const accentMap = {};
  const lines = [
    '# Metaphor map R2.4',
    '',
    'Цвет **только** первая линия: `group-*` + `right-*`. Все flyout-пункты — `mono`.',
    '',
    '| Slug | Label | Glyph | Accent | Line |',
    '|------|-------|-------|--------|------|',
  ];
  for (const e of entries) {
    const m = META[e.slug];
    if (!m) throw new Error('META missing ' + e.slug);
    if (!G[m.g]) throw new Error('Glyph missing ' + m.g + ' for ' + e.slug);
    // enforce rule
    const firstLine = e.kind === 'group' || e.kind === 'right';
    if (!firstLine) m.a = 'none';
    const uid = e.slug.replace(/[^a-z0-9]/gi, '');
    fs.writeFileSync(path.join(OUT, 'new', e.file), softSvg(m.g, { accent: m.a, uid }), 'utf8');
    if (m.a !== 'none') accentMap[e.slug] = m.a;
    lines.push(`| \`${e.slug}\` | ${e.label} | ${m.g} | ${m.a} | ${firstLine ? 'FIRST' : 'flyout'} |`);
  }
  // gate: no flyout accents
  for (const e of entries) {
    if (e.kind === 'item' && accentMap[e.slug]) throw new Error('flyout cannot be colored: ' + e.slug);
  }
  fs.writeFileSync(path.join(OUT, 'metaphor-map.md'), lines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(OUT, 'accent-map.json'), JSON.stringify(accentMap, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'inventory.json'), JSON.stringify(entries, null, 2), 'utf8');
  buildGallery(entries);
  console.log('R2.4 first-line color only:', Object.keys(accentMap).length, 'accents;', entries.length, 'icons →', OUT);
}

main();
