/** Twisted Happiness WhatsApp-first storefront. */
(() => {
  'use strict';

  const APP_CONFIG = Object.freeze({
    APP_NAME: 'Twisted Happiness',
    APP_VERSION: 'v2.0.0',
    SITE_URL: 'https://twistedhappiness.vercel.app/',
    SUPABASE_URL: 'https://jlszvfevobpqqrmmjzpp.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsc3p2ZmV2b2JwcXFybW1qenBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MzMwMTYsImV4cCI6MjEwMDMwOTAxNn0.WsaLFBk365cSO-nj2tezcLEtbxwKGm3YwZK1_eWoBmE',
    STORAGE_BUCKET: 'art-images',
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
    STORAGE_KEYS: Object.freeze({ 
      cart: 'twisted_happiness_cart_v4', 
      coupon: 'twisted_happiness_coupon_v2', 
      customer: 'twisted_happiness_customer_v2', 
      announcement: 'twisted_happiness_announcement_dismissed' 
    }),
    MAX_CART_LINES: 15,
    MAX_ITEM_QUANTITY: 20,
    PRODUCT_PAGE_SIZE: 16
  });

  const supabaseClient = window.supabase ? window.supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY) : null;

  const Utils = {
    parseJSON(value, fallback = null) { try { return typeof value === 'string' ? JSON.parse(value) : (value ?? fallback); } catch { return fallback; } },
    escapeHTML(value = '') { return String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]); },
    safeImageURL(value, fallback = '') { if (!value) return fallback; try { const url = new URL(String(value), window.location.origin); if (['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) return url.href; } catch {} return fallback; },
    normaliseImages(value) { let imgs = value; if (typeof imgs === 'string') { const p = Utils.parseJSON(imgs, null); imgs = Array.isArray(p) ? p : imgs.split(','); } return Array.isArray(imgs) ? [...new Set(imgs.map((i) => Utils.safeImageURL(String(i).trim())).filter(Boolean))] : []; },
    normaliseAttributes(value) { const p = Utils.parseJSON(value, value); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; },
    normaliseVipTiers(value, fallback = []) { const p = Utils.parseJSON(value, value); if (!Array.isArray(p)) return [...fallback]; const tiers = p.map((t) => ({ minimumQuantity: Math.max(1, Math.floor(Number(t.minimumQuantity ?? t.minimum_quantity ?? 1))), percent: Math.min(80, Math.max(0, Number(t.percent ?? t.discount_percent ?? 0))) })).filter((t) => Number.isFinite(t.minimumQuantity) && Number.isFinite(t.percent)).sort((a, b) => a.minimumQuantity - b.minimumQuantity); if (!tiers.length || tiers[0].minimumQuantity !== 1) tiers.unshift({ minimumQuantity: 1, percent: 0 }); return tiers; },
    normaliseCanvasSizes(value, fallback = []) { const p = Utils.parseJSON(value, value); if (Array.isArray(p)) return p.map((e, i) => Utils.normaliseCanvasSize(e, i)).filter(Boolean); if (typeof p === 'string') return p.split(',').map((l, i) => Utils.normaliseCanvasSize(l.trim(), i)).filter(Boolean); return [...fallback]; },
    normaliseCanvasSize(entry, index = 0) {
      if (!entry) return null;
      if (typeof entry === 'string') {
        const text = entry.replace(/×/g, 'x').trim();
        const rectangle = text.match(/(\d+(?:\.\d+)?)\s*["']?\s*x\s*(\d+(?:\.\d+)?)/i);
        if (rectangle) return { id: `size-${index}-${Number(rectangle[1])}-${Number(rectangle[2])}`, shape: Number(rectangle[1]) === Number(rectangle[2]) ? 'square' : 'rectangle', width: Number(rectangle[1]), height: Number(rectangle[2]), label: `${Utils.cleanNumber(rectangle[1])} × ${Utils.cleanNumber(rectangle[2])} in` };
        const circle = text.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|inches|["'])?/i);
        if (circle && /circle|diameter/i.test(text)) return { id: `circle-${index}-${Number(circle[1])}`, shape: 'circle', diameter: Number(circle[1]), label: `${Utils.cleanNumber(circle[1])} in diameter` };
        return null;
      }
      const shape = String(entry.shape || 'square').toLowerCase(); const w = Number(entry.width || 0); const h = Number(entry.height || (shape === 'square' ? w : 0)); const d = Number(entry.diameter || 0);
      if (shape === 'circle' && d > 0) return { id: String(entry.id || `circle-${index}-${d}`), shape, diameter: d, label: String(entry.label || `${Utils.cleanNumber(d)} in diameter`) };
      if (w > 0 && h > 0) return { id: String(entry.id || `${shape}-${index}-${w}-${h}`), shape: w === h ? 'square' : 'rectangle', width: w, height: h, label: String(entry.label || `${Utils.cleanNumber(w)} × ${Utils.cleanNumber(h)} in`) };
      return null;
    },
    cleanNumber(value) { const num = Number(value); return Number.isInteger(num) ? String(num) : String(Number(num.toFixed(2))); },
    roundMoney(value) { return Math.round(Number(value || 0)); },
    formatCurrency(value) { const n = Utils.roundMoney(value); return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n); },
    slugify(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90); },
    clamp(num, min, max) { return Math.min(Math.max(Number(num) || 0, min), max); },
    sameCanvasSize(a, b) { 
      if (!a || !b) return false;
      if (String(a.id) === String(b.id)) return true;
      if (a.shape !== b.shape) return false;
      if (a.shape === 'circle') return Number(a.diameter) === Number(b.diameter);
      return Number(a.width) === Number(b.width) && Number(a.height) === Number(b.height);
    },
    calculateCanvasPrice(basePrice, baseSize, targetSize) {
      const price = Number(basePrice) || 0;
      if (!price || !baseSize || !targetSize) return price;
      const getArea = (s) => s.shape === 'circle' ? (s.diameter * s.diameter) : (s.width * (s.height || s.width));
      const baseArea = getArea(baseSize);
      const targetArea = getArea(targetSize);
      if (!baseArea || !targetArea) return price;
      return Utils.roundMoney(price * (targetArea / baseArea));
    },
    debounce(func, wait) { let timeout; return function executedFunction(...args) { const later = () => { clearTimeout(timeout); func(...args); }; clearTimeout(timeout); timeout = setTimeout(later, wait); }; },
    setBodyLocked(locked) { if (locked) { document.documentElement.classList.add('is-locked'); document.body.classList.add('is-locked'); } else { document.documentElement.classList.remove('is-locked'); document.body.classList.remove('is-locked'); } },
    createLocalReference() { return `TH-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Date.now().toString().slice(-4)}`; },
    toast(message, type = 'success', delayMs = 0) {
      let region = document.getElementById('toast-region');
      if (!region) { region = document.createElement('div'); region.id = 'toast-region'; region.className = 'toast-region'; document.body.appendChild(region); }
      const toast = document.createElement('div'); toast.className = `app-toast app-toast--${type}`;
      
      const icon = type === 'success' 
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` 
        : `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
        
      toast.innerHTML = `<span class="app-toast__icon">${icon}</span><span class="app-toast__text">${Utils.escapeHTML(message)}</span>`;
      region.appendChild(toast);
      
      // Delay the start of the slide-in animation safely
      setTimeout(() => {
        void toast.offsetWidth; // CRITICAL: Forces browser reflow so the slide CSS transition never skips!
        toast.classList.add('is-visible');
        setTimeout(() => { toast.classList.remove('is-visible'); setTimeout(() => toast.remove(), 400); }, 1000);
      }, delayMs);
    },
    choice({ title = 'Please choose', message = '', icon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>', primaryLabel = 'Continue', secondaryLabel = 'Cancel', hideSecondary = false } = {}) {
      return new Promise((resolve) => {
        document.getElementById('app-modal-overlay')?.remove();
        const overlay = document.createElement('div'); overlay.id = 'app-modal-overlay'; overlay.className = 'app-modal-overlay';
        overlay.innerHTML = `<section class="app-modal" role="dialog" aria-modal="true"><div class="app-modal__icon" aria-hidden="true">${icon}</div><h2>${Utils.escapeHTML(title)}</h2><p>${Utils.escapeHTML(message)}</p><div class="app-modal__actions">${hideSecondary ? '' : `<button type="button" class="app-button app-button--soft" data-modal-secondary>${Utils.escapeHTML(secondaryLabel)}</button>`}<button type="button" class="app-button app-button--dark" data-modal-primary>${Utils.escapeHTML(primaryLabel)}</button></div></section>`;
        document.body.appendChild(overlay);
        overlay.querySelector('[data-modal-primary]')?.addEventListener('click', () => { overlay.remove(); resolve('primary'); });
        overlay.querySelector('[data-modal-secondary]')?.addEventListener('click', () => { overlay.remove(); resolve('secondary'); });
        overlay.addEventListener('click', (e) => { if (e.target === overlay && !hideSecondary) { overlay.remove(); resolve('dismiss'); } });
      });
    },
    async share(data) {
      try { if (navigator.share && navigator.canShare && navigator.canShare(data)) { await navigator.share(data); } else { await navigator.clipboard.writeText(data.url || data.text); Utils.toast('Link copied to clipboard'); } } catch (e) { if (e.name !== 'AbortError') Utils.toast('Sharing failed', 'error'); }
    }
  };

  // Fresh seed for each page load.
// The Featured Mix order changes after every full refresh,
// while remaining stable during filtering/sorting within the same page session.
const CATALOG_REFRESH_SEED = `${Date.now()}-${Math.random()}`;
  const state = {
    page: document.body.dataset.page || 'catalog',
    products: [],
    filteredProducts: [],
    cart: loadCart(),
    coupon: normaliseCoupon(readStorage(APP_CONFIG.STORAGE_KEYS.coupon, null)),
    store: {
      store_name: APP_CONFIG.DEFAULTS.storeName,
      admin_whatsapp: APP_CONFIG.DEFAULTS.whatsapp,
      support_whatsapp: APP_CONFIG.DEFAULTS.whatsapp,
      standard_delivery_fee: APP_CONFIG.DEFAULTS.deliveryFee,
      free_shipping_threshold: APP_CONFIG.DEFAULTS.freeShippingThreshold,
      global_canvas_sizes: APP_CONFIG.DEFAULTS.canvasSizes,
      vip_tiers: APP_CONFIG.DEFAULTS.vipTiers,
      vacation_mode: false,
      announcement_banner_active: false,
      announcement_banner_text: APP_CONFIG.DEFAULTS.announcement
    },
    category: 'All',
    search: '',
    sort: 'featured',
    visibleCount: APP_CONFIG.PRODUCT_PAGE_SIZE,
    activeProduct: null,
    activeCanvasSize: null,
    activePrice: 0,
    activeMRP: 0,
    gallery: { images: [], virtualIndex: 0, logicalIndex: 0, transitioning: false, startX: 0, deltaX: 0 },
    searchSuggestionIndex: -1,
    categoryImages: {}
  };

  function bindRouter() {
    window.addEventListener('popstate', () => {
      // Intercept physical back button to close overlays instead of navigating away
      const cartDrawer = document.getElementById('cart-drawer');
      const searchOverlay = document.getElementById('search-overlay');
      const modalOverlay = document.getElementById('app-modal-overlay');
      let overlayClosed = false;

      // 1. Close Cart if open
      if (cartDrawer && cartDrawer.classList.contains('is-open')) {
        closeCart(true); // true = Visually close without triggering history.back again
        overlayClosed = true;
      }

      // 2. Close Search if open
      if (searchOverlay && searchOverlay.classList.contains('is-active')) {
        searchOverlay.classList.remove('is-active');
        searchOverlay.setAttribute('aria-hidden', 'true');
        document.getElementById('search-suggestions')?.classList.add('hidden');
        if (document.activeElement && searchOverlay.contains(document.activeElement)) {
          document.activeElement.blur();
        }
        overlayClosed = true;
      }

      // 3. Close generic popup choice modals if open
      if (modalOverlay) {
        modalOverlay.remove();
        overlayClosed = true;
      }

      if (overlayClosed) return; // Prevent full page re-render since we just closed a drawer

      executeRouteTransition(window.location.href, false);
    });

    document.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (!link) return;
      
      const url = new URL(link.href);
      if (url.origin === window.location.origin && !link.hasAttribute('download') && link.target !== '_blank') {
        if (url.pathname === window.location.pathname && url.hash) return;
        e.preventDefault();
        executeRouteTransition(url.href, true);
      }
    });
  }

  async function executeRouteTransition(urlStr, pushState = true) {
    const root = document.getElementById('spa-root');
    if (root) {
      root.style.transition = 'opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1), transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)';
      root.style.opacity = '0';
      root.style.transform = 'translateY(8px)';
      await new Promise(r => setTimeout(r, 250));
    }

    if (pushState) window.history.pushState({}, '', urlStr);
    handleRoute(new URL(urlStr, window.location.origin));

    if (root) {
      window.scrollTo(0, 0);
      requestAnimationFrame(() => {
        root.style.opacity = '1';
        root.style.transform = 'none';
      });
    }
  }

  function handleRoute(url) {
    const path = url.pathname;
    const view = url.searchParams.get('view');
    document.querySelectorAll('.spa-view').forEach(v => { v.style.display = 'none'; v.classList.remove('active'); });

    if (path.startsWith('/product') || view === 'product' || path.startsWith('/share')) {
      state.page = 'product';
      document.getElementById('view-product').style.display = 'block';
      document.body.dataset.page = 'product';
      
      let pid = url.searchParams.get('pid');
      if (path.startsWith('/product/')) pid = path.split('/')[2];
      initialiseProduct(pid);
    } else if (path.startsWith('/checkout') || view === 'checkout') {
      state.page = 'checkout';
      document.getElementById('view-checkout').style.display = 'block';
      document.body.dataset.page = 'checkout';
      initialiseCheckout(url.searchParams.get('mode'));
    } else if (path.startsWith('/khushiified') || view === 'khushiified') {
      // Secret Admin URL Trigger
      window.location.href = '/admin.html';
      return;
    } else if (path.startsWith('/return-policy') || view === 'policy') {
      state.page = 'policy';
      document.getElementById('view-policy').style.display = 'block';
      document.body.dataset.page = 'policy';
      document.title = 'No-Return Policy | Twisted Happiness';
    } else if (path !== '/' && path !== '/index.html' && path !== '/index' && !view) {
      state.page = '404';
      document.getElementById('view-404').style.display = 'block';
      document.body.dataset.page = '404';
      document.title = 'Page Not Found | Twisted Happiness';
    } else {
      state.page = 'catalog';
      document.getElementById('view-home').style.display = 'block';
      document.body.dataset.page = 'catalog';
      document.title = 'Twisted Happiness | Handcrafted Art Studio';
      initialiseCatalog();
    }

    requestAnimationFrame(() => {
      document.querySelector('.spa-view[style*="block"]')?.classList.add('active');
    });
  }

  async function initialiseApp() {
    try {
      // 1. Instantly show the correct page skeleton before fetching database data
      const initUrl = new URL(window.location.href);
      const initPath = initUrl.pathname;
      const initView = initUrl.searchParams.get('view');
      
      document.querySelectorAll('.spa-view').forEach(v => { v.style.display = 'none'; v.classList.remove('active'); });
      
      if (initPath.startsWith('/product') || initView === 'product' || initPath.startsWith('/share')) {
        document.getElementById('view-product').style.display = 'block';
        document.body.dataset.page = 'product';
      } else if (initPath.startsWith('/checkout') || initView === 'checkout') {
        document.getElementById('view-checkout').style.display = 'block';
        document.body.dataset.page = 'checkout';
      } else if (initPath.startsWith('/return-policy') || initView === 'policy') {
        document.getElementById('view-policy').style.display = 'block';
        document.body.dataset.page = 'policy';
      } else if (initPath !== '/' && initPath !== '/index.html' && initPath !== '/index' && !initView && !initPath.startsWith('/khushiified')) {
        document.getElementById('view-404').style.display = 'block';
        document.body.dataset.page = '404';
      } else {
        document.getElementById('view-home').style.display = 'block';
        document.body.dataset.page = 'catalog';
      }
      
      document.querySelector('.spa-view[style*="block"]')?.classList.add('active');

      // 2. Proceed with normal initialization
      injectSharedCart();
      bindSharedCartEvents();
      bindGlobalEvents();
      setCurrentYear();
      bindRouter();
      
      try { await fetchStoreConfiguration(); } catch (e) { console.warn('Store config warning:', e); }
      try { applyStoreConfiguration(); } catch (e) { console.warn('Apply config warning:', e); }
      
      await fetchProducts();
      renderCart();

      handleRoute(new URL(window.location.href));
    } catch (error) {
      console.error('Critical initialization error:', error);
      document.getElementById('catalog-loading')?.classList.add('hidden');
      showCatalogError('Unable to load the collection. Please refresh.');
    }
  }

  function readStorage(key, fallback) {
    try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  }

  function writeStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be blocked */ }
  }

  function readSession(key, fallback) {
    try { const value = sessionStorage.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  }

  function writeSession(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be blocked */ }
  }

  function loadCart() {
    const candidates = [
      readStorage(APP_CONFIG.STORAGE_KEYS.cart, null),
      readStorage('twisted_happiness_cart_v3', null),
      readStorage('twisted_happiness_cart_v1', null),
      readStorage('twisted_cart', [])
    ];
    const source = candidates.find(Array.isArray) || [];
    const cart = source.map(normaliseCartItem).filter(Boolean).slice(0, APP_CONFIG.MAX_CART_LINES);
    writeStorage(APP_CONFIG.STORAGE_KEYS.cart, cart);
    return cart;
  }

  function normaliseCartItem(item) {
    if (!item || !item.title) return null;
    const productId = String(item.productId || item.product_id || item.id || '');
    if (!productId) return null;
    const selectedSize = item.selectedSize ? Utils.normaliseCanvasSize(item.selectedSize) : null;
    const note = String(item.note || item.customNote || '').trim().slice(0, 180);
    const orientation = String(item.orientation || '').trim() || null;
    return {
      key: item.key || cartKey(productId, selectedSize, orientation, note),
      productId,
      title: String(item.title),
      image: Utils.safeImageURL(item.image || item.thumbImg || '', '/assets/th_logo.svg?v=mtgyytmo'),
      estimatedPrice: Utils.roundMoney(item.estimatedPrice ?? item.price ?? 0),
      quantity: Math.floor(Utils.clamp(item.quantity || item.qty || 1, 1, APP_CONFIG.MAX_ITEM_QUANTITY)),
      selectedSize,
      orientation,
      note,
      preparationDays: String(item.preparationDays || item.prepDays || 'Made to order')
    };
  }

  function activeCheckoutItems() {
    return state.cart;
  }

  function persistCart() {
    writeStorage(APP_CONFIG.STORAGE_KEYS.cart, state.cart);
    validateStoredCoupon();
    renderCart();
    if (state.page === 'checkout') renderCheckout();
  }

  async function fetchStoreConfiguration() {
    if (!supabaseClient) return;
    const { data, error } = await supabaseClient.rpc(APP_CONFIG.RPC.storefrontSettings);
    if (error || !data) {
      console.warn('Store settings fallback used:', error?.message || 'No data');
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return;
    state.store = {
      ...state.store,
      ...row,
      global_canvas_sizes: Utils.normaliseCanvasSizes(row.global_canvas_sizes, APP_CONFIG.DEFAULTS.canvasSizes),
      vip_tiers: Utils.normaliseVipTiers(row.vip_tiers, APP_CONFIG.DEFAULTS.vipTiers)
    };
  }

  async function fetchProducts() {
    if (!supabaseClient) return showCatalogError('The catalog connection is unavailable.');
    const { data, error } = await supabaseClient
      .from('products')
      .select('id,title,slug,actual_price,fake_price,main_category,sub_category,preparation_days,attributes,images,description,care_instructions,sort_order,created_at')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) {
      console.error('Catalog load failed:', error);
      showCatalogError('The collection could not be loaded. Please refresh shortly.');
      return;
    }

    state.products = (data || []).map((product) => ({
      ...product,
      actual_price: Utils.roundMoney(product.actual_price),
      fake_price: product.fake_price ? Utils.roundMoney(product.fake_price) : null,
      attributes: Utils.normaliseAttributes(product.attributes),
      images: Utils.normaliseImages(product.images)
    }));
  }

  function applyStoreConfiguration() {
    const announcement = document.getElementById('announcement-bar');
    const text = document.getElementById('announcement-text');
    
    // Always show if active (removed the 'dismissed' memory check)
    if (announcement && text && state.store.announcement_banner_active && state.store.announcement_banner_text) {
      text.textContent = state.store.announcement_banner_text;
      announcement.classList.remove('hidden');
    }
    
    // Close button purely hides it for the current session without saving to memory
    document.getElementById('announcement-close')?.addEventListener('click', () => {
      announcement?.classList.add('hidden');
    });

    const helpMessage = state.store.vacation_mode
      ? 'Hello Twisted Happiness,\n\nI would like to join the waitlist for a handcrafted order.'
      : 'Hello Twisted Happiness,\n\nI need help choosing a handcrafted product.';
    const helpURL = whatsappURL(helpMessage);
    ['header-whatsapp', 'footer-whatsapp', 'reassurance-whatsapp'].forEach((id) => {
      const link = document.getElementById(id);
      if (link) { link.href = helpURL; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    });
  }

  function bindGlobalEvents() {
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-open-cart]')) openCart();
    });

    // Secret Admin Keyboard Shortcut Trigger
    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault(); // Prevents default browser behavior
        window.location.href = '/admin.html';
      }
    });
  }

  function setCurrentYear() {
    document.querySelectorAll('[data-current-year]').forEach((element) => { element.textContent = String(new Date().getFullYear()); });
  }

  /* ---------------- Catalog and search ---------------- */
  let catalogEventsBound = false;

  function initialiseCatalog() {
    const search = document.getElementById('catalog-search');
    const clear = document.getElementById('catalog-search-clear');
    const sort = document.getElementById('catalog-sort');
    renderHomeVipTiers();
    renderCategoryChips();
    applyCatalogFilters();

    if (!catalogEventsBound) {
      search?.addEventListener('input', Utils.debounce(() => {
        state.search = search.value.trim().toLowerCase();
        state.searchSuggestionIndex = -1;
        clear?.classList.toggle('hidden', !state.search);
        renderSearchSuggestions();
      }, 120));
      search?.addEventListener('keydown', handleSearchKeyboard);
      search?.addEventListener('focus', renderSearchSuggestions);

      clear?.addEventListener('click', () => {
        search.value = '';
        state.search = '';
        clear.classList.add('hidden');
        hideSearchSuggestions();
        state.visibleCount = APP_CONFIG.PRODUCT_PAGE_SIZE;
        applyCatalogFilters();
        search.focus();
      });

      sort?.addEventListener('change', () => {
        state.sort = sort.value;
        state.visibleCount = APP_CONFIG.PRODUCT_PAGE_SIZE;
        applyCatalogFilters();
      });

      const sortWrapper = document.getElementById('custom-sort-wrapper');
      const sortToggle = document.getElementById('sort-toggle');
      const sortMenu = document.getElementById('sort-menu');
      const sortCurrentLabel = document.getElementById('sort-current-label');

      sortToggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        const isExpanded = sortToggle.getAttribute('aria-expanded') === 'true';
        sortToggle.setAttribute('aria-expanded', !isExpanded);
        sortWrapper.classList.toggle('is-open', !isExpanded);
      });

      sortMenu?.addEventListener('click', (e) => {
        const option = e.target.closest('li[data-sort-val]');
        if (!option) return;
        sortCurrentLabel.textContent = option.textContent;
        if (sort) {
          sort.value = option.dataset.sortVal;
          sort.dispatchEvent(new Event('change'));
        }
        sortMenu.querySelectorAll('li').forEach(li => li.setAttribute('aria-selected', 'false'));
        option.setAttribute('aria-selected', 'true');
        sortToggle.setAttribute('aria-expanded', 'false');
        sortWrapper.classList.remove('is-open');
      });

      document.addEventListener('click', (e) => {
        if (sortWrapper && !sortWrapper.contains(e.target)) {
          sortToggle?.setAttribute('aria-expanded', 'false');
          sortWrapper.classList.remove('is-open');
        }
      });
      document.getElementById('reset-catalog')?.addEventListener('click', resetCatalog);
      document.getElementById('load-more')?.addEventListener('click', () => { state.visibleCount += APP_CONFIG.PRODUCT_PAGE_SIZE; renderCatalogProducts(); });
      document.getElementById('product-grid')?.addEventListener('click', handleProductGridClick);
      document.getElementById('search-suggestions')?.addEventListener('click', handleSearchSuggestionClick);
      
      const searchToggle = document.getElementById('header-search-toggle');
      const searchOverlay = document.getElementById('search-overlay');
      const searchClose = document.getElementById('search-close');
      
      function closeSearch(fromPopState = false) {
        if (!searchOverlay) return;
        if (document.activeElement && searchOverlay.contains(document.activeElement)) {
          document.activeElement.blur();
        }
        searchOverlay.classList.remove('is-active');
        searchOverlay.setAttribute('aria-hidden', 'true');
        hideSearchSuggestions();
        
        // If closed via "Cancel" button or clicking backdrop, pop the dummy state to keep browser history clean
        if (fromPopState !== true && history.state && history.state.overlay === 'search') {
          history.back();
        }
      }

      searchToggle?.addEventListener('click', () => {
        if (!searchOverlay) return;
        
        // Push a dummy history state so the mobile hardware back button has something to pop
        if (!history.state || history.state.overlay !== 'search') {
          history.pushState({ ...history.state, overlay: 'search' }, '', window.location.href);
        }
        
        searchOverlay.classList.add('is-active');
        searchOverlay.setAttribute('aria-hidden', 'false');
        setTimeout(() => search?.focus(), 150);
      });

      searchClose?.addEventListener('click', () => closeSearch(false));

      document.addEventListener('click', (event) => { 
        if (event.target.matches('.search-overlay__backdrop') || event.target.closest('[data-close-search]')) {
          closeSearch(false);
        }
        if (!event.target.closest('.search-overlay__panel') && !event.target.closest('#header-search-toggle')) {
          hideSearchSuggestions(); 
        }
      });
      
      catalogEventsBound = true;
    }
  }

  function renderHomeVipTiers() {
    const host = document.getElementById('home-vip-tiers');
    if (!host) return;
    const tiers = Array.isArray(state.store?.vip_tiers) ? state.store.vip_tiers : [];
    if (!tiers.length) return;
    host.innerHTML = tiers.map((tier, index) => {
      const next = tiers[index + 1];
      const range = next ? `${tier.minimumQuantity}${next.minimumQuantity - tier.minimumQuantity > 1 ? `–${next.minimumQuantity - 1}` : ''}` : `${tier.minimumQuantity}+`;
      const label = range === '1' ? 'Item' : 'Items';
      const value = tier.percent ? `${tier.percent}% OFF` : 'Base';
      return `<div class="vip-pill"><span class="vip-pill-qty">${Utils.escapeHTML(range)} ${label}</span><strong class="vip-pill-val">${value}</strong></div>`;
    }).join('');
  }

  function renderSearchSuggestions() {
    const host = document.getElementById('search-suggestions');
    if (!host) return;

    const query = state.search.trim();

    if (!query) {
      hideSearchSuggestions();
      return;
    }

    const results = getRankedSearchResults(query).slice(0, 6);

    if (!results.length) {
      host.innerHTML = '<div class="search-suggestions__all">No matching products. Try a product, subject, style or category.</div>';
      host.classList.remove('hidden');
      return;
    }

    host.innerHTML = results.map((result, index) => `
      <button class="search-suggestion ${index === state.searchSuggestionIndex ? 'is-active' : ''}" type="button" role="option" aria-selected="${index === state.searchSuggestionIndex ? 'true' : 'false'}" data-search-product="${Utils.escapeHTML(result.product.id)}">
        <img src="${Utils.escapeHTML(result.product.images?.[0] || '/assets/th_logo.svg?v=mtgyytmo')}" alt="" loading="lazy" decoding="async">
        <span>
          <strong>${Utils.escapeHTML(result.product.title)}</strong>
          <small>${Utils.escapeHTML(result.reasons[0] || result.product.sub_category || result.product.main_category || 'Handcrafted')}</small>
        </span>
        <span>${Utils.formatCurrency(result.product.actual_price)}</span>
      </button>`).join('') + '<button class="search-suggestions__all" type="button" data-search-all>View all relevant creations</button>';

    host.classList.remove('hidden');
  }

  function handleSearchKeyboard(event) {
    const results = getRankedSearchResults(state.search).slice(0, 6);

    if (event.key === 'Escape') {
      hideSearchSuggestions();
      const overlay = document.getElementById('search-overlay');
      if (overlay) { overlay.classList.remove('is-active'); overlay.setAttribute('aria-hidden', 'true'); }
      return;
    }

    if (!results.length && event.key === 'Enter') {
        event.preventDefault();
        if (state.search.trim() !== '') {
            const overlay = document.getElementById('search-overlay');
            if (overlay) { overlay.classList.remove('is-active'); overlay.setAttribute('aria-hidden', 'true'); }
            hideSearchSuggestions();
            state.visibleCount = APP_CONFIG.PRODUCT_PAGE_SIZE;
            applyCatalogFilters();
            document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
    }
    if (!results.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      state.searchSuggestionIndex = Math.min(results.length - 1, state.searchSuggestionIndex + 1);
      renderSearchSuggestions();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      state.searchSuggestionIndex = Math.max(0, state.searchSuggestionIndex - 1);
      renderSearchSuggestions();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (state.searchSuggestionIndex >= 0) {
        const result = results[state.searchSuggestionIndex];
        if (result?.product) {
          const overlay = document.getElementById('search-overlay');
          if (overlay) { overlay.classList.remove('is-active'); overlay.setAttribute('aria-hidden', 'true'); }
          executeRouteTransition(productURL(result.product));
        }
      } else if (state.search.trim() !== '') {
        const overlay = document.getElementById('search-overlay');
        if (overlay) { overlay.classList.remove('is-active'); overlay.setAttribute('aria-hidden', 'true'); }
        hideSearchSuggestions();
        state.visibleCount = APP_CONFIG.PRODUCT_PAGE_SIZE;
        applyCatalogFilters();
        document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  function handleSearchSuggestionClick(event) {
    const productButton = event.target.closest('[data-search-product]');

    if (productButton) {
      const product = state.products.find(
        (item) => String(item.id) === String(productButton.dataset.searchProduct)
      );

      if (product) {
        const overlay = document.getElementById('search-overlay');
        if (overlay) { overlay.classList.remove('is-active'); overlay.setAttribute('aria-hidden', 'true'); }
        executeRouteTransition(productURL(product));
      }

      return;
    }

    if (event.target.closest('[data-search-all]')) {
      const overlay = document.getElementById('search-overlay');
      if (overlay) { overlay.classList.remove('is-active'); overlay.setAttribute('aria-hidden', 'true'); }
      hideSearchSuggestions();
      state.visibleCount = APP_CONFIG.PRODUCT_PAGE_SIZE;
      applyCatalogFilters();
      document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function hideSearchSuggestions() {
    document.getElementById('search-suggestions')?.classList.add('hidden');
  }

  function normaliseSearchText(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function singularSearchToken(value) {
    const token = normaliseSearchText(value);

    if (!token) return '';

    if (token.endsWith('ies') && token.length > 4) {
      return `${token.slice(0, -3)}y`;
    }

    if (token.endsWith('es') && token.length > 4) {
      return token.slice(0, -2);
    }

    if (token.endsWith('s') && token.length > 3) {
      return token.slice(0, -1);
    }

    return token;
  }

  const SEARCH_CONCEPT_GROUPS = [
    {
      id: 'flower',
      terms: ['flower', 'flowers', 'floral', 'bloom', 'blossom', 'bouquet', 'petal', 'petals']
    },
    {
      id: 'lily',
      terms: ['lily', 'lilies']
    },
    {
      id: 'rose',
      terms: ['rose', 'roses']
    },
    {
      id: 'plant',
      terms: ['plant', 'plants', 'botanical', 'botanicals', 'garden']
    },
    {
      id: 'animal',
      terms: ['animal', 'animals', 'pet', 'pets', 'wildlife']
    },
    {
      id: 'dog',
      terms: ['dog', 'dogs', 'puppy', 'puppies', 'canine']
    },
    {
      id: 'cat',
      terms: ['cat', 'cats', 'kitten', 'kittens', 'feline']
    },
    {
      id: 'rabbit',
      terms: ['rabbit', 'rabbits', 'bunny', 'bunnies']
    },
    {
      id: 'vehicle',
      terms: ['vehicle', 'vehicles', 'automobile', 'automobiles', 'transport', 'transportation']
    },
    {
      id: 'car',
      terms: ['car', 'cars', 'automobile', 'automobiles', 'vehicle', 'vehicles', 'sports car', 'sports cars', 'supercar', 'supercars', 'luxury car', 'luxury cars', 'racing car', 'racing cars']
    },
    {
      id: 'porsche',
      terms: ['porsche', 'porsches', '911', 'porsche 911', 'carrera', 'taycan', 'macan', 'cayenne', 'panamera']
    },
    {
      id: 'art',
      terms: ['art', 'artwork', 'artworks', 'painting', 'paintings', 'illustration', 'illustrations', 'drawing', 'drawings']
    },
    {
      id: 'canvas',
      terms: ['canvas', 'canvases', 'canvas art', 'canvas painting', 'canvas paintings', 'wall art', 'wall decor', 'wall decoration']
    },
    {
      id: 'decor',
      terms: ['decor', 'decoration', 'decorative', 'home decor', 'room decor', 'office decor', 'wall decor', 'wall decoration']
    },
    {
      id: 'gift',
      terms: ['gift', 'gifts', 'present', 'presents', 'keepsake', 'keepsakes', 'souvenir', 'souvenirs']
    },
    {
      id: 'handmade',
      terms: ['handmade', 'handcrafted', 'craft', 'crafts', 'crafted', 'artisan', 'artisanal']
    },
    {
      id: 'romantic',
      terms: ['romantic', 'romance', 'love', 'loving', 'couple', 'couples', 'valentine', 'valentines']
    },
    {
      id: 'custom',
      terms: ['custom', 'customise', 'customised', 'customize', 'customized', 'personalise', 'personalised', 'personalize', 'personalized', 'bespoke']
    },
    {
      id: 'red',
      terms: ['red', 'crimson', 'scarlet', 'ruby', 'cherry', 'burgundy', 'maroon', 'wine']
    },
    {
      id: 'pink',
      terms: ['pink', 'blush', 'magenta', 'fuchsia']
    },
    {
      id: 'blue',
      terms: ['blue', 'navy', 'cobalt', 'azure', 'sapphire', 'royal blue']
    },
    {
      id: 'green',
      terms: ['green', 'emerald', 'olive', 'mint', 'sage', 'lime']
    },
    {
      id: 'yellow',
      terms: ['yellow', 'golden', 'gold', 'mustard', 'lemon']
    },
    {
      id: 'cute',
      terms: ['cute', 'adorable', 'sweet', 'lovely', 'kawaii']
    }
  ];

  const SEARCH_RELATIONSHIPS = {
    porsche: ['porsche', 'car', 'vehicle', 'automobile', 'sports car', 'supercar', 'luxury car', 'automotive'],
    'porsche 911': ['porsche', 'car', 'vehicle', 'automobile', 'sports car', 'supercar', 'luxury car', 'automotive'],
    lily: ['lily', 'flower', 'floral', 'plant', 'botanical'],
    lilies: ['lily', 'flower', 'floral', 'plant', 'botanical'],
    rose: ['rose', 'flower', 'floral', 'plant', 'botanical'],
    roses: ['rose', 'flower', 'floral', 'plant', 'botanical'],
    rabbit: ['rabbit', 'bunny', 'animal', 'pet'],
    bunny: ['rabbit', 'bunny', 'animal', 'pet'],
    dog: ['dog', 'puppy', 'animal', 'pet', 'canine'],
    puppy: ['dog', 'puppy', 'animal', 'pet', 'canine'],
    cat: ['cat', 'kitten', 'animal', 'pet', 'feline'],
    kitten: ['cat', 'kitten', 'animal', 'pet', 'feline'],
    canvas: ['canvas', 'art', 'painting', 'wall art', 'wall decor', 'decor'],
    painting: ['painting', 'art', 'canvas', 'wall art', 'wall decor', 'decor'],
    art: ['art', 'artwork', 'painting', 'canvas', 'wall art', 'decor'],
    handmade: ['handmade', 'handcrafted', 'craft', 'artisan'],
    handcrafted: ['handmade', 'handcrafted', 'craft', 'artisan']
  };

  function collectSearchableProductText(product) {
    const values = [];

    const addValue = (value) => {
      if (value === null || value === undefined) return;

      if (Array.isArray(value)) {
        value.forEach(addValue);
        return;
      }

      if (typeof value === 'object') {
        Object.entries(value).forEach(([key, nestedValue]) => {
          addValue(key);
          addValue(nestedValue);
        });
        return;
      }

      const text = String(value).trim();

      if (text) values.push(text);
    };

    addValue(product.title);
    addValue(product.slug);
    addValue(product.main_category);
    addValue(product.sub_category);
    addValue(product.description);
    addValue(product.care_instructions);
    addValue(product.preparation_days);
    addValue(product.attributes);

    return normaliseSearchText(values.join(' '));
  }

  function expandSearchConcepts(query) {
    const normalizedQuery = normaliseSearchText(query);
    const tokens = normalizedQuery.split(' ').filter(Boolean).map(singularSearchToken);
    const expanded = new Set(tokens);

    SEARCH_CONCEPT_GROUPS.forEach((group) => {
      const matched = group.terms.some((term) => {
        const normalizedTerm = normaliseSearchText(term);

        return normalizedQuery.includes(normalizedTerm) ||
          tokens.includes(singularSearchToken(normalizedTerm));
      });

      if (matched) {
        expanded.add(group.id);

        group.terms.forEach((term) => {
          const normalizedTerm = normaliseSearchText(term);
          if (normalizedTerm) expanded.add(normalizedTerm);
        });
      }
    });

    Object.entries(SEARCH_RELATIONSHIPS).forEach(([term, relatedTerms]) => {
      const normalizedTerm = normaliseSearchText(term);

      if (
        normalizedQuery.includes(normalizedTerm) ||
        tokens.includes(singularSearchToken(normalizedTerm))
      ) {
        relatedTerms.forEach((relatedTerm) => {
          expanded.add(normaliseSearchText(relatedTerm));
        });
      }
    });

    return {
      normalizedQuery,
      tokens,
      expanded: [...expanded].filter(Boolean)
    };
  }

  function levenshteinDistance(first, second) {
    if (first === second) return 0;
    if (!first) return second.length;
    if (!second) return first.length;

    let previous = Array.from(
      { length: second.length + 1 },
      (_, index) => index
    );

    for (let row = 0; row < first.length; row += 1) {
      const current = [row + 1];

      for (let column = 0; column < second.length; column += 1) {
        const insertion = current[column] + 1;
        const deletion = previous[column + 1] + 1;
        const substitution =
          previous[column] +
          (first[row] === second[column] ? 0 : 1);

        current.push(Math.min(insertion, deletion, substitution));
      }

      previous = current;
    }

    return previous[previous.length - 1];
  }

  function fuzzyTokenSimilarity(first, second) {
    const a = singularSearchToken(first);
    const b = singularSearchToken(second);

    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 3 || b.length < 3) return 0;

    if (a.includes(b) || b.includes(a)) return 0.88;

    const maxLength = Math.max(a.length, b.length);
    const distance = levenshteinDistance(a, b);

    if (distance > 3) return 0;

    return Math.max(0, 1 - distance / maxLength);
  }

  function calculateBestTokenMatch(queryToken, productText) {
    const token = singularSearchToken(queryToken);
    if (!token) return 0;

    return productText
      .split(' ')
      .filter(Boolean)
      .reduce(
        (best, productToken) =>
          Math.max(best, fuzzyTokenSimilarity(token, productToken)),
        0
      );
  }

  function calculateProductRelevance(product, searchQuery) {
    const {
      normalizedQuery,
      tokens,
      expanded
    } = expandSearchConcepts(searchQuery);

    if (!normalizedQuery) {
      return {
        score: 0,
        reasons: []
      };
    }

    const title = normaliseSearchText(product.title);
    const mainCategory = normaliseSearchText(product.main_category);
    const subCategory = normaliseSearchText(product.sub_category);
    const description = normaliseSearchText(product.description);
    const fullText = collectSearchableProductText(product);

    let score = 0;
    const reasons = [];

    if (title === normalizedQuery) {
      score += 180;
      reasons.push('Exact product match');
    } else if (title.includes(normalizedQuery)) {
      score += 125;
      reasons.push('Product title match');
    }

    if (
      mainCategory === normalizedQuery ||
      subCategory === normalizedQuery
    ) {
      score += 75;
      reasons.push('Category match');
    }

    const queryTokenResults = tokens.map((token) => {
      const singularToken = singularSearchToken(token);

      if (!singularToken) {
        return { score: 0, fuzzy: false };
      }

      if (title.includes(singularToken)) {
        return { score: 38, fuzzy: false };
      }

      if (subCategory.includes(singularToken)) {
        return { score: 27, fuzzy: false };
      }

      if (mainCategory.includes(singularToken)) {
        return { score: 24, fuzzy: false };
      }

      if (description.includes(singularToken)) {
        return { score: 11, fuzzy: false };
      }

      if (fullText.includes(singularToken)) {
        return { score: 15, fuzzy: false };
      }

      const fuzzySimilarity = calculateBestTokenMatch(
        singularToken,
        fullText
      );

      if (fuzzySimilarity >= 0.84) {
        return {
          score: Math.round(18 * fuzzySimilarity),
          fuzzy: true
        };
      }

      return {
        score: 0,
        fuzzy: false
      };
    });

    queryTokenResults.forEach((result) => {
      score += result.score;

      if (result.fuzzy) {
        reasons.push('Spelling-tolerant match');
      }
    });

    const relationshipMatches = new Set();

    tokens.forEach((token) => {
      const relationships =
        SEARCH_RELATIONSHIPS[singularSearchToken(token)] || [];

      relationships.forEach((relatedTerm) => {
        const normalizedRelatedTerm = normaliseSearchText(relatedTerm);

        if (
          normalizedRelatedTerm &&
          fullText.includes(normalizedRelatedTerm)
        ) {
          relationshipMatches.add(normalizedRelatedTerm);
        }
      });
    });

    if (relationshipMatches.size) {
      score += relationshipMatches.size * 19;

      if (
        [...relationshipMatches].some((term) =>
          ['car', 'vehicle', 'automobile', 'sports car', 'supercar'].includes(term)
        )
      ) {
        reasons.push('Vehicle-related match');
      }

      if (
        [...relationshipMatches].some((term) =>
          ['flower', 'floral', 'lily', 'rose'].includes(term)
        )
      ) {
        reasons.push('Floral match');
      }

      if (
        [...relationshipMatches].some((term) =>
          ['canvas', 'art', 'painting', 'wall art', 'decor'].includes(term)
        )
      ) {
        reasons.push('Art & decor match');
      }

      if (
        [...relationshipMatches].some((term) =>
          ['animal', 'pet', 'dog', 'cat', 'rabbit', 'bunny'].includes(term)
        )
      ) {
        reasons.push('Animal-related match');
      }
    }

    if (tokens.length > 1) {
      const matchedTokens = queryTokenResults.filter(
        (result) => result.score > 0
      ).length;

      if (matchedTokens === tokens.length) {
        score += 55;
      } else if (matchedTokens >= Math.ceil(tokens.length / 2)) {
        score += 20;
      }
    }

    if (expanded.length > tokens.length) {
      const matchedConcepts = expanded.filter((concept) =>
        fullText.includes(normaliseSearchText(concept))
      );

      score += Math.min(60, matchedConcepts.length * 6);
    }

    if (fullText.includes(normalizedQuery)) {
      score += 32;
    }

    if (tokens.length === 1) {
      const fuzzySimilarity = calculateBestTokenMatch(tokens[0], title);

      if (
        fuzzySimilarity >= 0.78 &&
        !title.includes(tokens[0])
      ) {
        score += Math.round(48 * fuzzySimilarity);
        reasons.push('Fuzzy product-name match');
      }
    }

    const hasStrongSignal =
      title.includes(normalizedQuery) ||
      queryTokenResults.some((result) => result.score >= 20) ||
      relationshipMatches.size > 0 ||
      fullText.includes(normalizedQuery);

    if (!hasStrongSignal) {
      score *= 0.35;
    }

    return {
      score: Math.round(score * 100) / 100,
      reasons: [...new Set(reasons)]
    };
  }

  function getRankedSearchResults(query) {
    const normalizedQuery = normaliseSearchText(query);

    if (!normalizedQuery) return [];

    return state.products
      .map((product) => {
        const relevance = calculateProductRelevance(
          product,
          normalizedQuery
        );

        return {
          product,
          score: relevance.score,
          reasons: relevance.reasons
        };
      })
      .filter((result) => result.score >= 10)
      .sort((first, second) => {
        if (second.score !== first.score) {
          return second.score - first.score;
        }

        const firstTitle = normaliseSearchText(first.product.title);
        const secondTitle = normaliseSearchText(second.product.title);

        const firstExact = firstTitle.includes(normalizedQuery) ? 1 : 0;
        const secondExact = secondTitle.includes(normalizedQuery) ? 1 : 0;

        if (secondExact !== firstExact) {
          return secondExact - firstExact;
        }

        return Number(first.product.sort_order || 0) -
          Number(second.product.sort_order || 0);
      });
  }

  function productSearchText(product) {
    return collectSearchableProductText(product);
  }
  // ----------------------------------------------------------------
  function renderCategoryChips() {
    const host = document.getElementById('category-chips');
    if (!host) return;
    const products = Array.isArray(state.products) ? state.products : [];
    const categories = ['All', ...new Set(products.map((product) => product.main_category).filter(Boolean))];
    
    if (!state.categoryImages) state.categoryImages = {};

    host.innerHTML = categories.map((category) => {
      if (category === 'All') {
        return `<button type="button" class="category-chip category-chip--all ${state.category === 'All' ? 'is-active' : ''}" data-category="All">
          <span class="all-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <rect x="3" y="3" width="7.5" height="7.5" rx="2"/>
              <rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/>
              <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>
              <rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/>
            </svg>
          </span>
          <span>Explore All</span>
        </button>`;
      }

      if (typeof state.categoryImages[category] === 'undefined') {
        let validProducts = products.filter(p => p.main_category === category && p.images && p.images.length > 0);
        if (validProducts.length > 0) {
          state.categoryImages[category] = validProducts[Math.floor(Math.random() * validProducts.length)].images[0];
        } else {
          state.categoryImages[category] = ''; 
        }
      }
      const bgImg = state.categoryImages[category];
      const bgStyle = bgImg ? `style="background-image: url('${Utils.escapeHTML(bgImg)}');"` : '';
      
      return `<button type="button" class="category-chip ${state.category === category ? 'is-active' : ''}" data-category="${Utils.escapeHTML(category)}" ${bgStyle}><span>${Utils.escapeHTML(category)}</span></button>`;
    }).join('');
    
    host.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', async (e) => {
      const root = document.getElementById('spa-root');
      if (root) {
        root.style.transition = 'opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1), transform 0.25s cubic-bezier(0.22, 1, 0.36, 1)';
        root.style.opacity = '0';
        root.style.transform = 'translateY(8px)';
        await new Promise(r => setTimeout(r, 250));
      }

      state.category = button.dataset.category;
      
      // Clear search gracefully
      state.search = '';
      const searchInput = document.getElementById('catalog-search');
      if (searchInput) searchInput.value = '';
      document.getElementById('catalog-search-clear')?.classList.add('hidden');

      state.visibleCount = APP_CONFIG.PRODUCT_PAGE_SIZE;
      renderCategoryChips();
      applyCatalogFilters();

      if (root) {
        document.getElementById('collection')?.scrollIntoView({ behavior: 'instant', block: 'start' });
        requestAnimationFrame(() => {
          root.style.opacity = '1';
          root.style.transform = 'none';
        });
      }
    }));
  }

  function resetCatalog() {
    state.category = 'All'; state.search = ''; state.sort = 'featured'; state.visibleCount = APP_CONFIG.PRODUCT_PAGE_SIZE;
    const search = document.getElementById('catalog-search'); if (search) search.value = '';
    const sort = document.getElementById('catalog-sort'); if (sort) sort.value = 'featured';
    document.getElementById('catalog-search-clear')?.classList.add('hidden');
    hideSearchSuggestions(); renderCategoryChips(); applyCatalogFilters();
    setTimeout(() => {
      document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  function applyCatalogFilters() {
    let products = [...state.products];

    // 1. Category filtering always applies first.
    products = products.filter((product) => {
      return state.category === 'All' || product.main_category === state.category;
    });

    // 2. Intelligent relevance search.
    if (state.search && state.search.trim() !== '') {
      const allowedProductIds = new Set(
        products.map((product) => String(product.id))
      );

      products = getRankedSearchResults(state.search)
        .filter((result) => allowedProductIds.has(String(result.product.id)))
        .map((result) => result.product);
    }

    // 3. Explicit sorting.
    //
    // When searching, relevance is the default order.
    // Price/newest ordering only overrides relevance when explicitly selected.
    if (state.search && state.search.trim() !== '') {
      if (state.sort === 'price-low') {
        products.sort(
          (a, b) => Number(a.actual_price || 0) - Number(b.actual_price || 0)
        );
      } else if (state.sort === 'price-high') {
        products.sort(
          (a, b) => Number(b.actual_price || 0) - Number(a.actual_price || 0)
        );
      } else if (state.sort === 'newest') {
        products.sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at)
        );
      }
    } else {
      if (state.sort === 'price-low') {
        products.sort(
          (a, b) => Number(a.actual_price || 0) - Number(b.actual_price || 0)
        );
      } else if (state.sort === 'price-high') {
        products.sort(
          (a, b) => Number(b.actual_price || 0) - Number(a.actual_price || 0)
        );
      } else if (state.sort === 'newest') {
        products.sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at)
        );
      } else {
        products = seededMix(products);
      }
    }

    state.filteredProducts = products;
    revealedProducts.clear(); // Reset memory so fresh searches animate cleanly
    renderCatalogProducts();
  }

  function seededMix(products) {
    // The seed is created once per full page load.
    // Therefore:
    // - Refreshing the website => new product arrangement.
    // - Changing category/search => same arrangement within that session.
    // - Newest/price sorting => unaffected.
    return [...products].sort(
        (a, b) =>
            stableScore(a.id, CATALOG_REFRESH_SEED) -
            stableScore(b.id, CATALOG_REFRESH_SEED)
    );
}

  function stableScore(value, seed) {
    const text = `${seed}:${value}`; let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    return hash >>> 0;
  }

  function renderCatalogProducts() {
    const loading = document.getElementById('catalog-loading');
    const grid = document.getElementById('product-grid');
    const empty = document.getElementById('catalog-empty');
    const loadWrap = document.getElementById('load-more-wrap');
    
    // Custom heading handling
    const title = document.getElementById('collection-title');
    const label = document.getElementById('search-results-label');

    if (!grid) return;
    
    if (title) {
      if (state.search.trim() !== '') {
        title.textContent = 'Search Results';
        if (label) {
          label.textContent = `Showing ${state.filteredProducts.length} creation${state.filteredProducts.length === 1 ? '' : 's'} for "${state.search}"`;
          label.classList.remove('hidden');
        }
      } else if (state.category !== 'All') {
        title.textContent = state.category;
        if (label) label.classList.add('hidden');
      } else {
        title.textContent = 'Shop the collection';
        if (label) label.classList.add('hidden');
      }
    }

    loading?.classList.add('hidden');
    if (!state.filteredProducts.length) { grid.classList.add('hidden'); empty?.classList.remove('hidden'); loadWrap?.classList.add('hidden'); return; }
    empty?.classList.add('hidden'); grid.classList.remove('hidden');
    const visible = state.filteredProducts.slice(0, state.visibleCount);
    grid.innerHTML = visible.map((product) => productCard(product)).join('');
    loadWrap?.classList.toggle('hidden', visible.length >= state.filteredProducts.length);
    
    // Trigger scroll animations dynamically
    requestAnimationFrame(() => observeReveal(grid));
  }

  const revealedProducts = new Set();
  let revealObserver = null;

  function observeReveal(container) {
    if (!window.IntersectionObserver) {
      container.querySelectorAll('.product-card').forEach(c => { c.classList.add('is-revealed'); revealedProducts.add(c.dataset.productId); });
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver((entries) => {
        const visibleEntries = entries.filter(e => e.isIntersecting);
        visibleEntries.forEach((entry, index) => {
          setTimeout(() => { 
            if (entry.target) {
              entry.target.classList.add('is-revealed');
              revealedProducts.add(entry.target.dataset.productId);
            }
          }, index * 80); // 80ms elegant staggered cascade
          revealObserver.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -40px 0px', threshold: 0.05 });
    }
    container.querySelectorAll('.product-card:not(.is-revealed)').forEach(c => revealObserver.observe(c));
  }

  function triggerBoomerang(element) {
    if (!element) return;
    element.classList.remove('is-popping');
    void element.offsetWidth;
    element.classList.add('is-popping');
    setTimeout(() => element.classList.remove('is-popping'), 250);
  }

  // New engine to handle the temporary green "Added" state
  function showButtonSuccessState(button) {
    if (!button || button.dataset.isAnimating === 'true') return;
    button.dataset.isAnimating = 'true';
    
    const originalHtml = button.innerHTML;
    
    // Lock the width so the button doesn't shrink when text changes to a shorter word
    const currentWidth = button.offsetWidth;
    if (currentWidth > 0) button.style.width = `${currentWidth}px`;
    
    // Switch to premium green success state
    button.classList.add('is-added-success');
    button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Added</span>`;
    
    // Restore the original state after 1.5 seconds
    setTimeout(() => {
      button.classList.remove('is-added-success');
      button.innerHTML = originalHtml;
      button.style.width = '';
      button.dataset.isAnimating = 'false';
    }, 1500);
  }

  function productCard(product, compact = false) {
    const discount = product.fake_price > product.actual_price ? Math.round((1 - product.actual_price / product.fake_price) * 100) : 0;
    const isCanvas = isCanvasProduct(product);
    const revealedClass = revealedProducts.has(String(product.id)) ? 'is-revealed' : '';
    return `<article class="product-card ${revealedClass}" data-product-id="${Utils.escapeHTML(product.id)}">
      <a class="product-card__image" href="${Utils.escapeHTML(productURL(product))}" aria-label="View ${Utils.escapeHTML(product.title)}">
        <img src="${Utils.escapeHTML(product.images[0] || '/assets/th_logo.svg?v=mtgyytmo')}" alt="${Utils.escapeHTML(product.title)}" loading="lazy" decoding="async">
        ${product.sub_category ? `<span class="product-card__badge">${Utils.escapeHTML(product.sub_category)}</span>` : ''}
      </a>
      <div class="product-card__body">
        <h3><a href="${Utils.escapeHTML(productURL(product))}">${Utils.escapeHTML(product.title)}</a></h3>
        <div class="product-card__price"><strong>${Utils.formatCurrency(product.actual_price)}</strong>${product.fake_price > product.actual_price ? `<del>${Utils.formatCurrency(product.fake_price)}</del><span class="product-card__discount">${discount}% off</span>` : ''}</div>
        <button type="button" class="product-card__action pop-click" data-card-action="${isCanvas ? 'choose' : 'add'}">
          ${isCanvas 
            ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg><span>Choose size</span>' 
            : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg><span>Add to bag</span>'}
        </button>
      </div>
    </article>`;
  }

  function handleProductGridClick(event) {
    const action = event.target.closest('[data-card-action]');
    if (!action) return;
    triggerBoomerang(action);
    const product = state.products.find((item) => String(item.id) === action.closest('[data-product-id]')?.dataset.productId);
    if (!product) return;
    if (action.dataset.cardAction === 'choose') {
      executeRouteTransition(productURL(product));
    } else {
      addProductToCart(product, { quantity: 1 });
      showButtonSuccessState(action); // Trigger the "Added" animation
    }
  }

  function productURL(product) {
    return `/product/${encodeURIComponent(product.id)}`;
  }

  function productShareURL(product) {
    return `https://twistedhappiness.vercel.app/product/${encodeURIComponent(product.id)}`;
  }

  function showCatalogError(message) {
    document.getElementById('catalog-loading')?.classList.add('hidden');
    const empty = document.getElementById('catalog-empty');

    if (empty) {
      empty.classList.remove('hidden');
      empty.querySelector('h3').textContent =
        'Unable to load the collection';
      empty.querySelector('p').textContent =
        message;
    }
  }

  /* ---------------- Product page ---------------- */
  let productEventsBound = false;

  function initialiseProduct(urlProductId = null) {
    const productId = urlProductId || new URLSearchParams(window.location.search).get('pid');
    const product = state.products.find((item) => String(item.id) === String(productId));
    if (!product) return showProductError();
    state.activeProduct = product;
    
    const qty = document.getElementById('product-qty'); if(qty) qty.value = "1";
    const note = document.getElementById('product-note'); if(note) note.value = "";
    
    renderProduct(product);
    if (!productEventsBound) {
      bindProductEvents();
      productEventsBound = true;
    }
    fetchProductReviews(product.id);
  }

  function renderProduct(product) {
    state.activePrice = product.actual_price;
    state.activeMRP = product.fake_price || 0;

    const productPageURL = window.location.href;

    const primaryImage =
      product.images?.[0] ||
      `${window.location.origin}/assets/share-icon.png?v=mtgyytmo`;

    const shareDescription =
      String(
        product.description ||
        'A handcrafted creation by Twisted Happiness.'
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);

    document.title = `${product.title} | Twisted Happiness`;

    document.querySelector('meta[property="og:title"]')?.setAttribute(
      'content',
      `${product.title} | Twisted Happiness`
    );

    document.querySelector('meta[property="og:description"]')?.setAttribute(
      'content',
      shareDescription
    );

    document.querySelector('meta[property="og:image"]')?.setAttribute(
      'content',
      primaryImage
    );

    document.querySelector('meta[property="og:url"]')?.setAttribute(
      'content',
      productPageURL
    );

    document.querySelector('meta[name="twitter:title"]')?.setAttribute(
      'content',
      `${product.title} | Twisted Happiness`
    );

    document.querySelector('meta[name="twitter:description"]')?.setAttribute(
      'content',
      shareDescription
    );

    document.querySelector('meta[name="twitter:image"]')?.setAttribute(
      'content',
      primaryImage
    );

    document.querySelector('meta[name="twitter:url"]')?.setAttribute(
      'content',
      productPageURL
    );

    document.querySelector('link[rel="canonical"]')?.setAttribute(
      'href',
      productPageURL
    );

    setText(
      'breadcrumb-product',
      product.title
    );

    setText(
      'product-category',
      product.sub_category ||
      product.main_category ||
      'Collection'
    );

    setText(
      'product-prep',
      `Prep: ${product.preparation_days || 'Made to order'}`
    );

    setText(
      'product-title',
      product.title
    );
    updateProductPrice();
    renderGallery(product);
    renderCanvasControls(product);
    
    const taxNote = document.querySelector('.product-tax-note');
    if (taxNote) {
      if (product.main_category === 'Painted Whispers' || isCanvasProduct(product)) {
         taxNote.classList.remove('hidden');
      } else {
         taxNote.classList.add('hidden');
      }
    }

    const description = document.getElementById('product-description');
    if (description) description.innerHTML = paragraphMarkup(product.description || 'Every Twisted Happiness creation is handcrafted with patience, detail and care.');
    const careLines = String(product.care_instructions || '').split('\n').map((line) => line.trim()).filter(Boolean);
    if (careLines.length) {
      document.getElementById('care-section')?.classList.remove('hidden');
      
      const getCareIcon = (text) => {
        const lower = text.toLowerCase();
        if (lower.includes('water') || lower.includes('humidity') || lower.includes('moisture')) return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>`;
        if (lower.includes('sunlight') || lower.includes('fading')) return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;
        if (lower.includes('dust') || lower.includes('wipe') || lower.includes('brush') || lower.includes('cloth')) return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`;
        if (lower.includes('handle') || lower.includes('delicate') || lower.includes('drop') || lower.includes('adjust')) return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;
        // Default leaf/flower
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`;
      };

      document.getElementById('product-care').innerHTML = careLines.map((line) => {
        // This regex safely strips out any old raw SVG code you might have accidentally saved to products already!
        const cleanText = line.replace(/<svg.*?<\/svg>/gi, '').trim();
        return `<li style="display: flex; align-items: flex-start; gap: 8px;"><span style="flex-shrink: 0; margin-top: 1px;">${getCareIcon(cleanText)}</span> <span>${Utils.escapeHTML(cleanText)}</span></li>`;
      }).join('');
    }
    setText('product-vip-text', vipProductNudge());
    document.getElementById('product-loading')?.classList.add('hidden');
    document.getElementById('product-detail')?.classList.remove('hidden');
    renderRelatedProducts(product);
  }

  function renderGallery(product) {
    const images = product.images.length ? product.images : ['/assets/th_logo.svg?v=mtgyytmo'];
    state.gallery.images = images;
    const track = document.getElementById('gallery-track');
    const thumbs = document.getElementById('gallery-thumbnails');
    const dots = document.getElementById('gallery-dots');
    const displayImages = images.length > 1 ? [images[images.length - 1], ...images, images[0]] : images;
    state.gallery.virtualIndex = images.length > 1 ? 1 : 0;
    state.gallery.logicalIndex = 0;
    track.innerHTML = displayImages.map((image, index) => `<figure class="main-gallery-slide"><img src="${Utils.escapeHTML(image)}" alt="${Utils.escapeHTML(product.title)} — image ${images.length > 1 ? ((index - 1 + images.length) % images.length) + 1 : 1}" draggable="false"></figure>`).join('');
    thumbs.innerHTML = images.map((image, index) => `<button class="thumbnail ${index === 0 ? 'is-active' : ''}" type="button" data-gallery-index="${index}" aria-label="Show image ${index + 1}"><img src="${Utils.escapeHTML(image)}" alt=""></button>`).join('');
    dots.innerHTML = images.map((_, index) => `<i class="gallery-dot ${index === 0 ? 'is-active' : ''}"></i>`).join('');
    document.getElementById('gallery-prev')?.classList.toggle('hidden', images.length < 2);
    document.getElementById('gallery-next')?.classList.toggle('hidden', images.length < 2);
    updateGalleryTransform(false);
    thumbs.querySelectorAll('[data-gallery-index]').forEach((button) => button.addEventListener('click', () => goToLogicalGalleryIndex(Number(button.dataset.galleryIndex))));
  }

  function updateGalleryTransform(animate = true) {
    const track = document.getElementById('gallery-track');
    if (!track) return;
    track.style.transition = animate ? 'transform .34s cubic-bezier(.22,.75,.25,1)' : 'none';
    track.style.transform = `translate3d(-${state.gallery.virtualIndex * 100}%,0,0)`;
    const count = state.gallery.images.length;
    const logical = count > 1 ? (state.gallery.virtualIndex - 1 + count) % count : 0;
    state.gallery.logicalIndex = logical;
    document.querySelectorAll('[data-gallery-index]').forEach((button, index) => button.classList.toggle('is-active', index === logical));
    document.querySelectorAll('.gallery-dot').forEach((dot, index) => dot.classList.toggle('is-active', index === logical));
  }

  function moveGallery(direction) {
    if (state.gallery.images.length < 2 || state.gallery.transitioning) return;
    state.gallery.transitioning = true;
    state.gallery.virtualIndex += direction;
    updateGalleryTransform(true);
  }

  function settleGalleryLoop() {
    const count = state.gallery.images.length;
    if (count < 2) { state.gallery.transitioning = false; return; }
    if (state.gallery.virtualIndex === 0) state.gallery.virtualIndex = count;
    if (state.gallery.virtualIndex === count + 1) state.gallery.virtualIndex = 1;
    updateGalleryTransform(false);
    state.gallery.transitioning = false;
  }

  function goToLogicalGalleryIndex(index) {
    if (state.gallery.images.length < 2) return;
    state.gallery.virtualIndex = Utils.clamp(index, 0, state.gallery.images.length - 1) + 1;
    state.gallery.transitioning = true;
    updateGalleryTransform(true);
  }

  function renderCanvasControls(product) {
    const section = document.getElementById('canvas-section');
    if (!isCanvasProduct(product)) {
      section?.classList.add('hidden');
      return;
    }
    const config = productCanvasConfig(product);
    if (!config.baseSize) {
      section?.classList.add('hidden');
      return;
    }
    const sizes = canvasSizesForProduct(product, config.baseSize);
    state.activeCanvasSize = config.baseSize;
    const host = document.getElementById('canvas-size-options');
    host.innerHTML = sizes.map((size, index) => {
        let display = size.label;
        const sh = String(size.shape || '').toLowerCase();
        if (sh === 'square' && size.width) display = `${size.width} x ${size.width} in`;
        else if (sh === 'rectangle' && size.width && size.height) display = `${size.width} x ${size.height} in`;
        else if (sh === 'circle' && size.diameter) display = `${size.diameter} in`;
        return `<button class="size-option ${Utils.sameCanvasSize(size, config.baseSize) || (!index && !state.activeCanvasSize) ? 'is-active' : ''}" type="button" data-canvas-size="${Utils.escapeHTML(JSON.stringify(size))}">${Utils.escapeHTML(display)}</button>`;
      }).join('');
    document.getElementById('canvas-section')?.classList.remove('hidden');
    updateOrientationVisibility();
    updateCanvasPrice();
  }

  function isCanvasProduct(product) { return product?.main_category === 'Painted Whispers' || Boolean(product?.attributes?.canvas || product?.attributes?.canvas_size); }

  function productCanvasConfig(product) {
    const attributes = Utils.normaliseAttributes(product?.attributes);
    const canvas = attributes.canvas && typeof attributes.canvas === 'object' ? attributes.canvas : {};
    const legacySize = attributes.canvas_size;
    const baseSize = Utils.normaliseCanvasSize(canvas.base_size || legacySize || null);
    return {
      shape: String(canvas.shape || attributes.canvas_shape || baseSize?.shape || 'square').toLowerCase(),
      baseSize,
      baseOrientation: canvas.orientation || attributes.canvas_orientation || 'Portrait'
    };
  }

  function canvasSizesForProduct(product, baseSize) {
    const config = productCanvasConfig(product);
    const configured = Utils.normaliseCanvasSizes(state.store.global_canvas_sizes, APP_CONFIG.DEFAULTS.canvasSizes)
      .filter((size) => size.shape === config.shape);
    const sizes = [...configured];
    if (baseSize && !sizes.some((size) => Utils.sameCanvasSize(size, baseSize))) sizes.unshift(baseSize);
    return sizes.length ? sizes : [baseSize].filter(Boolean);
  }

  function updateCanvasPrice() {
    const product = state.activeProduct;
    if (!product || !state.activeCanvasSize) return;
    const baseSize = productCanvasConfig(product).baseSize;
    
    // Update Pricing
    state.activePrice = Utils.calculateCanvasPrice(product.actual_price, baseSize, state.activeCanvasSize);
    state.activeMRP = product.fake_price > product.actual_price ? Utils.calculateCanvasPrice(product.fake_price, baseSize, state.activeCanvasSize) : 0;
    updateProductPrice();

    // Update Preparation Time
    const dynamicPrep = getDynamicPrepTime(product.preparation_days, baseSize, state.activeCanvasSize);
    setText('product-prep', `Prep: ${dynamicPrep}`);
  }

  function updateOrientationVisibility() {
    const wrap = document.getElementById('orientation-wrap');
    if (!wrap) return;
    wrap.classList.toggle('hidden', state.activeCanvasSize?.shape !== 'rectangle');
  }

  function updateProductPrice() {
    const qtyInput = document.getElementById('product-qty');
    const qty = qtyInput ? Math.floor(Utils.clamp(qtyInput.value, 1, APP_CONFIG.MAX_ITEM_QUANTITY)) : 1;
    
    setText('product-price', Utils.formatCurrency(state.activePrice * qty));
    const mrp = document.getElementById('product-mrp');
    const discount = document.getElementById('product-discount');
    if (state.activeMRP > state.activePrice) {
      mrp.textContent = Utils.formatCurrency(state.activeMRP * qty); mrp.classList.remove('hidden');
      discount.textContent = `${Math.round((1 - state.activePrice / state.activeMRP) * 100)}% off`; discount.classList.remove('hidden');
    } else { mrp?.classList.add('hidden'); discount?.classList.add('hidden'); }
  }

  function bindProductEvents() {
    const quantity = document.getElementById('product-qty');

    document.getElementById('gallery-prev')?.addEventListener('click', () => moveGallery(-1));
    document.getElementById('gallery-next')?.addEventListener('click', () => moveGallery(1));
    document.getElementById('gallery-track')?.addEventListener('transitionend', settleGalleryLoop);

    bindGallerySwipe();

    document.getElementById('canvas-size-options')?.addEventListener('click', (event) => {
      const option = event.target.closest('[data-canvas-size]');
      if (!option) return;

      state.activeCanvasSize = Utils.normaliseCanvasSize(
        Utils.parseJSON(option.dataset.canvasSize)
      );

      option.parentElement
        .querySelectorAll('.size-option')
        .forEach((button) =>
          button.classList.toggle('is-active', button === option)
        );

      updateOrientationVisibility();
      updateCanvasPrice();
    });

    document.getElementById('product-qty-minus')?.addEventListener('click', (e) => {
      triggerBoomerang(e.currentTarget);
      quantity.value = String(
        Math.floor(
          Utils.clamp(
            Number(quantity.value) - 1,
            1,
            APP_CONFIG.MAX_ITEM_QUANTITY
          )
        )
      );
      updateProductPrice();
    });

    document.getElementById('product-qty-plus')?.addEventListener('click', (e) => {
      triggerBoomerang(e.currentTarget);
      quantity.value = String(
        Math.floor(
          Utils.clamp(
            Number(quantity.value) + 1,
            1,
            APP_CONFIG.MAX_ITEM_QUANTITY
          )
        )
      );
      updateProductPrice();
    });

    quantity?.addEventListener('change', () => {
      quantity.value = String(
        Math.floor(
          Utils.clamp(
            quantity.value,
            1,
            APP_CONFIG.MAX_ITEM_QUANTITY
          )
        )
      );
      updateProductPrice();
    });

    document.getElementById('add-to-cart')?.addEventListener('click', (e) => {
      triggerBoomerang(e.currentTarget);
      addProductToCart(
        state.activeProduct,
        productSelections()
      );
      showButtonSuccessState(e.currentTarget); // Trigger the "Added" animation
      openCart();
    });

    // Single order logic removed

    document.getElementById('btn-fwd-item')?.addEventListener(
      'click',
      async () => {
        const product = state.activeProduct;
        if (!product) return Utils.toast('This product is still loading.', 'error');

        const shareData = {
          title: `${product.title} | Twisted Happiness`,
          text: `See this handcrafted creation: ${product.title}`,
          url: productShareURL(product)
        };

        // Secure Native Web Share: Attempt to attach file, fallback to URL/text on CORS/network/OS failure
        if (navigator.canShare && product.images?.[0]) {
          try {
            const imgUrl = Utils.safeImageURL(product.images[0]);
            const response = await fetch(imgUrl);
            if (response.ok) {
              const blob = await response.blob();
              const ext = blob.type.split('/')[1] || 'jpeg';
              const file = new File([blob], `product.${ext}`, { type: blob.type });
              if (navigator.canShare({ files: [file] })) shareData.files = [file];
            }
          } catch (e) {
             // Fallback triggered: File not attached, URL and text remain intact
          }
        }

        await Utils.share(shareData);
      }
    );

    document.getElementById('related-grid')?.addEventListener(
      'click',
      handleProductGridClick
    );
  }

  function bindGallerySwipe() {
    const viewport = document.getElementById('gallery-viewport');
    if (!viewport) return;
    viewport.addEventListener('pointerdown', (event) => { state.gallery.startX = event.clientX; state.gallery.deltaX = 0; viewport.setPointerCapture?.(event.pointerId); });
    viewport.addEventListener('pointermove', (event) => { if (!state.gallery.startX) return; state.gallery.deltaX = event.clientX - state.gallery.startX; });
    viewport.addEventListener('pointerup', () => {
      if (Math.abs(state.gallery.deltaX) > 42) moveGallery(state.gallery.deltaX < 0 ? 1 : -1);
      state.gallery.startX = 0; state.gallery.deltaX = 0;
    });
    viewport.addEventListener('pointercancel', () => { state.gallery.startX = 0; state.gallery.deltaX = 0; });
  }

  function productSelections() {
    return {
      estimatedPrice: state.activePrice,
      quantity: Math.floor(Utils.clamp(document.getElementById('product-qty')?.value || 1, 1, APP_CONFIG.MAX_ITEM_QUANTITY)),
      selectedSize: state.activeCanvasSize,
      orientation: state.activeCanvasSize?.shape === 'rectangle' ? document.getElementById('canvas-orientation')?.value || 'Portrait' : null,
      note: document.getElementById('product-note')?.value.trim().slice(0, 180) || ''
    };
  }

  

  function renderRelatedProducts(product) {
    const section = document.getElementById('related-section');
    const grid = document.getElementById('related-grid');
    if (!section || !grid) return;

    // Exclude the current product
    const pool = state.products.filter((item) => String(item.id) !== String(product.id));

    // 1. Same main category & same sub-category
    const sameSub = product.sub_category 
      ? pool.filter((item) => item.main_category === product.main_category && item.sub_category === product.sub_category)
      : [];

    const selectedIds = new Set(sameSub.map((item) => String(item.id)));

    // 2. Fill remaining slots from the same main category
    const sameMain = pool.filter((item) => item.main_category === product.main_category && !selectedIds.has(String(item.id)));

    const related = [...sameSub, ...sameMain].slice(0, 12);

    if (!related.length) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    grid.innerHTML = related.map((item) => productCard(item, true)).join('');

    // Trigger reveal observer so the cards animate into view
    requestAnimationFrame(() => observeReveal(grid));
  }

  async function fetchProductReviews(productId) {
    if (!supabaseClient) return;
    const { data, error } = await supabaseClient.from('reviews').select('customer_name,rating,review_text,created_at').eq('product_id', productId).eq('is_approved', true).order('created_at', { ascending: false }).limit(8);
    if (error || !data?.length) return;
    const average = data.reduce((sum, review) => sum + Number(review.rating), 0) / data.length;
    document.getElementById('reviews-section')?.classList.remove('hidden');
    setText('reviews-summary', `${average.toFixed(1)} / 5 · ${data.length} review${data.length === 1 ? '' : 's'}`);
    document.getElementById('reviews-list').innerHTML = data.map((review) => `<article class="review-card"><div class="review-card__top"><strong>${Utils.escapeHTML(review.customer_name || 'Customer')}</strong><span class="review-stars" aria-label="${Number(review.rating)} out of 5 stars">${'★'.repeat(Number(review.rating))}${'☆'.repeat(5 - Number(review.rating))}</span></div><p>${Utils.escapeHTML(review.review_text || '')}</p></article>`).join('');
  }

  function showProductError() { document.getElementById('product-loading')?.classList.add('hidden'); document.getElementById('product-error')?.classList.remove('hidden'); }
  function paragraphMarkup(value) { return String(value || '').split(/\n{2,}/).map((paragraph) => `<p>${Utils.escapeHTML(paragraph).replace(/\n/g, '<br>')}</p>`).join(''); }
  function vipProductNudge() { const first = state.store.vip_tiers.find((tier) => tier.percent > 0); return first ? `Add ${first.minimumQuantity} items to unlock ${first.percent}% off automatically.` : 'Build a bag for easier WhatsApp ordering.'; }

  /* ---------------- Shared cart ---------------- */
  function injectSharedCart() {
    const root = document.getElementById('shared-cart-root');
    if (!root) return;
    root.innerHTML = `
      <style>
        /* Premium Compact Cart Drawer Styling */
        .cart-drawer .cart-head { padding: 10px 16px; min-height: auto; }
        .cart-drawer .cart-head h2 { font-size: 1.05rem; }
        .cart-drawer .cart-frozen-top { padding: 8px 16px !important; }
        
        /* VIP Savings Card Perfect Alignment */
        .cart-drawer .savings-card { display: flex; align-items: center; gap: 14px; padding: 12px 14px; margin-bottom: 4px; background: #fff; border: 1px solid rgba(197, 139, 158, 0.25); border-radius: 8px; box-shadow: 0 2px 6px rgba(74, 59, 66, 0.04); }
        .cart-drawer .savings-card__icon { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 38px; height: 38px; background: rgba(197, 139, 158, 0.15); color: var(--pink-deep); border-radius: 50%; }
        .cart-drawer .savings-card__icon svg { width: 18px; height: 18px; }
        .cart-drawer .savings-card > div:last-child { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; margin-top: 2px; }
        .cart-drawer #cart-savings-title { display: block; font-size: 0.8rem; font-weight: 600; color: var(--charcoal); line-height: 1.2; margin-bottom: 3px; }
        .cart-drawer #cart-savings-message { display: block; font-size: 0.65rem; color: var(--muted); line-height: 1.2; margin-bottom: 8px; }
        .cart-drawer .progress-track { width: 100%; height: 4px; background: rgba(197, 139, 158, 0.2); border-radius: 99px; overflow: hidden; }
        .cart-drawer #cart-savings-progress { display: block; height: 100%; background: var(--pink-deep); border-radius: 99px; transition: width 0.4s ease; }
        
        .cart-drawer .shipping-progress { font-size: 0.7rem; margin-top: 2px; }
        .cart-drawer .cart-footer { padding: 10px 16px 16px; }
        .cart-drawer .coupon-control { margin-bottom: 4px !important; }
        .cart-drawer .coupon-control input, .cart-drawer .coupon-control button { min-height: 36px; }
        .cart-drawer .coupon-status { margin: 0 0 6px 2px; font-size: 0.7rem; }
        .cart-drawer .cart-totals { display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; }
        .cart-drawer .cart-total-row { font-size: 0.75rem; }
        .cart-drawer .cart-total-row.is-total { margin-top: 2px; padding-top: 6px; font-size: 0.9rem; }
        .cart-drawer .cart-items-scrollable { padding: 6px 16px 10px; gap: 8px !important; }
      </style>
      <div id="cart-overlay" class="cart-overlay" aria-hidden="true"></div>
      <aside id="cart-drawer" class="cart-drawer" aria-labelledby="cart-title" aria-hidden="true">
        <header class="cart-head"><h2 id="cart-title">Your Saving Bag</h2><button id="cart-close" class="round-button" type="button" aria-label="Close bag"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></header>
        
        <div class="cart-frozen-top" style="padding: 14px 18px; border-bottom: 1px solid var(--line); background: var(--cream);">
          <div class="savings-card">
            <div class="savings-card__icon">
              <!-- Premium Crown SVG -->
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>
            </div>
            <div>
              <strong id="cart-savings-title">Buy more, save more</strong>
              <span id="cart-savings-message">Add products to unlock automatic savings.</span>
              <div class="progress-track"><i id="cart-savings-progress" style="width:0%"></i></div>
            </div>
          </div>
          <div id="cart-shipping-progress" class="shipping-progress"></div>
        </div>

        <div class="cart-items-scrollable" style="overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 16px;">
          <div id="cart-items"></div>
          <div id="cart-recommendations" class="recommendations hidden" style="margin-top: 0; padding-bottom: 12px;"><h3>Complete the gift</h3><div id="cart-recommendation-row" class="recommendation-row no-scrollbar"></div></div>
        </div>

        <footer class="cart-footer" style="max-height: none;">
          <div class="coupon-control" style="margin-top: 0;"><input id="cart-coupon" type="text" maxlength="40" placeholder="Coupon code"><button id="cart-apply-coupon" class="app-button app-button--dark app-button--small" type="button">Apply</button></div>
          <p id="cart-coupon-status" class="coupon-status"></p>
          <div class="cart-totals">
            <div class="cart-total-row"><span style="color: var(--muted);">Total Prep Time</span><strong id="cart-prep-time">0 days</strong></div>
            <div class="cart-total-row"><span style="color: var(--muted);">Price (MRP)</span><strong id="cart-mrp">₹0</strong></div>
            <div class="cart-total-row is-saving"><span id="cart-mrp-discount-label">Discount</span><strong id="cart-mrp-discount">−₹0</strong></div>
            <div class="cart-total-row"><span>Subtotal</span><strong id="cart-subtotal">₹0</strong></div>
            <div id="cart-vip-row" class="cart-total-row is-saving"><span id="cart-vip-label">VIP Savings</span><strong id="cart-vip-discount">−₹0</strong></div>
            <div id="cart-coupon-row" class="cart-total-row is-saving"><span id="cart-coupon-label">Coupon Savings</span><strong id="cart-coupon-discount">−₹0</strong></div>
            <div class="cart-total-row"><span style="color: var(--muted);">Shipping Fee</span><strong id="cart-shipping">₹0</strong></div>
            <div class="cart-total-row is-total"><span>Order Total</span><strong id="cart-total">₹0</strong></div>
          </div>
          <button id="cart-checkout" class="app-button app-button--dark app-button--full" type="button">Review bag & order on WhatsApp</button>
        </footer>
      </aside>`;
  }

  let sharedCartEventsBound = false;

  function bindSharedCartEvents() {
    if (sharedCartEventsBound) return;
    document.getElementById('cart-overlay')?.addEventListener('click', () => closeCart(false));
    document.getElementById('cart-close')?.addEventListener('click', () => closeCart(false));
    document.getElementById('cart-items')?.addEventListener('click', handleCartItemClick);
    document.getElementById('cart-items')?.addEventListener('change', handleCartQuantityChange);
    document.getElementById('cart-apply-coupon')?.addEventListener('click', () => applyCoupon('cart'));
    document.getElementById('cart-checkout')?.addEventListener('click', () => { if (state.cart.length) { closeCart(true); executeRouteTransition('/?view=checkout'); } });
    document.getElementById('cart-recommendation-row')?.addEventListener('click', handleRecommendationClick);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeCart(false); });
    sharedCartEventsBound = true;
  }

  // 1. Silent server-side validation to keep the UI honest
  async function silentlyRevalidateCoupon() {
    if (!state.coupon || !state.cart.length) return;
    try {
      const subtotal = calculateTotals(state.cart).subtotal;
      const { data, error } = await supabaseClient.rpc(APP_CONFIG.RPC.validateCoupon, { p_code: state.coupon.code, p_subtotal: subtotal });
      if (error) return; 
      const row = Array.isArray(data) ? data[0] : data;
      const serverCoupon = normaliseCoupon(row);
      if (!serverCoupon || !serverCoupon.active) {
        state.coupon = null; 
        localStorage.removeItem(APP_CONFIG.STORAGE_KEYS.coupon);
        renderCart(); 
        if (state.page === 'checkout') renderCheckout();
        Utils.toast('Your applied coupon has expired or reached its limit.', 'error');
      }
    } catch (e) {}
  }

  // 2. Open cart and trigger the silent check
  function openCart() {
    // Push a dummy history state so the mobile hardware back button has something to pop
    if (!history.state || history.state.overlay !== 'cart') {
      history.pushState({ ...history.state, overlay: 'cart' }, '', window.location.href);
    }
    
    renderCart();
    document.getElementById('cart-overlay')?.classList.add('is-open');
    document.getElementById('cart-drawer')?.classList.add('is-open');
    document.getElementById('cart-overlay')?.setAttribute('aria-hidden', 'false');
    document.getElementById('cart-drawer')?.setAttribute('aria-hidden', 'false');
    Utils.setBodyLocked(true);
    document.getElementById('cart-close')?.focus();
    
    silentlyRevalidateCoupon();
  }

  function closeCart(fromPopState = false) {
    document.getElementById('cart-overlay')?.classList.remove('is-open');
    document.getElementById('cart-drawer')?.classList.remove('is-open');
    document.getElementById('cart-overlay')?.setAttribute('aria-hidden', 'true');
    document.getElementById('cart-drawer')?.setAttribute('aria-hidden', 'true');
    Utils.setBodyLocked(false);
    
    // If closed via "X" button or clicking backdrop, pop the dummy state to keep browser history clean
    if (fromPopState !== true && history.state && history.state.overlay === 'cart') {
      history.back();
    }
  }

  function buildCartItem(product, selections = {}) {
    let selectedSize = selections.selectedSize ? Utils.normaliseCanvasSize(selections.selectedSize) : null;
    if (selectedSize && selectedSize.shape) {
      const sh = String(selectedSize.shape).toLowerCase();
      if (sh === 'square' && selectedSize.width) selectedSize.label = `${selectedSize.width} x ${selectedSize.width} in`;
      else if (sh === 'rectangle' && selectedSize.width && selectedSize.height) selectedSize.label = `${selectedSize.width} x ${selectedSize.height} in`;
      else if (sh === 'circle' && selectedSize.diameter) selectedSize.label = `${selectedSize.diameter} in`;
    }
    const orientation = selections.orientation || null;
    const note = String(selections.note || '').trim().slice(0, 180);
    
    const baseSize = isCanvasProduct(product) ? productCanvasConfig(product).baseSize : null;
    const dynamicPrep = selectedSize ? getDynamicPrepTime(product.preparation_days, baseSize, selectedSize) : (product.preparation_days || 'Made to order');

    return {
      key: cartKey(product.id, selectedSize, orientation, note),
      productId: String(product.id),
      title: product.title,
      image: product.images?.[0] || '/assets/th_logo.svg?v=mtgyytmo',
      estimatedPrice: Utils.roundMoney(selections.estimatedPrice ?? product.actual_price),
      quantity: Math.floor(Utils.clamp(selections.quantity || 1, 1, APP_CONFIG.MAX_ITEM_QUANTITY)),
      selectedSize, orientation, note,
      preparationDays: dynamicPrep
    };
  }

  function addProductToCart(product, selections = {}) {
    if (!product) return;
    const item = buildCartItem(product, selections);
    const existing = state.cart.find((entry) => entry.key === item.key);
    if (!existing && state.cart.length >= APP_CONFIG.MAX_CART_LINES) return Utils.choice({ title: 'Bag limit reached', message: `Your bag can contain up to ${APP_CONFIG.MAX_CART_LINES} different selections.`, icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>', primaryLabel: 'Okay', hideSecondary: true });
    if (existing) existing.quantity = Math.floor(Utils.clamp(existing.quantity + item.quantity, 1, APP_CONFIG.MAX_ITEM_QUANTITY));
    else state.cart.push(item);
    persistCart();
    
    // Trigger the unified premium VIP bounce animation for the correct button based on screen size
    const targetSelector = window.matchMedia('(max-width: 720px)').matches ? '.mobile-nav [data-open-cart]' : '.site-header [data-open-cart]';
    document.querySelectorAll(targetSelector).forEach(btn => {
      btn.classList.remove('bag-cheering');
      void btn.offsetWidth;
      btn.classList.add('bag-cheering');
      setTimeout(() => btn.classList.remove('bag-cheering'), 800);
    });
  }

  function cartKey(productId, selectedSize, orientation, note) {
    const sizeKey = selectedSize ? JSON.stringify({ shape: selectedSize.shape, width: selectedSize.width || null, height: selectedSize.height || null, diameter: selectedSize.diameter || null }) : 'standard';
    return [productId, sizeKey, orientation || 'default', String(note || '').trim().toLowerCase()].join('::');
  }

  function handleCartItemClick(event) {
    const action = event.target.closest('[data-cart-action]');
    if (!action) return;
    
    const row = action.closest('[data-cart-key]');
    if (!row) return;
    
    const key = row.dataset.cartKey;
    const item = state.cart.find((entry) => entry.key === key);
    if (!item) return;
    
    const actionType = action.dataset.cartAction;
    
    if (actionType === 'increase') {
      item.quantity = Math.floor(Utils.clamp(item.quantity + 1, 1, APP_CONFIG.MAX_ITEM_QUANTITY));
    } else if (actionType === 'decrease') {
      item.quantity = Math.floor(Utils.clamp(item.quantity - 1, 1, APP_CONFIG.MAX_ITEM_QUANTITY));
    } else if (actionType === 'remove') {
      state.cart = state.cart.filter((entry) => entry.key !== key);
    }
    
    persistCart();
  }

  function handleCartQuantityChange(event) {
    if (!event.target.matches('[data-cart-quantity]')) return;
    const item = state.cart.find((entry) => entry.key === event.target.closest('[data-cart-key]')?.dataset.cartKey);
    if (!item) return;
    item.quantity = Math.floor(Utils.clamp(event.target.value, 1, APP_CONFIG.MAX_ITEM_QUANTITY));
    persistCart();
  }

  function renderCart() {
    document.querySelectorAll('[data-cart-count]').forEach((element) => { element.textContent = String(totalQuantity(state.cart)); });
    const host = document.getElementById('cart-items');
    if (!host) return;
    if (!state.cart.length) host.innerHTML = '<div class="empty-state"><span><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--pink-deep)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg></span><h3>Your bag is empty</h3><p>Add creations to unlock automatic VIP savings.</p></div>';
    else host.innerHTML = state.cart.map((item) => cartItemMarkup(item, 'cart')).join('');
    renderFinancialSummary('cart', state.cart);
    renderRecommendations('cart', state.cart);
    const checkout = document.getElementById('cart-checkout'); if (checkout) checkout.disabled = !state.cart.length;
    syncCouponControls();
  }

  function cartItemMarkup(item, location) {
    const actionPrefix = location === 'checkout' ? 'checkout' : 'cart';
    return `<article class="${location === 'checkout' ? 'checkout-item' : 'cart-item'}" data-cart-key="${Utils.escapeHTML(item.key)}" style="display: flex; gap: 12px; align-items: center; position: relative;">
      <img src="${Utils.escapeHTML(item.image || '/assets/th_logo.svg?v=mtgyytmo')}" alt="" style="width: 56px; height: 56px; object-fit: cover; border-radius: 6px; flex-shrink: 0; border: 1px solid var(--line);">
      <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; height: 56px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px;">
          <h3 style="margin: 0; font-family: 'Inter', sans-serif; font-size: 0.8rem; font-weight: 600; color: var(--charcoal); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;">${Utils.escapeHTML(item.title)}</h3>
          <strong class="${location === 'checkout' ? '' : 'cart-item__price'}" style="font-size: 0.8rem; color: var(--charcoal); flex-shrink: 0; font-family: 'Inter', sans-serif; line-height: 1.2;">${Utils.formatCurrency(item.estimatedPrice * item.quantity)}</strong>
        </div>
        <p style="margin: 0; font-size: 0.65rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1;">
          ${Utils.formatCurrency(item.estimatedPrice)} each · Prep ${Utils.escapeHTML(item.preparationDays)}
          ${item.selectedSize ? ` · ${Utils.escapeHTML(item.selectedSize.label)}` : ''}
          ${item.note ? ` · Note: ${Utils.escapeHTML(item.note)}` : ''}
        </p>
        <div class="cart-item-actions" style="display: flex; align-items: center; justify-content: space-between;">
          <span class="quantity-control" style="display: flex; align-items: center; border: 1px solid var(--line-strong); border-radius: 99px; height: 24px; overflow: hidden; background: var(--paper);">
            <button type="button" data-${actionPrefix}-action="decrease" aria-label="Decrease quantity" style="background: transparent; border: none; width: 24px; height: 24px; display: grid; place-items: center; cursor: pointer; color: var(--charcoal); padding: 0;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg></button>
            <input ${location === 'checkout' ? 'readonly' : 'data-cart-quantity'} type="number" min="1" max="${APP_CONFIG.MAX_ITEM_QUANTITY}" value="${item.quantity}" aria-label="Quantity" style="width: 20px; height: 24px; text-align: center; border: none; background: transparent; font-size: 0.75rem; font-weight: 600; padding: 0; margin: 0; outline: none; -moz-appearance: textfield; pointer-events: none; color: var(--charcoal);">
            <button type="button" data-${actionPrefix}-action="increase" aria-label="Increase quantity" style="background: transparent; border: none; width: 24px; height: 24px; display: grid; place-items: center; cursor: pointer; color: var(--charcoal); padding: 0;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg></button>
          </span>
          <button class="remove-svg-btn" type="button" data-${actionPrefix}-action="remove" aria-label="Remove item" style="background: transparent; border: none; color: #a3949b; cursor: pointer; display: grid; place-items: center; padding: 0;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
        </div>
      </div>
    </article>`;
  }

  function totalQuantity(items = activeCheckoutItems()) { return items.reduce((sum, item) => sum + Number(item.quantity || 0), 0); }
  function vipTier(quantity = totalQuantity()) { return [...state.store.vip_tiers].reverse().find((tier) => quantity >= tier.minimumQuantity) || state.store.vip_tiers[0]; }
  function nextVipTier(quantity = totalQuantity()) { return state.store.vip_tiers.find((tier) => tier.minimumQuantity > quantity) || null; }

  function calculateTotals(items = activeCheckoutItems()) {
    const subtotal = Utils.roundMoney(items.reduce((sum, item) => sum + Number(item.estimatedPrice) * Number(item.quantity), 0));
    
    const totalPrepDays = items.reduce((sum, item) => {
      const match = String(item.preparationDays || '').match(/(\d+)/);
      const minDays = match ? parseInt(match[1], 10) : 0;
      return sum + (minDays * Number(item.quantity));
    }, 0);

    // Dynamically calculate the exact original MRP based on the product's price ratio
    const totalMrp = Utils.roundMoney(items.reduce((sum, item) => {
      const product = state.products.find(p => String(p.id) === String(item.productId));
      let itemMrp = item.estimatedPrice;
      if (product && product.actual_price > 0 && product.fake_price > product.actual_price) {
         const ratio = product.fake_price / product.actual_price;
         itemMrp = item.estimatedPrice * ratio;
      }
      return sum + (itemMrp * item.quantity);
    }, 0));
    
    const mrpDiscount = Utils.roundMoney(Math.max(0, totalMrp - subtotal));
    const quantity = totalQuantity(items);
      const tier = vipTier(quantity);
      const validCoupon = couponIsValid(state.coupon, subtotal);
      
      let vipDiscount = Utils.roundMoney(subtotal * tier.percent / 100);
      
      // The VIP discount and Coupon discount are now permanently allowed to coexist.
      // Note: If the coupon is a percentage, it will safely apply to the 'afterVip' total.
      const afterVip = Math.max(0, subtotal - vipDiscount);
    let couponDiscount = 0; let freeShippingCoupon = false;
    if (validCoupon) {
      if (state.coupon.discountType === 'shipping') freeShippingCoupon = true;
      else if (state.coupon.discountType === 'percent') couponDiscount = Utils.roundMoney(afterVip * state.coupon.value / 100);
      else couponDiscount = Number(state.coupon.value) || 0;
      if (Number(state.coupon.maxDiscount) > 0) couponDiscount = Math.min(couponDiscount, Number(state.coupon.maxDiscount));
      couponDiscount = Math.min(afterVip, Math.max(0, couponDiscount));
    }
    const merchandiseTotal = Math.max(0, afterVip - couponDiscount);
    const threshold = Number(state.store.free_shipping_threshold) || 0;
    const deliveryFee = Number(state.store.standard_delivery_fee) || 0;
    const shipping = !items.length || freeShippingCoupon || (threshold > 0 && merchandiseTotal >= threshold) ? 0 : deliveryFee;
    return { totalPrepDays, totalMrp, mrpDiscount, subtotal, quantity, tier, vipDiscount, couponDiscount, merchandiseTotal, shipping, total: Utils.roundMoney(merchandiseTotal + shipping), threshold };
  }

  function couponIsValid(coupon, subtotal) {
    if (!coupon || !coupon.active) return false;
    if (coupon.startsAt && new Date(coupon.startsAt).getTime() > Date.now()) return false;
    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) return false;
    return subtotal >= Number(coupon.minimumSpend || 0);
  }

  function validateStoredCoupon() {
    const subtotal = state.cart.reduce((sum, item) => sum + item.estimatedPrice * item.quantity, 0);
    if (state.coupon && !couponIsValid(state.coupon, subtotal)) { state.coupon = null; localStorage.removeItem(APP_CONFIG.STORAGE_KEYS.coupon); }
  }

  let savingsTracker = null;

  function showGlobalCelebration(message) {
    // Prevent stacking
    document.getElementById('th-toast-container')?.remove();

    const container = document.createElement('div');
    container.id = 'th-toast-container';
    container.style.cssText = 'position:fixed;inset:0;z-index:99999;pointer-events:none;overflow:hidden;';

    // 1. Soft green bloom from top
    const bloom = document.createElement('div');
    bloom.style.cssText = 'position:absolute;top:0;left:0;right:0;height:40vh;background:radial-gradient(ellipse at top, rgba(89, 122, 104, 0.25) 0%, transparent 70%);opacity:0;animation:thBloom 1.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;';

    // 2. Premium VIP Slide-Down Toast with smooth glass shadow and internal shimmer
    const toast = document.createElement('div');
    // Notice: overflow:hidden added to contain the shimmer inside the rounded edges
    toast.style.cssText = 'position:absolute;top:max(16px, env(safe-area-inset-top));left:50%;display:flex;align-items:center;gap:12px;padding:10px 24px 10px 12px;background:linear-gradient(135deg, var(--green) 0%, #3d5648 100%);border:1px solid rgba(255,255,255,0.3);border-radius:14px;box-shadow:0 16px 36px rgba(89,122,104,0.4), inset 0 1px 0 rgba(255,255,255,0.3);opacity:0;width:max-content;max-width:90vw;animation:thToastSlide 2.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;overflow:hidden;';
    
    toast.innerHTML = `
      <div class="toast-shimmer"></div>
      <div style="display:grid;place-items:center;width:32px;height:32px;flex-shrink:0;border-radius:9px;background:#ffffff;color:var(--green);box-shadow:0 4px 12px rgba(0,0,0,0.15);position:relative;z-index:2;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      </div>
      <span style="font-family:'Inter',sans-serif;font-size:0.9rem;font-weight:600;color:#ffffff;letter-spacing:0.02em;line-height:1.3;position:relative;z-index:2;text-shadow:0 1px 2px rgba(0,0,0,0.2);">${Utils.escapeHTML(message)}</span>
      <style>
        @keyframes thBloom {
          0% { opacity: 0; transform: scaleY(0.8); }
          35% { opacity: 1; transform: scaleY(1); }
          100% { opacity: 0; transform: scaleY(1.1); }
        }
        @keyframes thToastSlide {
          0% { transform: translate(-50%, -120%) scale(0.9); opacity: 0; }
          15%, 85% { transform: translate(-50%, 0) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -120%) scale(0.95); opacity: 0; }
        }
        /* Beautiful glass glare sweep animation */
        @keyframes toastShimmer {
          0% { transform: translateX(-100%) skewX(-15deg); }
          100% { transform: translateX(250%) skewX(-15deg); }
        }
        .toast-shimmer {
          position: absolute;
          top: 0; left: 0; width: 50%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
          z-index: 1;
          animation: toastShimmer 1.2s ease-in-out forwards;
          animation-delay: 0.2s;
          pointer-events: none;
        }
      </style>
    `;

    container.appendChild(bloom);
    container.appendChild(toast);
    document.body.appendChild(container);

    setTimeout(() => container.remove(), 2500);
  }

  function evaluateSavingsAndAnimate(totals) {
    const isFreeShipping = totals.shipping === 0 && totals.subtotal > 0;
    
    // First load: silently record the baseline without animating
    if (!savingsTracker) {
      savingsTracker = { vip: totals.tier.percent, shipping: isFreeShipping, coupon: state.coupon?.code };
      return;
    }

    let unlockedMessages = [];
    
    // 1. Did they upgrade their VIP Tier?
    if (totals.tier.percent > savingsTracker.vip) {
      unlockedMessages.push(`${totals.tier.percent}% VIP Saving`);
    }
    
    // 2. Did they just unlock free shipping?
    if (isFreeShipping && !savingsTracker.shipping) {
      unlockedMessages.push('Free Delivery');
    }
    
    // 3. Did they just successfully apply a new coupon?
    if (state.coupon && state.coupon.code !== savingsTracker.coupon) {
      unlockedMessages.push('Coupon');
    }

    // Save the new state so we don't duplicate animations on the next click
    savingsTracker = { vip: totals.tier.percent, shipping: isFreeShipping, coupon: state.coupon?.code };

    // Trigger premium global celebration if ANY new saving was unlocked
    if (unlockedMessages.length > 0) {
      const finalMsg = unlockedMessages.join(' & ') + ' Unlocked!';
      
      // Fire the sleek top-sliding notification
      showGlobalCelebration(finalMsg);
      
      // Fire the joyful 'tada' ring on the correct shopping bag icon based on screen size
      const targetSelector = window.matchMedia('(max-width: 720px)').matches ? '.mobile-nav [data-open-cart]' : '.site-header [data-open-cart]';
      document.querySelectorAll(targetSelector).forEach(btn => {
        btn.classList.remove('bag-cheering');
        void btn.offsetWidth; // Force CSS reflow to restart animation
        btn.classList.add('bag-cheering');
        
        setTimeout(() => {
          btn.classList.remove('bag-cheering');
        }, 1100);
      });
    }
  }

  function renderFinancialSummary(prefix, items = activeCheckoutItems()) {
    const totals = calculateTotals(items);
    
    // Only track savings during the main cart render to prevent double-firing
    if (prefix === 'cart') {
      evaluateSavingsAndAnimate(totals);
    }
    
    const prepElement = document.getElementById(`${prefix}-prep-time`);
    if (prepElement) {
      prepElement.textContent = totals.totalPrepDays > 0 ? `${totals.totalPrepDays} day${totals.totalPrepDays === 1 ? '' : 's'}` : 'Ready to ship';
      prepElement.style.color = 'var(--charcoal)';
    }
    setText(`${prefix}-mrp`, Utils.formatCurrency(totals.totalMrp));
    setText(`${prefix}-mrp-discount`, `−${Utils.formatCurrency(totals.mrpDiscount)}`);
    setText(`${prefix}-subtotal`, Utils.formatCurrency(totals.subtotal));
    setText(`${prefix}-shipping`, totals.shipping ? Utils.formatCurrency(totals.shipping) : 'FREE');
    setText(`${prefix}-total`, Utils.formatCurrency(totals.total));
    
    setText(`${prefix}-vip-label`, `VIP Savings (${totals.tier.percent}%)`); 
    setText(`${prefix}-vip-discount`, `−${Utils.formatCurrency(totals.vipDiscount)}`);
    document.getElementById(`${prefix}-vip-row`)?.classList.toggle('hidden', totals.vipDiscount <= 0);
    
    setText(`${prefix}-coupon-label`, state.coupon ? `Coupon (${state.coupon.code})` : 'Coupon Savings');
    setText(`${prefix}-coupon-discount`, state.coupon?.discountType === 'shipping' ? 'Free delivery' : `−${Utils.formatCurrency(totals.couponDiscount)}`);
    document.getElementById(`${prefix}-coupon-row`)?.classList.toggle('hidden', totals.couponDiscount <= 0 && state.coupon?.discountType !== 'shipping');
    
    document.getElementById(`${prefix}-mrp-discount`)?.parentElement.classList.toggle('hidden', totals.mrpDiscount <= 0);
    
    renderSavingsProgress(prefix, totals);
  }

  function renderSavingsProgress(prefix, totals) {
    const next = nextVipTier(totals.quantity);
    const title = document.getElementById(`${prefix}-savings-title`); const message = document.getElementById(`${prefix}-savings-message`); const progress = document.getElementById(`${prefix}-savings-progress`);
    const highest = state.store.vip_tiers[state.store.vip_tiers.length - 1];
    if (next) {
      const needed = next.minimumQuantity - totals.quantity;
      if (title) title.textContent = totals.tier.percent ? `${totals.tier.percent}% VIP saving unlocked` : 'Buy more, save more';
      if (message) message.textContent = `Add ${needed} more item${needed === 1 ? '' : 's'} to unlock ${next.percent}% off.`;
      if (progress) progress.style.width = `${Math.min(100, totals.quantity / highest.minimumQuantity * 100)}%`;
    } else {
      if (title) title.textContent = `Maximum ${highest.percent}% VIP saving unlocked`;
      if (message) message.textContent = `You are saving ${Utils.formatCurrency(totals.vipDiscount)} automatically.`;
      if (progress) progress.style.width = '100%';
    }
    const shippingProgress = document.getElementById(`${prefix}-shipping-progress`);
    if (shippingProgress) {
      const remaining = Math.max(0, totals.threshold - totals.merchandiseTotal);
      shippingProgress.textContent = totals.shipping === 0 ? '✓ Free delivery estimate unlocked' : totals.threshold > 0 ? `Add ${Utils.formatCurrency(remaining)} more for free delivery estimate.` : '';
    }
  }

  function renderRecommendations(location, items = activeCheckoutItems()) {
    const host = document.getElementById(location === 'checkout' ? 'checkout-recommendations' : 'cart-recommendation-row');
    const wrapper = document.getElementById(location === 'checkout' ? 'checkout-recommendations-card' : 'cart-recommendations');
    if (!host || !wrapper || !items.length) { wrapper?.classList.add('hidden'); return; }
    const inCart = new Set(items.map((item) => String(item.productId)));
    const categories = new Set(items.map((item) => state.products.find((product) => String(product.id) === String(item.productId))?.main_category).filter(Boolean));
    const choices = state.products.filter((product) => !inCart.has(String(product.id))).sort((a, b) => Number(categories.has(b.main_category)) - Number(categories.has(a.main_category)) || a.actual_price - b.actual_price).slice(0, 4);
    if (!choices.length) { wrapper.classList.add('hidden'); return; }
    wrapper.classList.remove('hidden');
    host.innerHTML = choices.map((product) => `<article class="recommendation-card" data-recommendation-id="${Utils.escapeHTML(product.id)}"><img src="${Utils.escapeHTML(product.images[0] || '/assets/th_logo.svg?v=mtgyytmo')}" alt=""><strong>${Utils.escapeHTML(product.title)}</strong><span>${Utils.formatCurrency(product.actual_price)}</span><button type="button" data-recommendation-action="${isCanvasProduct(product) ? 'choose' : 'add'}">${isCanvasProduct(product) ? 'Choose size' : 'Quick add'}</button></article>`).join('');
  }

  function handleRecommendationClick(event) {
    const button = event.target.closest('[data-recommendation-action]'); if (!button) return;
    const product = state.products.find((item) => String(item.id) === button.closest('[data-recommendation-id]')?.dataset.recommendationId); if (!product) return;
    if (button.dataset.recommendationAction === 'choose') {
      executeRouteTransition(productURL(product));
    } else { 
      triggerBoomerang(button);
      addProductToCart(product, { quantity: 1 }); 
      showButtonSuccessState(button); // Trigger the "Added" animation
      if (state.page === 'checkout') executeRouteTransition('/?view=checkout'); 
    }
  }

  async function applyCoupon(location) {
    const input = document.getElementById(`${location}-coupon`); 
    const button = document.getElementById(`${location}-apply-coupon`);
    
    if (state.coupon) {
      state.coupon = null; 
      localStorage.removeItem(APP_CONFIG.STORAGE_KEYS.coupon); 
      // Safely clear out both locations
      ['cart', 'checkout'].forEach(loc => {
        const stat = document.getElementById(`${loc}-coupon-status`);
        if (stat) { stat.textContent = 'Coupon removed.'; stat.style.color = 'var(--charcoal)'; stat.style.fontWeight = '500'; }
      });
      renderCart(); 
      if (state.page === 'checkout') renderCheckout(); 
      return;
    }
    
    const code = input?.value.trim().toUpperCase(); 
    if (!code) { 
      ['cart', 'checkout'].forEach(loc => {
        const stat = document.getElementById(`${loc}-coupon-status`);
        if (stat) { stat.textContent = 'Enter a coupon code.'; stat.style.color = '#C5305A'; stat.style.fontWeight = '600'; }
      });
      return; 
    }
    
    button.disabled = true; button.textContent = 'Checking…';
    ['cart', 'checkout'].forEach(loc => {
      const stat = document.getElementById(`${loc}-coupon-status`);
      if (stat) { stat.textContent = ''; }
    });
    
    try {
      const subtotal = calculateTotals(activeCheckoutItems()).subtotal;
      const { data, error } = await supabaseClient.rpc(APP_CONFIG.RPC.validateCoupon, { p_code: code, p_subtotal: subtotal });
      if (error) throw error;
      
      const row = Array.isArray(data) ? data[0] : data;
      
      // CRITICAL LOGIC: Intercept the specific error message provided by the server
      if (row && row.valid === false) {
         throw new Error(row.message || 'This coupon is invalid or inactive.');
      }

      const coupon = normaliseCoupon(row);
      if (!coupon || !coupon.active) throw new Error('This coupon is invalid or inactive.');
      
      state.coupon = coupon; writeStorage(APP_CONFIG.STORAGE_KEYS.coupon, coupon);
      Utils.toast(`${code} applied.`, 'success');
      
    } catch (error) {
      state.coupon = null; localStorage.removeItem(APP_CONFIG.STORAGE_KEYS.coupon); 
      ['cart', 'checkout'].forEach(loc => {
        const stat = document.getElementById(`${loc}-coupon-status`);
        if (stat) { 
          // Display the direct server message
          const errorMsg = error.message && !error.message.includes('Failed to fetch') ? error.message : friendlyDatabaseError(error, 'Coupon could not be applied.');
          stat.textContent = errorMsg; 
          stat.style.color = '#C5305A'; // Deep, crisp red for high contrast
          stat.style.fontWeight = '600'; 
        }
      });
    } finally { 
      button.disabled = false; renderCart(); if (state.page === 'checkout') renderCheckout(); 
    }
  }

  function normaliseCoupon(data) {
    if (!data || !data.code) return null;
    return {
      id: data.id || null,
      code: String(data.code).trim().toUpperCase(),
      discountType: data.discount_type || 'flat',
      value: Number(data.discount_value || 0),
      minimumSpend: Number(data.min_spend_amount || 0),
      maxDiscount: Number(data.max_discount || 0) || null,
      startsAt: data.starts_at || null,
      expiresAt: data.expires_at || data.expiry_date || null,
      active: data.is_active !== false,
      stackWithVip: data.stack_with_vip !== false,
      label: data.display_label || ''
    };
  }

  function syncCouponControls() {
    ['cart', 'checkout'].forEach((location) => {
      const input = document.getElementById(`${location}-coupon`); 
      const button = document.getElementById(`${location}-apply-coupon`);
      const status = document.getElementById(`${location}-coupon-status`);
      
      if (input) { 
        input.value = state.coupon?.code || ''; 
        input.disabled = Boolean(state.coupon); 
      }
      
      if (button) {
        button.textContent = state.coupon ? 'Remove' : 'Apply';
        // Visually deprioritize the button to 'soft' when removing so it acts as a secondary action
        if (state.coupon) {
          button.classList.remove('app-button--dark');
          button.classList.add('app-button--soft');
        } else {
          button.classList.add('app-button--dark');
          button.classList.remove('app-button--soft');
        }
      }
      
      // Ensures the success message is vividly green and bold
      if (status && state.coupon) {
        status.textContent = `${state.coupon.code} applied successfully.`;
        status.style.color = '#347A55'; // Crisp, high-contrast green
        status.style.fontWeight = '600';
      }
    });
  }

  /* ---------------- Checkout and secure enquiry ---------------- */
  let checkoutEventsBound = false;

  function initialiseCheckout() {
    const stored = readStorage(APP_CONFIG.STORAGE_KEYS.customer, {});
    setInputValue('customer-name', stored.name || ''); 
    setInputValue('customer-phone', stored.phone || ''); 
    setInputValue('customer-email', stored.email || ''); 
    setInputValue('customer-address-1', stored.address_line_1 || ''); 
    setInputValue('customer-address-2', stored.address_line_2 || ''); 
    setInputValue('customer-city', stored.city || ''); 
    setInputValue('customer-state', stored.state || ''); 
    setInputValue('customer-pincode', stored.pincode || '');
    
    if (!checkoutEventsBound) {
      document.getElementById('checkout-apply-coupon')?.addEventListener('click', () => applyCoupon('checkout'));
      document.getElementById('checkout-form')?.addEventListener('submit', checkoutWhatsApp);
      document.getElementById('edit-bag-btn')?.addEventListener('click', () => {
        openCart();
      });
      checkoutEventsBound = true;
    }
    renderCheckout();
  }

  function checkoutCompactItemMarkup(item) {
    return `<div style="display: flex; gap: 12px; margin-bottom: 16px; align-items: start;">
      <img src="${Utils.escapeHTML(item.image || '/assets/th_logo.svg?v=mtgyytmo')}" alt="" style="width: 44px; height: 44px; object-fit: cover; border-radius: var(--radius-sm); background: var(--beige); flex-shrink: 0; border: 1px solid var(--line);">
      <div style="flex: 1; min-width: 0;">
        <h4 style="margin: 0 0 2px; font-family: 'Inter', sans-serif; font-size: 0.8rem; font-weight: 600; color: var(--charcoal); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${Utils.escapeHTML(item.title)}</h4>
        ${item.selectedSize ? `<p style="margin: 0; font-size: 0.7rem; color: var(--muted);">${Utils.escapeHTML(item.selectedSize.label)}${item.orientation ? ` · ${Utils.escapeHTML(item.orientation)}` : ''}</p>` : ''}
        ${item.note ? `<p style="margin: 2px 0 0; font-size: 0.7rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Note: ${Utils.escapeHTML(item.note)}</p>` : ''}
      </div>
      <div style="text-align: right; flex-shrink: 0;">
        <strong style="display: block; font-family: 'Inter', sans-serif; font-size: 0.8rem; color: var(--charcoal);">${Utils.formatCurrency(item.estimatedPrice * item.quantity)}</strong>
        <span style="font-size: 0.7rem; color: var(--muted);">Qty: ${item.quantity}</span>
      </div>
    </div>`;
  }

  function renderCheckout() {
    const items = activeCheckoutItems();
    const empty = document.getElementById('checkout-empty'); const content = document.getElementById('checkout-content');
    if (!items.length) { empty?.classList.remove('hidden'); content?.classList.add('hidden'); return; }
    empty?.classList.add('hidden'); content?.classList.remove('hidden');
    document.getElementById('checkout-items').innerHTML = items.map(checkoutCompactItemMarkup).join('');
    renderFinancialSummary('checkout', items); syncCouponControls();
  }

  async function checkoutWhatsApp(event) {
    event.preventDefault();
    const items = activeCheckoutItems(); if (!items.length) return;
    
    const name = document.getElementById('customer-name')?.value.trim();
    const phone = document.getElementById('customer-phone')?.value.replace(/\D/g, '');
    const email = document.getElementById('customer-email')?.value.trim();
    const address_line_1 = document.getElementById('customer-address-1')?.value.trim();
    const address_line_2 = document.getElementById('customer-address-2')?.value.trim();
    const city = document.getElementById('customer-city')?.value.trim();
    const stateStr = document.getElementById('customer-state')?.value.trim();
    const pincode = document.getElementById('customer-pincode')?.value.trim();
    const note = document.getElementById('customer-note')?.value.trim().slice(0, 260);

    if (!name) return focusError('customer-name', 'Please enter your name.');
    if (!phone || phone.length < 10 || phone.length > 15) return focusError('customer-phone', 'Enter a valid WhatsApp number.');
    if (!email || !email.includes('@')) return focusError('customer-email', 'Enter a valid email address.');
    if (!address_line_1) return focusError('customer-address-1', 'Complete your full address details.');
    if (!city) return focusError('customer-city', 'Enter your delivery city.');
    if (!stateStr) return focusError('customer-state', 'Enter your state.');
    if (!/^\d{6}$/.test(pincode)) return focusError('customer-pincode', 'Enter a valid 6-digit Indian Pincode.');

    writeStorage(APP_CONFIG.STORAGE_KEYS.customer, { name, phone, email, address_line_1, address_line_2, city, state: stateStr, pincode });

    const button = document.getElementById('checkout-whatsapp');
    button.disabled = true; button.textContent = 'Securing your final total…';
    try {
      const cartPayload = items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
        selected_size: item.selectedSize,
        orientation: item.orientation,
        note: item.note
      }));
      const customerPayload = { name, phone, email, address_line_1, address_line_2, city, state: stateStr, pincode, note: note || null };
      const localRef = Utils.createLocalReference();
      
      const { data, error } = await supabaseClient.rpc(APP_CONFIG.RPC.createEnquiry, {
        p_cart: cartPayload,
        p_customer: customerPayload,
        p_coupon_code: state.coupon?.code || null,
        p_client_reference: localRef
      });
      if (error) throw error;
      
      const quote = Array.isArray(data) ? data[0] : data;
      
      // Override the database message text to guarantee professional, universally compatible typography
      const reference = quote?.reference || quote?.client_reference || localRef;
      const adminPhone = String(quote?.whatsapp_number || state.store.admin_whatsapp || APP_CONFIG.DEFAULTS.whatsapp).replace(/\D/g, '');
      const totals = calculateTotals(items);
      const itemsList = items.map(item => `- ${item.quantity}x ${item.title}${item.selectedSize ? ` (${item.selectedSize.label})` : ''}`).join('\n');
      
      const messageText = `*NEW ORDER REQUEST*\n\nHello Twisted Happiness Studio,\nI would like to place a secure order. My details are below:\n\n*ORDER SUMMARY*\n• Reference: #${reference}\n• Total Amount: ${Utils.formatCurrency(totals.total)}\n\n*ITEMS ORDERED:*\n${itemsList}\n\n*DELIVERY DETAILS:*\n• Name: ${name}\n• Phone: ${phone}\n• City: ${city}, ${stateStr} - ${pincode}\n${note ? `• Note: ${note}\n` : ''}\n>> Please confirm availability and share the payment details. Thank you!`;

      const secureWhatsAppURL = `https://wa.me/${adminPhone}?text=${encodeURIComponent(messageText)}`;
      
      // 1. Show the beautiful success animation
      showCheckoutSuccessAnimation();

      // 2. Wait exactly 2 seconds, then redirect to WhatsApp
      setTimeout(() => {
        window.location.assign(secureWhatsAppURL);
        
        // 3. Clean up the overlay shortly after redirecting so it isn't stuck when the user returns
            setTimeout(() => {
              const overlay = document.getElementById('checkout-success-overlay');
              if (overlay) {
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 400);
              }
              
              // Empty the bag and clear coupon to prevent duplicate orders
              state.cart = [];
              state.coupon = null;
              localStorage.removeItem(APP_CONFIG.STORAGE_KEYS.coupon);
              persistCart();

              // Reset the button so they can try again if WhatsApp failed to open
              button.disabled = false;
              button.textContent = 'Confirm & open WhatsApp';
              
              // Smoothly route back to the home page so they see the collection when they return
              executeRouteTransition('/');
            }, 1500);
      }, 2000);

    } catch (error) {
      console.error('Secure checkout failed:', error);
      await Utils.choice({ title: 'We could not prepare the order', message: friendlyDatabaseError(error, 'Please try again. No payment has been taken and your bag is safe.'), icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>', primaryLabel: 'Return to bag', hideSecondary: true });
      button.disabled = false; 
      button.textContent = 'Review bag & order on WhatsApp';
    } 
  }

  function showCheckoutSuccessAnimation() {
    const overlay = document.createElement('div');
    overlay.id = 'checkout-success-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(252,247,248,0.95);backdrop-filter:blur(10px);display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;transition:opacity 0.4s ease;';
    
    overlay.innerHTML = `
      <div style="text-align:center; animation: popIn 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;">
        <div style="margin-bottom: 16px; animation: floatHeart 2.5s ease-in-out infinite;"><svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="var(--pink-deep)" stroke="var(--pink-deep)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div>
        <h2 style="font-family:'Lora',serif; color:var(--pink-deep); font-size: 2.2rem; margin:0 0 10px; letter-spacing: -0.02em;">Order Placed!</h2>
        <p style="color:var(--charcoal); font-weight: 600; font-size: 1rem; margin: 0; opacity: 0.8;">Taking you to WhatsApp to confirm...</p>
        <div style="margin: 24px auto 0; display: block; width: 60px; height: 6px; background: rgba(244,143,177,0.3); border-radius: 99px; overflow: hidden;">
           <div style="height: 100%; background: var(--pink-deep); animation: loadingBar 2s linear forwards;"></div>
        </div>
      </div>
      <style>
        @keyframes popIn { 0% { transform: scale(0.8); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes floatHeart { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-12px) scale(1.05); } }
        @keyframes loadingBar { 0% { width: 0%; } 100% { width: 100%; } }
      </style>
    `;
    
    document.body.appendChild(overlay);
    
    // Trigger fade in
    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
    });
  }

  function focusError(id, message) { Utils.toast(message, 'error'); document.getElementById(id)?.focus(); }
  function friendlyDatabaseError(error, fallback) {
    const message = String(error?.message || error?.details || '');
    if (/function .* does not exist|schema cache/i.test(message)) return 'The Supabase final migration has not been applied yet.';
    if (/rate limit/i.test(message)) return 'Too many enquiry attempts were made. Please wait a little and try again.';
    if (/coupon/i.test(message)) return message.replace(/^.*?:\s*/, '') || fallback;
    if (/unavailable|inactive|product/i.test(message)) return message;
    return fallback;
  }

  /* ---------------- WhatsApp ---------------- */
  function whatsappNumber() { return String(state.store.admin_whatsapp || state.store.support_whatsapp || APP_CONFIG.DEFAULTS.whatsapp).replace(/\D/g, '') || APP_CONFIG.DEFAULTS.whatsapp; }
  function whatsappURL(message) { return `https://wa.me/${whatsappNumber()}?text=${encodeURIComponent(message)}`; }
  function setText(id, value) { const element = document.getElementById(id); if (element) element.textContent = value; }
  function setInputValue(id, value) { const element = document.getElementById(id); if (element) element.value = value; }

  function getDynamicPrepTime(basePrep, baseSize, targetSize) {
    const defaultPrep = basePrep || 'Made to order';
    // If there is no target size, stick to the default time
    if (!targetSize || !targetSize.width) return defaultPrep;

    // Calculate the absolute area in square inches
    const targetArea = (targetSize.width || 1) * (targetSize.height || targetSize.width || 1);

    // Look for numbers in the prep time string (e.g., extracts "2" and "3" from "2-3 Days")
    const match = defaultPrep.match(/(\d+)(?:\s*-\s*(\d+))?/);
    if (!match) return defaultPrep;

    let min = parseInt(match[1], 10);
    let max = match[2] ? parseInt(match[2], 10) : min;

    // Realistic area-based scaling (assuming base is 2-3 days)
    let extraDays = 0;
    
    if (targetArea > 576) {
      // Larger than 24x24 in (e.g., 24x36) -> +4 days (Total: 6-7 days)
      extraDays = 4;
    } else if (targetArea > 400) {
      // 16x20 up to 20x20 in -> +3 days (Total: 5-6 days)
      extraDays = 3;
    } else if (targetArea > 225) {
      // 16x16 up to ~15x20 in -> +2 days (Total: 4-5 days)
      extraDays = 2; 
    } else if (targetArea > 100) {
      // 11x11 up to 15x15 in (121 to 225 sq inches) -> +1 day (Total: 3-4 days)
      extraDays = 1;
    }
    // Anything 100 sq inches or less (10x10, 8x8, 5x5) adds 0 extra days.

    if (extraDays === 0) return defaultPrep;

    min += extraDays;
    max += extraDays;

    // Inject the new calculated numbers back into your original string format
    return defaultPrep.replace(match[0], match[2] ? `${min}-${max}` : `${min}`);
  }

  window.APP_CONFIG = APP_CONFIG;
  window.supabaseClient = supabaseClient;
  window.Utils = Utils;

  // Startup hook MUST be at the absolute bottom after all variables are hoisted
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialiseApp);
  } else {
    initialiseApp();
  }
 
})();
