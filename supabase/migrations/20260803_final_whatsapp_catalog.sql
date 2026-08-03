BEGIN;

-- ============================================================
-- TWISTED HAPPINESS — FINAL WEBSITE CONTRACT MIGRATION
-- Version: 2026-08-03-final-contract-v4
--
-- IMPORTANT DESIGN DECISIONS
-- 1. Existing products are preserved in-place.
-- 2. actual_price TYPE IS NOT CHANGED.
--    The live table currently stores whole-rupee prices as INTEGER.
--    PostgreSQL numeric calculations work correctly by casting inside
--    the secure RPCs, so changing the column type is unnecessary.
-- 3. Existing pricing trigger is replaced safely without altering
--    the actual_price column type.
-- 4. Existing store_configurations is kept as a locked legacy source.
--    The final website uses store_settings.
-- 5. Existing whatsapp_enquiries rows are preserved and upgraded in-place.
-- 6. Existing coupons are preserved and upgraded in-place.
-- 7. No SQL statement touches storage.objects or storage.buckets policies.
--    Those are Supabase-managed tables and must be secured from the
--    Supabase Storage Policy UI after this migration.
-- 8. The migration is intentionally re-runnable / idempotent.
--
-- FINAL FRONTEND CONTRACTS
--   products
--   store_settings
--   coupons
--   reviews
--   canvas_sizes
--   user_roles
--   whatsapp_enquiries
--
-- FINAL RPC CONTRACTS USED BY THE WEBSITE
--   get_storefront_settings()
--   validate_coupon_for_cart(p_code text, p_subtotal numeric)
--   create_whatsapp_enquiry(
--       p_cart jsonb,
--       p_customer jsonb,
--       p_coupon_code text,
--       p_client_reference text
--   )
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS legacy_archive;

CREATE TABLE IF NOT EXISTS public.twisted_happiness_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- 1. COMMON ADMIN AUTHORIZATION
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = auth.uid()
          AND role = 'admin'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_studio_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT public.is_admin();
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_studio_admin() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_admin()
TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.is_studio_admin()
TO anon, authenticated;


-- ============================================================
-- 2. PRODUCTS — IN-PLACE, NO PRICE TYPE CONVERSION
-- ============================================================
-- ROOT-CAUSE FIX:
-- The live products.actual_price column is INTEGER and has an existing
-- trigger trg_products_fake_price depending on that column.
--
-- We deliberately DO NOT run:
--   ALTER COLUMN actual_price TYPE NUMERIC(...)
--
-- The previous migration failed for exactly that reason.
-- Whole-rupee INTEGER prices are fully compatible with the frontend and
-- secure NUMERIC calculations in the RPCs.

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS slug TEXT;

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS sort_order INTEGER
        NOT NULL DEFAULT 100;

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS mrp_generated_from_price NUMERIC(12,2);


-- ============================================================
-- 2A. Stable slug helper
-- ============================================================

CREATE OR REPLACE FUNCTION public.th_slugify(
    p_value TEXT
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT COALESCE(
        NULLIF(
            LEFT(
                TRIM(
                    BOTH '-'
                    FROM REGEXP_REPLACE(
                        LOWER(COALESCE(p_value, '')),
                        '[^a-z0-9]+',
                        '-',
                        'g'
                    )
                ),
                90
            ),
            ''
        ),
        'product'
    );
$$;


-- Backfill all product slugs deterministically.
WITH ranked AS (
    SELECT
        id,
        th_slugify(title) AS base_slug,
        ROW_NUMBER() OVER (
            PARTITION BY th_slugify(title)
            ORDER BY created_at, id
        ) AS duplicate_number
    FROM public.products
)
UPDATE public.products p
SET slug =
    CASE
        WHEN ranked.duplicate_number = 1
        THEN ranked.base_slug
        ELSE
            LEFT(ranked.base_slug, 80)
            || '-'
            || SUBSTRING(
                REPLACE(p.id::TEXT, '-', '')
                FROM 1 FOR 8
            )
    END
FROM ranked
WHERE ranked.id = p.id;


-- Backfill deterministic sort ordering.
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            ORDER BY
                COALESCE(featured_product, FALSE) DESC,
                COALESCE(best_seller, FALSE) DESC,
                created_at DESC,
                id
        ) AS row_position
    FROM public.products
)
UPDATE public.products p
SET sort_order = ranked.row_position * 10
FROM ranked
WHERE ranked.id = p.id
  AND (
      p.sort_order IS NULL
      OR p.sort_order = 100
  );


-- ============================================================
-- 2B. Stable MRP generator
-- ============================================================

