/** Public runtime configuration. The anon key is safe to expose; RLS protects data. */
(() => {
  'use strict';

  const APP_CONFIG = Object.freeze({
    APP_NAME: 'Twisted Happiness',
    APP_VERSION: '2026.08.03-final',
    SITE_URL: 'https://twistedhappiness.in',

    SUPABASE_URL: 'https://jlszvfevobpqqrmmjzpp.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsc3p2ZmV2b2JwcXFybW1qenBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MzMwMTYsImV4cCI6MjEwMDMwOTAxNn0.WsaLFBk365cSO-nj2tezcLEtbxwKGm3YwZK1_eWoBmE',

    STORAGE_BUCKET: 'art-images',
    ADMIN_ROUTE: '/khushifieed/',
    RPC: Object.freeze({
      storefrontSettings: 'get_storefront_settings',
      validateCoupon: 'validate_coupon_for_cart',
      createEnquiry: 'create_whatsapp_enquiry'
    }),

    DEFAULTS: Object.freeze({
      storeName: 'Twisted Happiness',
      whatsapp: '917383333494',
      deliveryFee: 80,
      freeShippingThreshold: 1499,
      announcement: 'Every creation is handcrafted to order with love and patience.',
      vipTiers: Object.freeze([
        Object.freeze({ minimumQuantity: 1, percent: 0 }),
        Object.freeze({ minimumQuantity: 2, percent: 5 }),
        Object.freeze({ minimumQuantity: 3, percent: 10 }),
        Object.freeze({ minimumQuantity: 5, percent: 15 })
      ]),
      canvasSizes: Object.freeze([
        Object.freeze({ id: 'square-5', shape: 'square', width: 5, height: 5, label: '5 × 5 in' }),
        Object.freeze({ id: 'square-8', shape: 'square', width: 8, height: 8, label: '8 × 8 in' }),
        Object.freeze({ id: 'square-10', shape: 'square', width: 10, height: 10, label: '10 × 10 in' }),
        Object.freeze({ id: 'rectangle-8-10', shape: 'rectangle', width: 8, height: 10, label: '8 × 10 in' }),
        Object.freeze({ id: 'rectangle-12-16', shape: 'rectangle', width: 12, height: 16, label: '12 × 16 in' }),
        Object.freeze({ id: 'circle-8', shape: 'circle', diameter: 8, label: '8 in diameter' })
      ])
    }),

    CATEGORY_SUBCATEGORIES: Object.freeze({
      'Whimsical Art': Object.freeze(['Bouquets', 'Miniatures', 'Decor', 'Gift Sets']),
      'Painted Whispers': Object.freeze(['Custom Canvas', 'Floral Canvas', 'Portrait Canvas', 'Mini Canvas']),
      'Clay Stories': Object.freeze(['Miniatures', 'Keepsakes', 'Decor', 'Custom Clay']),
      'Standard': Object.freeze(['Handmade Gifts', 'Personalised Gifts', 'Other'])
    }),

    STORAGE_KEYS: Object.freeze({
      cart: 'twisted_happiness_cart_v4',
      coupon: 'twisted_happiness_coupon_v4',
      customer: 'twisted_happiness_customer_v2',
      announcement: 'twisted_happiness_announcement_v1',
      sessionSeed: 'twisted_happiness_mix_seed_v1'
    }),

    PRODUCT_PAGE_SIZE: 16,
    MAX_CART_LINES: 30,
    MAX_ITEM_QUANTITY: 20,
    MAX_PRODUCT_IMAGES: 8,
    MAX_IMAGE_BYTES: 500000,
    MAX_IMAGE_SOURCE_BYTES: 15 * 1024 * 1024,
    MAX_IMAGE_DIMENSION: 1920,
    DEFAULT_CARE_GUIDE: 'Keep away from water and direct heat.\nDust gently with a soft, dry brush.\nHandle delicate handmade details with care.'
  });

  const supabaseClient = window.supabase
    ? window.supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'twisted-happiness-auth'
        },
        global: { headers: { 'x-client-info': `twisted-happiness/${APP_CONFIG.APP_VERSION}` } }
      })
    : null;

  window.APP_CONFIG = APP_CONFIG;
  window.supabaseClient = supabaseClient;
})();
