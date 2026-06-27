-- Phase 9.6 (accessibility): product photos need alt text so screen readers can describe them and
-- WCAG 2.4 is met on the storefront. Additive + nullable, per the Phase 2.12 forward-only policy:
-- existing rows keep NULL and the storefront falls back to the product name. New/edited products
-- with a photo require alt text (>= 3 chars) at the Zod boundary (lib/schemas/product.ts).
-- No RLS change — products_owner_all + the anon active-store read policy already govern this table.

alter table public.products
  add column if not exists image_alt text;

comment on column public.products.image_alt is
  'Accessible description of image_url (Phase 9.6). NULL falls back to the product name on render.';
