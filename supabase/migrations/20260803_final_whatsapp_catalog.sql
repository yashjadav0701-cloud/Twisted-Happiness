BEGIN;

-- ============================================================
-- 1. ADD MISSING SHIPPING COLUMNS
-- ============================================================
ALTER TABLE public.whatsapp_enquiries
    ADD COLUMN IF NOT EXISTS customer_email TEXT,
    ADD COLUMN IF NOT EXISTS address_line_1 TEXT,
    ADD COLUMN IF NOT EXISTS address_line_2 TEXT,
    ADD COLUMN IF NOT EXISTS state TEXT,
    ADD COLUMN IF NOT EXISTS pincode TEXT;


-- ============================================================
-- 2. UPDATE RPC TO PERSIST CUSTOMER DATA FOR SHIPROCKET
-- ============================================================
DROP FUNCTION IF EXISTS public.create_whatsapp_enquiry(JSONB, JSONB, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.create_whatsapp_enquiry(JSONB, TEXT, TEXT, TEXT, TEXT, UUID);

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

    -- Customer payload extensions
    v_customer_name TEXT;
    v_customer_phone TEXT;
    v_customer_email TEXT;
    v_address_line_1 TEXT;
    v_address_line_2 TEXT;
    v_customer_city TEXT;
    v_state TEXT;
    v_pincode TEXT;
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
    IF p_cart IS NULL OR jsonb_typeof(p_cart) <> 'array' OR jsonb_array_length(p_cart) = 0 THEN
        RAISE EXCEPTION 'Your bag is empty.';
    END IF;

    IF jsonb_array_length(p_cart) > 30 THEN
        RAISE EXCEPTION 'Too many products are in the bag.';
    END IF;

    -- Extract full customer payload securely
    v_customer_name := NULLIF(TRIM(p_customer ->> 'name'), '');
    v_customer_phone := NULLIF(TRIM(p_customer ->> 'phone'), '');
    v_customer_email := NULLIF(TRIM(p_customer ->> 'email'), '');
    v_address_line_1 := NULLIF(TRIM(p_customer ->> 'address_line_1'), '');
    v_address_line_2 := NULLIF(TRIM(p_customer ->> 'address_line_2'), '');
    v_customer_city := NULLIF(TRIM(p_customer ->> 'city'), '');
    v_state := NULLIF(TRIM(p_customer ->> 'state'), '');
    v_pincode := NULLIF(TRIM(p_customer ->> 'pincode'), '');
    v_customer_note := NULLIF(LEFT(TRIM(p_customer ->> 'note'), 260), '');

    IF v_customer_name IS NULL THEN
        RAISE EXCEPTION 'Customer name is required.';
    END IF;

    IF v_customer_phone IS NULL OR LENGTH(REGEXP_REPLACE(v_customer_phone, '[^0-9]', '', 'g')) < 10 THEN
        RAISE EXCEPTION 'A valid customer WhatsApp number is required.';
    END IF;

    -- --------------------------------------------------------
    -- Idempotency Check
    -- --------------------------------------------------------
    IF NULLIF(TRIM(p_client_reference), '') IS NOT NULL THEN
        SELECT * INTO v_existing FROM public.whatsapp_enquiries WHERE client_reference = TRIM(p_client_reference) LIMIT 1;
        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', TRUE, 'duplicate', TRUE, 'reference', v_existing.reference,
                'whatsapp_number', COALESCE((SELECT admin_whatsapp FROM public.store_settings WHERE id = 1), '917383333494'),
                'whatsapp_message', v_existing.whatsapp_message, 'whatsapp_url', NULL,
                'subtotal', v_existing.subtotal, 'vip_discount', v_existing.vip_discount,
                'coupon_discount', v_existing.coupon_discount, 'delivery_fee', v_existing.delivery_fee,
                'total_amount', v_existing.total_amount, 'items', v_existing.items
            );
        END IF;
    END IF;

    -- --------------------------------------------------------
    -- Settings & Vacation Mode
    -- --------------------------------------------------------
    SELECT * INTO v_settings FROM public.store_settings WHERE id = 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Store settings are not configured.'; END IF;
    IF v_settings.vacation_mode THEN RAISE EXCEPTION 'Ordering is temporarily paused. Please contact us on WhatsApp.'; END IF;

    -- --------------------------------------------------------
    -- Server-side product pricing
    -- --------------------------------------------------------
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_cart) LOOP
        v_product_id := NULLIF(COALESCE(v_item ->> 'product_id', v_item ->> 'productId'), '')::UUID;
        v_quantity := COALESCE(NULLIF(v_item ->> 'quantity', '')::INTEGER, 1);
        v_selected_size := public.th_canvas_selected_size_json(v_item -> 'selected_size');
        IF v_selected_size IS NULL THEN v_selected_size := public.th_canvas_selected_size_json(v_item -> 'selectedSize'); END IF;
        v_selected_orientation := COALESCE(NULLIF(v_item ->> 'orientation', ''), NULLIF(v_item ->> 'selected_orientation', ''));
        v_note := NULLIF(LEFT(TRIM(COALESCE(v_item ->> 'note', '')), 180), '');

        IF v_product_id IS NULL THEN RAISE EXCEPTION 'A cart item is missing its product ID.'; END IF;
        IF v_quantity < 1 OR v_quantity > 20 THEN RAISE EXCEPTION 'Product quantity must be between 1 and 20.'; END IF;

        SELECT * INTO v_product FROM public.products WHERE id = v_product_id AND COALESCE(is_active, TRUE) = TRUE AND COALESCE(visibility, TRUE) = TRUE AND COALESCE(is_draft, FALSE) = FALSE;
        IF NOT FOUND THEN RAISE EXCEPTION 'One of the selected creations is no longer available.'; END IF;

        v_unit_price := v_product.actual_price::NUMERIC;

        IF v_selected_size IS NOT NULL AND (v_product.main_category = 'Painted Whispers' OR COALESCE(v_product.attributes, '{}'::JSONB) ? 'canvas' OR COALESCE(v_product.attributes, '{}'::JSONB) ? 'canvas_size') THEN
            v_base_canvas := COALESCE(v_product.attributes -> 'canvas' -> 'base_size', NULL);
            IF v_base_canvas IS NULL THEN v_base_canvas := public.th_canvas_selected_size_json(v_product.attributes -> 'canvas_size'); END IF;
            v_base_area := public.th_canvas_area_from_json(v_base_canvas);
            v_selected_area := public.th_canvas_area_from_json(v_selected_size);

            IF v_base_area IS NULL OR v_base_area <= 0 THEN RAISE EXCEPTION 'The base canvas size for "%" is invalid.', v_product.title; END IF;
            IF v_selected_area IS NULL OR v_selected_area <= 0 THEN RAISE EXCEPTION 'The selected canvas size for "%" is invalid.', v_product.title; END IF;

            IF ABS(v_selected_area - v_base_area) < 0.0001 THEN
                v_unit_price := v_product.actual_price::NUMERIC;
            ELSE
                v_unit_price := ROUND((v_product.actual_price::NUMERIC * v_selected_area / v_base_area) / 10) * 10;
            END IF;
        END IF;

        v_item_total := ROUND(v_unit_price * v_quantity, 2);
        v_subtotal := v_subtotal + v_item_total;
        v_quantity_total := v_quantity_total + v_quantity;

        SELECT COALESCE(MAX((match_array)[1]::INTEGER), 0) INTO v_product_prep_max FROM regexp_matches(COALESCE(v_product.preparation_days, ''), '[0-9]+', 'g') AS match_array;
        v_max_preparation_days := GREATEST(v_max_preparation_days, v_product_prep_max);

        v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', v_product.id, 'title', v_product.title, 'quantity', v_quantity, 'unit_price', v_unit_price, 'item_total', v_item_total, 'selected_size', v_selected_size, 'orientation', v_selected_orientation, 'note', v_note, 'preparation_days', v_product.preparation_days));
    END LOOP;

    -- --------------------------------------------------------
    -- VIP tier & Coupon validation
    -- --------------------------------------------------------
    SELECT COALESCE((SELECT (tier ->> 'percent')::NUMERIC FROM jsonb_array_elements(v_settings.vip_tiers) tier WHERE (tier ->> 'minimumQuantity')::INTEGER <= v_quantity_total ORDER BY (tier ->> 'minimumQuantity')::INTEGER DESC LIMIT 1), 0) INTO v_vip_percent;

    IF NULLIF(TRIM(p_coupon_code), '') IS NOT NULL THEN
        SELECT * INTO v_coupon FROM public.coupons WHERE UPPER(code) = UPPER(TRIM(p_coupon_code)) FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Coupon code is invalid or inactive.'; END IF;
        IF COALESCE(v_coupon.is_active, TRUE) = FALSE THEN RAISE EXCEPTION 'Coupon code is invalid or inactive.'; END IF;
        IF v_coupon.starts_at IS NOT NULL AND NOW() < v_coupon.starts_at THEN RAISE EXCEPTION 'This coupon is not active yet.'; END IF;
        IF COALESCE(v_coupon.expires_at, v_coupon.expiry_date) IS NOT NULL AND NOW() > COALESCE(v_coupon.expires_at, v_coupon.expiry_date) THEN RAISE EXCEPTION 'This coupon has expired.'; END IF;
        IF v_subtotal < COALESCE(v_coupon.min_spend_amount, 0) THEN RAISE EXCEPTION 'Minimum spend for this coupon is ₹%.', v_coupon.min_spend_amount; END IF;
        IF COALESCE(v_coupon.usage_limit, 0) > 0 AND COALESCE(v_coupon.used_count, 0) >= v_coupon.usage_limit THEN RAISE EXCEPTION 'This coupon has reached its usage limit.'; END IF;

        v_phone_normalized := NULLIF(REGEXP_REPLACE(v_customer_phone, '[^0-9]', '', 'g'), '');
        IF COALESCE(v_coupon.per_phone_limit, 0) > 0 AND v_phone_normalized IS NOT NULL THEN
            SELECT COUNT(*) INTO v_phone_usage_count FROM public.whatsapp_enquiries WHERE UPPER(coupon_code) = UPPER(v_coupon.code) AND REGEXP_REPLACE(COALESCE(customer_phone, ''), '[^0-9]', '', 'g') = v_phone_normalized AND status <> 'cancelled';
            IF v_phone_usage_count >= v_coupon.per_phone_limit THEN RAISE EXCEPTION 'This coupon has reached its usage limit for this phone number.'; END IF;
        END IF;

        v_stack_with_vip := COALESCE(v_coupon.stack_with_vip, v_coupon.stackable, TRUE);
        v_coupon_counted := TRUE;
    END IF;

    -- --------------------------------------------------------
    -- Calculations (VIP, Coupon, Total, Shipping)
    -- --------------------------------------------------------
    IF v_stack_with_vip = FALSE THEN v_vip_percent := 0; END IF;
    v_vip_discount := ROUND(v_subtotal * v_vip_percent / 100, 2);

    IF v_coupon_counted THEN
        IF v_coupon.discount_type = 'shipping' OR COALESCE(v_coupon.free_shipping, FALSE) THEN
            v_free_shipping_coupon := TRUE; v_coupon_discount := 0;
        ELSIF v_coupon.discount_type = 'percent' THEN
            v_coupon_discount := ROUND(GREATEST(v_subtotal - v_vip_discount, 0) * COALESCE(v_coupon.discount_value, 0) / 100, 2);
        ELSE
            v_coupon_discount := COALESCE(v_coupon.discount_value, 0);
        END IF;
        IF v_coupon.max_discount IS NOT NULL THEN v_coupon_discount := LEAST(v_coupon_discount, v_coupon.max_discount); END IF;
        v_coupon_discount := LEAST(v_coupon_discount, GREATEST(v_subtotal - v_vip_discount, 0));
    END IF;

    v_merchandise_total := GREATEST(v_subtotal - v_vip_discount - v_coupon_discount, 0);

    IF v_free_shipping_coupon OR (v_settings.free_shipping_threshold > 0 AND v_merchandise_total >= v_settings.free_shipping_threshold) THEN
        v_delivery_fee := 0;
    ELSE
        v_delivery_fee := COALESCE(v_settings.standard_delivery_fee, 0);
    END IF;

    v_total_amount := ROUND(v_merchandise_total + v_delivery_fee, 2);

    -- --------------------------------------------------------
    -- Reference + WhatsApp message compilation
    -- --------------------------------------------------------
    v_reference := 'TH-WA-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 8));

    v_message := '🛍️ *New Enquiry - Twisted Happiness*' || E'\n\n*Reference:* ' || v_reference || E'\n*Customer:* ' || v_customer_name || E'\n*Phone:* ' || v_customer_phone;

    -- Inject precise address details for studio visibility
    IF v_address_line_1 IS NOT NULL THEN
        v_message := v_message || E'\n*Address:* ' || v_address_line_1;
        IF v_address_line_2 IS NOT NULL THEN v_message := v_message || ', ' || v_address_line_2; END IF;
        v_message := v_message || E'\n*Location:* ' || COALESCE(v_customer_city, '') || ', ' || COALESCE(v_state, '') || ' - ' || COALESCE(v_pincode, '');
    ELSIF v_customer_city IS NOT NULL THEN
        v_message := v_message || E'\n*City:* ' || v_customer_city;
    END IF;

    v_message := v_message || E'\n\n*Items*\n';

    FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
        v_message := v_message || E'\n• ' || COALESCE(v_item ->> 'title', 'Product') || ' × ' || COALESCE(v_item ->> 'quantity', '1') || ' — ₹' || TO_CHAR((v_item ->> 'item_total')::NUMERIC, 'FM999999990.00');
        IF v_item -> 'selected_size' IS NOT NULL AND v_item -> 'selected_size' <> 'null'::JSONB THEN v_message := v_message || E'\n  Size: ' || COALESCE(v_item -> 'selected_size' ->> 'label', v_item -> 'selected_size' #>> '{}'); END IF;
        IF NULLIF(v_item ->> 'orientation', '') IS NOT NULL THEN v_message := v_message || E'\n  Orientation: ' || v_item ->> 'orientation'; END IF;
        IF NULLIF(v_item ->> 'note', '') IS NOT NULL THEN v_message := v_message || E'\n  Note: ' || v_item ->> 'note'; END IF;
    END LOOP;

    v_message := v_message || E'\n\nSubtotal: ₹' || TO_CHAR(v_subtotal, 'FM999999990.00') || E'\nVIP Discount (' || TO_CHAR(v_vip_percent, 'FM999999990.##') || '%): -₹' || TO_CHAR(v_vip_discount, 'FM999999990.00');
    IF v_coupon_counted THEN v_message := v_message || E'\nCoupon (' || UPPER(v_coupon.code) || '): ' || CASE WHEN v_free_shipping_coupon THEN 'Free delivery' ELSE '-₹' || TO_CHAR(v_coupon_discount, 'FM999999990.00') END; END IF;
    v_message := v_message || E'\nDelivery estimate: ' || CASE WHEN v_delivery_fee = 0 THEN 'FREE' ELSE '₹' || TO_CHAR(v_delivery_fee, 'FM999999990.00') END || E'\n*Estimated Total: ₹' || TO_CHAR(v_total_amount, 'FM999999990.00') || '*' || E'\nMax Crafting Time: ' || v_max_preparation_days || ' days.';
    IF v_customer_note IS NOT NULL THEN v_message := v_message || E'\nCustomer note: ' || v_customer_note; END IF;
    v_message := v_message || E'\n\nPlease confirm availability, final delivery charges and payment details on WhatsApp.';

    -- --------------------------------------------------------
    -- Persist enquiry with full shipping details
    -- --------------------------------------------------------
    INSERT INTO public.whatsapp_enquiries (
        reference_code, request_id, reference, client_reference,
        customer_name, customer_phone, customer_email,
        address_line_1, address_line_2, customer_city, state, pincode,
        customer_note, coupon_code, subtotal, vip_discount, coupon_discount, delivery_fee, estimated_total, total_amount, max_preparation_days, items_snapshot, items, whatsapp_message, coupon_counted, status
    ) VALUES (
        v_reference, gen_random_uuid(), v_reference, NULLIF(TRIM(p_client_reference), ''),
        v_customer_name, v_customer_phone, v_customer_email,
        v_address_line_1, v_address_line_2, v_customer_city, v_state, v_pincode,
        v_customer_note, CASE WHEN v_coupon_counted THEN UPPER(v_coupon.code) ELSE NULL END, ROUND(v_subtotal, 2), ROUND(v_vip_discount, 2), ROUND(v_coupon_discount, 2), ROUND(v_delivery_fee, 2), ROUND(v_total_amount, 2), ROUND(v_total_amount, 2), v_max_preparation_days, v_items, v_items, v_message, v_coupon_counted, 'new'
    );

    IF v_coupon_counted THEN UPDATE public.coupons SET used_count = COALESCE(used_count, 0) + 1, updated_at = NOW() WHERE id = v_coupon.id; END IF;

    RETURN jsonb_build_object(
        'success', TRUE, 'duplicate', FALSE, 'reference', v_reference,
        'whatsapp_number', REGEXP_REPLACE(COALESCE(v_settings.admin_whatsapp, v_settings.support_whatsapp, '917383333494'), '[^0-9]', '', 'g'),
        'whatsapp_message', v_message, 'whatsapp_url', NULL, 'subtotal', ROUND(v_subtotal, 2), 'vip_percent', v_vip_percent, 'vip_discount', ROUND(v_vip_discount, 2), 'coupon_discount', ROUND(v_coupon_discount, 2), 'delivery_fee', ROUND(v_delivery_fee, 2), 'total_amount', ROUND(v_total_amount, 2), 'max_preparation_days', v_max_preparation_days, 'items', v_items
    );

END;
$$;

INSERT INTO public.twisted_happiness_migrations (version) VALUES ('20260815_checkout_data_fix') ON CONFLICT (version) DO NOTHING;

COMMIT;