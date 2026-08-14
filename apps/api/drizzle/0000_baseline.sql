-- The schema, whole.
--
-- One baseline rather than the eighty-one steps that built it. A fresh install
-- creates the tables as they are now instead of replaying every column that was
-- ever added and later dropped, which is both faster and honest: the history of
-- how a schema arrived is git's business, not the installer's.
--
-- Generated with `pg_dump --schema-only` from a database migrated through the
-- full original sequence, so this is the exact schema those steps produced —
-- not a hand-merge of them. The `drizzle` bookkeeping schema is excluded; the
-- migrator creates that itself.
--
-- **Its journal timestamp is deliberately the original 0000's.** Drizzle decides
-- what to run by comparing the journal's `when` against the newest applied row
-- and nothing else, so a database that already ran the old sequence sees a
-- baseline older than its last migration and skips it, untouched. Only a fresh
-- database, with no rows to compare against, runs this.
--
-- Adding a column from here on is a new migration in the ordinary way; leave
-- this file alone.

--
-- PostgreSQL database dump
--

-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id text NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    user_id text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: asset_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tracks_downtime boolean DEFAULT true NOT NULL
);

--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    parent_id uuid,
    type_id uuid,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    location_id uuid
);

--
-- Name: attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    filename text NOT NULL,
    content_type text NOT NULL,
    size integer NOT NULL,
    backend text NOT NULL,
    key text NOT NULL,
    checksum text NOT NULL,
    uploaded_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action text NOT NULL,
    actor_id text,
    company_id uuid,
    ip text,
    request_id text,
    details jsonb,
    before jsonb,
    after jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    storage_key text NOT NULL,
    size_bytes bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    error text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id uuid NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    description text
);

--
-- Name: channel_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    channel text NOT NULL,
    destination text NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    author_id text NOT NULL,
    body text NOT NULL,
    parent_id uuid,
    edited_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL
);

--
-- Name: consumables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    name text NOT NULL,
    unit text DEFAULT 'ea'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: department_user_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.department_user_locations (
    department_id uuid NOT NULL,
    user_id text NOT NULL,
    location_id uuid NOT NULL
);

--
-- Name: department_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.department_users (
    department_id uuid NOT NULL,
    user_id text NOT NULL,
    rank text DEFAULT 'member'::text NOT NULL,
    reports_to_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    parent_id uuid,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: designations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.designations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: device_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tracks_downtime boolean DEFAULT false NOT NULL
);

--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    name text NOT NULL,
    identifier text,
    asset_id uuid,
    department_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    location_id uuid,
    asset_tag text,
    type_id uuid
);

--
-- Name: downtime_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.downtime_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    report_id uuid NOT NULL,
    target_kind text NOT NULL,
    target_id text NOT NULL,
    reason text,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: entity_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    field text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    actor_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: group_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_roles (
    group_id uuid NOT NULL,
    role_id uuid NOT NULL
);

--
-- Name: group_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_users (
    group_id uuid NOT NULL,
    user_id text NOT NULL
);

--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entries (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT reports_id_not_null NOT NULL,
    company_id uuid CONSTRAINT reports_company_id_not_null NOT NULL,
    author_id text CONSTRAINT reports_author_id_not_null NOT NULL,
    kind text CONSTRAINT reports_kind_not_null NOT NULL,
    state text DEFAULT 'draft'::text CONSTRAINT reports_state_not_null NOT NULL,
    title text CONSTRAINT reports_title_not_null NOT NULL,
    category_id uuid,
    department_id uuid,
    severity_id uuid,
    status_id uuid,
    report_date timestamp with time zone DEFAULT now() CONSTRAINT reports_report_date_not_null NOT NULL,
    occurred_at timestamp with time zone,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    issue_summary text,
    issue_detail text,
    root_cause text,
    preventive_measures text,
    work_summary text,
    work_detail text,
    recurrence_of_id uuid,
    locked_at timestamp with time zone,
    submitted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT reports_created_at_not_null NOT NULL,
    updated_at timestamp with time zone DEFAULT now() CONSTRAINT reports_updated_at_not_null NOT NULL,
    task_id uuid,
    location_id uuid,
    assignee_id text,
    rejected_at timestamp with time zone,
    rejected_by_id text,
    rejection_reason text,
    points_review_needed boolean DEFAULT false NOT NULL
);

--
-- Name: journal_handovers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_handovers (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT report_handovers_id_not_null NOT NULL,
    report_id uuid CONSTRAINT report_handovers_report_id_not_null NOT NULL,
    from_user_id text,
    to_user_id text,
    by_user_id text CONSTRAINT report_handovers_by_user_id_not_null NOT NULL,
    reason text,
    handed_at timestamp with time zone DEFAULT now() CONSTRAINT report_handovers_handed_at_not_null NOT NULL
);

--
-- Name: journal_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_participants (
    report_id uuid CONSTRAINT report_participants_report_id_not_null NOT NULL,
    user_id text CONSTRAINT report_participants_user_id_not_null NOT NULL,
    added_by text CONSTRAINT report_participants_added_by_not_null NOT NULL,
    added_at timestamp with time zone DEFAULT now() CONSTRAINT report_participants_added_at_not_null NOT NULL
);

--
-- Name: journal_score_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_score_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_id uuid NOT NULL,
    subject_user_id text,
    tier text NOT NULL,
    rater_id text,
    old_points real,
    new_points real,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: journal_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_scores (
    report_id uuid CONSTRAINT report_scores_report_id_not_null NOT NULL,
    subject_user_id text CONSTRAINT report_scores_subject_user_id_not_null NOT NULL,
    tier text CONSTRAINT report_scores_tier_not_null NOT NULL,
    rater_id text CONSTRAINT report_scores_rater_id_not_null NOT NULL,
    points real CONSTRAINT report_scores_points_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT report_scores_created_at_not_null NOT NULL,
    updated_at timestamp with time zone DEFAULT now() CONSTRAINT report_scores_updated_at_not_null NOT NULL
);

--
-- Name: journal_status_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_status_events (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT report_status_events_id_not_null NOT NULL,
    report_id uuid CONSTRAINT report_status_events_report_id_not_null NOT NULL,
    from_status_id uuid,
    to_status_id uuid,
    changed_by text CONSTRAINT report_status_events_changed_by_not_null NOT NULL,
    changed_at timestamp with time zone DEFAULT now() CONSTRAINT report_status_events_changed_at_not_null NOT NULL
);

