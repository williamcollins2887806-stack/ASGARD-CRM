/**
 * ASGARD CRM - Centralized Configuration
 * APP_VERSION reads from package.json (single source of truth)
 */

const pkg = require('../package.json');

module.exports = {
  APP_VERSION: pkg.version
};
