# Project-wide audit and implementation record

## Source audited

The uploaded WhatsApp-first Twisted Happiness ZIP was used as the foundation.
The audit covered every HTML, CSS and JavaScript file, the current Supabase
client contract, admin CRUD, local cart, coupon flow, canvas pricing, image
processing, Netlify settings and the supplied database-alignment notes.

## Preserved and improved

- Public product catalog and Supabase product CRUD
- Product categories, subcategories, preparation time and care instructions
- Structured canvas pricing by area
- Local saving bag and quick single-product WhatsApp path
- VIP quantity discounts and coupon codes
- Admin image upload, WebP conversion and safe orphan cleanup
- Supabase email/password admin authentication and role authorization
- Existing visual identity, logo, pastel palette and premium typography

## Replaced

- Client-authoritative checkout calculations → secure Supabase quote RPC
- Comma-separated canvas sizes → structured square/rectangle/circle objects
- Masonry/waterfall catalog → predictable responsive product grid
- Draft/inventory/out-of-stock concepts → one visible/hidden product switch
- Broad settings/coupon reads → safe settings and exact-code RPCs
- Traditional order/payment path → lightweight WhatsApp enquiry snapshots
- Oversized/fragmented storefront hierarchy → compact hero and scan-friendly UI

## Removed from the final runtime

- Customer login/account requirement
- Website payment, COD automation and payment verification
- Shiprocket checkout/shipment integration
- Client-side authority over price, VIP, coupon or delivery totals
- Publish/draft workflow and stock reservation
- Obsolete account and order pages (legacy URLs redirect safely)
- Tailwind CDN dependency and unused framework code

## Security decisions

- The browser receives only the Supabase anon key; no service-role credential is
  present in the repository.
- RLS is explicit for products, settings, coupons, reviews, enquiries and roles.
- Final checkout re-fetches every product and recalculates canvas variants,
  discounts and delivery in PostgreSQL.
- Anonymous users cannot directly read coupon definitions or enquiry records.
- Admin access requires Auth plus `user_roles.role = 'admin'`; the shortcut and
  hidden path are not treated as security.
- Storage uploads and deletion are admin-only and limited to the art-images
  product path.

## Data migration strategy

The final SQL builds clean replacement tables, copies compatible production
data using JSON adapters, archives obsolete public tables into
`legacy_archive`, promotes the final tables, then applies constraints, indexes,
functions, RLS and storage policies. Historical checkout data is not silently
deleted.

## Validation performed

- JavaScript syntax validation for all application files
- Duplicate HTML ID audit
- Local HTML/CSS/JS/image link audit
- SQL quote, dollar-block and parenthesis balance audit
- Legacy runtime reference scan
- ZIP file integrity and path audit

A live database migration cannot be executed without privileged access to the
Supabase project. The included deployment checklist requires a backup and a
post-migration production smoke test before archived objects or deployed Edge
Functions are deleted.
