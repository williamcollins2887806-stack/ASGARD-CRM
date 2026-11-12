#!/usr/bin/env bash
set -euo pipefail
PGPASSWORD=123456789 psql -U asgard -d asgard_crm -A -F'|' -c \
  "SELECT login, role, is_active FROM users WHERE login IN ('test_pm','test_to','test_head_pm','admin') ORDER BY login;"
