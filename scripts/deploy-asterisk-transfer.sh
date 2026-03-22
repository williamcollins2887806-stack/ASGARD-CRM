#!/bin/bash
# Deploy asgard-transfer context to Asterisk extensions.conf
# Run on server: bash /var/www/asgard-crm/scripts/deploy-asterisk-transfer.sh

CONF="/etc/asterisk/extensions.conf"

if grep -q '\[asgard-transfer\]' "$CONF"; then
  echo "[OK] asgard-transfer context already exists"
  exit 0
fi

echo "Adding [asgard-transfer] context to $CONF..."
cp "$CONF" "${CONF}.bak.$(date +%Y%m%d_%H%M%S)"

cat >> "$CONF" << 'EOF'

[asgard-transfer]
; Context for AMI Redirect from AudioSocket voice agent
exten => _X.,1,NoOp(ASGARD Transfer to ${EXTEN})
 same => n,Set(CALLERID(num)=${CALLERID(num)})
 same => n,Dial(SIP/mango-trunk/${EXTEN},60,tTg)
 same => n,Hangup()
EOF

echo "Reloading dialplan..."
asterisk -rx "dialplan reload"
echo "[OK] asgard-transfer context deployed"
