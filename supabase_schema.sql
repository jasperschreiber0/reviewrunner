-- Add reviewed_at to clients table (run this if clients table already exists from reactivate)
alter table clients add column if not exists reviewed_at timestamptz;

-- Add google_review_url to businesses table
alter table businesses add column if not exists google_review_url text;

-- ReviewRunner log table
create table if not exists reviewrunner_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  business_id uuid references businesses(id),
  booking_id uuid references bookings(id),
  message_type text, -- 'review_request', 'thankyou', 'review_click'
  message_sent text,
  sent_at timestamptz,
  created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_reviewrunner_client on reviewrunner_log(client_id);
create index if not exists idx_clients_reviewed on clients(reviewed_at);
