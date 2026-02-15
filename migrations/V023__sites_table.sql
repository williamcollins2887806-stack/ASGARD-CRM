-- V023: Sites (object locations) table for map feature
CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  name VARCHAR(500) NOT NULL,
  short_name VARCHAR(200),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  region VARCHAR(200),
  site_type VARCHAR(50) DEFAULT 'object',
  customer_id INTEGER REFERENCES customers(id),
  customer_name VARCHAR(500),
  address TEXT,
  description TEXT,
  geocode_status VARCHAR(20) DEFAULT 'pending',
  geocode_source VARCHAR(200),
  photo_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sites_customer ON sites(customer_id);
CREATE INDEX IF NOT EXISTS idx_sites_geocode_status ON sites(geocode_status);
CREATE INDEX IF NOT EXISTS idx_sites_region ON sites(region);

-- Add site_id foreign key to works and tenders
ALTER TABLE works ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES sites(id);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES sites(id);