CREATE OR REPLACE FUNCTION public.generate_stable_product_mrp(
    p_price NUMERIC,
    p_product_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_min NUMERIC;
    v_max NUMERIC;
    v_span INTEGER;
    v_seed BIGINT;
    v_step INTEGER;
    v_mrp NUMERIC;
BEGIN
    IF p_price IS NULL OR p_price <= 0 THEN
        RETURN NULL;
    END IF;

    v_min := CEIL((p_price * 1.10) / 10) * 10;
    v_max := FLOOR((p_price * 1.60) / 10) * 10;

    IF v_max < v_min THEN
        RETURN ROUND(p_price * 1.25, 2);
    END IF;

    v_span := GREATEST(
        0,
        FLOOR((v_max - v_min) / 10)::INTEGER
    );

    v_seed := ABS(
        hashtextextended(
            COALESCE(p_product_id::TEXT, '')
            || ':'
            || p_price::TEXT,
            0
        )
    );

    v_step :=
        CASE
            WHEN v_span = 0 THEN 0
            ELSE MOD(v_seed, v_span + 1)::INTEGER
        END;

    v_mrp := v_min + (v_step * 10);

    RETURN ROUND(
        LEAST(
            p_price * 1.60,
            GREATEST(
                p_price * 1.10,
                v_mrp
            )
        ),
        2
    );
END;
$$;


-- Preserve valid existing MRP.
-- Generate only when missing or invalid.
UPDATE public.products
SET
    fake_price = public.generate_stable_product_mrp(
        actual_price::NUMERIC,
        id
    ),
    mrp_generated_from_price = actual_price::NUMERIC
WHERE fake_price IS NULL
   OR fake_price <= actual_price;


-- ============================================================
-- 2C. Replace old pricing trigger safely
-- ============================================================
-- This DROP is safe because we are NOT altering actual_price type.
-- It also removes the exact trigger that caused the previous migration
-- to fail during the attempted column type conversion.

DROP TRIGGER IF EXISTS trg_products_fake_price
ON public.products;

DROP TRIGGER IF EXISTS products_pricing_trigger
ON public.products;


CREATE OR REPLACE FUNCTION public.enforce_product_pricing()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.actual_price IS NULL OR NEW.actual_price <= 0 THEN
        RAISE EXCEPTION
            'Selling price must be greater than zero.';
    END IF;

    -- Keep slug stable unless it is missing.
    IF NEW.slug IS NULL OR TRIM(NEW.slug) = '' THEN
        NEW.slug := public.th_slugify(NEW.title);
    END IF;

    -- Automatic MRP:
    -- 1. New product + no MRP => generate.
    -- 2. Selling price changed + mrp_generated_from_price explicitly
    --    equals new selling price => generate a new MRP.
    -- 3. Manual MRP => preserve it.
    IF NEW.fake_price IS NULL THEN
        NEW.fake_price :=
            public.generate_stable_product_mrp(
                NEW.actual_price::NUMERIC,
                NEW.id
            );

        NEW.mrp_generated_from_price :=
            NEW.actual_price::NUMERIC;

    ELSIF TG_OP = 'UPDATE'
      AND NEW.actual_price IS DISTINCT FROM OLD.actual_price
      AND NEW.mrp_generated_from_price IS NOT NULL
      AND ABS(
          NEW.mrp_generated_from_price
          - NEW.actual_price::NUMERIC
      ) < 0.01
    THEN
        NEW.fake_price :=
            public.generate_stable_product_mrp(
                NEW.actual_price::NUMERIC,
                NEW.id
            );

        NEW.mrp_generated_from_price :=
            NEW.actual_price::NUMERIC;
    END IF;

    IF NEW.fake_price IS NULL
       OR NEW.fake_price <= NEW.actual_price::NUMERIC THEN
        RAISE EXCEPTION
            'MRP must be greater than the selling price.';
    END IF;

    RETURN NEW;
END;
$$;


CREATE TRIGGER products_pricing_trigger
BEFORE INSERT OR UPDATE OF
    title,
    slug,
    actual_price,
    fake_price,
    mrp_generated_from_price
ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.enforce_product_pricing();


-- Product updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_products_updated_at
ON public.products;

CREATE TRIGGER set_products_updated_at
BEFORE UPDATE
ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();


-- Product indexes
CREATE UNIQUE INDEX IF NOT EXISTS products_slug_unique_idx
ON public.products (slug);

CREATE INDEX IF NOT EXISTS products_sort_order_idx
ON public.products (
    sort_order,
    created_at DESC
);

CREATE INDEX IF NOT EXISTS products_catalog_visibility_idx
ON public.products (
    is_active,
    visibility,
    is_draft,
    created_at DESC
);


-- ============================================================
-- 3. STORE SETTINGS — FINAL FRONTEND CONTRACT
-- ============================================================

CREATE TABLE IF NOT EXISTS public.store_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    store_name TEXT NOT NULL DEFAULT 'Twisted Happiness',
    admin_whatsapp TEXT NOT NULL DEFAULT '917383333494',
    support_whatsapp TEXT NOT NULL DEFAULT '917383333494',
    standard_delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 80
        CHECK (standard_delivery_fee >= 0),
    free_shipping_threshold NUMERIC(12,2) NOT NULL DEFAULT 1499
        CHECK (free_shipping_threshold >= 0),
    global_canvas_sizes JSONB NOT NULL DEFAULT '[]'::JSONB
        CHECK (jsonb_typeof(global_canvas_sizes) = 'array'),
    vip_tiers JSONB NOT NULL DEFAULT
        '[{"minimumQuantity":1,"percent":0},{"minimumQuantity":2,"percent":5},{"minimumQuantity":3,"percent":10},{"minimumQuantity":5,"percent":15}]'::JSONB
        CHECK (jsonb_typeof(vip_tiers) = 'array'),
    vacation_mode BOOLEAN NOT NULL DEFAULT FALSE,
    announcement_banner_active BOOLEAN NOT NULL DEFAULT TRUE,
    announcement_banner_text TEXT,
    return_policy TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add missing columns to a partially-created table safely.
ALTER TABLE public.store_settings
    ADD COLUMN IF NOT EXISTS store_name TEXT,
    ADD COLUMN IF NOT EXISTS admin_whatsapp TEXT,
    ADD COLUMN IF NOT EXISTS support_whatsapp TEXT,
    ADD COLUMN IF NOT EXISTS standard_delivery_fee NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS free_shipping_threshold NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS global_canvas_sizes JSONB,
    ADD COLUMN IF NOT EXISTS vip_tiers JSONB,
    ADD COLUMN IF NOT EXISTS vacation_mode BOOLEAN,
    ADD COLUMN IF NOT EXISTS announcement_banner_active BOOLEAN,
    ADD COLUMN IF NOT EXISTS announcement_banner_text TEXT,
    ADD COLUMN IF NOT EXISTS return_policy TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;


-- Seed/update store settings from the existing store_configurations row.
INSERT INTO public.store_settings (
    id,
    store_name,
    admin_whatsapp,
    support_whatsapp,
    standard_delivery_fee,
    free_shipping_threshold,
    global_canvas_sizes,
    vip_tiers,
    vacation_mode,
    announcement_banner_active,
    announcement_banner_text,
    return_policy
)
SELECT
    1,
    COALESCE(sc.store_name, 'Twisted Happiness'),
    COALESCE(
        NULLIF(REGEXP_REPLACE(COALESCE(sc.admin_whatsapp, ''), '[^0-9]', '', 'g'), ''),
        '917383333494'
    ),
    COALESCE(
        NULLIF(REGEXP_REPLACE(COALESCE(sc.support_whatsapp, ''), '[^0-9]', '', 'g'), ''),
        NULLIF(REGEXP_REPLACE(COALESCE(sc.admin_whatsapp, ''), '[^0-9]', '', 'g'), ''),
        '917383333494'
    ),
    COALESCE(sc.standard_delivery_fee, 80),
    COALESCE(sc.free_shipping_threshold, 1499),
    COALESCE(
        (
            SELECT jsonb_agg(
                jsonb_strip_nulls(
                    jsonb_build_object(
                        'id', cs.id::TEXT,
                        'shape', LOWER(cs.shape),
                        'width', CASE
                            WHEN LOWER(cs.shape) = 'circle'
                            THEN cs.width_inches
                            ELSE cs.width_inches
                        END,
                        'height', CASE
                            WHEN LOWER(cs.shape) = 'circle'
                            THEN NULL
                            ELSE cs.height_inches
                        END,
                        'diameter', CASE
                            WHEN LOWER(cs.shape) = 'circle'
                            THEN cs.width_inches
                            ELSE NULL
                        END,
                        'label', cs.label,
                        'sort_order', COALESCE(cs.sort_order, 0)
                    )
                )
                ORDER BY COALESCE(cs.sort_order, 0), cs.id
            )
            FROM public.canvas_sizes cs
            WHERE COALESCE(cs.is_active, TRUE) = TRUE
        ),
        '[]'::JSONB
    ),
    CASE
        WHEN jsonb_typeof(sc.vip_tiers) = 'array'
        THEN sc.vip_tiers
        WHEN jsonb_typeof(sc.vip_tiers) = 'object'
        THEN COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'minimumQuantity', key::INTEGER,
                        'percent', value::NUMERIC
                    )
                    ORDER BY key::INTEGER
                )
                FROM jsonb_each(sc.vip_tiers)
            ),
            '[{"minimumQuantity":1,"percent":0},{"minimumQuantity":2,"percent":5},{"minimumQuantity":3,"percent":10},{"minimumQuantity":5,"percent":15}]'::JSONB
        )
        ELSE
            '[{"minimumQuantity":1,"percent":0},{"minimumQuantity":2,"percent":5},{"minimumQuantity":3,"percent":10},{"minimumQuantity":5,"percent":15}]'::JSONB
    END,
    COALESCE(sc.vacation_mode, FALSE),
    COALESCE(sc.announcement_banner_active, TRUE),
    sc.announcement_banner_text,
    sc.return_policy
