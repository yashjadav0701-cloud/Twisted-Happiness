-- ============================================================================
-- TWISTED HAPPINESS — FINAL WHATSAPP-FIRST CATALOG MIGRATION
-- Version: 2026-08-03
--
-- Run this file once from Supabase SQL Editor after taking a database backup.
-- It preserves existing catalog data, archives obsolete checkout structures,
-- creates the final secure quote/enquiry flow, and applies RLS/storage policies.
-- ============================================================================

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create schema if not exists legacy_archive;
revoke all on schema legacy_archive from public, anon, authenticated;

create table if not exists public.twisted_happiness_schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

-- Stop accidental double execution. The migration is intentionally ordered and
-- data-preserving, but it should still be executed only once per project.
do $$
begin
  if exists (
    select 1
    from public.twisted_happiness_schema_migrations
    where version = '20260803_final_whatsapp_catalog'
  ) then
    raise exception 'Twisted Happiness migration 20260803_final_whatsapp_catalog is already applied.';
  end if;
end;
$$;

-- --------------------------------------------------------------------------
-- Temporary migration helpers
-- --------------------------------------------------------------------------
create or replace function public._th_bool(p_json jsonb, p_key text, p_default boolean)
returns boolean
language plpgsql
immutable
as $$
declare
  v text;
begin
  v := lower(nullif(trim(p_json ->> p_key), ''));
  if v is null then return p_default; end if;
  if v in ('true','t','1','yes','y','on') then return true; end if;
  if v in ('false','f','0','no','n','off') then return false; end if;
  return p_default;
end;
$$;

create or replace function public._th_numeric(p_json jsonb, p_key text, p_default numeric)
returns numeric
language plpgsql
immutable
as $$
begin
  return coalesce(nullif(regexp_replace(p_json ->> p_key, '[^0-9.\-]', '', 'g'), '')::numeric, p_default);
exception when others then
  return p_default;
end;
$$;

create or replace function public._th_integer(p_json jsonb, p_key text, p_default integer)
returns integer
language plpgsql
immutable
as $$
begin
  return coalesce(nullif(regexp_replace(p_json ->> p_key, '[^0-9\-]', '', 'g'), '')::integer, p_default);
exception when others then
  return p_default;
end;
$$;

