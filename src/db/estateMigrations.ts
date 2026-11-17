// EstateFlow schema, added on top of the inherited RetailX CRM tables (customers = the central Person record).
// Property ≠ Ownership ≠ Listing ≠ Availability ≠ Deal: each is its own table. Money is INTEGER PKR.
// History tables and financial tables are append-only (enforced by triggers).

const CATEGORIES = `'residential_plot','commercial_plot','house','apartment','agricultural_land','shop','office','commercial_building','property_file','other'`;

export const V2_PROPERTY_CORE = `
  ALTER TABLE customers ADD COLUMN whatsapp TEXT NOT NULL DEFAULT '';
  ALTER TABLE customers ADD COLUMN cnic TEXT NOT NULL DEFAULT '';
  ALTER TABLE customers ADD COLUMN profile_image TEXT NOT NULL DEFAULT '';

  CREATE TABLE person_roles (
    person_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('buyer','seller','owner','tenant','dealer','investor','landlord','other')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (person_id, role)
  );
  CREATE INDEX idx_person_roles_role ON person_roles(role);

  CREATE TABLE dealer_profiles (
    person_id INTEGER PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    business_name TEXT NOT NULL DEFAULT '',
    specialization TEXT NOT NULL DEFAULT '',
    societies TEXT NOT NULL DEFAULT '',
    areas TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (${CATEGORIES})),
    transaction_type TEXT NOT NULL DEFAULT 'sale' CHECK (transaction_type IN ('sale','rent')),
    availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available','under_negotiation','reserved','sold','rented','on_hold')),
    reserved_by_deal_id INTEGER,
    record_status TEXT NOT NULL DEFAULT 'active' CHECK (record_status IN ('active','archived')),
    country TEXT NOT NULL DEFAULT 'Pakistan',
    province TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT '',
    society TEXT NOT NULL DEFAULT '',
    phase TEXT NOT NULL DEFAULT '',
    block TEXT NOT NULL DEFAULT '',
    street TEXT NOT NULL DEFAULT '',
    plot_no TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    latitude REAL,
    longitude REAL,
    area_value REAL NOT NULL CHECK (area_value > 0),
    area_unit TEXT NOT NULL CHECK (area_unit IN ('marla','kanal','sqft','sqyd','acre')),
    marla_basis TEXT NOT NULL DEFAULT 'revenue' CHECK (marla_basis IN ('revenue','society')),
    area_sqft REAL NOT NULL CHECK (area_sqft > 0),
    front REAL, depth REAL, covered_area REAL, floors INTEGER, bedrooms INTEGER, bathrooms INTEGER,
    construction_status TEXT NOT NULL DEFAULT '',
    condition TEXT NOT NULL DEFAULT '',
    facing TEXT NOT NULL DEFAULT '',
    utilities TEXT NOT NULL DEFAULT '[]',
    parking TEXT NOT NULL DEFAULT '',
    amenities TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    registered_at TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_properties_location ON properties(city, society, phase, block);
  CREATE INDEX idx_properties_category ON properties(category, availability);
  CREATE INDEX idx_properties_sqft ON properties(area_sqft);
  CREATE INDEX idx_properties_dup ON properties(society COLLATE NOCASE, block COLLATE NOCASE, plot_no COLLATE NOCASE);
  CREATE INDEX idx_properties_created ON properties(created_at);

  CREATE TABLE property_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    thumb TEXT NOT NULL DEFAULT '',
    caption TEXT NOT NULL DEFAULT '',
    is_main INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_property_photos_property ON property_photos(property_id, sort);

  -- ownership history is never deleted: a transfer sets end_date on old rows and inserts new rows
  CREATE TABLE ownerships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
    person_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    percentage REAL NOT NULL CHECK (percentage > 0 AND percentage <= 100),
    start_date TEXT NOT NULL,
    end_date TEXT,
    verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','documents_seen','dealer_verified')),
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_ownerships_property ON ownerships(property_id, end_date);
  CREATE INDEX idx_ownerships_person ON ownerships(person_id);
  CREATE TRIGGER trg_ownerships_no_delete BEFORE DELETE ON ownerships BEGIN SELECT RAISE(ABORT, 'ownership history is append-only'); END;

  CREATE TABLE listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
    source TEXT NOT NULL DEFAULT 'own',
    dealer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    owner_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    asking_price INTEGER NOT NULL CHECK (asking_price >= 0),
    min_price INTEGER CHECK (min_price IS NULL OR min_price >= 0),
    commission_type TEXT NOT NULL DEFAULT 'none' CHECK (commission_type IN ('none','fixed','percent')),
    commission_value REAL NOT NULL DEFAULT 0,
    commission_terms TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL DEFAULT '',
    expiry_date TEXT NOT NULL DEFAULT '',
    marketing_permissions TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','expired','withdrawn','closed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_listings_property ON listings(property_id, status);
  CREATE INDEX idx_listings_status ON listings(status, expiry_date);
  CREATE INDEX idx_listings_dealer ON listings(dealer_id);

  CREATE TABLE listing_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    at INTEGER NOT NULL
  );
  CREATE INDEX idx_listing_history_listing ON listing_history(listing_id, at);

  CREATE TABLE availability_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT '',
    deal_id INTEGER,
    reason TEXT NOT NULL DEFAULT '',
    at INTEGER NOT NULL
  );
  CREATE INDEX idx_availability_history_property ON availability_history(property_id, at);
  CREATE TRIGGER trg_avail_hist_no_update BEFORE UPDATE ON availability_history BEGIN SELECT RAISE(ABORT, 'availability history is append-only'); END;
  CREATE TRIGGER trg_avail_hist_no_delete BEFORE DELETE ON availability_history BEGIN SELECT RAISE(ABORT, 'availability history is append-only'); END;
`;

