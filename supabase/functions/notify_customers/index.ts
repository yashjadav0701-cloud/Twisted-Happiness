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
    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!publicKey || !privateKey) throw new Error('VAPID keys are missing.');
    webpush.setVapidDetails('mailto:yashjadav0701@gmail.com', publicKey, privateKey);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const payload = await req.json();
    const product = payload.record || {}; 
    const isUpdate = payload.isUpdate || false;

    if (product.is_active === false) return new Response(JSON.stringify({ success: true, ignored: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: subs, error } = await supabase.from('customer_push_subscriptions').select('*');
    if (error || !subs || subs.length === 0) return new Response(JSON.stringify({ success: true, notified: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    let productImage = product.images?.[0] || null;
    if (productImage && productImage.startsWith('/')) {
      productImage = `https://twistedhappiness.vercel.app${productImage}`;
    }

    // Clean payload construction ensuring Android compatibility
    let payloadObj: any = {
      title: isUpdate ? "✨ Restocked & Updated!" : "✨ Fresh Drop!",
      body: isUpdate ? `${product.title} has been updated. Tap to check it out!` : `${product.title} is now available. Tap to view!`,
      icon: "https://twistedhappiness.vercel.app/assets/icon-192.png",
      url: `/?view=product&pid=${product.id}` 
    };

    if (productImage) payloadObj.image = productImage;

    const notificationPayload = JSON.stringify(payloadObj);
    let successCount = 0;

    const pushPromises = subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { auth: sub.auth, p256dh: sub.p256dh } }, notificationPayload);
        successCount++;
      } catch (err) {
        console.error('Customer push failed:', err);
      }
    });

    await Promise.all(pushPromises);
    return new Response(JSON.stringify({ success: true, notified: successCount }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error('Customer Edge Function Error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});