--
-- Name: journal_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_statuses (
    id uuid DEFAULT gen_random_uuid() CONSTRAINT report_statuses_id_not_null NOT NULL,
    name text CONSTRAINT report_statuses_name_not_null NOT NULL,
    "group" text DEFAULT 'open'::text CONSTRAINT report_statuses_group_not_null NOT NULL,
    is_terminal boolean DEFAULT false CONSTRAINT report_statuses_is_terminal_not_null NOT NULL,
    order_index integer DEFAULT 0 CONSTRAINT report_statuses_order_index_not_null NOT NULL,
    status text DEFAULT 'active'::text CONSTRAINT report_statuses_status_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT report_statuses_created_at_not_null NOT NULL,
    updated_at timestamp with time zone DEFAULT now() CONSTRAINT report_statuses_updated_at_not_null NOT NULL
);

--
-- Name: journal_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_targets (
    report_id uuid CONSTRAINT report_targets_report_id_not_null NOT NULL,
    target_kind text CONSTRAINT report_targets_target_kind_not_null NOT NULL,
    target_id text CONSTRAINT report_targets_target_id_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT report_targets_created_at_not_null NOT NULL,
    updated_at timestamp with time zone DEFAULT now() CONSTRAINT report_targets_updated_at_not_null NOT NULL
);

--
-- Name: locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    name text NOT NULL,
    is_remote boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL
);

--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    type text NOT NULL,
    channel text NOT NULL,
    enabled boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: notification_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    type text NOT NULL,
    entity_kind text NOT NULL,
    entity_id text NOT NULL,
    occurrence_key text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    user_id text NOT NULL,
    type text NOT NULL,
    category text NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    link text,
    entity_kind text,
    entity_id text,
    actor_user_id text,
    read_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: part_model_compatibility; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_model_compatibility (
    part_model_id uuid NOT NULL,
    device_type_id uuid NOT NULL
);

--
-- Name: part_model_service_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_model_service_rates (
    part_model_id uuid NOT NULL,
    service_kind_id uuid NOT NULL,
    points real NOT NULL
);

--
-- Name: part_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    cycle_limit integer,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    rated_page_yield integer
);

--
-- Name: part_placements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.part_placements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    part_id uuid NOT NULL,
    device_id uuid NOT NULL,
    installed_at timestamp with time zone DEFAULT now() NOT NULL,
    installed_by text,
    removed_at timestamp with time zone,
    removed_by text,
    outcome text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    meter_start integer,
    meter_end integer,
    pages_printed integer
);

--
-- Name: parts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    part_model_id uuid NOT NULL,
    identifier text NOT NULL,
    status text DEFAULT 'needs_service'::text NOT NULL,
    cycle_count integer DEFAULT 0 NOT NULL,
    location_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: password_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: point_awards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.point_awards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    beneficiary_user_id text NOT NULL,
    report_id uuid,
    kind text NOT NULL,
    depth integer DEFAULT 0 NOT NULL,
    points real NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id uuid NOT NULL,
    earned_on date NOT NULL,
    department_id uuid,
    source text DEFAULT 'journal'::text NOT NULL,
    routine_id uuid,
    service_event_id uuid,
    reverses_award_id uuid
);

--
-- Name: report_view_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_view_groups (
    report_view_id uuid NOT NULL,
    group_id uuid NOT NULL
);

--
-- Name: report_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    name text NOT NULL,
    description text,
    is_system boolean DEFAULT false NOT NULL,
    owner_id text,
    access text DEFAULT 'private'::text NOT NULL,
    definition jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL
);

--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: routine_assignees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routine_assignees (
    routine_id uuid NOT NULL,
    user_id text NOT NULL
);

--
-- Name: routine_completions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routine_completions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    routine_id uuid NOT NULL,
    occurrence_date date NOT NULL,
    user_id text NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    notes text,
    awarded_points real,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: routines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    cadence text NOT NULL,
    anchor_weekday integer,
    anchor_day integer,
    anchor_month_of_quarter integer,
    points real DEFAULT 1 NOT NULL,
    start_date date NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    department_id uuid,
    grace_days integer DEFAULT 3 NOT NULL
);

--
-- Name: schedule_change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_change_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    schedule_id uuid NOT NULL,
    department_id uuid NOT NULL,
    date date,
    subject_user_id text,
    actor_user_id text,
    action text NOT NULL,
    from_label text,
    to_label text,
    swap_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: schedule_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedule_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid NOT NULL,
    date date NOT NULL,
    user_id text NOT NULL,
    shift_id uuid,
    state text DEFAULT 'working'::text NOT NULL,
    planned_shift_id uuid,
    planned_state text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    department_id uuid NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    locked boolean DEFAULT false NOT NULL
);

--
-- Name: service_consumptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_consumptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_event_id uuid NOT NULL,
    consumable_id uuid NOT NULL,
    quantity real NOT NULL
);

--
-- Name: service_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    part_id uuid NOT NULL,
    service_kind_id uuid NOT NULL,
    performed_by text,
    performed_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    points real DEFAULT 0 NOT NULL,
    points_reversed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: service_kind_consumables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_kind_consumables (
    service_kind_id uuid NOT NULL,
    consumable_id uuid NOT NULL,
    min_quantity real DEFAULT 0 NOT NULL,
    max_quantity real
);

--
-- Name: service_kinds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_kinds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    default_points real DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ip_address text,
    user_agent text,
    user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    namespace text NOT NULL,
    key text NOT NULL,
    value jsonb NOT NULL,
    scope text DEFAULT 'system'::text NOT NULL,
    user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id uuid
);

--
-- Name: severities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.severities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: shift_swap_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shift_swap_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    department_id uuid NOT NULL,
    schedule_id uuid NOT NULL,
    date date NOT NULL,
    requester_user_id text NOT NULL,
    requester_entry_id uuid,
    counterpart_user_id text,
    counterpart_entry_id uuid,
    note text,
    status text DEFAULT 'pending'::text NOT NULL,
    approver_user_id text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    name text NOT NULL,
    start_minute integer NOT NULL,
    end_minute integer NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    code text NOT NULL,
    color text DEFAULT 'slate'::text NOT NULL
);

