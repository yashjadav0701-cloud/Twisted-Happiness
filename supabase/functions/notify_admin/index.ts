import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push";

webpush.setVapidDetails(
  'mailto:yashjadav0701@gmail.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!
);

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const payload = await req.json();
  const order = payload.record; // This maps directly to your whatsapp_enquiries table
  const amount = order.total_amount || 0;
  const customer = order.customer_name || 'A customer';

  // Fetch all devices that clicked "Enable Alerts"
  const { data: subs, error } = await supabase
    .from('admin_push_subscriptions')
    .select('subscription');

  if (error || !subs) return new Response('Error fetching subscriptions', { status: 500 });

  const notificationPayload = JSON.stringify({
    title: "🌸 New Twisted Happiness Order!",
    body: `${customer} placed an order for ₹${amount}. Tap to view in enquiries.`,
    url: "/admin.html#enquiries"
  });

  const pushPromises = subs.map(sub => {
    return webpush.sendNotification(sub.subscription, notificationPayload)
      .catch(err => console.error('Push failed for device:', err));
  });

  await Promise.all(pushPromises);
  
  return new Response(JSON.stringify({ success: true }), { 
    headers: { "Content-Type": "application/json" } 
  });
});