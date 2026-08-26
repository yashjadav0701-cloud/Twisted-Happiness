# Final deployment checklist

## Before deployment

- [ ] Download a Supabase database backup.
- [ ] Run `supabase/migrations/20260803_final_whatsapp_catalog.sql` once.
- [ ] Add the correct Auth user UUID to `public.user_roles` as `admin`.
- [ ] Confirm `config.js` contains the live site URL, Supabase URL and anon key.
- [ ] Confirm the WhatsApp number includes the country code without `+`.

## After Netlify deployment

- [ ] Open the home page in an incognito window.
- [ ] Test live search and product filters.
- [ ] Test native product sharing on mobile.
- [ ] Test a standard item and every canvas shape.
- [ ] Verify the exact base canvas price restores after changing size.
- [ ] Test VIP tiers and one coupon of every enabled type.
- [ ] Complete a cart checkout and confirm the WhatsApp message and enquiry row.
- [ ] Test `/khushifieed` and `Ctrl + Shift + K`.
- [ ] Upload, reorder, replace and delete a product image.
- [ ] Change an enquiry status to confirmed and verify coupon usage increments.
- [ ] Confirm no horizontal overflow at 320 px, 375 px, 768 px and desktop widths.

## Later cleanup

- [ ] Export any historical data required from `legacy_archive`.
- [ ] Review and delete obsolete deployed Supabase Edge Functions.
- [ ] Remove the archive only after a separate backup and business approval.