--
-- Name: taggables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.taggables (
    tag_id uuid NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    department_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    color text DEFAULT '#64748b'::text NOT NULL
);

--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    title text NOT NULL,
    detail text,
    assignee_id text NOT NULL,
    assigner_id text,
    department_id uuid,
    due_at timestamp with time zone,
    priority text DEFAULT 'normal'::text NOT NULL,
    state text DEFAULT 'open'::text NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: two_factors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.two_factors (
    id text NOT NULL,
    secret text NOT NULL,
    backup_codes text NOT NULL,
    user_id text NOT NULL,
    verified boolean DEFAULT true NOT NULL,
    failed_verification_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone
);

--
-- Name: user_avatars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_avatars (
    user_id text NOT NULL,
    content_type text NOT NULL,
    bytes bytea NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: user_companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_companies (
    user_id text NOT NULL,
    company_id uuid NOT NULL
);

--
-- Name: user_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_locations (
    user_id text NOT NULL,
    location_id uuid NOT NULL
);

--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    image text,
    avatar_url text,
    status text DEFAULT 'active'::text NOT NULL,
    two_factor_enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    employee_id text,
    username text NOT NULL,
    display_username text,
    mobile text,
    whatsapp_on_mobile boolean DEFAULT false NOT NULL,
    telegram_on_mobile boolean DEFAULT false NOT NULL,
    discord_handle text,
    mobile_verified_at timestamp with time zone,
    whatsapp_verified_at timestamp with time zone,
    telegram_verified_at timestamp with time zone,
    discord_verified_at timestamp with time zone,
    must_change_password boolean DEFAULT false NOT NULL,
    designation_id uuid,
    counts_on_leaderboard boolean DEFAULT true NOT NULL
);

--
-- Name: verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verifications (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);

--
-- Name: asset_types asset_types_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_types
    ADD CONSTRAINT asset_types_name_unique UNIQUE (name);

--
-- Name: asset_types asset_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_types
    ADD CONSTRAINT asset_types_pkey PRIMARY KEY (id);

--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);

--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);

--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);

--
-- Name: backups backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backups
    ADD CONSTRAINT backups_pkey PRIMARY KEY (id);

--
-- Name: categories categories_department_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_department_name_unique UNIQUE (department_id, name);

--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);

--
-- Name: channel_verifications channel_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_verifications
    ADD CONSTRAINT channel_verifications_pkey PRIMARY KEY (id);

--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);

--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);

--
-- Name: consumables consumables_company_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumables
    ADD CONSTRAINT consumables_company_name_unique UNIQUE (company_id, name);

--
-- Name: consumables consumables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumables
    ADD CONSTRAINT consumables_pkey PRIMARY KEY (id);

--
-- Name: department_user_locations department_user_locations_department_id_user_id_location_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_user_locations
    ADD CONSTRAINT department_user_locations_department_id_user_id_location_id_pk PRIMARY KEY (department_id, user_id, location_id);

--
-- Name: department_users department_users_department_id_user_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_users
    ADD CONSTRAINT department_users_department_id_user_id_pk PRIMARY KEY (department_id, user_id);

--
-- Name: departments departments_company_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_company_name_unique UNIQUE (company_id, name);

--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);

--
-- Name: designations designations_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.designations
    ADD CONSTRAINT designations_name_unique UNIQUE (name);

--
-- Name: designations designations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.designations
    ADD CONSTRAINT designations_pkey PRIMARY KEY (id);

--
-- Name: device_types device_types_department_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_types
    ADD CONSTRAINT device_types_department_name_unique UNIQUE (department_id, name);

--
-- Name: device_types device_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_types
    ADD CONSTRAINT device_types_pkey PRIMARY KEY (id);

--
-- Name: devices devices_company_asset_tag_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_company_asset_tag_unique UNIQUE (company_id, asset_tag);

--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);

--
-- Name: downtime_entries downtime_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.downtime_entries
    ADD CONSTRAINT downtime_entries_pkey PRIMARY KEY (id);

--
-- Name: entity_history entity_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_history
    ADD CONSTRAINT entity_history_pkey PRIMARY KEY (id);

--
-- Name: group_roles group_roles_group_id_role_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_roles
    ADD CONSTRAINT group_roles_group_id_role_id_pk PRIMARY KEY (group_id, role_id);

--
-- Name: group_users group_users_group_id_user_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_users
    ADD CONSTRAINT group_users_group_id_user_id_pk PRIMARY KEY (group_id, user_id);

--
-- Name: groups groups_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_name_unique UNIQUE (name);

--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);

--
-- Name: journal_score_events journal_score_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_score_events
    ADD CONSTRAINT journal_score_events_pkey PRIMARY KEY (id);

--
-- Name: locations locations_company_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_company_name_unique UNIQUE (company_id, name);

--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);

--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);

--
-- Name: notification_preferences notification_preferences_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_unique UNIQUE (user_id, type, channel);

--
-- Name: notification_reminders notification_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reminders
    ADD CONSTRAINT notification_reminders_pkey PRIMARY KEY (id);

--
-- Name: notification_reminders notification_reminders_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reminders
    ADD CONSTRAINT notification_reminders_unique UNIQUE (user_id, type, entity_id, occurrence_key);

--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

--
-- Name: part_model_compatibility part_model_compatibility_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_model_compatibility
    ADD CONSTRAINT part_model_compatibility_pkey PRIMARY KEY (part_model_id, device_type_id);

--
-- Name: part_model_service_rates part_model_service_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_model_service_rates
    ADD CONSTRAINT part_model_service_rates_pkey PRIMARY KEY (part_model_id, service_kind_id);

--
-- Name: part_models part_models_company_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_models
    ADD CONSTRAINT part_models_company_name_unique UNIQUE (company_id, name);

--
-- Name: part_models part_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_models
    ADD CONSTRAINT part_models_pkey PRIMARY KEY (id);

--
-- Name: part_placements part_placements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_placements
    ADD CONSTRAINT part_placements_pkey PRIMARY KEY (id);

--
-- Name: parts parts_company_identifier_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_company_identifier_unique UNIQUE (company_id, identifier);

