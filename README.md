# Twisted Happiness

A production-oriented, WhatsApp-first catalog for handmade pipe-cleaner art,
canvas paintings and clay keepsakes.

## Final customer journey

1. Browse and live-search the catalog.
2. Open a product, swipe its gallery and choose structured canvas options.
3. Add products to the saving bag; configured VIP tiers apply automatically.
4. Apply an exact coupon code.
5. Enter basic contact details.
6. Supabase securely recalculates every price, discount and delivery estimate.
7. WhatsApp opens with the final server-generated enquiry summary.

There is no customer login, website payment, COD automation or Shiprocket flow.

## Project structure

```text
.
├── index.html
├── product.html
├── checkout.html
├── return-policy.html
├── 404.html
├── assets/
├── css/
├── js/
├── admin/ (Overview, Products, Enquiries, Settings)
├── khushifieed/
├── supabase/
│   ├── migrations/20260803_final_whatsapp_catalog.sql
│   └── functions/README.md
└── netlify.toml
```

## Required public configuration

Edit `config.js` only when your Supabase project or domain changes:

- `SITE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `DEFAULTS.whatsapp`

The Supabase anon key is a public browser credential, not a secret. Security is
enforced by RLS and secured functions. Never place the Supabase service-role key
or database password in this repository, Netlify client code or browser files.

## Database deployment

1. In Supabase, create a full database backup/export.
2. Open SQL Editor.
3. Run the complete file:
   `supabase/migrations/20260803_final_whatsapp_catalog.sql`
4. Confirm the migration finishes successfully before deploying the frontend.
5. Ensure your Supabase Auth admin user has the admin role:

```sql
insert into public.user_roles (user_id, role)
values ('YOUR-AUTH-USER-UUID', 'admin')
on conflict (user_id) do update set role = excluded.role;
```

The migration creates the final public tables, secure functions, RLS, storage
policies and indexes. Legacy checkout/payment/customer/logistics tables are
moved to `legacy_archive`; they are not immediately deleted.

## Admin access

- Keyboard shortcut: `Ctrl + Shift + K`
- Direct path: `/khushifieed`
- Actual authentication: Supabase email/password plus `user_roles.role='admin'`

The hidden route and shortcut are convenience features only. They are not the
security boundary.

## GitHub → Netlify deployment

1. Extract this folder.
2. Commit all files to a new or existing GitHub repository.
3. In Netlify, choose **Add new site → Import an existing project**.
4. Select the repository.
5. Leave the build command empty.
6. Set the publish directory to `.` (Netlify also reads `netlify.toml`).
7. Deploy.
8. Add the production domain to Supabase Authentication → URL Configuration.
9. Add the exact site URL and `/admin/*` paths to allowed redirect URLs if your
   Supabase project requires explicit redirect allow-listing.

No secret Netlify environment variable is required for this static build.

## Production smoke test

Test these in an incognito browser and once on a real phone:

- Catalog loads only visible products.
- Live search opens the exact product.
- Product sharing opens native share or copies a direct link.
- Gallery moves one image per swipe and loops correctly.
- Canvas base size returns the exact stored price.
- Two, three and five-item VIP tiers update correctly.
- Invalid, expired and under-minimum coupons are rejected.
- Checkout returns a secure enquiry reference and opens WhatsApp.
- Admin login rejects users without the admin role.
- Product image upload creates WebP files under 500 KB when required.
- Replacing an image removes only unreferenced old storage objects.
- Enquiry status changes appear in Admin → Enquiries.

## Safe legacy cleanup

Keep `legacy_archive` until the new version has operated successfully and its
historical data has been exported. Edge Functions are deployed separately from
the repository; review them in the Supabase Dashboard and remove obsolete
checkout/payment/Shiprocket functions only after the smoke test.