FROM public.store_configurations sc
WHERE sc.id = 1
ON CONFLICT (id)
DO UPDATE SET
    store_name = EXCLUDED.store_name,
    admin_whatsapp = EXCLUDED.admin_whatsapp,
    support_whatsapp = EXCLUDED.support_whatsapp,
    standard_delivery_fee = EXCLUDED.standard_delivery_fee,
    free_shipping_threshold = EXCLUDED.free_shipping_threshold,
    global_canvas_sizes = EXCLUDED.global_canvas_sizes,
    vip_tiers = EXCLUDED.vip_tiers,
    vacation_mode = EXCLUDED.vacation_mode,
    announcement_banner_active = EXCLUDED.announcement_banner_active,
    announcement_banner_text = EXCLUDED.announcement_banner_text,
    return_policy = EXCLUDED.return_policy,
    updated_at = NOW();


-- Store settings updated_at
CREATE OR REPLACE FUNCTION public.set_store_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS store_settings_updated_at
ON public.store_settings;

CREATE TRIGGER store_settings_updated_at
BEFORE UPDATE
ON public.store_settings
FOR EACH ROW
EXECUTE FUNCTION public.set_store_settings_updated_at();


-- ============================================================
-- 4. COUPONS — FINAL WEBSITE CONTRACT
-- ============================================================

ALTER TABLE public.coupons
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS stack_with_vip BOOLEAN,
    ADD COLUMN IF NOT EXISTS used_count INTEGER,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE public.coupons
SET
    code = UPPER(TRIM(code)),
    expires_at = COALESCE(expires_at, expiry_date),
    stack_with_vip = COALESCE(stack_with_vip, stackable, TRUE),
    used_count = COALESCE(used_count, 0),
    is_active = COALESCE(is_active, TRUE),
    min_spend_amount = COALESCE(min_spend_amount, 0),
    updated_at = COALESCE(updated_at, created_at, NOW());

-- Remove only discount_type constraints, then create one that supports
-- the final website's Free Delivery coupon.
DO $$
DECLARE
    v_constraint RECORD;
BEGIN
    FOR v_constraint IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.coupons'::REGCLASS
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%discount_type%'
    LOOP
        EXECUTE format(
            'ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS %I',
            v_constraint.conname
        );
    END LOOP;
END;
$$;

ALTER TABLE public.coupons
    ADD CONSTRAINT coupons_discount_type_final_contract_check
    CHECK (
        discount_type IN ('flat', 'percent', 'shipping')
    );


CREATE OR REPLACE FUNCTION public.sync_coupon_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.code := UPPER(TRIM(NEW.code));

    IF NEW.discount_type = 'shipping' THEN
        NEW.discount_value := 0;
        NEW.free_shipping := TRUE;
    ELSE
        NEW.free_shipping := COALESCE(NEW.free_shipping, FALSE);
    END IF;

    IF NEW.expires_at IS NULL
       AND NEW.expiry_date IS NOT NULL THEN
        NEW.expires_at := NEW.expiry_date;
    ELSIF NEW.expires_at IS NOT NULL THEN
        NEW.expiry_date := NEW.expires_at;
    END IF;

    IF NEW.stack_with_vip IS NULL THEN
        NEW.stack_with_vip := COALESCE(NEW.stackable, TRUE);
    END IF;

    NEW.stackable := NEW.stack_with_vip;

    NEW.used_count := GREATEST(
        COALESCE(NEW.used_count, 0),
        0
    );

    NEW.updated_at := NOW();

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_coupons_normalize
ON public.coupons;

DROP TRIGGER IF EXISTS trg_coupons_updated_at
ON public.coupons;

DROP TRIGGER IF EXISTS coupons_final_contract_trigger
ON public.coupons;

CREATE TRIGGER coupons_final_contract_trigger
BEFORE INSERT OR UPDATE
ON public.coupons
FOR EACH ROW
EXECUTE FUNCTION public.sync_coupon_contract();


CREATE UNIQUE INDEX IF NOT EXISTS coupons_code_upper_unique_idx
ON public.coupons (UPPER(code));

CREATE INDEX IF NOT EXISTS coupons_active_lookup_idx
ON public.coupons (
    UPPER(code),
    is_active
);


-- ============================================================
-- 5. REVIEWS — FINAL ADMIN CONTRACT
-- ============================================================

ALTER TABLE public.reviews
    ADD COLUMN IF NOT EXISTS customer_name TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE public.reviews
SET
    customer_name = COALESCE(
        NULLIF(customer_name, ''),
        reviewer_name,
        'Customer'
    ),
    updated_at = COALESCE(updated_at, created_at, NOW());

-- Preserve review history when a product is deleted.
ALTER TABLE public.reviews
    DROP CONSTRAINT IF EXISTS reviews_product_id_fkey;

ALTER TABLE public.reviews
    ADD CONSTRAINT reviews_product_id_fkey
    FOREIGN KEY (product_id)
    REFERENCES public.products(id)
    ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.set_reviews_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reviews_updated_at
ON public.reviews;

CREATE TRIGGER reviews_updated_at
BEFORE UPDATE
ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.set_reviews_updated_at();


-- ============================================================
-- 6. WHATSAPP ENQUIRIES — FINAL ADMIN + RPC CONTRACT
-- ============================================================

ALTER TABLE public.whatsapp_enquiries
    ADD COLUMN IF NOT EXISTS reference TEXT,
    ADD COLUMN IF NOT EXISTS client_reference TEXT,
    ADD COLUMN IF NOT EXISTS items JSONB,
    ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS whatsapp_message TEXT,
    ADD COLUMN IF NOT EXISTS coupon_counted BOOLEAN;

UPDATE public.whatsapp_enquiries
SET
    reference = COALESCE(reference, reference_code),
    client_reference = COALESCE(
        client_reference,
        request_id::TEXT
    ),
    items = COALESCE(items, items_snapshot, '[]'::JSONB),
    total_amount = COALESCE(
        total_amount,
        estimated_total,
        0
    ),
    coupon_counted = COALESCE(coupon_counted, TRUE);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_enquiries_reference_unique_idx
