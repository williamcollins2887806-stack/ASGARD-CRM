#!/bin/bash
# =====================================================================================
# ASGARD CRM - Fresh Server Deployment Script
# =====================================================================================
# Usage: Run on a fresh Ubuntu 22.04/24.04 server as root:
#   bash deploy-fresh.sh
#
# What it does:
#   1. Installs Node.js 22.x, PostgreSQL 16, PM2, Nginx
#   2. Creates database and user
#   3. Clones the repo and installs dependencies
#   4. Initializes the database schema
#   5. Creates .env configuration
#   6. Starts the server with PM2
#   7. Configures Nginx reverse proxy
# =====================================================================================

set -e

# ─────────────────────────────────────────────────────
# Configuration (edit these before running)
# ─────────────────────────────────────────────────────
APP_DIR="/var/www/asgard-crm"
REPO_URL="https://github.com/AsgardCRM/ASGARD-CRM.git"
REPO_BRANCH="main"

DB_NAME="asgard_crm"
DB_USER="asgard"
DB_PASSWORD="$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 20)"

JWT_SECRET="$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 32)"

SERVER_PORT=3000
DOMAIN=""  # Leave empty for IP-only access, or set to "crm.example.com"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
step() { echo -e "\n${BLUE}═══════════════════════════════════════════════════════════${NC}"; echo -e "${BLUE}  $1${NC}"; echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"; }

# ─────────────────────────────────────────────────────
# Check root
# ─────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  err "Run this script as root: sudo bash deploy-fresh.sh"
fi

step "1/7 - System Update & Base Packages"
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl wget gnupg2 git build-essential software-properties-common ca-certificates lsb-release
log "System updated"

step "2/7 - Install Node.js 22.x"
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
  log "Node.js $(node -v) installed"
else
  log "Node.js $(node -v) already installed"
fi

# Install PM2 globally
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2
  log "PM2 installed"
else
  log "PM2 already installed"
fi

step "3/7 - Install PostgreSQL 16"
if ! command -v psql &> /dev/null; then
  sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
  apt-get update -qq
  apt-get install -y -qq postgresql-16 postgresql-client-16
  log "PostgreSQL 16 installed"
else
  log "PostgreSQL already installed: $(psql --version)"
fi

# Ensure PostgreSQL is running
systemctl enable postgresql
systemctl start postgresql
log "PostgreSQL running"

step "4/7 - Create Database & User"
# Create DB user (if not exists)
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';"
log "DB user '${DB_USER}' ready"

# Create database (if not exists)
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
log "Database '${DB_NAME}' ready"

# Grant privileges
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
sudo -u postgres psql -d ${DB_NAME} -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"
log "Privileges granted"

step "5/7 - Clone Repository & Install Dependencies"
if [ -d "$APP_DIR" ]; then
  warn "Directory ${APP_DIR} exists. Pulling latest..."
  cd "$APP_DIR"
  git pull origin ${REPO_BRANCH} || true
else
  mkdir -p "$(dirname $APP_DIR)"
  git clone --branch ${REPO_BRANCH} ${REPO_URL} ${APP_DIR}
  cd "$APP_DIR"
fi

# Install Node.js dependencies
npm ci --production 2>/dev/null || npm install --production
log "Dependencies installed"

# Create uploads directory
mkdir -p ${APP_DIR}/uploads
log "Uploads directory ready"

# Create .env file
cat > ${APP_DIR}/.env << EOF
PORT=${SERVER_PORT}
HOST=0.0.0.0
DB_HOST=localhost
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
JWT_SECRET=${JWT_SECRET}
NODE_ENV=production
UPLOAD_DIR=./uploads
CORS_ORIGIN=http://$(hostname -I | awk '{print $1}')
RATE_LIMIT_MAX=1000
RATE_LIMIT_WINDOW=60000
EOF
log ".env created"

step "6/7 - Initialize Database Schema"
cd "$APP_DIR"
PGPASSWORD="${DB_PASSWORD}" psql -h localhost -U ${DB_USER} -d ${DB_NAME} -f db/init.sql
log "Database schema initialized"

step "7/7 - Start Server with PM2"
cd "$APP_DIR"

# Create PM2 ecosystem file
cat > ecosystem.config.js << 'PMEOF'
module.exports = {
  apps: [{
    name: 'asgard-crm',
    script: 'src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/var/log/asgard-crm/error.log',
    out_file: '/var/log/asgard-crm/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
PMEOF

# Create log directory
mkdir -p /var/log/asgard-crm

# Stop existing instance if running
pm2 delete asgard-crm 2>/dev/null || true

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true
log "Server started with PM2"

# ─────────────────────────────────────────────────────
# Configure Nginx (optional)
# ─────────────────────────────────────────────────────
if ! command -v nginx &> /dev/null; then
  apt-get install -y -qq nginx
fi

SERVER_IP=$(hostname -I | awk '{print $1}')
NGINX_SERVER_NAME="${DOMAIN:-$SERVER_IP}"

cat > /etc/nginx/sites-available/asgard-crm << NGINXEOF
server {
    listen 80;
    server_name ${NGINX_SERVER_NAME};

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:${SERVER_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|webp)$ {
        proxy_pass http://127.0.0.1:${SERVER_PORT};
        proxy_set_header Host \$host;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/asgard-crm /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl restart nginx
systemctl enable nginx
log "Nginx configured"

# ─────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              ASGARD CRM - DEPLOYMENT COMPLETE               ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC} App:        http://${SERVER_IP}                               ${GREEN}║${NC}"
echo -e "${GREEN}║${NC} API:        http://${SERVER_IP}/api/health                    ${GREEN}║${NC}"
echo -e "${GREEN}║${NC} Directory:  ${APP_DIR}                            ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                                             ${GREEN}║${NC}"
echo -e "${GREEN}║${NC} Database:   ${DB_NAME}                                  ${GREEN}║${NC}"
echo -e "${GREEN}║${NC} DB User:    ${DB_USER}                                       ${GREEN}║${NC}"
echo -e "${GREEN}║${NC} DB Pass:    ${DB_PASSWORD}                       ${GREEN}║${NC}"
echo -e "${GREEN}║${NC} JWT Secret: ${JWT_SECRET}         ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                                             ${GREEN}║${NC}"
echo -e "${GREEN}║${NC} Admin:      login: admin / password: admin123               ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                                             ${GREEN}║${NC}"
echo -e "${GREEN}║${NC} PM2:        pm2 status / pm2 logs asgard-crm               ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}             pm2 restart asgard-crm                          ${GREEN}║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}IMPORTANT: Save these credentials! They won't be shown again.${NC}"
echo -e "${YELLOW}Credentials are stored in ${APP_DIR}/.env${NC}"