create or replace function public._th_uuid(p_value jsonb)
returns uuid
language plpgsql
immutable
as $$
begin
  return nullif(trim(p_value #>> '{}'), '')::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public._th_timestamptz(p_json jsonb, p_key text, p_default timestamptz)
returns timestamptz
language plpgsql
immutable
as $$
begin
  return coalesce(nullif(trim(p_json ->> p_key), '')::timestamptz, p_default);
exception when others then
  return p_default;
end;
$$;

create or replace function public._th_json_array(p_value jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_text text;
  v_json jsonb;
begin
  if p_value is null or p_value = 'null'::jsonb then return '[]'::jsonb; end if;
  if jsonb_typeof(p_value) = 'array' then return p_value; end if;
  if jsonb_typeof(p_value) = 'string' then
    v_text := trim(p_value #>> '{}');
    if v_text = '' then return '[]'::jsonb; end if;
    begin
      v_json := v_text::jsonb;
      if jsonb_typeof(v_json) = 'array' then return v_json; end if;
    exception when others then null;
    end;
    return coalesce(
      (select jsonb_agg(trim(value)) from unnest(string_to_array(v_text, ',')) value where trim(value) <> ''),
      '[]'::jsonb
    );
  end if;
  return '[]'::jsonb;
end;
$$;

create or replace function public._th_json_object(p_value jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_text text;
  v_json jsonb;
begin
  if p_value is null or p_value = 'null'::jsonb then return '{}'::jsonb; end if;
  if jsonb_typeof(p_value) = 'object' then return p_value; end if;
  if jsonb_typeof(p_value) = 'string' then
    v_text := trim(p_value #>> '{}');
    begin
      v_json := v_text::jsonb;
      if jsonb_typeof(v_json) = 'object' then return v_json; end if;
    exception when others then null;
    end;
  end if;
  return '{}'::jsonb;
end;
$$;

create or replace function public._th_canvas_size_from_text(p_text text)
returns jsonb
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(p_text, ''));
  m text[];
  w numeric;
  h numeric;
  d numeric;
begin
  if trim(v) = '' then return null; end if;

  if v ~ '(circle|diameter)' then
    m := regexp_match(v, '([0-9]+(?:\.[0-9]+)?)');
    if m is null then return null; end if;
    d := m[1]::numeric;
    return jsonb_build_object(
      'id', 'circle-' || trim(to_char(d, 'FM999990.##')),
      'shape', 'circle',
      'diameter', d,
      'label', trim(to_char(d, 'FM999990.##')) || ' in diameter'
    );
  end if;

  m := regexp_match(v, '([0-9]+(?:\.[0-9]+)?)\s*(?:in|inch|inches|["''])*\s*[x×]\s*([0-9]+(?:\.[0-9]+)?)');
  if m is null then
    m := regexp_match(v, '([0-9]+(?:\.[0-9]+)?)');
    if m is null then return null; end if;
    w := m[1]::numeric;
    h := w;
  else
    w := m[1]::numeric;
    h := m[2]::numeric;
  end if;

  return jsonb_build_object(
    'id', case when w = h then 'square-' else 'rectangle-' end || trim(to_char(w, 'FM999990.##')) || '-' || trim(to_char(h, 'FM999990.##')),
    'shape', case when w = h then 'square' else 'rectangle' end,
    'width', w,
    'height', h,
    'label', trim(to_char(w, 'FM999990.##')) || ' × ' || trim(to_char(h, 'FM999990.##')) || ' in'
  );
end;
$$;

create or replace function public._th_normalise_canvas_sizes(p_value jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_array jsonb := public._th_json_array(p_value);
  v_item jsonb;
  v_size jsonb;
  v_result jsonb := '[]'::jsonb;
begin
  for v_item in select value from jsonb_array_elements(v_array)
  loop
    if jsonb_typeof(v_item) = 'object' then
      v_size := v_item;
    else
      v_size := public._th_canvas_size_from_text(v_item #>> '{}');
    end if;
    if v_size is not null then v_result := v_result || jsonb_build_array(v_size); end if;
  end loop;
  return v_result;
end;
$$;

create or replace function public._th_slug(p_title text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p_title, 'creation')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public._th_archive_table(p_table text)
returns void
language plpgsql
as $$
declare
  v_target text;
  v_suffix integer := 1;
begin
  if to_regclass(format('public.%I', p_table)) is null then return; end if;
  v_target := p_table || '_legacy_20260803';
  while to_regclass(format('legacy_archive.%I', v_target)) is not null loop
    v_suffix := v_suffix + 1;
    v_target := p_table || '_legacy_20260803_' || v_suffix;
  end loop;
  execute format('alter table public.%I set schema legacy_archive', p_table);
  execute format('alter table legacy_archive.%I rename to %I', p_table, v_target);
end;
$$;

-- --------------------------------------------------------------------------
-- Build clean final tables beside the existing production tables
-- --------------------------------------------------------------------------
drop table if exists public.products_final cascade;
create table public.products_final (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null,
  description text not null,
  actual_price numeric(12,2) not null,
  fake_price numeric(12,2) not null,
  mrp_generated_from_price numeric(12,2),
  main_category text not null,
  sub_category text not null,
  images jsonb not null default '[]'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  preparation_days text not null default '2-3 Days',
  care_instructions text,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_final_price_positive check (actual_price > 0),
  constraint products_final_mrp_valid check (fake_price > actual_price),
  constraint products_final_images_array check (jsonb_typeof(images) = 'array'),
  constraint products_final_attributes_object check (jsonb_typeof(attributes) = 'object'),
  constraint products_final_sort_nonnegative check (sort_order >= 0)
);

-- Preserve current products through a JSON row adapter so old column types and
-- optional legacy columns do not break the migration.
do $$
begin
  if to_regclass('public.products') is not null then
    insert into public.products_final (
      id, title, slug, description, actual_price, fake_price,
      mrp_generated_from_price, main_category, sub_category,
      images, attributes, preparation_days, care_instructions,
      is_active, sort_order, created_at, updated_at
    )
    select
      coalesce(public._th_uuid(j -> 'id'), gen_random_uuid()),
      coalesce(nullif(trim(j ->> 'title'), ''), 'Untitled Creation'),
      coalesce(nullif(trim(j ->> 'slug'), ''), public._th_slug(j ->> 'title')),
      coalesce(nullif(trim(j ->> 'description'), ''), 'A handcrafted creation made with care.'),
      greatest(0.01, coalesce(public._th_numeric(j, 'actual_price', null), public._th_numeric(j, 'price', 1))),
      case
        when coalesce(public._th_numeric(j, 'fake_price', null), public._th_numeric(j, 'mrp', null))
             > greatest(0.01, coalesce(public._th_numeric(j, 'actual_price', null), public._th_numeric(j, 'price', 1)))
        then coalesce(public._th_numeric(j, 'fake_price', null), public._th_numeric(j, 'mrp', null))
        else round(greatest(0.01, coalesce(public._th_numeric(j, 'actual_price', null), public._th_numeric(j, 'price', 1))) * 1.25, 0)
      end,
      public._th_numeric(j, 'mrp_generated_from_price', null),
      coalesce(nullif(trim(j ->> 'main_category'), ''), nullif(trim(j ->> 'category'), ''), 'Whimsical Art'),
      coalesce(nullif(trim(j ->> 'sub_category'), ''), nullif(trim(j ->> 'subcategory'), ''), 'Handcrafted Creation'),
      public._th_json_array(j -> 'images'),
      public._th_json_object(j -> 'attributes'),
      coalesce(nullif(trim(j ->> 'preparation_days'), ''), nullif(trim(j ->> 'prep_days'), ''), '2-3 Days'),
      nullif(trim(coalesce(j ->> 'care_instructions', j ->> 'care')), ''),
      public._th_bool(j, 'is_active', true)
        and public._th_bool(j, 'visibility', true)
        and not public._th_bool(j, 'is_draft', false),
      greatest(0, public._th_integer(j, 'sort_order', 100)),
      public._th_timestamptz(j, 'created_at', now()),
      public._th_timestamptz(j, 'updated_at', now())
    from (select to_jsonb(p) as j from public.products p) source
    on conflict (id) do nothing;
  end if;
end;
$$;

-- Convert legacy canvas_size attributes into the final structured object.
update public.products_final
set attributes = jsonb_set(
  attributes,
  '{canvas}',
  jsonb_build_object(
    'shape', coalesce(public._th_canvas_size_from_text(attributes ->> 'canvas_size') ->> 'shape', 'square'),
    'base_size', public._th_canvas_size_from_text(attributes ->> 'canvas_size'),
    'orientation', coalesce(attributes ->> 'canvas_orientation', 'Portrait'),
    'pricing_method', 'area'
  ),
  true
)
where main_category = 'Painted Whispers'
  and not (attributes ? 'canvas')
  and nullif(trim(attributes ->> 'canvas_size'), '') is not null;

-- Guarantee valid, stable MRP values for any legacy row that did not contain one.
update public.products_final
set fake_price = greatest(actual_price + 1, ceil(actual_price * 1.25 / 10) * 10 - 1),
    mrp_generated_from_price = actual_price
where fake_price <= actual_price;

-- Store settings ------------------------------------------------------------
drop table if exists public.store_settings_final cascade;
create table public.store_settings_final (
  id smallint primary key default 1 check (id = 1),
  store_name text not null default 'Twisted Happiness',
  admin_whatsapp text not null default '917383333494',
  support_whatsapp text,
  standard_delivery_fee numeric(12,2) not null default 0 check (standard_delivery_fee >= 0),
  free_shipping_threshold numeric(12,2) not null default 0 check (free_shipping_threshold >= 0),
  global_canvas_sizes jsonb not null default '[]'::jsonb check (jsonb_typeof(global_canvas_sizes) = 'array'),
  vip_tiers jsonb not null default '[{"minimumQuantity":1,"percent":0},{"minimumQuantity":2,"percent":5},{"minimumQuantity":3,"percent":10},{"minimumQuantity":5,"percent":15}]'::jsonb check (jsonb_typeof(vip_tiers) = 'array'),
  vacation_mode boolean not null default false,
  announcement_banner_active boolean not null default false,
  announcement_banner_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.store_settings_final (id) values (1);

do $$
declare
  j jsonb;
begin
  if to_regclass('public.store_settings') is not null then
    execute 'select to_jsonb(s) from public.store_settings s order by id limit 1' into j;
  elsif to_regclass('public.store_configurations') is not null then
    execute 'select to_jsonb(s) from public.store_configurations s order by id limit 1' into j;
  end if;

  if j is not null then
    update public.store_settings_final set
      store_name = coalesce(nullif(trim(j ->> 'store_name'), ''), 'Twisted Happiness'),
      admin_whatsapp = regexp_replace(coalesce(nullif(trim(j ->> 'admin_whatsapp'), ''), nullif(trim(j ->> 'support_whatsapp'), ''), '917383333494'), '\D', '', 'g'),
      support_whatsapp = regexp_replace(coalesce(nullif(trim(j ->> 'support_whatsapp'), ''), nullif(trim(j ->> 'admin_whatsapp'), ''), '917383333494'), '\D', '', 'g'),
      standard_delivery_fee = greatest(0, coalesce(public._th_numeric(j, 'standard_delivery_fee', null), public._th_numeric(j, 'shipping_fee', 0))),
      free_shipping_threshold = greatest(0, coalesce(public._th_numeric(j, 'free_shipping_threshold', null), public._th_numeric(j, 'free_delivery_amount', 0))),
      global_canvas_sizes = case
        when jsonb_array_length(public._th_normalise_canvas_sizes(j -> 'global_canvas_sizes')) > 0
          then public._th_normalise_canvas_sizes(j -> 'global_canvas_sizes')
        else '[{"id":"square-8-8","shape":"square","width":8,"height":8,"label":"8 × 8 in"},{"id":"square-10-10","shape":"square","width":10,"height":10,"label":"10 × 10 in"},{"id":"rectangle-12-16","shape":"rectangle","width":12,"height":16,"label":"12 × 16 in"},{"id":"circle-10","shape":"circle","diameter":10,"label":"10 in diameter"}]'::jsonb
      end,
      vip_tiers = case
        when jsonb_typeof(public._th_json_array(j -> 'vip_tiers')) = 'array'
             and jsonb_array_length(public._th_json_array(j -> 'vip_tiers')) > 0
          then public._th_json_array(j -> 'vip_tiers')
        else '[{"minimumQuantity":1,"percent":0},{"minimumQuantity":2,"percent":5},{"minimumQuantity":3,"percent":10},{"minimumQuantity":5,"percent":15}]'::jsonb
      end,
      vacation_mode = public._th_bool(j, 'vacation_mode', false),
      announcement_banner_active = public._th_bool(j, 'announcement_banner_active', false),
      announcement_banner_text = nullif(trim(j ->> 'announcement_banner_text'), ''),
      updated_at = now()
    where id = 1;
  else
    update public.store_settings_final
    set global_canvas_sizes = '[{"id":"square-8-8","shape":"square","width":8,"height":8,"label":"8 × 8 in"},{"id":"square-10-10","shape":"square","width":10,"height":10,"label":"10 × 10 in"},{"id":"rectangle-12-16","shape":"rectangle","width":12,"height":16,"label":"12 × 16 in"},{"id":"circle-10","shape":"circle","diameter":10,"label":"10 in diameter"}]'::jsonb
    where id = 1;
  end if;
end;
$$;

-- Coupons -------------------------------------------------------------------
drop table if exists public.coupons_final cascade;
create table public.coupons_final (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  discount_type text not null default 'percent',
  discount_value numeric(12,2) not null default 0,
  min_spend_amount numeric(12,2) not null default 0,
  max_discount numeric(12,2),
  starts_at timestamptz,
  expires_at timestamptz,
  usage_limit integer,
  per_phone_limit integer,
  used_count integer not null default 0,
  stack_with_vip boolean not null default true,
  is_active boolean not null default true,
  display_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_final_type check (discount_type in ('percent','flat','shipping')),
  constraint coupons_final_value check (
    discount_value >= 0 and
    (discount_type <> 'percent' or discount_value <= 100)
  ),
  constraint coupons_final_minimum check (min_spend_amount >= 0),
  constraint coupons_final_maximum check (max_discount is null or max_discount >= 0),
  constraint coupons_final_usage check (usage_limit is null or usage_limit > 0),
  constraint coupons_final_phone_limit check (per_phone_limit is null or per_phone_limit > 0),
  constraint coupons_final_used_count check (used_count >= 0)
);
create unique index coupons_final_code_unique on public.coupons_final (upper(code));

do $$
begin
  if to_regclass('public.coupons') is not null then
    insert into public.coupons_final (
      id, code, discount_type, discount_value, min_spend_amount,
      max_discount, starts_at, expires_at, usage_limit, per_phone_limit,
      used_count, stack_with_vip, is_active, display_label, created_at, updated_at
    )
    select
      coalesce(public._th_uuid(j -> 'id'), gen_random_uuid()),
      upper(coalesce(nullif(trim(j ->> 'code'), ''), 'LEGACY-' || substr(gen_random_uuid()::text, 1, 8))),
      case lower(coalesce(j ->> 'discount_type', j ->> 'type', 'percent'))
        when 'percentage' then 'percent'
        when 'fixed' then 'flat'
        when 'free_shipping' then 'shipping'
        when 'shipping' then 'shipping'
        when 'flat' then 'flat'
        else 'percent'
      end,
      greatest(0, coalesce(public._th_numeric(j, 'discount_value', null), public._th_numeric(j, 'value', 0))),
      greatest(0, coalesce(public._th_numeric(j, 'min_spend_amount', null), public._th_numeric(j, 'minimum_spend', 0))),
      case when coalesce(public._th_numeric(j, 'max_discount', null), 0) > 0 then public._th_numeric(j, 'max_discount', null) else null end,
      public._th_timestamptz(j, 'starts_at', null),
      coalesce(public._th_timestamptz(j, 'expires_at', null), public._th_timestamptz(j, 'expiry_date', null)),
      case when public._th_integer(j, 'usage_limit', 0) > 0 then public._th_integer(j, 'usage_limit', 0) else null end,
      case when coalesce(public._th_integer(j, 'per_phone_limit', 0), public._th_integer(j, 'per_user_limit', 0)) > 0
        then coalesce(public._th_integer(j, 'per_phone_limit', 0), public._th_integer(j, 'per_user_limit', 0)) else null end,
      greatest(0, coalesce(public._th_integer(j, 'used_count', null), public._th_integer(j, 'usage_count', 0))),
      public._th_bool(j, 'stack_with_vip', true),
      public._th_bool(j, 'is_active', true),
      nullif(trim(coalesce(j ->> 'display_label', j ->> 'name')), ''),
      public._th_timestamptz(j, 'created_at', now()),
      public._th_timestamptz(j, 'updated_at', now())
    from (select to_jsonb(c) as j from public.coupons c) source
    on conflict do nothing;
  end if;
end;
$$;

-- Reviews -------------------------------------------------------------------
drop table if exists public.reviews_final cascade;
create table public.reviews_final (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products_final(id) on delete set null,
  customer_name text not null,
  rating smallint not null check (rating between 1 and 5),
  review_text text not null,
  is_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.reviews') is not null then
    insert into public.reviews_final (
      id, product_id, customer_name, rating, review_text,
      is_approved, created_at, updated_at
    )
    select
      coalesce(public._th_uuid(j -> 'id'), gen_random_uuid()),
      case when exists (select 1 from public.products_final p where p.id = public._th_uuid(j -> 'product_id')) then public._th_uuid(j -> 'product_id') else null end,
      coalesce(nullif(trim(j ->> 'customer_name'), ''), nullif(trim(j ->> 'reviewer_name'), ''), nullif(trim(j ->> 'user_name'), ''), 'Customer'),
      least(5, greatest(1, coalesce(public._th_integer(j, 'rating', 5), 5))),
      coalesce(nullif(trim(j ->> 'review_text'), ''), nullif(trim(j ->> 'comment'), ''), nullif(trim(j ->> 'content'), ''), 'Beautiful handcrafted creation.'),
      public._th_bool(j, 'is_approved', lower(coalesce(j ->> 'status', '')) = 'approved'),
      public._th_timestamptz(j, 'created_at', now()),
      public._th_timestamptz(j, 'updated_at', now())
    from (select to_jsonb(r) as j from public.reviews r) source
    on conflict (id) do nothing;
  end if;
end;
$$;

-- Lightweight secure enquiry snapshots. These are not online orders and do not
-- process payment; they preserve the server-calculated quote sent to WhatsApp.
drop table if exists public.whatsapp_enquiries_final cascade;
create table public.whatsapp_enquiries_final (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  client_reference text,
  customer_name text not null,
  customer_phone text not null,
  customer_city text,
  customer_note text,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  vip_percent numeric(5,2) not null default 0 check (vip_percent between 0 and 100),
  vip_discount numeric(12,2) not null default 0 check (vip_discount >= 0),
  coupon_code text,
  coupon_discount numeric(12,2) not null default 0 check (coupon_discount >= 0),
  delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
  total_amount numeric(12,2) not null check (total_amount >= 0),
  max_preparation_days integer not null default 0 check (max_preparation_days >= 0),
  whatsapp_number text not null,
  coupon_counted boolean not null default false,
  status text not null default 'new' check (status in ('new','contacted','confirmed','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.whatsapp_enquiries') is not null then
    insert into public.whatsapp_enquiries_final (
      id, reference, client_reference, customer_name, customer_phone,
      customer_city, customer_note, items, subtotal, vip_percent,
      vip_discount, coupon_code, coupon_discount, delivery_fee,
      total_amount, max_preparation_days, whatsapp_number, coupon_counted,
      status, created_at, updated_at
    )
    select
      coalesce(public._th_uuid(j -> 'id'), gen_random_uuid()),
      coalesce(nullif(trim(j ->> 'reference'), ''), 'TH-LEGACY-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
      nullif(trim(j ->> 'client_reference'), ''),
      coalesce(nullif(trim(j ->> 'customer_name'), ''), 'Customer'),
      regexp_replace(coalesce(nullif(trim(j ->> 'customer_phone'), ''), '0000000000'), '\D', '', 'g'),
      nullif(trim(j ->> 'customer_city'), ''),
      nullif(trim(j ->> 'customer_note'), ''),
      public._th_json_array(j -> 'items'),
      greatest(0, public._th_numeric(j, 'subtotal', 0)),
      least(100, greatest(0, public._th_numeric(j, 'vip_percent', 0))),
      greatest(0, public._th_numeric(j, 'vip_discount', 0)),
      nullif(trim(j ->> 'coupon_code'), ''),
      greatest(0, public._th_numeric(j, 'coupon_discount', 0)),
      greatest(0, public._th_numeric(j, 'delivery_fee', 0)),
      greatest(0, public._th_numeric(j, 'total_amount', 0)),
      greatest(0, public._th_integer(j, 'max_preparation_days', 0)),
      regexp_replace(coalesce(nullif(trim(j ->> 'whatsapp_number'), ''), '917383333494'), '\D', '', 'g'),
      public._th_bool(j, 'coupon_counted', false),
      case when lower(coalesce(j ->> 'status','new')) in ('new','contacted','confirmed','completed','cancelled') then lower(j ->> 'status') else 'new' end,
      public._th_timestamptz(j, 'created_at', now()),
      public._th_timestamptz(j, 'updated_at', now())
    from (select to_jsonb(e) as j from public.whatsapp_enquiries e) source
    on conflict do nothing;
  end if;
end;
$$;

-- Admin role table is retained because it already links to Supabase Auth.
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role = 'admin'),
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- Archive old structures, then promote the final tables
-- --------------------------------------------------------------------------
select public._th_archive_table('products');
select public._th_archive_table('coupons');
select public._th_archive_table('reviews');
select public._th_archive_table('store_settings');
select public._th_archive_table('store_configurations');
select public._th_archive_table('whatsapp_enquiries');

alter table public.products_final rename to products;
alter table public.store_settings_final rename to store_settings;
alter table public.coupons_final rename to coupons;
alter table public.reviews_final rename to reviews;
alter table public.whatsapp_enquiries_final rename to whatsapp_enquiries;
drop index if exists public.coupons_final_code_unique;

-- Archive known checkout/payment/customer/logistics tables. Nothing is deleted;
-- archived objects are removed from the public API and can be exported later.
do $$
declare
  v_name text;
begin
  foreach v_name in array array[
    'orders','order_items','customer_addresses','addresses','profiles',
    'customers','payments','payment_transactions','payment_references',
    'order_status_history','order_timeline','inventory_history',
    'shiprocket_config','shiprocket_shipments','shipping_events',
    'cod_confirmations','webhook_events','idempotency_keys'
  ] loop
    perform public._th_archive_table(v_name);
  end loop;
end;
$$;

-- Move public views that still resolve to archived legacy tables out of the API.
do $$
declare
  v record;
begin
  for v in
    select schemaname, viewname
    from pg_views
    where schemaname = 'public'
      and definition ilike '%legacy_archive.%'
  loop
    begin
      execute format('alter view public.%I set schema legacy_archive', v.viewname);
    exception when others then
      raise notice 'Could not archive view %: %', v.viewname, sqlerrm;
    end;
  end loop;
end;
$$;

-- Move legacy checkout/integration functions out of the public API while
-- preserving them in the archive for audit or rollback.
do $$
declare
  f record;
begin
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname not like '_th_%'
      and p.proname not in ('is_admin','get_storefront_settings','validate_coupon_for_cart','create_whatsapp_enquiry')
      and (
        p.proname ilike '%order%' or p.proname ilike '%payment%' or
        p.proname ilike '%shiprocket%' or p.proname ilike '%shipment%' or
        p.proname ilike '%inventory%' or p.proname ilike '%coupon_secure%' or
        p.proname ilike '%awb%' or p.proname ilike '%cod%'
      )
  loop
    begin
      execute format('alter function public.%I(%s) set schema legacy_archive', f.proname, f.args);
    exception when others then
      raise notice 'Could not archive function %.%: %', f.proname, f.args, sqlerrm;
    end;
  end loop;
end;
$$;

-- --------------------------------------------------------------------------
-- Final indexes, triggers and server-side business rules
-- --------------------------------------------------------------------------
with ranked as (
  select id, slug, row_number() over (partition by slug order by created_at, id) as rn
  from public.products
)
update public.products p
set slug = p.slug || '-' || substr(replace(p.id::text, '-', ''), 1, 6)
from ranked r
where p.id = r.id and r.rn > 1;

create unique index products_slug_unique on public.products (slug);
create index products_public_sort_idx on public.products (sort_order, created_at desc) where is_active = true;
create index products_category_idx on public.products (main_category, sub_category) where is_active = true;
create index products_title_trgm_idx on public.products using gin (title gin_trgm_ops);
create unique index coupons_code_unique on public.coupons (upper(code));
create index coupons_active_lookup_idx on public.coupons (upper(code)) where is_active = true;
create index reviews_public_product_idx on public.reviews (product_id, created_at desc) where is_approved = true;
create index enquiries_created_idx on public.whatsapp_enquiries (created_at desc);
create index enquiries_phone_idx on public.whatsapp_enquiries (customer_phone, created_at desc);
create index enquiries_status_idx on public.whatsapp_enquiries (status, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.generate_stable_mrp(p_price numeric, p_product_id uuid)
returns numeric
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_percent integer;
  v_raw numeric;
  v_mrp numeric;
begin
  if p_price is null or p_price <= 0 then return null; end if;
  v_percent := 10 + mod(abs(hashtextextended(coalesce(p_product_id::text, '') || ':' || p_price::text, 0)), 51)::integer;
  v_raw := p_price * (1 + v_percent / 100.0);
  v_mrp := ceil(v_raw / 10.0) * 10 - 1;
  if v_mrp < p_price * 1.10 or v_mrp > p_price * 1.60 then v_mrp := v_raw; end if;
  v_mrp := least(p_price * 1.60, greatest(p_price * 1.10, v_mrp));
  return round(v_mrp, 2);
end;
$$;

update public.products
set fake_price = public.generate_stable_mrp(actual_price, id),
    mrp_generated_from_price = actual_price
where fake_price <= actual_price
   or fake_price < actual_price * 1.10
   or fake_price > actual_price * 1.60;

create or replace function public.enforce_product_pricing()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.actual_price := round(new.actual_price, 2);

  if new.id is null then new.id := gen_random_uuid(); end if;

  if new.fake_price is null or new.fake_price <= new.actual_price then
    new.fake_price := public.generate_stable_mrp(new.actual_price, new.id);
    new.mrp_generated_from_price := new.actual_price;
  elsif tg_op = 'UPDATE'
        and new.actual_price is distinct from old.actual_price
        and new.fake_price is not distinct from old.fake_price then
    new.fake_price := public.generate_stable_mrp(new.actual_price, new.id);
    new.mrp_generated_from_price := new.actual_price;
  else
    new.fake_price := round(new.fake_price, 2);
  end if;

  if new.fake_price < new.actual_price * 1.10 or new.fake_price > new.actual_price * 1.60 then
    raise exception 'MRP must be between 10%% and 60%% above the selling price.';
  end if;

  new.slug := public._th_slug(coalesce(nullif(trim(new.slug), ''), new.title));
  if exists (select 1 from public.products p where p.slug = new.slug and p.id <> new.id) then
    new.slug := new.slug || '-' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;
  return new;
end;
$$;

create or replace function public.normalise_coupon()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.code := upper(trim(new.code));
  new.discount_type := lower(trim(new.discount_type));
  new.discount_value := round(coalesce(new.discount_value, 0), 2);
  new.min_spend_amount := round(coalesce(new.min_spend_amount, 0), 2);
  new.max_discount := case when coalesce(new.max_discount, 0) > 0 then round(new.max_discount, 2) else null end;
  return new;
end;
$$;

drop trigger if exists products_pricing_trigger on public.products;
create trigger products_pricing_trigger
before insert or update of actual_price, fake_price, slug, title
on public.products
for each row execute function public.enforce_product_pricing();

drop trigger if exists products_updated_at_trigger on public.products;
create trigger products_updated_at_trigger before update on public.products for each row execute function public.set_updated_at();
drop trigger if exists settings_updated_at_trigger on public.store_settings;
create trigger settings_updated_at_trigger before update on public.store_settings for each row execute function public.set_updated_at();
drop trigger if exists coupons_normalise_trigger on public.coupons;
create trigger coupons_normalise_trigger before insert or update on public.coupons for each row execute function public.normalise_coupon();
drop trigger if exists coupons_updated_at_trigger on public.coupons;
create trigger coupons_updated_at_trigger before update on public.coupons for each row execute function public.set_updated_at();
drop trigger if exists reviews_updated_at_trigger on public.reviews;
create trigger reviews_updated_at_trigger before update on public.reviews for each row execute function public.set_updated_at();
drop trigger if exists enquiries_updated_at_trigger on public.whatsapp_enquiries;
create trigger enquiries_updated_at_trigger before update on public.whatsapp_enquiries for each row execute function public.set_updated_at();

create or replace function public.count_confirmed_coupon_usage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.coupon_code is null then return new; end if;

  if new.status in ('confirmed','completed') and not coalesce(old.coupon_counted, false) then
    update public.coupons
    set used_count = used_count + 1
    where upper(code) = upper(new.coupon_code);
    new.coupon_counted := true;
  elsif new.status = 'cancelled' and coalesce(old.coupon_counted, false) then
    update public.coupons
    set used_count = greatest(0, used_count - 1)
    where upper(code) = upper(new.coupon_code);
    new.coupon_counted := false;
  end if;
  return new;
end;
$$;

drop trigger if exists enquiries_coupon_usage_trigger on public.whatsapp_enquiries;
create trigger enquiries_coupon_usage_trigger
before update of status on public.whatsapp_enquiries
for each row execute function public.count_confirmed_coupon_usage();

-- --------------------------------------------------------------------------
-- Authorization helper
-- --------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- --------------------------------------------------------------------------
-- Safe public settings RPC
-- --------------------------------------------------------------------------
create or replace function public.get_storefront_settings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'store_name', store_name,
    'admin_whatsapp', admin_whatsapp,
    'support_whatsapp', support_whatsapp,
    'standard_delivery_fee', standard_delivery_fee,
    'free_shipping_threshold', free_shipping_threshold,
    'global_canvas_sizes', global_canvas_sizes,
    'vip_tiers', vip_tiers,
    'vacation_mode', vacation_mode,
    'announcement_banner_active', announcement_banner_active,
    'announcement_banner_text', announcement_banner_text
  )
  from public.store_settings
  where id = 1;
$$;

revoke all on function public.get_storefront_settings() from public;
grant execute on function public.get_storefront_settings() to anon, authenticated;

-- --------------------------------------------------------------------------
-- Secure exact-code coupon validation
-- --------------------------------------------------------------------------
create or replace function public.validate_coupon_for_cart(p_code text, p_subtotal numeric)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.coupons%rowtype;
  v_now timestamptz := now();
begin
  if p_code is null or trim(p_code) = '' then
    raise exception 'Enter a coupon code.';
  end if;
  if p_subtotal is null or p_subtotal < 0 then
    raise exception 'Invalid cart subtotal.';
  end if;

  select * into c
  from public.coupons
  where upper(code) = upper(trim(p_code))
  limit 1;

  if not found or not c.is_active then raise exception 'This coupon is invalid or inactive.'; end if;
  if c.starts_at is not null and v_now < c.starts_at then raise exception 'This coupon is not active yet.'; end if;
  if c.expires_at is not null and v_now > c.expires_at then raise exception 'This coupon has expired.'; end if;
  if c.usage_limit is not null and c.used_count >= c.usage_limit then raise exception 'This coupon has reached its usage limit.'; end if;
  if p_subtotal < c.min_spend_amount then raise exception 'Minimum spend for this coupon is ₹%.', trim(to_char(c.min_spend_amount, 'FM999999990.00')); end if;

  return jsonb_build_object(
    'id', c.id,
    'code', c.code,
    'discount_type', c.discount_type,
    'discount_value', c.discount_value,
    'min_spend_amount', c.min_spend_amount,
    'max_discount', c.max_discount,
    'starts_at', c.starts_at,
    'expires_at', c.expires_at,
    'is_active', c.is_active,
    'stack_with_vip', c.stack_with_vip,
    'display_label', c.display_label
  );
end;
$$;

revoke all on function public.validate_coupon_for_cart(text,numeric) from public;
grant execute on function public.validate_coupon_for_cart(text,numeric) to anon, authenticated;

-- --------------------------------------------------------------------------
-- Secure quote helpers
-- --------------------------------------------------------------------------
create or replace function public._canvas_area(p_size jsonb)
returns numeric
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_shape text := lower(coalesce(p_size ->> 'shape', ''));
  v_width numeric;
  v_height numeric;
  v_diameter numeric;
begin
  if p_size is null or jsonb_typeof(p_size) <> 'object' then return 0; end if;
  if v_shape = 'circle' then
    v_diameter := coalesce((p_size ->> 'diameter')::numeric, 0);
    return round(pi()::numeric * power(v_diameter / 2, 2), 6);
  end if;
  v_width := coalesce((p_size ->> 'width')::numeric, 0);
  v_height := coalesce((p_size ->> 'height')::numeric, v_width);
  return round(v_width * v_height, 6);
exception when others then
  return 0;
end;
$$;

create or replace function public._same_canvas_size(a jsonb, b jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when a is null or b is null then false
    when lower(coalesce(a ->> 'shape','')) <> lower(coalesce(b ->> 'shape','')) then false
    when lower(coalesce(a ->> 'shape','')) = 'circle'
      then round(coalesce((a ->> 'diameter')::numeric,0),4) = round(coalesce((b ->> 'diameter')::numeric,0),4)
    else round(coalesce((a ->> 'width')::numeric,0),4) = round(coalesce((b ->> 'width')::numeric,0),4)
      and round(coalesce((a ->> 'height')::numeric,coalesce((a ->> 'width')::numeric,0)),4)
        = round(coalesce((b ->> 'height')::numeric,coalesce((b ->> 'width')::numeric,0)),4)
  end;
$$;

create or replace function public._canvas_size_allowed(p_selected jsonb, p_base jsonb, p_allowed jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  v jsonb;
begin
  if public._same_canvas_size(p_selected, p_base) then return true; end if;
  if jsonb_typeof(p_allowed) <> 'array' then return false; end if;
  for v in select value from jsonb_array_elements(p_allowed)
  loop
    if public._same_canvas_size(p_selected, v) then return true; end if;
  end loop;
  return false;
end;
$$;

create or replace function public._canvas_price(p_base_price numeric, p_base_size jsonb, p_selected_size jsonb)
returns numeric
language plpgsql
immutable
as $$
declare
  v_base_area numeric;
  v_selected_area numeric;
begin
  -- Exact equality returns the exact persisted base price. This explicitly fixes
  -- the historical ₹349 -> ₹350 round-trip issue.
  if p_selected_size is null or public._same_canvas_size(p_base_size, p_selected_size) then
    return round(p_base_price, 2);
  end if;
  v_base_area := public._canvas_area(p_base_size);
  v_selected_area := public._canvas_area(p_selected_size);
  if v_base_area <= 0 or v_selected_area <= 0 then return round(p_base_price, 2); end if;
  return round(p_base_price * v_selected_area / v_base_area, 2);
end;
$$;

create or replace function public._max_days(p_text text)
returns integer
language sql
immutable
as $$
  select coalesce(max((m)[1]::integer), 0)
  from regexp_matches(coalesce(p_text,''), '([0-9]+)', 'g') m;
$$;

create or replace function public._money_text(p_value numeric)
returns text
language sql
immutable
as $$
  select '₹' || trim(to_char(round(coalesce(p_value,0),2), 'FM999999990.00'));
$$;

-- --------------------------------------------------------------------------
-- Secure final quote + lightweight WhatsApp enquiry creation
-- --------------------------------------------------------------------------
create or replace function public.create_whatsapp_enquiry(
  p_cart jsonb,
  p_customer jsonb,
  p_coupon_code text default null,
  p_client_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_settings public.store_settings%rowtype;
  v_cart_row jsonb;
  v_product public.products%rowtype;
  v_coupon public.coupons%rowtype;
  v_product_id uuid;
  v_quantity integer;
  v_selected_size jsonb;
  v_base_size jsonb;
  v_unit_price numeric(12,2);
  v_line_total numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_total_quantity integer := 0;
  v_vip_percent numeric(5,2) := 0;
  v_vip_discount numeric(12,2) := 0;
  v_coupon_discount numeric(12,2) := 0;
  v_delivery_fee numeric(12,2) := 0;
  v_final_total numeric(12,2) := 0;
  v_max_prep integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_customer_name text;
  v_customer_phone text;
  v_customer_city text;
  v_customer_note text;
  v_item_note text;
  v_item_orientation text;
  v_coupon_code text := null;
  v_reference text;
  v_message text;
  v_whatsapp_number text;
  v_tier jsonb;
  v_computed_coupon numeric(12,2) := 0;
  v_enquiry_id uuid;
  v_existing_count integer;
  v_after_discounts numeric(12,2);
begin
  if p_cart is null or jsonb_typeof(p_cart) <> 'array' or jsonb_array_length(p_cart) = 0 then
    raise exception 'Your bag is empty.';
  end if;
  if jsonb_array_length(p_cart) > 30 then raise exception 'Too many separate items in one enquiry.'; end if;
  if p_customer is null or jsonb_typeof(p_customer) <> 'object' then raise exception 'Customer details are required.'; end if;

  v_customer_name := left(trim(coalesce(p_customer ->> 'name','')), 100);
  v_customer_phone := regexp_replace(coalesce(p_customer ->> 'phone',''), '\D', '', 'g');
  v_customer_city := nullif(left(trim(coalesce(p_customer ->> 'city','')), 120), '');
  v_customer_note := nullif(left(trim(coalesce(p_customer ->> 'note','')), 300), '');

  if v_customer_name = '' then raise exception 'Customer name is required.'; end if;
  if length(v_customer_phone) < 10 or length(v_customer_phone) > 15 then raise exception 'Enter a valid WhatsApp number.'; end if;

  -- Lightweight anti-spam rule without customer accounts.
  select count(*) into v_existing_count
  from public.whatsapp_enquiries e
  where e.customer_phone = v_customer_phone
    and e.created_at > now() - interval '1 hour';
  if v_existing_count >= 5 then raise exception 'Rate limit: please wait before creating another enquiry.'; end if;

  select * into v_settings from public.store_settings where id = 1;
  if not found then raise exception 'Store settings are unavailable.'; end if;

  for v_cart_row in select value from jsonb_array_elements(p_cart)
  loop
    begin
      v_product_id := (v_cart_row ->> 'product_id')::uuid;
    exception when others then
      raise exception 'A product reference in the bag is invalid.';
    end;

    begin
      v_quantity := coalesce((v_cart_row ->> 'quantity')::integer, 1);
    exception when others then
      raise exception 'A product quantity is invalid.';
    end;
    if v_quantity < 1 or v_quantity > 20 then raise exception 'Quantity must be between 1 and 20.'; end if;

    select * into v_product
    from public.products p
    where p.id = v_product_id and p.is_active = true;
    if not found then raise exception 'A selected product is unavailable. Please refresh your bag.'; end if;

    v_selected_size := v_cart_row -> 'selected_size';
    v_item_orientation := nullif(left(trim(coalesce(v_cart_row ->> 'orientation','')), 30), '');
    v_item_note := nullif(left(trim(coalesce(v_cart_row ->> 'note','')), 180), '');
    v_unit_price := v_product.actual_price;

    if v_product.main_category = 'Painted Whispers' then
      v_base_size := v_product.attributes #> '{canvas,base_size}';
      if v_base_size is null then v_base_size := public._th_canvas_size_from_text(v_product.attributes ->> 'canvas_size'); end if;
      if v_base_size is null then raise exception 'Canvas base size is not configured for %.', v_product.title; end if;
      if v_selected_size is null or v_selected_size = 'null'::jsonb then v_selected_size := v_base_size; end if;
      if not public._canvas_size_allowed(v_selected_size, v_base_size, v_settings.global_canvas_sizes) then
        raise exception 'The selected canvas size is not available for %.', v_product.title;
      end if;
      v_unit_price := public._canvas_price(v_product.actual_price, v_base_size, v_selected_size);
    else
      v_selected_size := null;
    end if;

    v_line_total := round(v_unit_price * v_quantity, 2);
    v_subtotal := v_subtotal + v_line_total;
    v_total_quantity := v_total_quantity + v_quantity;
    v_max_prep := greatest(v_max_prep, public._max_days(v_product.preparation_days));

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'title', v_product.title,
      'quantity', v_quantity,
      'unit_price', v_unit_price,
      'line_total', v_line_total,
      'selected_size', v_selected_size,
      'orientation', v_item_orientation,
      'note', v_item_note,
      'preparation_days', v_product.preparation_days,
      'image', coalesce(v_product.images ->> 0, '')
    ));
  end loop;

  if jsonb_typeof(v_settings.vip_tiers) = 'array' then
    for v_tier in select value from jsonb_array_elements(v_settings.vip_tiers)
    loop
      if coalesce((v_tier ->> 'minimumQuantity')::integer, 0) <= v_total_quantity
         and coalesce((v_tier ->> 'percent')::numeric, 0) >= v_vip_percent then
        v_vip_percent := least(80, greatest(0, (v_tier ->> 'percent')::numeric));
      end if;
    end loop;
  end if;
  v_vip_discount := round(v_subtotal * v_vip_percent / 100, 2);

  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    select * into v_coupon
    from public.coupons c
    where upper(c.code) = upper(trim(p_coupon_code))
    for update;

    if not found or not v_coupon.is_active then raise exception 'Coupon: invalid or inactive.'; end if;
    if v_coupon.starts_at is not null and now() < v_coupon.starts_at then raise exception 'Coupon: not active yet.'; end if;
    if v_coupon.expires_at is not null and now() > v_coupon.expires_at then raise exception 'Coupon: expired.'; end if;
    if v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit then raise exception 'Coupon: usage limit reached.'; end if;
    if v_subtotal < v_coupon.min_spend_amount then raise exception 'Coupon: minimum spend is %.', public._money_text(v_coupon.min_spend_amount); end if;

    if v_coupon.per_phone_limit is not null then
      select count(*) into v_existing_count
      from public.whatsapp_enquiries e
      where e.customer_phone = v_customer_phone
        and upper(coalesce(e.coupon_code,'')) = upper(v_coupon.code)
        and e.status <> 'cancelled';
      if v_existing_count >= v_coupon.per_phone_limit then raise exception 'Coupon: usage limit reached for this phone number.'; end if;
    end if;

    if not v_coupon.stack_with_vip then v_vip_discount := 0; v_vip_percent := 0; end if;
    v_after_discounts := greatest(0, v_subtotal - v_vip_discount);

    if v_coupon.discount_type = 'percent' then
      v_computed_coupon := round(v_after_discounts * v_coupon.discount_value / 100, 2);
      if v_coupon.max_discount is not null then v_computed_coupon := least(v_computed_coupon, v_coupon.max_discount); end if;
      v_coupon_discount := least(v_after_discounts, greatest(0, v_computed_coupon));
    elsif v_coupon.discount_type = 'flat' then
      v_coupon_discount := least(v_after_discounts, greatest(0, v_coupon.discount_value));
    else
      v_coupon_discount := 0;
    end if;
    v_coupon_code := v_coupon.code;
  end if;

  v_after_discounts := greatest(0, v_subtotal - v_vip_discount - v_coupon_discount);
  v_delivery_fee := case
    when v_coupon_code is not null and v_coupon.discount_type = 'shipping' then 0
    when v_settings.free_shipping_threshold > 0 and v_after_discounts >= v_settings.free_shipping_threshold then 0
    else v_settings.standard_delivery_fee
  end;
  v_final_total := round(v_after_discounts + v_delivery_fee, 2);

  v_reference := 'TH-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  v_whatsapp_number := regexp_replace(coalesce(nullif(v_settings.admin_whatsapp,''), v_settings.support_whatsapp, '917383333494'), '\D', '', 'g');

  v_message := case when v_settings.vacation_mode then '🌷 *Waitlist Enquiry - Twisted Happiness*' else '🛍️ *New Enquiry - Twisted Happiness*' end || E'\n' ||
               '*Reference:* ' || v_reference || E'\n\n';

  for v_cart_row in select value from jsonb_array_elements(v_items)
  loop
    v_message := v_message || '*• ' || (v_cart_row ->> 'title') || '*' || E'\n';
    if v_cart_row -> 'selected_size' is not null and v_cart_row -> 'selected_size' <> 'null'::jsonb then
      v_message := v_message || 'Size: ' || coalesce(v_cart_row #>> '{selected_size,label}', 'Custom') || E'\n';
    end if;
    if nullif(v_cart_row ->> 'orientation','') is not null then v_message := v_message || 'Orientation: ' || (v_cart_row ->> 'orientation') || E'\n'; end if;
    v_message := v_message || 'Qty: ' || (v_cart_row ->> 'quantity') || E'\n' ||
                 'Price: ' || public._money_text((v_cart_row ->> 'line_total')::numeric) || E'\n';
    if nullif(v_cart_row ->> 'note','') is not null then v_message := v_message || 'Custom note: ' || (v_cart_row ->> 'note') || E'\n'; end if;
    v_message := v_message || E'\n';
  end loop;

  v_message := v_message || 'Subtotal: ' || public._money_text(v_subtotal) || E'\n';
  if v_vip_discount > 0 then v_message := v_message || 'VIP Discount (' || trim(to_char(v_vip_percent, 'FM990.##')) || '%): -' || public._money_text(v_vip_discount) || E'\n'; end if;
  if v_coupon_code is not null then
    if v_coupon.discount_type = 'shipping' then v_message := v_message || 'Coupon (' || v_coupon_code || '): Free delivery' || E'\n';
    elsif v_coupon_discount > 0 then v_message := v_message || 'Coupon (' || v_coupon_code || '): -' || public._money_text(v_coupon_discount) || E'\n'; end if;
  end if;
  v_message := v_message || 'Delivery estimate: ' || case when v_delivery_fee = 0 then 'Free' else public._money_text(v_delivery_fee) end || E'\n' ||
               '*Estimated Total: ' || public._money_text(v_final_total) || '*' || E'\n' ||
               'Maximum crafting time: ' || case when v_max_prep > 0 then v_max_prep || ' Days' else 'To be confirmed' end || E'\n\n' ||
               '*Customer:* ' || v_customer_name || E'\n' ||
               '*Phone:* ' || v_customer_phone || E'\n';
  if v_customer_city is not null then v_message := v_message || '*City:* ' || v_customer_city || E'\n'; end if;
  if v_customer_note is not null then v_message := v_message || '*Note:* ' || v_customer_note || E'\n'; end if;
  v_message := v_message || case when v_settings.vacation_mode then E'\nThe studio is in vacation mode. Please confirm the waitlist timing and availability.' else E'\nPlease confirm availability, final delivery details and payment instructions.' end;

  insert into public.whatsapp_enquiries (
    reference, client_reference, customer_name, customer_phone, customer_city,
    customer_note, items, subtotal, vip_percent, vip_discount, coupon_code,
    coupon_discount, delivery_fee, total_amount, max_preparation_days,
    whatsapp_number
  ) values (
    v_reference, nullif(left(trim(coalesce(p_client_reference,'')), 80), ''),
    v_customer_name, v_customer_phone, v_customer_city, v_customer_note, v_items,
    v_subtotal, v_vip_percent, v_vip_discount, v_coupon_code, v_coupon_discount,
    v_delivery_fee, v_final_total, v_max_prep, v_whatsapp_number
  ) returning id into v_enquiry_id;

  return jsonb_build_object(
    'id', v_enquiry_id,
    'reference', v_reference,
    'whatsapp_number', v_whatsapp_number,
    'whatsapp_message', v_message,
    'subtotal', v_subtotal,
    'vip_percent', v_vip_percent,
    'vip_discount', v_vip_discount,
    'coupon_code', v_coupon_code,
    'coupon_discount', v_coupon_discount,
    'delivery_fee', v_delivery_fee,
    'total_amount', v_final_total,
    'max_preparation_days', v_max_prep,
    'items', v_items,
    'vacation_mode', v_settings.vacation_mode
  );
end;
$$;
revoke all on function public.create_whatsapp_enquiry(jsonb,jsonb,text,text) from public;
grant execute on function public.create_whatsapp_enquiry(jsonb,jsonb,text,text) to anon, authenticated;

-- Internal functions are callable by triggers/definer functions but are not a
-- public application API.
revoke all on function public._th_canvas_size_from_text(text) from public;
revoke all on function public._th_slug(text) from public;
revoke all on function public.set_updated_at() from public;
revoke all on function public.generate_stable_mrp(numeric,uuid) from public;
revoke all on function public.enforce_product_pricing() from public;
revoke all on function public.normalise_coupon() from public;
revoke all on function public.count_confirmed_coupon_usage() from public;
revoke all on function public._canvas_area(jsonb) from public;
revoke all on function public._same_canvas_size(jsonb,jsonb) from public;
revoke all on function public._canvas_size_allowed(jsonb,jsonb,jsonb) from public;
revoke all on function public._canvas_price(numeric,jsonb,jsonb) from public;
revoke all on function public._max_days(text) from public;
revoke all on function public._money_text(numeric) from public;

-- --------------------------------------------------------------------------
-- Row Level Security
-- --------------------------------------------------------------------------
alter table public.products enable row level security;
alter table public.store_settings enable row level security;
alter table public.coupons enable row level security;
alter table public.reviews enable row level security;
alter table public.whatsapp_enquiries enable row level security;
alter table public.user_roles enable row level security;

-- Remove any older policies on the final application tables. These tables now
-- receive one explicit least-privilege policy set below.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('products','store_settings','coupons','reviews','whatsapp_enquiries','user_roles')
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end;
$$;

-- Products
drop policy if exists "products public read active" on public.products;
create policy "products public read active" on public.products for select to anon, authenticated using (is_active = true);
drop policy if exists "products admin read all" on public.products;
create policy "products admin read all" on public.products for select to authenticated using (public.is_admin());
drop policy if exists "products admin insert" on public.products;
create policy "products admin insert" on public.products for insert to authenticated with check (public.is_admin());
drop policy if exists "products admin update" on public.products;
create policy "products admin update" on public.products for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "products admin delete" on public.products;
create policy "products admin delete" on public.products for delete to authenticated using (public.is_admin());

-- Settings: no direct anonymous access; storefront uses the safe RPC.
drop policy if exists "settings admin select" on public.store_settings;
create policy "settings admin select" on public.store_settings for select to authenticated using (public.is_admin());
drop policy if exists "settings admin insert" on public.store_settings;
create policy "settings admin insert" on public.store_settings for insert to authenticated with check (public.is_admin());
drop policy if exists "settings admin update" on public.store_settings;
create policy "settings admin update" on public.store_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Coupons: definitions are private; only admin CRUD and exact-code RPC access.
drop policy if exists "coupons admin select" on public.coupons;
create policy "coupons admin select" on public.coupons for select to authenticated using (public.is_admin());
drop policy if exists "coupons admin insert" on public.coupons;
create policy "coupons admin insert" on public.coupons for insert to authenticated with check (public.is_admin());
drop policy if exists "coupons admin update" on public.coupons;
create policy "coupons admin update" on public.coupons for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "coupons admin delete" on public.coupons;
create policy "coupons admin delete" on public.coupons for delete to authenticated using (public.is_admin());

-- Reviews
drop policy if exists "reviews public approved" on public.reviews;
create policy "reviews public approved" on public.reviews for select to anon, authenticated using (is_approved = true);
drop policy if exists "reviews admin read all" on public.reviews;
create policy "reviews admin read all" on public.reviews for select to authenticated using (public.is_admin());
drop policy if exists "reviews admin insert" on public.reviews;
create policy "reviews admin insert" on public.reviews for insert to authenticated with check (public.is_admin());
drop policy if exists "reviews admin update" on public.reviews;
create policy "reviews admin update" on public.reviews for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "reviews admin delete" on public.reviews;
create policy "reviews admin delete" on public.reviews for delete to authenticated using (public.is_admin());

-- Enquiries: anonymous clients cannot read or write directly. The definer RPC is
-- the only creation path; admin can read and update status.
drop policy if exists "enquiries admin select" on public.whatsapp_enquiries;
create policy "enquiries admin select" on public.whatsapp_enquiries for select to authenticated using (public.is_admin());
drop policy if exists "enquiries admin update" on public.whatsapp_enquiries;
create policy "enquiries admin update" on public.whatsapp_enquiries for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "enquiries admin delete" on public.whatsapp_enquiries;
create policy "enquiries admin delete" on public.whatsapp_enquiries for delete to authenticated using (public.is_admin());

-- User roles
drop policy if exists "roles read own" on public.user_roles;
create policy "roles read own" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "roles admin insert" on public.user_roles;
create policy "roles admin insert" on public.user_roles for insert to authenticated with check (public.is_admin());
drop policy if exists "roles admin update" on public.user_roles;
create policy "roles admin update" on public.user_roles for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "roles admin delete" on public.user_roles;
create policy "roles admin delete" on public.user_roles for delete to authenticated using (public.is_admin());

-- Table privileges. RLS still applies after these grants.
revoke all on public.products, public.store_settings, public.coupons, public.reviews, public.whatsapp_enquiries, public.user_roles from anon, authenticated;
grant select on public.products, public.reviews to anon, authenticated;
grant select, insert, update, delete on public.products, public.store_settings, public.coupons, public.reviews, public.whatsapp_enquiries to authenticated;
grant select, insert, update, delete on public.user_roles to authenticated;

-- --------------------------------------------------------------------------
-- Supabase Storage bucket and policies
-- --------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('art-images', 'art-images', true, 5242880, array['image/webp','image/jpeg','image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table storage.objects enable row level security;

-- Remove previous policies that reference this bucket, including policies with
-- old names, so no permissive anonymous upload rule survives the migration.
do $$
declare
  p record;
begin
  for p in
    select pol.polname
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace ns on ns.oid = cls.relnamespace
    where ns.nspname = 'storage'
      and cls.relname = 'objects'
      and (
        pol.polname ilike '%art%image%'
        or coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ilike '%art-images%'
        or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ilike '%art-images%'
      )
  loop
    execute format('drop policy if exists %I on storage.objects', p.polname);
  end loop;
end;
$$;

drop policy if exists "art images public read" on storage.objects;
create policy "art images public read" on storage.objects
for select to public using (bucket_id = 'art-images');

drop policy if exists "art images admin upload" on storage.objects;
create policy "art images admin upload" on storage.objects
for insert to authenticated with check (
  bucket_id = 'art-images'
  and public.is_admin()
  and (storage.foldername(name))[1] = 'products'
  and lower(storage.extension(name)) = 'webp'
);

drop policy if exists "art images admin update" on storage.objects;
create policy "art images admin update" on storage.objects
for update to authenticated using (bucket_id = 'art-images' and public.is_admin())
with check (bucket_id = 'art-images' and public.is_admin());

drop policy if exists "art images admin delete" on storage.objects;
create policy "art images admin delete" on storage.objects
for delete to authenticated using (bucket_id = 'art-images' and public.is_admin());

-- --------------------------------------------------------------------------
-- Remove temporary migration-only helpers; runtime helpers are retained.
-- --------------------------------------------------------------------------
drop function if exists public._th_archive_table(text);
drop function if exists public._th_bool(jsonb,text,boolean);
drop function if exists public._th_numeric(jsonb,text,numeric);
drop function if exists public._th_integer(jsonb,text,integer);
drop function if exists public._th_uuid(jsonb);
drop function if exists public._th_timestamptz(jsonb,text,timestamptz);
drop function if exists public._th_json_array(jsonb);
drop function if exists public._th_json_object(jsonb);
drop function if exists public._th_normalise_canvas_sizes(jsonb);
-- _th_canvas_size_from_text and _th_slug are retained because legacy product
-- compatibility and the pricing trigger still use them.

insert into public.twisted_happiness_schema_migrations (version)
values ('20260803_final_whatsapp_catalog');

commit;

-- ============================================================================
-- AFTER RUNNING THIS MIGRATION
-- 1. Ensure your admin Auth user's UUID exists in public.user_roles as 'admin'.
-- 2. Deploy the ZIP and test storefront, coupon, checkout, product upload.
-- 3. Delete old Supabase Edge Functions only after the smoke test succeeds.
-- Archived legacy tables remain in legacy_archive and are not exposed by API.
-- ============================================================================