ON public.whatsapp_enquiries (reference)
WHERE reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_enquiries_client_reference_unique_idx
ON public.whatsapp_enquiries (client_reference)
WHERE client_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS whatsapp_enquiries_created_idx
ON public.whatsapp_enquiries (created_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_enquiries_status_idx
ON public.whatsapp_enquiries (status, created_at DESC);


-- ============================================================
-- 7. CANVAS HELPERS
-- ============================================================

CREATE OR REPLACE FUNCTION public.th_canvas_area_from_json(
    p_size JSONB
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_shape TEXT;
    v_width NUMERIC;
    v_height NUMERIC;
    v_diameter NUMERIC;
    v_label TEXT;
    v_match TEXT[];
BEGIN
    IF p_size IS NULL
       OR p_size = 'null'::JSONB THEN
        RETURN NULL;
    END IF;

    IF jsonb_typeof(p_size) = 'string' THEN
        v_label := p_size #>> '{}';

        v_match := REGEXP_MATCH(
            LOWER(v_label),
            '([0-9]+(?:\.[0-9]+)?)\s*(?:in|inch|inches|["'']*)?\s*[x×]\s*([0-9]+(?:\.[0-9]+)?)'
        );

        IF v_match IS NOT NULL THEN
            RETURN
                v_match[1]::NUMERIC
                * v_match[2]::NUMERIC;
        END IF;

        v_match := REGEXP_MATCH(
            LOWER(v_label),
            '([0-9]+(?:\.[0-9]+)?)'
        );

        IF v_match IS NOT NULL THEN
            RETURN POWER(v_match[1]::NUMERIC, 2);
        END IF;

        RETURN NULL;
    END IF;

    IF jsonb_typeof(p_size) <> 'object' THEN
        RETURN NULL;
    END IF;

    v_shape := LOWER(COALESCE(p_size->>'shape', 'square'));

    IF v_shape = 'circle' THEN
        v_diameter := COALESCE(
            NULLIF(p_size->>'diameter', '')::NUMERIC,
            NULLIF(p_size->>'width', '')::NUMERIC
        );

        IF v_diameter IS NULL OR v_diameter <= 0 THEN
            RETURN NULL;
        END IF;

        RETURN PI() * POWER(v_diameter, 2) / 4;
    END IF;

    v_width := NULLIF(p_size->>'width', '')::NUMERIC;

    IF v_width IS NULL OR v_width <= 0 THEN
        RETURN NULL;
    END IF;

    IF v_shape = 'rectangle' THEN
        v_height := NULLIF(p_size->>'height', '')::NUMERIC;
    ELSE
        v_height := v_width;
    END IF;

    IF v_height IS NULL OR v_height <= 0 THEN
        RETURN NULL;
    END IF;

    RETURN v_width * v_height;
END;
$$;


CREATE OR REPLACE FUNCTION public.th_canvas_selected_size_json(
    p_value JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_text TEXT;
    v_match TEXT[];
    v_width NUMERIC;
    v_height NUMERIC;
BEGIN
    IF p_value IS NULL
       OR p_value = 'null'::JSONB THEN
        RETURN NULL;
    END IF;

    IF jsonb_typeof(p_value) = 'object' THEN
        RETURN p_value;
    END IF;

    IF jsonb_typeof(p_value) <> 'string' THEN
        RETURN NULL;
    END IF;

    v_text := TRIM(p_value #>> '{}');

    IF v_text = '' THEN
        RETURN NULL;
    END IF;

    v_match := REGEXP_MATCH(
        LOWER(v_text),
        '([0-9]+(?:\.[0-9]+)?)\s*(?:in|inch|inches|["'']*)?\s*[x×]\s*([0-9]+(?:\.[0-9]+)?)'
    );

    IF v_match IS NOT NULL THEN
        v_width := v_match[1]::NUMERIC;
        v_height := v_match[2]::NUMERIC;

        RETURN jsonb_build_object(
            'shape',
            CASE
                WHEN v_width = v_height
                THEN 'square'
                ELSE 'rectangle'
            END,
            'width', v_width,
            'height', v_height,
            'label',
            v_width || ' × ' || v_height || ' in'
        );
    END IF;

    v_match := REGEXP_MATCH(
        LOWER(v_text),
        '([0-9]+(?:\.[0-9]+)?)'
    );

    IF v_match IS NOT NULL THEN
        RETURN jsonb_build_object(
            'shape', 'square',
            'width', v_match[1]::NUMERIC,
            'height', v_match[1]::NUMERIC,
            'label', v_match[1] || ' × ' || v_match[1] || ' in'
        );
    END IF;

    RETURN NULL;
END;
$$;


-- ============================================================
-- 8. PUBLIC STOREFRONT SETTINGS RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_storefront_settings()
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object(
        'store_name', store_name,
        'admin_whatsapp', admin_whatsapp,
        'support_whatsapp', support_whatsapp,
        'standard_delivery_fee', standard_delivery_fee,
        'free_shipping_threshold', free_shipping_threshold,
        'global_canvas_sizes', global_canvas_sizes,
        'vip_tiers', vip_tiers,
        'vacation_mode', vacation_mode,
        'announcement_banner_active', announcement_banner_active,
        'announcement_banner_text', announcement_banner_text,
        'return_policy', return_policy
    )
    FROM public.store_settings
    WHERE id = 1;
$$;

REVOKE ALL
ON FUNCTION public.get_storefront_settings()
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.get_storefront_settings()
TO anon, authenticated;


-- ============================================================
-- 9. COUPON VALIDATION RPC — EXACT FRONTEND SIGNATURE
-- ============================================================
-- Frontend call:
--   rpc('validate_coupon_for_cart', {
--      p_code: code,
--      p_subtotal: subtotal
--   })
--
-- Per-phone usage is enforced again by create_whatsapp_enquiry,
-- where the customer's phone number is available.

CREATE OR REPLACE FUNCTION public.validate_coupon_for_cart(
    p_code TEXT,
    p_subtotal NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_coupon public.coupons%ROWTYPE;
BEGIN
    SELECT *
    INTO v_coupon
    FROM public.coupons
    WHERE UPPER(code) = UPPER(TRIM(p_code))
      AND COALESCE(is_active, TRUE) = TRUE
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'valid', FALSE,
            'message', 'Coupon code is invalid or inactive.'
        );
    END IF;

    IF v_coupon.starts_at IS NOT NULL
       AND NOW() < v_coupon.starts_at THEN
        RETURN jsonb_build_object(
            'valid', FALSE,
            'message', 'This coupon is not active yet.'
        );
    END IF;

    IF COALESCE(v_coupon.expires_at, v_coupon.expiry_date) IS NOT NULL
       AND NOW() > COALESCE(v_coupon.expires_at, v_coupon.expiry_date) THEN
        RETURN jsonb_build_object(
            'valid', FALSE,
            'message', 'This coupon has expired.'
        );
    END IF;

    IF COALESCE(p_subtotal, 0)
       < COALESCE(v_coupon.min_spend_amount, 0) THEN
        RETURN jsonb_build_object(
            'valid', FALSE,
            'message',
            'Minimum spend is ₹'
            || TO_CHAR(
                COALESCE(v_coupon.min_spend_amount, 0),
                'FM999999990.00'
            )
        );
    END IF;

    IF COALESCE(v_coupon.usage_limit, 0) > 0
       AND COALESCE(v_coupon.used_count, 0)
           >= v_coupon.usage_limit THEN
        RETURN jsonb_build_object(
            'valid', FALSE,
            'message', 'This coupon has reached its usage limit.'
        );
    END IF;

    RETURN jsonb_build_object(
        'valid', TRUE,
        'id', v_coupon.id,
        'code', UPPER(v_coupon.code),
        'discount_type', v_coupon.discount_type,
        'discount_value', v_coupon.discount_value,
        'min_spend_amount', v_coupon.min_spend_amount,
        'max_discount', v_coupon.max_discount,
        'starts_at', v_coupon.starts_at,
        'expires_at',
            COALESCE(v_coupon.expires_at, v_coupon.expiry_date),
        'expiry_date',
            COALESCE(v_coupon.expires_at, v_coupon.expiry_date),
        'is_active', v_coupon.is_active,
        'stack_with_vip',
            COALESCE(v_coupon.stack_with_vip, v_coupon.stackable, TRUE),
        'display_label', v_coupon.display_label,
        'message', 'Coupon applied successfully.'
    );
END;
$$;

REVOKE ALL
ON FUNCTION public.validate_coupon_for_cart(TEXT, NUMERIC)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.validate_coupon_for_cart(TEXT, NUMERIC)
TO anon, authenticated;


-- ============================================================
-- 10. SECURE WHATSAPP ENQUIRY RPC — EXACT FRONTEND SIGNATURE
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_whatsapp_enquiry(
    p_cart JSONB,
    p_customer JSONB,
    p_coupon_code TEXT,
    p_client_reference TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing RECORD;
    v_item JSONB;
    v_product public.products%ROWTYPE;
    v_coupon public.coupons%ROWTYPE;
    v_settings public.store_settings%ROWTYPE;

    v_product_id UUID;
    v_quantity INTEGER;
    v_selected_size JSONB;
    v_selected_orientation TEXT;
    v_note TEXT;

    v_base_canvas JSONB;
    v_selected_area NUMERIC;
    v_base_area NUMERIC;
    v_unit_price NUMERIC;
    v_item_total NUMERIC;

    v_items JSONB := '[]'::JSONB;
    v_subtotal NUMERIC := 0;
    v_quantity_total INTEGER := 0;

    v_vip_percent NUMERIC := 0;
    v_vip_discount NUMERIC := 0;

    v_coupon_discount NUMERIC := 0;
    v_free_shipping_coupon BOOLEAN := FALSE;
    v_stack_with_vip BOOLEAN := TRUE;

    v_merchandise_total NUMERIC := 0;
    v_delivery_fee NUMERIC := 0;
    v_total_amount NUMERIC := 0;

    v_max_preparation_days INTEGER := 0;
    v_product_prep_max INTEGER;

    v_customer_name TEXT;
    v_customer_phone TEXT;
    v_customer_city TEXT;
    v_customer_note TEXT;

    v_reference TEXT;
    v_message TEXT;
    v_coupon_counted BOOLEAN := FALSE;

    v_phone_normalized TEXT;
    v_phone_usage_count INTEGER := 0;
BEGIN

    -- --------------------------------------------------------
    -- Validate cart/customer payload
    -- --------------------------------------------------------

    IF p_cart IS NULL
       OR jsonb_typeof(p_cart) <> 'array'
       OR jsonb_array_length(p_cart) = 0 THEN
        RAISE EXCEPTION 'Your bag is empty.';
    END IF;

    IF jsonb_array_length(p_cart) > 30 THEN
        RAISE EXCEPTION 'Too many products are in the bag.';
    END IF;

    v_customer_name :=
        NULLIF(TRIM(p_customer ->> 'name'), '');

    v_customer_phone :=
        NULLIF(TRIM(p_customer ->> 'phone'), '');

    v_customer_city :=
        NULLIF(TRIM(p_customer ->> 'city'), '');

    v_customer_note :=
        NULLIF(
            LEFT(TRIM(p_customer ->> 'note'), 260),
            ''
        );

    IF v_customer_name IS NULL THEN
        RAISE EXCEPTION 'Customer name is required.';
    END IF;

    IF v_customer_phone IS NULL
       OR LENGTH(REGEXP_REPLACE(v_customer_phone, '[^0-9]', '', 'g')) < 10 THEN
        RAISE EXCEPTION 'A valid customer WhatsApp number is required.';
    END IF;


    -- --------------------------------------------------------
    -- Idempotency
    -- --------------------------------------------------------

    IF NULLIF(TRIM(p_client_reference), '') IS NOT NULL THEN
        SELECT *
        INTO v_existing
        FROM public.whatsapp_enquiries
        WHERE client_reference = TRIM(p_client_reference)
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', TRUE,
                'duplicate', TRUE,
                'reference', v_existing.reference,
                'whatsapp_number',
                    COALESCE(
                        (SELECT admin_whatsapp FROM public.store_settings WHERE id = 1),
                        '917383333494'
                    ),
                'whatsapp_message', v_existing.whatsapp_message,
                'whatsapp_url', NULL,
                'subtotal', v_existing.subtotal,
                'vip_discount', v_existing.vip_discount,
                'coupon_discount', v_existing.coupon_discount,
                'delivery_fee', v_existing.delivery_fee,
                'total_amount', v_existing.total_amount,
                'items', v_existing.items
            );
        END IF;
    END IF;


    -- --------------------------------------------------------
    -- Settings
    -- --------------------------------------------------------

    SELECT *
    INTO v_settings
    FROM public.store_settings
    WHERE id = 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Store settings are not configured.';
    END IF;

    IF v_settings.vacation_mode THEN
        RAISE EXCEPTION
            'Ordering is temporarily paused. Please contact us on WhatsApp.';
    END IF;


    -- --------------------------------------------------------
    -- Server-side product pricing
    -- --------------------------------------------------------

    FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(p_cart)
    LOOP

        v_product_id :=
            NULLIF(
                COALESCE(
                    v_item ->> 'product_id',
                    v_item ->> 'productId'
                ),
                ''
            )::UUID;

        v_quantity :=
            COALESCE(
                NULLIF(v_item ->> 'quantity', '')::INTEGER,
                1
            );

        v_selected_size :=
            public.th_canvas_selected_size_json(
                v_item -> 'selected_size'
            );

        IF v_selected_size IS NULL THEN
            v_selected_size :=
                public.th_canvas_selected_size_json(
                    v_item -> 'selectedSize'
                );
        END IF;

        v_selected_orientation :=
            COALESCE(
                NULLIF(v_item ->> 'orientation', ''),
                NULLIF(v_item ->> 'selected_orientation', '')
            );

        v_note :=
            NULLIF(
                LEFT(
                    TRIM(
                        COALESCE(
                            v_item ->> 'note',
                            ''
                        )
                    ),
                    180
                ),
                ''
            );

        IF v_product_id IS NULL THEN
            RAISE EXCEPTION
                'A cart item is missing its product ID.';
        END IF;

        IF v_quantity < 1
           OR v_quantity > 20 THEN
            RAISE EXCEPTION
                'Product quantity must be between 1 and 20.';
        END IF;


        SELECT *
        INTO v_product
        FROM public.products
        WHERE id = v_product_id
          AND COALESCE(is_active, TRUE) = TRUE
          AND COALESCE(visibility, TRUE) = TRUE
          AND COALESCE(is_draft, FALSE) = FALSE;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'One of the selected creations is no longer available.';
        END IF;


        v_unit_price :=
            v_product.actual_price::NUMERIC;


        -- Canvas pricing
        IF v_selected_size IS NOT NULL
           AND (
               v_product.main_category = 'Painted Whispers'
               OR COALESCE(
                   v_product.attributes,
                   '{}'::JSONB
               ) ? 'canvas'
               OR COALESCE(
                   v_product.attributes,
                   '{}'::JSONB
               ) ? 'canvas_size'
           ) THEN

            v_base_canvas :=
                COALESCE(
                    v_product.attributes -> 'canvas' -> 'base_size',
                    NULL
                );

            IF v_base_canvas IS NULL THEN
                v_base_canvas :=
                    public.th_canvas_selected_size_json(
                        v_product.attributes -> 'canvas_size'
                    );
            END IF;

            v_base_area :=
                public.th_canvas_area_from_json(
                    v_base_canvas
                );

            v_selected_area :=
                public.th_canvas_area_from_json(
                    v_selected_size
                );

            IF v_base_area IS NULL
               OR v_base_area <= 0 THEN
                RAISE EXCEPTION
                    'The base canvas size for "%" is invalid.',
                    v_product.title;
            END IF;

            IF v_selected_area IS NULL
               OR v_selected_area <= 0 THEN
                RAISE EXCEPTION
                    'The selected canvas size for "%" is invalid.',
                    v_product.title;
            END IF;

            -- Exact restoration of the base price:
            -- selecting the original size must return the exact stored price.
            IF ABS(v_selected_area - v_base_area) < 0.0001 THEN
                v_unit_price :=
                    v_product.actual_price::NUMERIC;
            ELSE
                v_unit_price :=
                    ROUND(
                        (
                            v_product.actual_price::NUMERIC
                            * v_selected_area
                            / v_base_area
                        ) / 10
                    ) * 10;
            END IF;
        END IF;


        v_item_total :=
            ROUND(
                v_unit_price * v_quantity,
                2
            );

        v_subtotal :=
            v_subtotal + v_item_total;

        v_quantity_total :=
            v_quantity_total + v_quantity;


        SELECT COALESCE(
            MAX((match_array)[1]::INTEGER),
            0
        )
        INTO v_product_prep_max
        FROM regexp_matches(
            COALESCE(v_product.preparation_days, ''),
            '[0-9]+',
            'g'
        ) AS match_array;


        v_max_preparation_days :=
            GREATEST(
                v_max_preparation_days,
                v_product_prep_max
            );


        v_items :=
            v_items
            || jsonb_build_array(
                jsonb_build_object(
                    'product_id', v_product.id,
                    'title', v_product.title,
                    'quantity', v_quantity,
                    'unit_price', v_unit_price,
                    'item_total', v_item_total,
                    'selected_size', v_selected_size,
                    'orientation', v_selected_orientation,
                    'note', v_note,
                    'preparation_days', v_product.preparation_days
                )
            );

    END LOOP;


    -- --------------------------------------------------------
    -- VIP tier
    -- --------------------------------------------------------

    SELECT COALESCE(
        (
            SELECT (tier ->> 'percent')::NUMERIC
            FROM jsonb_array_elements(
                v_settings.vip_tiers
            ) tier
            WHERE (tier ->> 'minimumQuantity')::INTEGER
                  <= v_quantity_total
            ORDER BY
                (tier ->> 'minimumQuantity')::INTEGER DESC
            LIMIT 1
        ),
        0
    )
    INTO v_vip_percent;


    -- --------------------------------------------------------
    -- Coupon validation + locking
    -- --------------------------------------------------------

    IF NULLIF(TRIM(p_coupon_code), '') IS NOT NULL THEN

        SELECT *
        INTO v_coupon
        FROM public.coupons
        WHERE UPPER(code) = UPPER(TRIM(p_coupon_code))
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Coupon code is invalid or inactive.';
        END IF;

        IF COALESCE(v_coupon.is_active, TRUE) = FALSE THEN
            RAISE EXCEPTION 'Coupon code is invalid or inactive.';
        END IF;

        IF v_coupon.starts_at IS NOT NULL
           AND NOW() < v_coupon.starts_at THEN
            RAISE EXCEPTION 'This coupon is not active yet.';
        END IF;

        IF COALESCE(v_coupon.expires_at, v_coupon.expiry_date) IS NOT NULL
           AND NOW() > COALESCE(
               v_coupon.expires_at,
               v_coupon.expiry_date
           ) THEN
            RAISE EXCEPTION 'This coupon has expired.';
        END IF;

        IF v_subtotal < COALESCE(
            v_coupon.min_spend_amount,
            0
        ) THEN
            RAISE EXCEPTION
                'Minimum spend for this coupon is ₹%.',
                v_coupon.min_spend_amount;
        END IF;

        IF COALESCE(v_coupon.usage_limit, 0) > 0
           AND COALESCE(v_coupon.used_count, 0)
               >= v_coupon.usage_limit THEN
            RAISE EXCEPTION
                'This coupon has reached its usage limit.';
        END IF;

        v_phone_normalized :=
            NULLIF(
                REGEXP_REPLACE(
                    v_customer_phone,
                    '[^0-9]',
                    '',
                    'g'
                ),
                ''
            );

        IF COALESCE(v_coupon.per_phone_limit, 0) > 0
           AND v_phone_normalized IS NOT NULL THEN

            SELECT COUNT(*)
            INTO v_phone_usage_count
            FROM public.whatsapp_enquiries
            WHERE UPPER(coupon_code) =
                    UPPER(v_coupon.code)
              AND REGEXP_REPLACE(
                    COALESCE(customer_phone, ''),
                    '[^0-9]',
                    '',
                    'g'
                  ) = v_phone_normalized
              AND status <> 'cancelled';

            IF v_phone_usage_count
               >= v_coupon.per_phone_limit THEN
                RAISE EXCEPTION
                    'This coupon has reached its usage limit for this phone number.';
            END IF;
        END IF;

        v_stack_with_vip :=
            COALESCE(
                v_coupon.stack_with_vip,
                v_coupon.stackable,
                TRUE
            );

        v_coupon_counted := TRUE;
    END IF;


    -- --------------------------------------------------------
    -- VIP discount
    -- --------------------------------------------------------

    IF v_stack_with_vip = FALSE THEN
        v_vip_percent := 0;
    END IF;

    v_vip_discount :=
        ROUND(
            v_subtotal
            * v_vip_percent
            / 100,
            2
        );


    -- --------------------------------------------------------
    -- Coupon discount
    -- --------------------------------------------------------

    IF v_coupon_counted THEN

        IF v_coupon.discount_type = 'shipping'
           OR COALESCE(v_coupon.free_shipping, FALSE) THEN

            v_free_shipping_coupon := TRUE;
            v_coupon_discount := 0;

        ELSIF v_coupon.discount_type = 'percent' THEN

            v_coupon_discount :=
                ROUND(
                    GREATEST(
                        v_subtotal - v_vip_discount,
                        0
                    )
                    * COALESCE(
                        v_coupon.discount_value,
                        0
                    )
                    / 100,
                    2
                );

        ELSE

            v_coupon_discount :=
                COALESCE(
                    v_coupon.discount_value,
                    0
                );

        END IF;

        IF v_coupon.max_discount IS NOT NULL THEN
            v_coupon_discount :=
                LEAST(
                    v_coupon_discount,
                    v_coupon.max_discount
                );
        END IF;

        v_coupon_discount :=
            LEAST(
                v_coupon_discount,
                GREATEST(
                    v_subtotal - v_vip_discount,
                    0
                )
            );

    END IF;


    -- --------------------------------------------------------
    -- Final merchandise total
    -- --------------------------------------------------------

    v_merchandise_total :=
        GREATEST(
            v_subtotal
            - v_vip_discount
            - v_coupon_discount,
            0
        );


    -- --------------------------------------------------------
    -- Delivery
    -- --------------------------------------------------------

    IF v_free_shipping_coupon
       OR (
           v_settings.free_shipping_threshold > 0
           AND v_merchandise_total
               >= v_settings.free_shipping_threshold
       ) THEN

        v_delivery_fee := 0;

    ELSE

        v_delivery_fee :=
            COALESCE(
                v_settings.standard_delivery_fee,
                0
            );

    END IF;


    v_total_amount :=
        ROUND(
            v_merchandise_total
            + v_delivery_fee,
            2
        );


    -- --------------------------------------------------------
    -- Reference + WhatsApp message
    -- --------------------------------------------------------

    v_reference :=
        'TH-WA-'
        || TO_CHAR(NOW(), 'YYYYMMDD')
        || '-'
        || UPPER(
            SUBSTRING(
                REPLACE(
                    gen_random_uuid()::TEXT,
                    '-',
                    ''
                )
                FROM 1 FOR 8
            )
        );


    v_message :=
        '🛍️ *New Enquiry - Twisted Happiness*'
        || E'\n\n'
        || '*Reference:* '
        || v_reference
        || E'\n'
        || '*Customer:* '
        || v_customer_name
        || E'\n'
        || '*Phone:* '
        || v_customer_phone;

    IF v_customer_city IS NOT NULL THEN
        v_message :=
            v_message
            || E'\n'
            || '*City:* '
            || v_customer_city;
    END IF;

    v_message :=
        v_message
        || E'\n\n'
        || '*Items*'
        || E'\n';

    FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(v_items)
    LOOP

        v_message :=
            v_message
            || E'\n'
            || '• '
            || COALESCE(v_item ->> 'title', 'Product')
            || ' × '
            || COALESCE(v_item ->> 'quantity', '1')
            || ' — ₹'
            || TO_CHAR(
                (v_item ->> 'item_total')::NUMERIC,
                'FM999999990.00'
            );

        IF v_item -> 'selected_size' IS NOT NULL
           AND v_item -> 'selected_size' <> 'null'::JSONB THEN
            v_message :=
                v_message
                || E'\n  Size: '
                || COALESCE(
                    v_item -> 'selected_size' ->> 'label',
                    v_item -> 'selected_size' #>> '{}'
                );
        END IF;

        IF NULLIF(
            v_item ->> 'orientation',
            ''
        ) IS NOT NULL THEN
            v_message :=
                v_message
                || E'\n  Orientation: '
                || v_item ->> 'orientation';
        END IF;

        IF NULLIF(
            v_item ->> 'note',
            ''
        ) IS NOT NULL THEN
            v_message :=
                v_message
                || E'\n  Note: '
                || v_item ->> 'note';
        END IF;

    END LOOP;


    v_message :=
        v_message
        || E'\n\nSubtotal: ₹'
        || TO_CHAR(
            v_subtotal,
            'FM999999990.00'
        )
        || E'\nVIP Discount ('
        || TO_CHAR(
            v_vip_percent,
            'FM999999990.##'
        )
        || '%): -₹'
        || TO_CHAR(
            v_vip_discount,
            'FM999999990.00'
        );

    IF v_coupon_counted THEN
        v_message :=
            v_message
            || E'\nCoupon ('
            || UPPER(v_coupon.code)
            || '): '
            || CASE
                WHEN v_free_shipping_coupon
                THEN 'Free delivery'
                ELSE '-₹'
                    || TO_CHAR(
                        v_coupon_discount,
                        'FM999999990.00'
                    )
            END;
    END IF;

    v_message :=
        v_message
        || E'\nDelivery estimate: '
        || CASE
            WHEN v_delivery_fee = 0 THEN 'FREE'
            ELSE '₹'
                || TO_CHAR(
                    v_delivery_fee,
                    'FM999999990.00'
                )
           END
        || E'\n*Estimated Total: ₹'
        || TO_CHAR(
            v_total_amount,
            'FM999999990.00'
        )
        || '*'
        || E'\nMax Crafting Time: '
        || v_max_preparation_days
        || ' days.';

    IF v_customer_note IS NOT NULL THEN
        v_message :=
            v_message
            || E'\nCustomer note: '
            || v_customer_note;
    END IF;

    v_message :=
        v_message
        || E'\n\nPlease confirm availability, final delivery charges and payment details on WhatsApp.';


    -- --------------------------------------------------------
    -- Persist enquiry
    -- --------------------------------------------------------

    INSERT INTO public.whatsapp_enquiries (
        reference_code,
        request_id,
        reference,
        client_reference,
        customer_name,
        customer_phone,
        customer_city,
        customer_note,
        coupon_code,
        subtotal,
        vip_discount,
        coupon_discount,
        delivery_fee,
        estimated_total,
        total_amount,
        max_preparation_days,
        items_snapshot,
        items,
        whatsapp_message,
        coupon_counted,
        status
    )
    VALUES (
        v_reference,
        gen_random_uuid(),
        v_reference,
        NULLIF(
            TRIM(p_client_reference),
            ''
        ),
        v_customer_name,
        v_customer_phone,
        v_customer_city,
        v_customer_note,
        CASE
            WHEN v_coupon_counted
            THEN UPPER(v_coupon.code)
            ELSE NULL
        END,
        ROUND(v_subtotal, 2),
        ROUND(v_vip_discount, 2),
        ROUND(v_coupon_discount, 2),
        ROUND(v_delivery_fee, 2),
        ROUND(v_total_amount, 2),
        ROUND(v_total_amount, 2),
        v_max_preparation_days,
        v_items,
        v_items,
        v_message,
        v_coupon_counted,
        'new'
    );


    -- Increment coupon usage only after enquiry creation succeeds.
    IF v_coupon_counted THEN
        UPDATE public.coupons
        SET used_count =
            COALESCE(used_count, 0) + 1,
            updated_at = NOW()
        WHERE id = v_coupon.id;
    END IF;


    RETURN jsonb_build_object(
        'success', TRUE,
        'duplicate', FALSE,
        'reference', v_reference,
        'whatsapp_number',
            REGEXP_REPLACE(
                COALESCE(
                    v_settings.admin_whatsapp,
                    v_settings.support_whatsapp,
                    '917383333494'
                ),
                '[^0-9]',
                '',
                'g'
            ),
        'whatsapp_message', v_message,
        'whatsapp_url', NULL,
        'subtotal', ROUND(v_subtotal, 2),
        'vip_percent', v_vip_percent,
        'vip_discount', ROUND(v_vip_discount, 2),
        'coupon_discount', ROUND(v_coupon_discount, 2),
        'delivery_fee', ROUND(v_delivery_fee, 2),
        'total_amount', ROUND(v_total_amount, 2),
        'max_preparation_days', v_max_preparation_days,
        'items', v_items
    );

END;
$$;


REVOKE ALL
ON FUNCTION public.create_whatsapp_enquiry(
    JSONB,
    JSONB,
    TEXT,
    TEXT
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.create_whatsapp_enquiry(
    JSONB,
    JSONB,
    TEXT,
    TEXT
)
TO anon, authenticated;


-- Lock old six-argument public checkout RPC out of the public API.
REVOKE ALL
ON FUNCTION public.create_whatsapp_enquiry(
    JSONB,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    UUID
)
FROM PUBLIC;


-- ============================================================
-- 11. FINAL RLS POLICIES
-- ============================================================

ALTER TABLE public.products
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.store_settings
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.coupons
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.reviews
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.canvas_sizes
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.whatsapp_enquiries
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_roles
    ENABLE ROW LEVEL SECURITY;


-- Remove all existing policies from final application tables.
DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN
        SELECT
            schemaname,
            tablename,
            policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
              'products',
              'store_settings',
              'coupons',
              'reviews',
              'canvas_sizes',
              'whatsapp_enquiries',
              'user_roles'
          )
    LOOP
        EXECUTE format(
            'DROP POLICY IF EXISTS %I ON %I.%I',
            p.policyname,
            p.schemaname,
            p.tablename
        );
    END LOOP;
END;
$$;


-- Products: public sees only live creations.
CREATE POLICY products_public_read
ON public.products
FOR SELECT
TO anon, authenticated
USING (
    COALESCE(is_active, TRUE)
    AND COALESCE(visibility, TRUE)
    AND COALESCE(is_draft, FALSE) = FALSE
);

CREATE POLICY products_admin_all
ON public.products
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());


-- Store settings: admin direct access only.
CREATE POLICY store_settings_admin_all
ON public.store_settings
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());


-- Coupons: admin only.
CREATE POLICY coupons_admin_all
ON public.coupons
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());


-- Reviews: public approved read, admin CRUD.
CREATE POLICY reviews_public_approved_read
ON public.reviews
FOR SELECT
TO anon, authenticated
USING (
    COALESCE(is_approved, FALSE)
);

CREATE POLICY reviews_admin_all
ON public.reviews
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());