--
-- Name: parts parts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_pkey PRIMARY KEY (id);

--
-- Name: password_history password_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_history
    ADD CONSTRAINT password_history_pkey PRIMARY KEY (id);

--
-- Name: permissions permissions_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_key_unique UNIQUE (key);

--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);

--
-- Name: point_awards point_awards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.point_awards
    ADD CONSTRAINT point_awards_pkey PRIMARY KEY (id);

--
-- Name: journal_handovers report_handovers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_handovers
    ADD CONSTRAINT report_handovers_pkey PRIMARY KEY (id);

--
-- Name: journal_participants report_participants_report_id_user_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_participants
    ADD CONSTRAINT report_participants_report_id_user_id_pk PRIMARY KEY (report_id, user_id);

--
-- Name: journal_scores report_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_scores
    ADD CONSTRAINT report_scores_pkey PRIMARY KEY (report_id, subject_user_id, tier);

--
-- Name: journal_status_events report_status_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_status_events
    ADD CONSTRAINT report_status_events_pkey PRIMARY KEY (id);

--
-- Name: journal_statuses report_statuses_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_statuses
    ADD CONSTRAINT report_statuses_name_unique UNIQUE (name);

--
-- Name: journal_statuses report_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_statuses
    ADD CONSTRAINT report_statuses_pkey PRIMARY KEY (id);

--
-- Name: journal_targets report_targets_report_id_target_kind_target_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_targets
    ADD CONSTRAINT report_targets_report_id_target_kind_target_id_pk PRIMARY KEY (report_id, target_kind, target_id);

--
-- Name: report_view_groups report_view_groups_report_view_id_group_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_view_groups
    ADD CONSTRAINT report_view_groups_report_view_id_group_id_pk PRIMARY KEY (report_view_id, group_id);

--
-- Name: report_views report_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_views
    ADD CONSTRAINT report_views_pkey PRIMARY KEY (id);

--
-- Name: journal_entries reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);

--
-- Name: role_permissions role_permissions_role_id_permission_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_permission_id_pk PRIMARY KEY (role_id, permission_id);

--
-- Name: roles roles_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_unique UNIQUE (name);

--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);

--
-- Name: routine_assignees routine_assignees_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routine_assignees
    ADD CONSTRAINT routine_assignees_pk PRIMARY KEY (routine_id, user_id);

--
-- Name: routine_completions routine_completions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routine_completions
    ADD CONSTRAINT routine_completions_pkey PRIMARY KEY (id);

--
-- Name: routine_completions routine_completions_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routine_completions
    ADD CONSTRAINT routine_completions_unique UNIQUE (routine_id, occurrence_date, user_id);

--
-- Name: routines routines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routines
    ADD CONSTRAINT routines_pkey PRIMARY KEY (id);

--
-- Name: schedule_change_log schedule_change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_change_log
    ADD CONSTRAINT schedule_change_log_pkey PRIMARY KEY (id);

--
-- Name: schedule_entries schedule_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_entries
    ADD CONSTRAINT schedule_entries_pkey PRIMARY KEY (id);

--
-- Name: schedules schedules_dept_month_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_dept_month_unique UNIQUE (department_id, year, month);

--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (id);

--
-- Name: service_consumptions service_consumptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_consumptions
    ADD CONSTRAINT service_consumptions_pkey PRIMARY KEY (id);

--
-- Name: service_events service_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_events
    ADD CONSTRAINT service_events_pkey PRIMARY KEY (id);

--
-- Name: service_kind_consumables service_kind_consumables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_kind_consumables
    ADD CONSTRAINT service_kind_consumables_pkey PRIMARY KEY (service_kind_id, consumable_id);

--
-- Name: service_kinds service_kinds_company_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_kinds
    ADD CONSTRAINT service_kinds_company_name_unique UNIQUE (company_id, name);

--
-- Name: service_kinds service_kinds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_kinds
    ADD CONSTRAINT service_kinds_pkey PRIMARY KEY (id);

--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

--
-- Name: sessions sessions_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_unique UNIQUE (token);

--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);

--
-- Name: settings settings_scope_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_scope_key_unique UNIQUE (namespace, key, scope, user_id, company_id);

--
-- Name: severities severities_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.severities
    ADD CONSTRAINT severities_name_unique UNIQUE (name);

--
-- Name: severities severities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.severities
    ADD CONSTRAINT severities_pkey PRIMARY KEY (id);

--
-- Name: shift_swap_requests shift_swap_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swap_requests
    ADD CONSTRAINT shift_swap_requests_pkey PRIMARY KEY (id);

--
-- Name: shifts shifts_company_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_company_name_unique UNIQUE (company_id, name);

--
-- Name: shifts shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_pkey PRIMARY KEY (id);

--
-- Name: taggables taggables_tag_id_owner_type_owner_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taggables
    ADD CONSTRAINT taggables_tag_id_owner_type_owner_id_pk PRIMARY KEY (tag_id, owner_type, owner_id);

--
-- Name: tags tags_department_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_department_name_unique UNIQUE (department_id, name);

--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);

--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);

--
-- Name: two_factors two_factors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.two_factors
    ADD CONSTRAINT two_factors_pkey PRIMARY KEY (id);

--
-- Name: user_avatars user_avatars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_avatars
    ADD CONSTRAINT user_avatars_pkey PRIMARY KEY (user_id);

--
-- Name: user_companies user_companies_user_id_company_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_companies
    ADD CONSTRAINT user_companies_user_id_company_id_pk PRIMARY KEY (user_id, company_id);

--
-- Name: user_locations user_locations_user_id_location_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_locations
    ADD CONSTRAINT user_locations_user_id_location_id_pk PRIMARY KEY (user_id, location_id);

--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);

--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

--
-- Name: users users_username_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_unique UNIQUE (username);

--
-- Name: verifications verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verifications
    ADD CONSTRAINT verifications_pkey PRIMARY KEY (id);

--
-- Name: assets_company_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assets_company_parent_idx ON public.assets USING btree (company_id, parent_id);

--
-- Name: assets_location_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX assets_location_idx ON public.assets USING btree (location_id);

--
-- Name: attachments_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attachments_company_idx ON public.attachments USING btree (company_id);

