CREATE TABLE IF NOT EXISTS business_conversations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  type varchar NOT NULL DEFAULT 'business_user',
  subject varchar,
  restaurant_id varchar REFERENCES restaurants(id) ON DELETE SET NULL,
  created_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context_type varchar,
  context_id varchar,
  status varchar NOT NULL DEFAULT 'open',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_message_at timestamp DEFAULT now(),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_conversations_restaurant
  ON business_conversations(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_business_conversations_status
  ON business_conversations(status);

CREATE INDEX IF NOT EXISTS idx_business_conversations_last_message
  ON business_conversations(last_message_at);

CREATE INDEX IF NOT EXISTS idx_business_conversations_context
  ON business_conversations(context_type, context_id);

CREATE TABLE IF NOT EXISTS business_conversation_participants (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id varchar NOT NULL REFERENCES business_conversations(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_type varchar NOT NULL DEFAULT 'user',
  display_role varchar,
  last_read_at timestamp,
  archived_at timestamp,
  muted_at timestamp,
  joined_at timestamp DEFAULT now(),
  created_at timestamp DEFAULT now(),
  CONSTRAINT uq_business_conversation_participants_conversation_user
    UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_business_conversation_participants_conversation
  ON business_conversation_participants(conversation_id);

CREATE INDEX IF NOT EXISTS idx_business_conversation_participants_user
  ON business_conversation_participants(user_id);

CREATE INDEX IF NOT EXISTS idx_business_conversation_participants_archived
  ON business_conversation_participants(archived_at);

CREATE TABLE IF NOT EXISTS business_messages (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id varchar NOT NULL REFERENCES business_conversations(id) ON DELETE CASCADE,
  sender_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_system boolean NOT NULL DEFAULT false,
  status varchar NOT NULL DEFAULT 'sent',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_messages_conversation_created
  ON business_messages(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_business_messages_sender
  ON business_messages(sender_user_id);
