-- RudraKailash Site Audit Tool - Database Schema
-- Run this once in u943038602_spiderman database

CREATE TABLE IF NOT EXISTS audit_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  started_at DATETIME NOT NULL,
  completed_at DATETIME,
  status ENUM('running','completed','failed') DEFAULT 'running',
  triggered_by ENUM('manual','scheduled') DEFAULT 'manual',
  total_pages INT DEFAULT 0,
  total_issues INT DEFAULT 0,
  critical_issues INT DEFAULT 0,
  warning_issues INT DEFAULT 0,
  info_issues INT DEFAULT 0,
  crawl_duration_ms INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_pages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  run_id INT NOT NULL,
  url VARCHAR(2048) NOT NULL,
  status_code INT,
  redirect_url VARCHAR(2048),
  redirect_chain JSON,
  content_type VARCHAR(255),
  page_size_bytes INT,
  load_time_ms INT,
  title VARCHAR(512),
  meta_description TEXT,
  h1 VARCHAR(512),
  canonical_url VARCHAR(2048),
  word_count INT,
  image_count INT,
  internal_link_count INT,
  external_link_count INT,
  is_in_sitemap TINYINT(1) DEFAULT 0,
  is_indexable TINYINT(1) DEFAULT 1,
  robots_directive VARCHAR(255),
  schema_types JSON,
  og_title VARCHAR(512),
  og_description TEXT,
  og_image VARCHAR(2048),
  crawled_at DATETIME,
  FOREIGN KEY (run_id) REFERENCES audit_runs(id) ON DELETE CASCADE,
  INDEX idx_run_id (run_id),
  INDEX idx_url (url(255)),
  INDEX idx_status_code (status_code)
);

CREATE TABLE IF NOT EXISTS audit_issues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  run_id INT NOT NULL,
  page_id INT,
  category ENUM(
    'links_urls',
    'on_page_seo',
    'images',
    'performance',
    'crawlability',
    'mobile_ux',
    'security',
    'content_quality',
    'structured_data'
  ) NOT NULL,
  severity ENUM('critical','warning','info') NOT NULL,
  check_name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  affected_url VARCHAR(2048),
  extra_data JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES audit_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (page_id) REFERENCES audit_pages(id) ON DELETE SET NULL,
  INDEX idx_run_id (run_id),
  INDEX idx_category (category),
  INDEX idx_severity (severity),
  INDEX idx_check_name (check_name)
);

CREATE TABLE IF NOT EXISTS audit_sessions (
  id VARCHAR(128) PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);
