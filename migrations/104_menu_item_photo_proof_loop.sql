-- Issue #23: menu item photo proof loop

create table if not exists menu_item_recommendations (
  id varchar primary key default gen_random_uuid(),
  restaurant_id varchar not null references restaurants(id) on delete cascade,
  menu_item_id varchar not null references menu_items(id) on delete cascade,
  user_id varchar not null references users(id) on delete cascade,
  comment text,
  rating integer,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

create unique index if not exists uq_menu_item_recommendations_user_item
  on menu_item_recommendations(user_id, menu_item_id);
create index if not exists idx_menu_item_recommendations_restaurant
  on menu_item_recommendations(restaurant_id);
create index if not exists idx_menu_item_recommendations_menu_item
  on menu_item_recommendations(menu_item_id);
create index if not exists idx_menu_item_recommendations_user
  on menu_item_recommendations(user_id);

create table if not exists menu_item_photos (
  id varchar primary key default gen_random_uuid(),
  restaurant_id varchar not null references restaurants(id) on delete cascade,
  menu_item_id varchar not null references menu_items(id) on delete cascade,
  source_user_id varchar not null references users(id) on delete cascade,
  recommendation_id varchar references menu_item_recommendations(id) on delete set null,
  image_url text not null,
  thumbnail_url text,
  cloudinary_public_id varchar,
  caption text,
  status varchar not null default 'pending',
  moderation_status varchar not null default 'pending',
  featured_by_business boolean not null default false,
  reviewed_by_user_id varchar references users(id) on delete set null,
  reviewed_at timestamp,
  rejected_reason text,
  score_photo_awarded_at timestamp,
  score_featured_awarded_at timestamp,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

create index if not exists idx_menu_item_photos_restaurant
  on menu_item_photos(restaurant_id);
create index if not exists idx_menu_item_photos_menu_item
  on menu_item_photos(menu_item_id);
create index if not exists idx_menu_item_photos_source_user
  on menu_item_photos(source_user_id);
create index if not exists idx_menu_item_photos_status
  on menu_item_photos(status);