-- Canvas sizes: public active read, admin CRUD.
CREATE POLICY canvas_sizes_public_read
ON public.canvas_sizes
FOR SELECT
TO anon, authenticated
USING (
    COALESCE(is_active, TRUE)
);

CREATE POLICY canvas_sizes_admin_all
ON public.canvas_sizes
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());


-- Enquiries: admin only; creation is RPC-only.
CREATE POLICY whatsapp_enquiries_admin_all
ON public.whatsapp_enquiries
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());


-- User roles: authenticated users may read their own role;
-- admins may manage roles.
CREATE POLICY user_roles_read_own
ON public.user_roles
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR public.is_admin()
);

CREATE POLICY user_roles_admin_insert
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.is_admin());

CREATE POLICY user_roles_admin_update
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE POLICY user_roles_admin_delete
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.is_admin());


-- Old store_configurations is retained for compatibility but removed from
-- the public application API. The final website uses store_settings.
DO $$
BEGIN
    IF to_regclass('public.store_configurations') IS NOT NULL THEN
        EXECUTE 'DROP POLICY IF EXISTS "store_config_admin_all" ON public.store_configurations';
        EXECUTE 'DROP POLICY IF EXISTS "Public Read Global Settings" ON public.store_configurations';
        EXECUTE 'DROP POLICY IF EXISTS "Public Read Store Config" ON public.store_configurations';
        EXECUTE 'REVOKE ALL ON public.store_configurations FROM anon, authenticated';
    END IF;
END;
$$;


-- ============================================================
-- 12. GRANTS
-- ============================================================

REVOKE ALL
ON public.products,
   public.store_settings,
   public.coupons,
   public.reviews,
   public.canvas_sizes,
   public.whatsapp_enquiries
FROM anon, authenticated;

GRANT SELECT
ON public.products,
   public.reviews,
   public.canvas_sizes
TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.products,
   public.store_settings,
   public.coupons,
   public.reviews,
   public.canvas_sizes,
   public.whatsapp_enquiries
TO authenticated;

REVOKE ALL
ON public.user_roles
FROM anon, authenticated;

GRANT SELECT
ON public.user_roles
TO authenticated;

GRANT INSERT, UPDATE, DELETE
ON public.user_roles
TO authenticated;


-- ============================================================
-- 13. RECORD MIGRATION
-- ============================================================

INSERT INTO public.twisted_happiness_migrations (
    version
)
VALUES (
    '20260803_final_contract_v4'
)
ON CONFLICT (version)
DO NOTHING;


COMMIT;
