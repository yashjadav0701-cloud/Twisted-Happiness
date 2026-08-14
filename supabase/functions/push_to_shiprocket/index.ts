import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Extract dynamic package dimensions passed from admin panel
    const { recordId, length, breadth, height, weight } = await req.json();

    // 1. Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Fetch enquiry from database
    const { data: enquiry, error: fetchError } = await supabaseClient
      .from('whatsapp_enquiries')
      .select('*')
      .eq('id', recordId)
      .single();

    if (fetchError || !enquiry) throw new Error("Order not found in database.");
    if (enquiry.shiprocket_order_id) throw new Error("Order already pushed to Shiprocket.");

    // 2. Authenticate with Shiprocket
    const authRes = await fetch('https://apiv2.shiprocket.in/v1/external/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: Deno.env.get('SHIPROCKET_EMAIL'),
        password: Deno.env.get('SHIPROCKET_PASSWORD')
      })
    });
    
    if (!authRes.ok) throw new Error("Failed to authenticate with Shiprocket.");
    const authData = await authRes.json();
    const token = authData.token;

    // Format items payload & calculate correct item subtotal
    const orderItems = (enquiry.items || []).map((item: any) => ({
      name: item.title || "Handcrafted Item",
      sku: item.product_id || item.productId || "SKU-TH-01",
      units: Number(item.quantity) || 1,
      selling_price: Number(item.unit_price || item.estimatedPrice) || 0,
      discount: 0,
      tax: 0,
      hsn: ""
    }));

    // Calculate exact product subtotal from items
    const subTotal = orderItems.reduce((sum: number, item: any) => sum + (item.selling_price * item.units), 0);
    const shippingCharges = Number(enquiry.delivery_fee) || 0;

    // Clean phone number to strictly 10 digits for India
    const rawPhone = String(enquiry.customer_phone || '').replace(/\D/g, '');
    const cleanPhone = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone;

    // Build Shiprocket payload with corrected math & clean phone
    const shiprocketPayload = {
      order_id: enquiry.reference,
      order_date: new Date(enquiry.created_at).toISOString().replace('T', ' ').substring(0, 16),
      pickup_location: "Home", 
      comment: enquiry.customer_note || "",
      billing_customer_name: String(enquiry.customer_name || "Customer").split(' ')[0],
      billing_last_name: String(enquiry.customer_name || "Customer").split(' ').slice(1).join(' ') || ".", // Shiprocket requires a fallback character if last name is empty
      billing_address: enquiry.address_line_1 || "Address not provided",
      billing_address_2: enquiry.address_line_2 || "",
      billing_city: enquiry.customer_city || "Nadiad",
      billing_pincode: enquiry.pincode || "387001",
      billing_state: enquiry.state || "Gujarat",
      billing_country: "India",
      billing_email: enquiry.customer_email || "customer@twistedhappiness.com",
      billing_phone: cleanPhone,
      shipping_is_billing: true,
      order_items: orderItems,
      payment_method: "Prepaid",
      shipping_charges: shippingCharges,
      giftwrap_charges: 0,
      transaction_charges: 0,
      total_discount: 0,
      sub_total: subTotal,
      length: Number(length) || 10,
      breadth: Number(breadth) || 10,
      height: Number(height) || 10,
      weight: Number(weight) || 0.5
    };

    // 4. Push the ad-hoc order to Shiprocket
    const orderRes = await fetch('https://apiv2.shiprocket.in/v1/external/orders/create/adhoc', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(shiprocketPayload)
    });

    const orderData = await orderRes.json();
    if (!orderRes.ok) throw new Error(orderData.message || JSON.stringify(orderData) || "Shiprocket order creation failed.");

    // 5. Save the generated Shiprocket ID back to your database to prevent duplicate pushes
    const shiprocketOrderId = orderData.order_id || orderData.payload?.order_id;
    
    await supabaseClient
      .from('whatsapp_enquiries')
      .update({ shiprocket_order_id: String(shiprocketOrderId) })
      .eq('id', recordId);

    return new Response(JSON.stringify({ success: true, order_id: shiprocketOrderId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});