--
-- Name: attachments_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attachments_owner_idx ON public.attachments USING btree (owner_type, owner_id);

--
-- Name: backups_kind_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX backups_kind_created_idx ON public.backups USING btree (kind, created_at);

--
-- Name: channel_verifications_user_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX channel_verifications_user_channel_idx ON public.channel_verifications USING btree (user_id, channel, created_at);

--
-- Name: comments_author_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comments_author_idx ON public.comments USING btree (author_id);

--
-- Name: comments_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comments_owner_idx ON public.comments USING btree (owner_type, owner_id, created_at);

--
-- Name: department_users_reports_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX department_users_reports_to_idx ON public.department_users USING btree (reports_to_id);

--
-- Name: department_users_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX department_users_user_idx ON public.department_users USING btree (user_id);

--
-- Name: departments_company_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX departments_company_parent_idx ON public.departments USING btree (company_id, parent_id);

--
-- Name: devices_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX devices_company_idx ON public.devices USING btree (company_id);

--
-- Name: devices_location_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX devices_location_idx ON public.devices USING btree (location_id);

--
-- Name: downtime_company_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX downtime_company_target_idx ON public.downtime_entries USING btree (company_id, target_kind, target_id);

--
-- Name: downtime_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX downtime_report_idx ON public.downtime_entries USING btree (report_id);

--
-- Name: journal_score_events_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX journal_score_events_report_idx ON public.journal_score_events USING btree (report_id);

--
-- Name: notification_preferences_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_preferences_user_idx ON public.notification_preferences USING btree (user_id);

--
-- Name: notification_reminders_sent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_reminders_sent_idx ON public.notification_reminders USING btree (sent_at);

--
-- Name: notifications_inbox_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_inbox_idx ON public.notifications USING btree (user_id, company_id, created_at);

--
-- Name: notifications_system_inbox_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_system_inbox_idx ON public.notifications USING btree (user_id, created_at) WHERE (company_id IS NULL);

--
-- Name: notifications_system_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_system_unread_idx ON public.notifications USING btree (user_id, read_at) WHERE (company_id IS NULL);

--
-- Name: notifications_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_unread_idx ON public.notifications USING btree (user_id, company_id, read_at);

--
-- Name: part_placements_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX part_placements_device_idx ON public.part_placements USING btree (device_id);

--
-- Name: part_placements_part_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX part_placements_part_idx ON public.part_placements USING btree (part_id, installed_at);

--
-- Name: parts_company_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX parts_company_status_idx ON public.parts USING btree (company_id, status);

--
-- Name: password_history_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX password_history_user_created_idx ON public.password_history USING btree (user_id, created_at);

--
-- Name: point_awards_beneficiary_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX point_awards_beneficiary_idx ON public.point_awards USING btree (beneficiary_user_id);

--
-- Name: point_awards_company_earned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX point_awards_company_earned_idx ON public.point_awards USING btree (company_id, earned_on);

--
-- Name: point_awards_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX point_awards_report_idx ON public.point_awards USING btree (report_id);

--
-- Name: point_awards_service_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX point_awards_service_idx ON public.point_awards USING btree (service_event_id) WHERE (service_event_id IS NOT NULL);

--
-- Name: report_handovers_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_handovers_report_idx ON public.journal_handovers USING btree (report_id, handed_at);

--
-- Name: report_scores_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_scores_report_idx ON public.journal_scores USING btree (report_id);

--
-- Name: report_scores_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_scores_subject_idx ON public.journal_scores USING btree (subject_user_id);

--
-- Name: report_status_events_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_status_events_report_idx ON public.journal_status_events USING btree (report_id, changed_at);

--
-- Name: report_targets_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_targets_target_idx ON public.journal_targets USING btree (target_kind, target_id);

--
-- Name: report_views_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX report_views_company_idx ON public.report_views USING btree (company_id);

--
-- Name: reports_author_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_author_state_idx ON public.journal_entries USING btree (author_id, state);

--
-- Name: reports_company_author_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_company_author_idx ON public.journal_entries USING btree (company_id, author_id);

--
-- Name: reports_location_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_location_idx ON public.journal_entries USING btree (location_id);

--
-- Name: routine_assignees_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routine_assignees_user_idx ON public.routine_assignees USING btree (user_id);

--
-- Name: routine_completions_routine_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routine_completions_routine_date_idx ON public.routine_completions USING btree (routine_id, occurrence_date);

--
-- Name: routine_completions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routine_completions_user_idx ON public.routine_completions USING btree (user_id);

--
-- Name: routines_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX routines_company_idx ON public.routines USING btree (company_id);

--
-- Name: schedule_change_log_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schedule_change_log_created_idx ON public.schedule_change_log USING btree (created_at);

--
-- Name: schedule_change_log_schedule_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schedule_change_log_schedule_date_idx ON public.schedule_change_log USING btree (schedule_id, date);

--
-- Name: schedule_entries_schedule_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schedule_entries_schedule_date_idx ON public.schedule_entries USING btree (schedule_id, date);

--
-- Name: schedule_entries_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX schedule_entries_user_idx ON public.schedule_entries USING btree (user_id);

--
-- Name: service_consumptions_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_consumptions_event_idx ON public.service_consumptions USING btree (service_event_id);

--
-- Name: service_events_part_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_events_part_idx ON public.service_events USING btree (part_id, performed_at);

--
-- Name: settings_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX settings_company_idx ON public.settings USING btree (namespace, key, company_id) WHERE (company_id IS NOT NULL);

--
-- Name: shift_swaps_requester_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shift_swaps_requester_idx ON public.shift_swap_requests USING btree (requester_user_id);

--
-- Name: shift_swaps_schedule_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shift_swaps_schedule_idx ON public.shift_swap_requests USING btree (schedule_id);

--
-- Name: shift_swaps_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shift_swaps_status_idx ON public.shift_swap_requests USING btree (status);

--
-- Name: taggables_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX taggables_owner_idx ON public.taggables USING btree (owner_type, owner_id);

--
-- Name: tasks_assignee_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_assignee_state_idx ON public.tasks USING btree (assignee_id, state);

--
-- Name: tasks_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_company_idx ON public.tasks USING btree (company_id);

