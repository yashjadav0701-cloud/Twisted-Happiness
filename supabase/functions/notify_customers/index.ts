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
  const product = payload.record; 

  // Do not notify customers if the product is saved as hidden
  if (product.is_active === false) {
    return new Response(JSON.stringify({ success: true, ignored: true }), { headers: { "Content-Type": "application/json" } });
  }

  // Fetch all subscribed customers
  const { data: subs, error } = await supabase
    .from('customer_push_subscriptions')
    .select('*');

  if (error || !subs) return new Response('Error fetching subs', { status: 500 });

  // Format the targeted message
  const notificationPayload = JSON.stringify({
    title: "✨ Fresh Drop!",
    body: `${product.title} is now available. Tap to view it before it sells out!`,
    url: `/?view=product&pid=${product.id}` // Directs them exactly to the new product page
  });

  const pushPromises = subs.map(sub => {
    const pushSubscription = { endpoint: sub.endpoint, keys: { auth: sub.auth, p256dh: sub.p256dh } };
    return webpush.sendNotification(pushSubscription, notificationPayload)
      .catch(err => {
        console.error('Customer push failed for device:', sub.id, err);
      });
  });

  await Promise.all(pushPromises);
  
  return new Response(JSON.stringify({ success: true, notified: subs.length }), { 
    headers: { "Content-Type": "application/json" } 
  });
});