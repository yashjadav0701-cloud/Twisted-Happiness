import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Must be inside to survive Deno cold starts
    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!publicKey || !privateKey) throw new Error('VAPID keys are missing.');
    webpush.setVapidDetails('mailto:yashjadav0701@gmail.com', publicKey, privateKey);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const payload = await req.json();
    const order = payload.record || {}; 
    const amount = order.total_amount || order.subtotal || 0;
    const customer = order.customer_name || 'A customer';

    const items = Array.isArray(order.items) ? order.items : [];
    const totalQuantity = items.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 1), 0);
    const itemDetails = items.slice(0, 2).map((item: any) => `${item.quantity || 1}x ${item.title}`).join(', ');
    const extraCount = items.length > 2 ? ` +${items.length - 2} more` : '';
    const itemsText = items.length > 0 ? ` (${itemDetails}${extraCount})` : '';

    // 🔥 FATAL FIX: Actually query the database! Your previous file omitted this.
    const { data: subs, error } = await supabase.from('admin_push_subscriptions').select('subscription');
    
    // Graceful return if no admins exist to prevent crashing
    if (error || !subs || subs.length === 0) {
       return new Response(JSON.stringify({ success: true, message: 'No admins registered' }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const notificationPayload = JSON.stringify({
      title: `🛍️ New Order: ₹${amount}`,
      body: `${customer} ordered ${totalQuantity} item(s)${itemsText}. Tap to open.`,
      icon: "https://twistedhappiness.vercel.app/assets/icon-192.png",
      url: `/admin.html#enquiries?open=${order.id}` 
    });

    const pushPromises = subs.map(async (item) => {
      const sub = item.subscription;
      if (!sub || !sub.endpoint) return;
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { auth: sub.keys?.auth, p256dh: sub.keys?.p256dh } }, notificationPayload);
      } catch (err) {
        console.error(`Push failed for ${sub.endpoint}:`, err);
      }
    });

    await Promise.all(pushPromises);
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error('Admin Edge Function Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});