--
-- Name: accounts accounts_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: assets assets_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: assets assets_location_id_locations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_location_id_locations_id_fk FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;

--
-- Name: assets assets_parent_id_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_parent_id_assets_id_fk FOREIGN KEY (parent_id) REFERENCES public.assets(id) ON DELETE SET NULL;

--
-- Name: assets assets_type_id_asset_types_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_type_id_asset_types_id_fk FOREIGN KEY (type_id) REFERENCES public.asset_types(id) ON DELETE SET NULL;

--
-- Name: attachments attachments_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: attachments attachments_uploaded_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_uploaded_by_users_id_fk FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: backups backups_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backups
    ADD CONSTRAINT backups_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: categories categories_department_id_departments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_department_id_departments_id_fk FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;

--
-- Name: channel_verifications channel_verifications_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_verifications
    ADD CONSTRAINT channel_verifications_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: comments comments_author_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_author_id_users_id_fk FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: comments comments_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: comments comments_parent_id_comments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_parent_id_comments_id_fk FOREIGN KEY (parent_id) REFERENCES public.comments(id) ON DELETE CASCADE;

--
-- Name: consumables consumables_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumables
    ADD CONSTRAINT consumables_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: department_user_locations department_user_locations_location_id_locations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_user_locations
    ADD CONSTRAINT department_user_locations_location_id_locations_id_fk FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;

--
-- Name: department_user_locations department_user_locations_membership_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_user_locations
    ADD CONSTRAINT department_user_locations_membership_fk FOREIGN KEY (department_id, user_id) REFERENCES public.department_users(department_id, user_id) ON DELETE CASCADE;

--
-- Name: department_users department_users_department_id_departments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_users
    ADD CONSTRAINT department_users_department_id_departments_id_fk FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;