export const V3_DEALS_FINANCE = `
  CREATE TABLE buyer_requirements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL DEFAULT 'sale' CHECK (transaction_type IN ('sale','rent')),
    category TEXT NOT NULL DEFAULT '',
    budget_min INTEGER, budget_max INTEGER,
    city TEXT NOT NULL DEFAULT '', society TEXT NOT NULL DEFAULT '', phase TEXT NOT NULL DEFAULT '', block TEXT NOT NULL DEFAULT '',
    area_min_sqft REAL, area_max_sqft REAL,
    features TEXT NOT NULL DEFAULT '[]',
    urgency TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low','medium','high')),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','active','matching','visit_scheduled','negotiation','fulfilled','lost','cancelled')),
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_requirements_person ON buyer_requirements(person_id);
  CREATE INDEX idx_requirements_status ON buyer_requirements(status);

  CREATE TABLE property_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    buyer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    requirement_id INTEGER REFERENCES buyer_requirements(id) ON DELETE SET NULL,
    followup_id INTEGER REFERENCES followups(id) ON DELETE SET NULL,
    scheduled_at INTEGER NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    responsible_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled','rescheduled','no_show')),
    feedback TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL DEFAULT '', next_action TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_visits_when ON property_visits(status, scheduled_at);
  CREATE INDEX idx_visits_property ON property_visits(property_id);
  CREATE INDEX idx_visits_buyer ON property_visits(buyer_id);

  CREATE TABLE deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
    listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
    buyer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
    seller_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('sale','rent')),
    stage TEXT NOT NULL DEFAULT 'initial_interest' CHECK (stage IN ('initial_interest','negotiation','offer_submitted','offer_accepted','token_received','bayana_agreement','payment_in_progress','completed','cancelled')),
    agreed_price INTEGER CHECK (agreed_price IS NULL OR agreed_price >= 0),
    deal_date TEXT NOT NULL DEFAULT '',
    payment_terms TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    cancel_reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER
  );
  CREATE INDEX idx_deals_property ON deals(property_id, stage);
  CREATE INDEX idx_deals_stage ON deals(stage);
  CREATE INDEX idx_deals_buyer ON deals(buyer_id);

  CREATE TABLE deal_participants (
    deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (role IN ('listing_dealer','buyer_dealer','buyer','seller','other')),
    PRIMARY KEY (deal_id, person_id, role)
  );

  CREATE TABLE deal_stage_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    from_stage TEXT, to_stage TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL
  );
  CREATE INDEX idx_deal_stage_history_deal ON deal_stage_history(deal_id, at);
  CREATE TRIGGER trg_deal_stage_no_update BEFORE UPDATE ON deal_stage_history BEGIN SELECT RAISE(ABORT, 'deal history is append-only'); END;
  CREATE TRIGGER trg_deal_stage_no_delete BEFORE DELETE ON deal_stage_history BEGIN SELECT RAISE(ABORT, 'deal history is append-only'); END;

  CREATE TABLE installments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL, due_date TEXT NOT NULL, amount INTEGER NOT NULL CHECK (amount > 0),
    UNIQUE (deal_id, seq)
  );

  -- frozen snapshot of the finalised commission terms; never edited, never deleted
  CREATE TABLE commission_agreements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE RESTRICT,
    total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
    snapshot TEXT NOT NULL,
    finalized_at INTEGER NOT NULL,
    superseded_by INTEGER REFERENCES commission_agreements(id)
  );
  CREATE INDEX idx_commission_agreements_deal ON commission_agreements(deal_id);
  CREATE TRIGGER trg_commission_agr_no_delete BEFORE DELETE ON commission_agreements BEGIN SELECT RAISE(ABORT, 'commission agreements are immutable'); END;
  CREATE TRIGGER trg_commission_agr_no_edit BEFORE UPDATE OF deal_id, total_amount, snapshot, finalized_at ON commission_agreements BEGIN SELECT RAISE(ABORT, 'commission agreements are immutable'); END;

  CREATE TABLE commission_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agreement_id INTEGER NOT NULL REFERENCES commission_agreements(id) ON DELETE RESTRICT,
    person_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    role TEXT NOT NULL DEFAULT '',
    amount INTEGER NOT NULL CHECK (amount >= 0),
    share_bps INTEGER
  );
  CREATE INDEX idx_commission_shares_agreement ON commission_shares(agreement_id);
  CREATE TRIGGER trg_commission_shares_no_delete BEFORE DELETE ON commission_shares BEGIN SELECT RAISE(ABORT, 'commission shares are immutable'); END;
  CREATE TRIGGER trg_commission_shares_no_edit BEFORE UPDATE ON commission_shares BEGIN SELECT RAISE(ABORT, 'commission shares are immutable'); END;

  -- append-only: corrections are reversal rows (amount stays positive, reversal_of points at the original)
  CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    deal_id INTEGER REFERENCES deals(id) ON DELETE RESTRICT,
    person_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
    commission_share_id INTEGER REFERENCES commission_shares(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind IN ('buyer_payment','token','bayana','installment','seller_payment','refund','commission_received','commission_paid')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    paid_at INTEGER NOT NULL,
    method TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','bank_transfer','cheque','other')),
    reference TEXT NOT NULL DEFAULT '',
    receipt_file TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    reversal_of INTEGER REFERENCES payments(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_payments_deal ON payments(deal_id);
  CREATE INDEX idx_payments_person ON payments(person_id);
  CREATE INDEX idx_payments_paid ON payments(paid_at);
  CREATE UNIQUE INDEX idx_payments_one_reversal ON payments(reversal_of) WHERE reversal_of IS NOT NULL;
  CREATE TRIGGER trg_payments_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT, 'payments are append-only: add a reversal instead'); END;
  CREATE TRIGGER trg_payments_no_edit BEFORE UPDATE OF deal_id, person_id, kind, amount, paid_at, method, reversal_of, commission_share_id ON payments BEGIN SELECT RAISE(ABORT, 'payments are append-only: add a reversal instead'); END;

  CREATE TABLE expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL CHECK (category IN ('office','marketing','travel','other')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    spent_at INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    method TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','bank_transfer','cheque','other')),
    receipt_file TEXT NOT NULL DEFAULT '',
    reversal_of INTEGER REFERENCES expenses(id) ON DELETE RESTRICT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_expenses_when ON expenses(spent_at);
  CREATE TRIGGER trg_expenses_no_delete BEFORE DELETE ON expenses BEGIN SELECT RAISE(ABORT, 'expenses are append-only: add a reversal instead'); END;
  CREATE TRIGGER trg_expenses_no_edit BEFORE UPDATE OF category, amount, spent_at, reversal_of ON expenses BEGIN SELECT RAISE(ABORT, 'expenses are append-only: add a reversal instead'); END;

  CREATE TABLE dealer_collaborations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
    listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
    deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','negotiating','accepted','active','completed','cancelled','rejected')),
    agreement_date TEXT NOT NULL DEFAULT '',
    terms TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX idx_collab_status ON dealer_collaborations(status);

  CREATE TABLE collaboration_participants (
    collaboration_id INTEGER NOT NULL REFERENCES dealer_collaborations(id) ON DELETE CASCADE,
    dealer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (role IN ('listing_owner','buyer_introducer','other')),
    share_type TEXT NOT NULL DEFAULT 'percent' CHECK (share_type IN ('percent','fixed')),
    share_value REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (collaboration_id, dealer_id, role)
  );

  CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('cnic','ownership','allotment','transfer','property_file','agreement','bayana','receipt','commission_agreement','other')),
    title TEXT NOT NULL,
    file TEXT NOT NULL, mime TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0,
    property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
    person_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
    listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
    version_of INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_documents_property ON documents(property_id);
  CREATE INDEX idx_documents_person ON documents(person_id);
  CREATE INDEX idx_documents_deal ON documents(deal_id);

  CREATE TABLE saved_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'properties',
    filters TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
  );
  CREATE TABLE favorites (property_id INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE, created_at INTEGER NOT NULL);
  CREATE TABLE viewed_properties (property_id INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE, viewed_at INTEGER NOT NULL);
`;
