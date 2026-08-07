CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS restaurants (
  id varchar PRIMARY KEY,
  name varchar NOT NULL
);

CREATE TABLE IF NOT EXISTS menus (
  id varchar PRIMARY KEY,
  restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS menu_categories (
  id varchar PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS menu_items (
  id varchar PRIMARY KEY,
  menu_id varchar NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  category_id varchar REFERENCES menu_categories(id) ON DELETE SET NULL,
  restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name varchar NOT NULL,
  is_available boolean NOT NULL DEFAULT true,
  inventory_qty integer,
  track_inventory boolean NOT NULL DEFAULT false
);

INSERT INTO restaurants (id, name) VALUES ('rest_seed_1', 'Lane1 Proof Truck');
INSERT INTO menus (id, restaurant_id) VALUES ('menu_seed_1', 'rest_seed_1');
INSERT INTO menu_items (id, menu_id, restaurant_id, name, is_available, inventory_qty, track_inventory) VALUES
  ('item_seed_1', 'menu_seed_1', 'rest_seed_1', 'Taco', true, 5, true),
  ('item_seed_2', 'menu_seed_1', 'rest_seed_1', 'Sold Out Bowl', false, 0, true);