--
-- Name: department_users department_users_reports_to_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_users
    ADD CONSTRAINT department_users_reports_to_id_users_id_fk FOREIGN KEY (reports_to_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: department_users department_users_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_users
    ADD CONSTRAINT department_users_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: departments departments_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: departments departments_parent_id_departments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_parent_id_departments_id_fk FOREIGN KEY (parent_id) REFERENCES public.departments(id) ON DELETE SET NULL;

--
-- Name: device_types device_types_department_id_departments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_types
    ADD CONSTRAINT device_types_department_id_departments_id_fk FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;

--
-- Name: devices devices_asset_id_assets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_asset_id_assets_id_fk FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;

--
-- Name: devices devices_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: devices devices_department_id_departments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_department_id_departments_id_fk FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;

--
-- Name: devices devices_location_id_locations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_location_id_locations_id_fk FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;

--
-- Name: devices devices_type_id_device_types_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_type_id_device_types_id_fk FOREIGN KEY (type_id) REFERENCES public.device_types(id) ON DELETE SET NULL;

--
-- Name: downtime_entries downtime_entries_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.downtime_entries
    ADD CONSTRAINT downtime_entries_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: downtime_entries downtime_entries_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.downtime_entries
    ADD CONSTRAINT downtime_entries_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: downtime_entries downtime_entries_report_id_reports_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.downtime_entries
    ADD CONSTRAINT downtime_entries_report_id_reports_id_fk FOREIGN KEY (report_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;

--
-- Name: group_roles group_roles_group_id_groups_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_roles
    ADD CONSTRAINT group_roles_group_id_groups_id_fk FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

--
-- Name: group_roles group_roles_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_roles
    ADD CONSTRAINT group_roles_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;

--
-- Name: group_users group_users_group_id_groups_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_users
    ADD CONSTRAINT group_users_group_id_groups_id_fk FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

--
-- Name: group_users group_users_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_users
    ADD CONSTRAINT group_users_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: journal_entries journal_entries_rejected_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_rejected_by_id_fkey FOREIGN KEY (rejected_by_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: journal_score_events journal_score_events_rater_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_score_events
    ADD CONSTRAINT journal_score_events_rater_id_fkey FOREIGN KEY (rater_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: journal_score_events journal_score_events_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_score_events
    ADD CONSTRAINT journal_score_events_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;

--
-- Name: journal_score_events journal_score_events_subject_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_score_events
    ADD CONSTRAINT journal_score_events_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: locations locations_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: notification_reminders notification_reminders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_reminders
    ADD CONSTRAINT notification_reminders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: notifications notifications_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: notifications notifications_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: part_model_compatibility part_model_compatibility_device_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_model_compatibility
    ADD CONSTRAINT part_model_compatibility_device_type_id_fkey FOREIGN KEY (device_type_id) REFERENCES public.device_types(id) ON DELETE CASCADE;

--
-- Name: part_model_compatibility part_model_compatibility_part_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_model_compatibility
    ADD CONSTRAINT part_model_compatibility_part_model_id_fkey FOREIGN KEY (part_model_id) REFERENCES public.part_models(id) ON DELETE CASCADE;

--
-- Name: part_model_service_rates part_model_service_rates_part_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_model_service_rates
    ADD CONSTRAINT part_model_service_rates_part_model_id_fkey FOREIGN KEY (part_model_id) REFERENCES public.part_models(id) ON DELETE CASCADE;

--
-- Name: part_model_service_rates part_model_service_rates_service_kind_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_model_service_rates
    ADD CONSTRAINT part_model_service_rates_service_kind_id_fkey FOREIGN KEY (service_kind_id) REFERENCES public.service_kinds(id) ON DELETE CASCADE;

--
-- Name: part_models part_models_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_models
    ADD CONSTRAINT part_models_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: part_placements part_placements_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_placements
    ADD CONSTRAINT part_placements_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: part_placements part_placements_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_placements
    ADD CONSTRAINT part_placements_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;

--
-- Name: part_placements part_placements_installed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_placements
    ADD CONSTRAINT part_placements_installed_by_fkey FOREIGN KEY (installed_by) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: part_placements part_placements_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_placements
    ADD CONSTRAINT part_placements_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(id) ON DELETE CASCADE;

--
-- Name: part_placements part_placements_removed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.part_placements
    ADD CONSTRAINT part_placements_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: parts parts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: parts parts_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;

--
-- Name: parts parts_part_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parts
    ADD CONSTRAINT parts_part_model_id_fkey FOREIGN KEY (part_model_id) REFERENCES public.part_models(id) ON DELETE RESTRICT;

--
-- Name: password_history password_history_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_history
    ADD CONSTRAINT password_history_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: point_awards point_awards_beneficiary_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.point_awards
    ADD CONSTRAINT point_awards_beneficiary_user_id_users_id_fk FOREIGN KEY (beneficiary_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: point_awards point_awards_company_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.point_awards
    ADD CONSTRAINT point_awards_company_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: point_awards point_awards_department_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.point_awards
    ADD CONSTRAINT point_awards_department_id_fk FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;

--
-- Name: point_awards point_awards_report_id_reports_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.point_awards
    ADD CONSTRAINT point_awards_report_id_reports_id_fk FOREIGN KEY (report_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;

--
-- Name: journal_handovers report_handovers_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_handovers
    ADD CONSTRAINT report_handovers_by_user_id_users_id_fk FOREIGN KEY (by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: journal_handovers report_handovers_from_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_handovers
    ADD CONSTRAINT report_handovers_from_user_id_users_id_fk FOREIGN KEY (from_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: journal_handovers report_handovers_report_id_reports_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_handovers
    ADD CONSTRAINT report_handovers_report_id_reports_id_fk FOREIGN KEY (report_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;

--
-- Name: journal_handovers report_handovers_to_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_handovers
    ADD CONSTRAINT report_handovers_to_user_id_users_id_fk FOREIGN KEY (to_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: journal_participants report_participants_added_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_participants
    ADD CONSTRAINT report_participants_added_by_users_id_fk FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: journal_participants report_participants_report_id_reports_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_participants
    ADD CONSTRAINT report_participants_report_id_reports_id_fk FOREIGN KEY (report_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;

--
-- Name: journal_participants report_participants_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_participants
    ADD CONSTRAINT report_participants_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: journal_scores report_scores_rater_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_scores
    ADD CONSTRAINT report_scores_rater_id_fkey FOREIGN KEY (rater_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: journal_scores report_scores_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_scores
    ADD CONSTRAINT report_scores_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;

--
-- Name: journal_scores report_scores_subject_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_scores
    ADD CONSTRAINT report_scores_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: journal_status_events report_status_events_changed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_status_events
    ADD CONSTRAINT report_status_events_changed_by_users_id_fk FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: journal_status_events report_status_events_from_status_id_report_statuses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_status_events
    ADD CONSTRAINT report_status_events_from_status_id_report_statuses_id_fk FOREIGN KEY (from_status_id) REFERENCES public.journal_statuses(id) ON DELETE SET NULL;

--
-- Name: journal_status_events report_status_events_report_id_reports_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_status_events
    ADD CONSTRAINT report_status_events_report_id_reports_id_fk FOREIGN KEY (report_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;

--
-- Name: journal_status_events report_status_events_to_status_id_report_statuses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_status_events
    ADD CONSTRAINT report_status_events_to_status_id_report_statuses_id_fk FOREIGN KEY (to_status_id) REFERENCES public.journal_statuses(id) ON DELETE SET NULL;

--
-- Name: journal_targets report_targets_report_id_reports_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_targets
    ADD CONSTRAINT report_targets_report_id_reports_id_fk FOREIGN KEY (report_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;

--
-- Name: report_view_groups report_view_groups_group_id_groups_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_view_groups
    ADD CONSTRAINT report_view_groups_group_id_groups_id_fk FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;

--
-- Name: report_view_groups report_view_groups_report_view_id_report_views_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_view_groups
    ADD CONSTRAINT report_view_groups_report_view_id_report_views_id_fk FOREIGN KEY (report_view_id) REFERENCES public.report_views(id) ON DELETE CASCADE;

--
-- Name: report_views report_views_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_views
    ADD CONSTRAINT report_views_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: report_views report_views_owner_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_views
    ADD CONSTRAINT report_views_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: journal_entries reports_assignee_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT reports_assignee_id_users_id_fk FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: journal_entries reports_author_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT reports_author_id_users_id_fk FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: journal_entries reports_category_id_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT reports_category_id_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;

--
-- Name: journal_entries reports_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT reports_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: journal_entries reports_department_id_departments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT reports_department_id_departments_id_fk FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;

--
-- Name: journal_entries reports_location_id_locations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT reports_location_id_locations_id_fk FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;

--
-- Name: journal_entries reports_recurrence_of_id_reports_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT reports_recurrence_of_id_reports_id_fk FOREIGN KEY (recurrence_of_id) REFERENCES public.journal_entries(id) ON DELETE SET NULL;

--
-- Name: journal_entries reports_severity_id_severities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT reports_severity_id_severities_id_fk FOREIGN KEY (severity_id) REFERENCES public.severities(id) ON DELETE SET NULL;

--
-- Name: journal_entries reports_status_id_report_statuses_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT reports_status_id_report_statuses_id_fk FOREIGN KEY (status_id) REFERENCES public.journal_statuses(id) ON DELETE SET NULL;

--
-- Name: journal_entries reports_task_id_tasks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT reports_task_id_tasks_id_fk FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;

--
-- Name: role_permissions role_permissions_permission_id_permissions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_permissions_id_fk FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;

--
-- Name: role_permissions role_permissions_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;

--
-- Name: routine_assignees routine_assignees_routine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routine_assignees
    ADD CONSTRAINT routine_assignees_routine_id_fkey FOREIGN KEY (routine_id) REFERENCES public.routines(id) ON DELETE CASCADE;

--
-- Name: routine_assignees routine_assignees_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routine_assignees
    ADD CONSTRAINT routine_assignees_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: routine_completions routine_completions_routine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routine_completions
    ADD CONSTRAINT routine_completions_routine_id_fkey FOREIGN KEY (routine_id) REFERENCES public.routines(id) ON DELETE CASCADE;

--
-- Name: routine_completions routine_completions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routine_completions
    ADD CONSTRAINT routine_completions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: routines routines_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routines
    ADD CONSTRAINT routines_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: routines routines_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routines
    ADD CONSTRAINT routines_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: routines routines_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routines
    ADD CONSTRAINT routines_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;

--
-- Name: schedule_change_log schedule_change_log_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_change_log
    ADD CONSTRAINT schedule_change_log_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: schedule_change_log schedule_change_log_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_change_log
    ADD CONSTRAINT schedule_change_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: schedule_change_log schedule_change_log_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_change_log
    ADD CONSTRAINT schedule_change_log_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;

--
-- Name: schedule_change_log schedule_change_log_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_change_log
    ADD CONSTRAINT schedule_change_log_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE;

--
-- Name: schedule_change_log schedule_change_log_subject_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_change_log
    ADD CONSTRAINT schedule_change_log_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: schedule_change_log schedule_change_log_swap_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_change_log
    ADD CONSTRAINT schedule_change_log_swap_id_fkey FOREIGN KEY (swap_id) REFERENCES public.shift_swap_requests(id) ON DELETE SET NULL;

--
-- Name: schedule_entries schedule_entries_planned_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_entries
    ADD CONSTRAINT schedule_entries_planned_shift_id_fkey FOREIGN KEY (planned_shift_id) REFERENCES public.shifts(id) ON DELETE SET NULL;

--
-- Name: schedule_entries schedule_entries_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_entries
    ADD CONSTRAINT schedule_entries_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE;

--
-- Name: schedule_entries schedule_entries_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_entries
    ADD CONSTRAINT schedule_entries_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id) ON DELETE SET NULL;

--
-- Name: schedule_entries schedule_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedule_entries
    ADD CONSTRAINT schedule_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: schedules schedules_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: schedules schedules_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schedules
    ADD CONSTRAINT schedules_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;

--
-- Name: service_consumptions service_consumptions_consumable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_consumptions
    ADD CONSTRAINT service_consumptions_consumable_id_fkey FOREIGN KEY (consumable_id) REFERENCES public.consumables(id) ON DELETE RESTRICT;

--
-- Name: service_consumptions service_consumptions_service_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_consumptions
    ADD CONSTRAINT service_consumptions_service_event_id_fkey FOREIGN KEY (service_event_id) REFERENCES public.service_events(id) ON DELETE CASCADE;

--
-- Name: service_events service_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_events
    ADD CONSTRAINT service_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: service_events service_events_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_events
    ADD CONSTRAINT service_events_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(id) ON DELETE CASCADE;

--
-- Name: service_events service_events_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_events
    ADD CONSTRAINT service_events_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: service_events service_events_service_kind_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_events
    ADD CONSTRAINT service_events_service_kind_id_fkey FOREIGN KEY (service_kind_id) REFERENCES public.service_kinds(id) ON DELETE RESTRICT;

--
-- Name: service_kind_consumables service_kind_consumables_consumable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_kind_consumables
    ADD CONSTRAINT service_kind_consumables_consumable_id_fkey FOREIGN KEY (consumable_id) REFERENCES public.consumables(id) ON DELETE CASCADE;

--
-- Name: service_kind_consumables service_kind_consumables_service_kind_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_kind_consumables
    ADD CONSTRAINT service_kind_consumables_service_kind_id_fkey FOREIGN KEY (service_kind_id) REFERENCES public.service_kinds(id) ON DELETE CASCADE;

--
-- Name: service_kinds service_kinds_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_kinds
    ADD CONSTRAINT service_kinds_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: sessions sessions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: settings settings_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: settings settings_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: shift_swap_requests shift_swap_requests_approver_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swap_requests
    ADD CONSTRAINT shift_swap_requests_approver_user_id_fkey FOREIGN KEY (approver_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: shift_swap_requests shift_swap_requests_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swap_requests
    ADD CONSTRAINT shift_swap_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: shift_swap_requests shift_swap_requests_counterpart_entry_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swap_requests
    ADD CONSTRAINT shift_swap_requests_counterpart_entry_id_fk FOREIGN KEY (counterpart_entry_id) REFERENCES public.schedule_entries(id) ON DELETE SET NULL;

--
-- Name: shift_swap_requests shift_swap_requests_counterpart_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swap_requests
    ADD CONSTRAINT shift_swap_requests_counterpart_user_id_fkey FOREIGN KEY (counterpart_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: shift_swap_requests shift_swap_requests_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swap_requests
    ADD CONSTRAINT shift_swap_requests_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;

--
-- Name: shift_swap_requests shift_swap_requests_requester_entry_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swap_requests
    ADD CONSTRAINT shift_swap_requests_requester_entry_id_fk FOREIGN KEY (requester_entry_id) REFERENCES public.schedule_entries(id) ON DELETE SET NULL;

--
-- Name: shift_swap_requests shift_swap_requests_requester_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swap_requests
    ADD CONSTRAINT shift_swap_requests_requester_user_id_fkey FOREIGN KEY (requester_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: shift_swap_requests shift_swap_requests_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shift_swap_requests
    ADD CONSTRAINT shift_swap_requests_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES public.schedules(id) ON DELETE CASCADE;

--
-- Name: shifts shifts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: taggables taggables_tag_id_tags_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.taggables
    ADD CONSTRAINT taggables_tag_id_tags_id_fk FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;

--
-- Name: tags tags_department_id_departments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_department_id_departments_id_fk FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE CASCADE;

--
-- Name: tasks tasks_assignee_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assignee_id_users_id_fk FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: tasks tasks_assigner_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigner_id_users_id_fk FOREIGN KEY (assigner_id) REFERENCES public.users(id) ON DELETE SET NULL;

--
-- Name: tasks tasks_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: tasks tasks_department_id_departments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_department_id_departments_id_fk FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;

--
-- Name: two_factors two_factors_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.two_factors
    ADD CONSTRAINT two_factors_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: user_avatars user_avatars_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_avatars
    ADD CONSTRAINT user_avatars_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: user_companies user_companies_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_companies
    ADD CONSTRAINT user_companies_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;

--
-- Name: user_companies user_companies_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_companies
    ADD CONSTRAINT user_companies_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: user_locations user_locations_location_id_locations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_locations
    ADD CONSTRAINT user_locations_location_id_locations_id_fk FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;

--
-- Name: user_locations user_locations_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_locations
    ADD CONSTRAINT user_locations_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

--
-- Name: users users_designation_id_designations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_designation_id_designations_id_fk FOREIGN KEY (designation_id) REFERENCES public.designations(id) ON DELETE SET NULL;

--
-- PostgreSQL database dump complete
--
