# Edge Functions

The final Twisted Happiness website does not require a checkout, payment, COD,
Shiprocket, or order-creation Edge Function.

The final quote is calculated by the secured PostgreSQL function
`create_whatsapp_enquiry(...)`. It validates live products, structured canvas
sizes, VIP tiers, coupons and delivery before returning the WhatsApp message.

After the production smoke test, remove legacy deployed functions from the
Supabase Dashboard only when they are no longer referenced. Common old names
from earlier versions include:

- `create-order`
- `validate-coupon`
- `create-shipment`
- `admin-order-action`
- payment verification/webhook functions

Do not delete a deployed function solely because it appears in this list;
confirm the exact names under Supabase → Edge Functions first.
