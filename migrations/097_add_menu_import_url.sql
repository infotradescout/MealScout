-- Track the last source URL used for url-based menu imports
-- so owners can one-click re-import from the menu builder.
ALTER TABLE menus ADD COLUMN IF NOT EXISTS import_url varchar;
