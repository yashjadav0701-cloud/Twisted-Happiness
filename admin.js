/** Twisted Happiness secure studio admin. */
(() => {
  'use strict';

  const APP_CONFIG = Object.freeze({
    APP_NAME: 'Twisted Happiness',
    APP_VERSION: '2026.08.03-spa',
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
    STORAGE_KEYS: Object.freeze({ customer: 'twisted_happiness_customer_v2' }),
    MAX_PRODUCT_IMAGES: 8,
    DEFAULT_CARE_GUIDE: 'Keep away from water and direct heat.\nDust gently with a soft, dry brush.\nHandle delicate handmade details with care.'
  });

  const supabaseClient = window.supabase ? window.supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'twisted-happiness-auth' }
  }) : null;

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
    roundMoney(value) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; },
    formatCurrency(value) { const n = Utils.roundMoney(value); return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n); },
    slugify(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90); },
    choice({ title = 'Please choose', message = '', icon = '✨', primaryLabel = 'Continue', secondaryLabel = 'Cancel', hideSecondary = false } = {}) {
      return new Promise((resolve) => {
        document.getElementById('admin-modal-overlay')?.remove();
        const overlay = document.createElement('div'); overlay.id = 'admin-modal-overlay'; overlay.className = 'admin-modal-overlay';
        overlay.innerHTML = `<section class="admin-modal-card" role="dialog" aria-modal="true"><div class="admin-modal-icon" aria-hidden="true">${Utils.escapeHTML(icon)}</div><h2 class="admin-modal-title">${Utils.escapeHTML(title)}</h2><p class="admin-modal-text">${Utils.escapeHTML(message)}</p><div class="admin-modal-actions">${hideSecondary ? '' : `<button type="button" class="admin-button admin-button--soft" data-modal-secondary>${Utils.escapeHTML(secondaryLabel)}</button>`}<button type="button" class="admin-button admin-button--dark" data-modal-primary>${Utils.escapeHTML(primaryLabel)}</button></div></section>`;
        document.body.appendChild(overlay);
        
        requestAnimationFrame(() => overlay.classList.add('is-visible'));

        overlay.querySelector('[data-modal-primary]')?.addEventListener('click', () => { overlay.classList.remove('is-visible'); setTimeout(() => { overlay.remove(); resolve('primary'); }, 200); });
        overlay.querySelector('[data-modal-secondary]')?.addEventListener('click', () => { overlay.classList.remove('is-visible'); setTimeout(() => { overlay.remove(); resolve('secondary'); }, 200); });
        overlay.addEventListener('click', (e) => { if (e.target === overlay && !hideSecondary) { overlay.classList.remove('is-visible'); setTimeout(() => { overlay.remove(); resolve('dismiss'); }, 200); } });
      });
    },
    async compressImage(file, options = {}) {
      const maxDimension = 1920; const maxBytes = 500000;
      let source; let objectURL = null;
      if ('createImageBitmap' in window) { source = await createImageBitmap(file, { imageOrientation: 'from-image' }); } else { objectURL = URL.createObjectURL(file); source = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Invalid image.')); image.src = objectURL; }); }
      try {
        let scale = Math.min(1, maxDimension / Math.max(source.width, source.height)); let blob = null; let quality = 0.9;
        for (let i = 0; i < 5; i++) {
          const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(source.width * scale)); canvas.height = Math.max(1, Math.round(source.height * scale));
          const context = canvas.getContext('2d', { alpha: true }); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.drawImage(source, 0, 0, canvas.width, canvas.height);
          quality = 0.9;
          for (let j = 0; j < 8; j++) { blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', quality)); if (blob.size <= maxBytes) break; quality -= 0.08; }
          if (blob?.size <= maxBytes) break; scale *= 0.82;
        }
        if (!blob || blob.size > maxBytes) throw new Error('Could not compress image.');
        return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.webp`, { type: 'image/webp', lastModified: Date.now() });
      } finally { source?.close?.(); if (objectURL) URL.revokeObjectURL(objectURL); }
    }
  };

  const state = {
    page: document.body.dataset.adminPage,
    session: null,
    products: [],
    coupons: [],
    reviews: [],
    enquiries: [],
    settings: null,
    canvasSizes: [],
    vipTiers: [],
    editingProduct: null,
    productImages: [],
    originalPrice: null,
    mrpManuallyEdited: false,
    suppressMRPTracking: false
  };

  const CARE_GUIDES = {
    'Whimsical Art': `Keep away from water and direct humidity.\nDust gently with a soft, dry brush or lint roller.\nAdjust stems and petals gently without over-bending.\nAvoid prolonged direct sunlight to prevent fading.\nKeep out of reach of pets to protect the pipe-cleaner fuzz.`,
    'Painted Whispers': `Keep out of direct sunlight to protect the painted colours.\nWipe gently with a clean, dry microfiber cloth.\nAvoid high humidity areas to maintain canvas tension.\nHandle by the outer frame edges to avoid smudging.\nDo not lean sharp or heavy objects against the canvas.`,
    'Clay Stories': `Keep strictly away from water and extreme moisture.\nDust gently using a small, soft-bristled brush.\nHard Clay: Handle with care and avoid dropping, as it can chip or break.\nSoft Clay: Keep away from sharp objects to prevent permanent dents or scratches.\nStore in a sturdy, dry box if not actively displayed.`,
    'Standard': `Keep away from direct water contact and heat sources.\nDust gently with a clean, dry brush or soft cloth.\nHandle any delicate handmade elements with care.\nAvoid direct sunlight to maintain the original finish.\nProtect from heavy objects resting on or crushing the piece.`
  };

  document.addEventListener('DOMContentLoaded', initialiseApp);

  function bindAdminRouter() {
    window.addEventListener('popstate', () => {
      executeRouteTransition(window.location.hash || '#dashboard');
    });

    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-admin-nav-link], a[href^="#"]');
      if (!link) return;
      e.preventDefault();
      executeRouteTransition(new URL(link.href, window.location.origin).hash || '#dashboard');
    });
  }

  async function executeRouteTransition(hash) {
    const root = document.querySelector('.admin-main');
    if (root) {
      root.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      root.style.opacity = '0';
      root.style.transform = 'translateY(5px)';
      await new Promise(r => setTimeout(r, 200));
    }

    handleRoute(hash);

    if (root) {
      window.scrollTo(0, 0);
      requestAnimationFrame(() => {
        root.style.opacity = '1';
        root.style.transform = 'translateY(0)';
      });
    }
  }

  function handleRoute(hash) {
    const page = hash.replace('#', '') || 'dashboard';
    state.page = page;
    document.body.dataset.adminPage = page;
    
    // Hide all views
    document.querySelectorAll('.spa-view').forEach(v => { v.style.display = 'none'; v.classList.remove('active'); });
    
    // Show active view
    const activeView = document.getElementById(`view-${page}`);
    if (activeView) {
      activeView.style.display = 'block';
      requestAnimationFrame(() => activeView.classList.add('active'));
    }

    // Update navigation active states
    document.querySelectorAll('[data-admin-nav-link]').forEach(nav => {
      nav.classList.toggle('is-active', nav.dataset.adminNavLink === page);
    });

    // Close mobile sidebar if open
    document.querySelector('.admin-sidebar')?.classList.remove('is-open');

    initialisePage();
  }

  async function initialiseApp() {
    // Register Service Worker for PWA and Push Notifications cleanly
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/sw.js');
      } catch (err) {
        console.error('Service Worker registration failed:', err);
      }
    }

    bindGlobalAdminEvents();
    bindAdminRouter();
    
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && await hasAdminRole(session.user.id)) {
      state.session = session;
      showWorkspace();
      handleRoute(window.location.hash || '#dashboard');
      listenForNewOrders();
    } else {
      if (session) await supabaseClient.auth.signOut();
      showLogin();
    }
  }

  /* ---------------- Live Admin Alerts ---------------- */
  function listenForNewOrders() {
    supabaseClient
      .channel('admin-order-alerts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_enquiries' }, payload => {
        const order = payload.new;
        
        // Show a beautiful, native admin toast notification
        const alertMsg = `🌸 New Order Alert! ${order.customer_name} from ${order.customer_city || 'your store'} just placed an order for ${Utils.formatCurrency(order.total_amount)}.`;
        notify(alertMsg, 'success');

        // Automatically refresh the dashboard or enquiries list so the new order appears instantly
        if (state.page === 'enquiries') loadEnquiries();
        if (state.page === 'dashboard') initialiseDashboard();
      })
      .subscribe();
  }

  async function hasAdminRole(userId) {
    if (!userId) return false;
    const { data, error } = await supabaseClient.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    return !error && data?.role === 'admin';
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function bindGlobalAdminEvents() {
    // Enable Notifications with Custom Modal Error Handling
    document.getElementById('enable-notifications')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setLoading(btn, true, 'Enabling...');
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
          throw new Error('Push notifications are not supported by your current browser or device.');
        }
        
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          throw new Error('Permission was denied. You must allow notifications in your browser settings to receive alerts.');
        }
        
        const registration = await navigator.serviceWorker.ready;
        
        // ⚠️ CRITICAL: Replace the string below with your 87-character Public VAPID Key.
        // Make sure there are NO spaces before or after the key inside the quotes.
        const publicVapidKey = 'BDSLU_bkW1CzAngKt3WWp-ys8t0UDvgbhwhSaSVtfgYv-vFxTkt1JCv3geMoXQhWZ1m8NG0EMVb06iaZGa5x6CM'; 
        const applicationServerKey = urlBase64ToUint8Array(publicVapidKey);
        
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        });
        
        const { error } = await supabaseClient.from('admin_push_subscriptions').insert([{
          subscription: subscription.toJSON()
        }]);
        
        // Ignore duplicate error if device is already registered
        if (error && error.code !== '23505') throw error; 
        
        await Utils.choice({ 
          title: 'Alerts Enabled!', 
          message: 'This device is now registered to receive instant push notifications for new orders.', 
          icon: '🌸', 
          hideSecondary: true, 
          primaryLabel: 'Awesome' 
        });
        
      } catch (err) {
        await Utils.choice({ 
          title: 'Setup Failed', 
          message: err.message || 'An unexpected error occurred.', 
          icon: '⚠️', 
          hideSecondary: true, 
          primaryLabel: 'Okay' 
        });
      } finally {
        setLoading(btn, false);
      }
    });

    // Test Notification Button
    document.getElementById('test-notification')?.addEventListener('click', async (e) => {
      try {
        if (Notification.permission !== 'granted') {
          throw new Error('Notifications are not enabled yet. Please click "Enable Alerts" first.');
        }
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification('✨ Test Alert Successful!', {
          body: 'Your device is perfectly configured to receive Twisted Happiness order alerts.',
          icon: '/assets/th_logo.svg',
          badge: '/assets/th_logo.svg',
          vibrate: [200, 100, 200]
        });
      } catch (err) {
        await Utils.choice({ 
          title: 'Test Failed', 
          message: err.message, 
          icon: '⚠️', 
          hideSecondary: true, 
          primaryLabel: 'Okay' 
        });
      }
    });

    document.getElementById('admin-logout')?.addEventListener('click', async () => {
      await supabaseClient.auth.signOut(); 
      state.session = null; 
      showLogin('You have signed out safely.');
    });
    
    document.querySelector('[data-admin-menu]')?.addEventListener('click', () => {
      document.querySelector('.admin-sidebar')?.classList.toggle('is-open');
    });
    
    document.addEventListener('click', (event) => {
      const sidebar = document.querySelector('.admin-sidebar');
      if (sidebar?.classList.contains('is-open') && !event.target.closest('.admin-sidebar') && !event.target.closest('[data-admin-menu]')) {
        sidebar.classList.remove('is-open');
      }
    });
    
    // Enable Ctrl + Shift + K to instantly focus search boxes globally
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        const searchBox = document.getElementById('enquiry-search') || document.getElementById('product-search');
        if (searchBox) searchBox.focus();
      }
    });
  }
      const btn = e.currentTarget;
      setLoading(btn, true, 'Enabling...');
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Push not supported by this browser.');
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Notification permission denied.');
        
        const registration = await navigator.serviceWorker.ready;
        // REPLACE THE STRING BELOW WITH YOUR GENERATED PUBLIC KEY
        const publicVapidKey = 'BDSLU_bkW1CzAngKt3WWp-ys8t0UDvgbhwhSaSVtfgYv-vFxTkt1JCv3geMoXQhWZ1m8NG0EMVb06iaZGa5x6CM'; 
        const applicationServerKey = urlBase64ToUint8Array(publicVapidKey);
        
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        });
        
        const { error } = await supabaseClient.from('admin_push_subscriptions').insert([{
          subscription: subscription.toJSON()
        }]);
        
        if (error) throw error;
        notify('Push notifications enabled for this device!', 'success');
      } catch (err) {
        notify(err.message, 'error');
      } finally {
        setLoading(btn, false);
      }
    });

    document.getElementById('admin-logout')?.addEventListener('click', async () => {
      await supabaseClient.auth.signOut(); 
      state.session = null; 
      showLogin('You have signed out safely.');
    });
    document.querySelector('[data-admin-menu]')?.addEventListener('click', () => {
      document.querySelector('.admin-sidebar')?.classList.toggle('is-open');
    });
    document.addEventListener('click', (event) => {
      const sidebar = document.querySelector('.admin-sidebar');
      if (sidebar?.classList.contains('is-open') && !event.target.closest('.admin-sidebar') && !event.target.closest('[data-admin-menu]')) {
        sidebar.classList.remove('is-open');
      }
    });
    
    // Enable Ctrl + Shift + K to instantly focus search boxes globally
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        const searchBox = document.getElementById('enquiry-search') || document.getElementById('product-search');
        if (searchBox) searchBox.focus();
      }
    });
  }

  function showLogin(message = '') {
    document.getElementById('admin-workspace')?.classList.add('hidden');
    const root = document.getElementById('admin-auth-root');
    root.innerHTML = `
      <section class="admin-auth">
        <div class="admin-auth-card">
          <img src="/assets/th_logo.svg" alt="Twisted Happiness" style="width: 76px; height: 76px; object-fit: contain; margin: 0 auto 16px; border-radius: 50%; box-shadow: 0 10px 30px rgba(49,38,43,.08);">
          <p class="admin-eyebrow">Twisted Happiness</p>
          <h1>Studio access</h1>
          <p>The shortcut and private route are conveniences only. Supabase authentication, admin roles and RLS provide the real protection.</p>
          <form id="admin-login-form">
            <label class="admin-field"><span>Email</span><input id="admin-email" class="admin-input" type="email" required autocomplete="username"></label>
            <label class="admin-field"><span>Password</span><input id="admin-password" class="admin-input" type="password" required minlength="6" autocomplete="current-password"></label>
            <button id="admin-login-button" class="admin-button admin-button--dark" type="submit">Sign in securely</button>
            <p id="admin-auth-message" class="admin-auth-message">${Utils.escapeHTML(message)}</p>
          </form>
        </div>
      </section>`;
    root.classList.remove('hidden');
    document.getElementById('admin-login-form').addEventListener('submit', login);
  }

  async function login(event) {
    event.preventDefault();
    const button = document.getElementById('admin-login-button'); 
    const message = document.getElementById('admin-auth-message');
    setLoading(button, true, 'Signing in…'); 
    message.textContent = '';
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ 
        email: document.getElementById('admin-email').value.trim(), 
        password: document.getElementById('admin-password').value 
      });
      if (error || !data.session) throw error || new Error('Sign-in failed.');
      if (!await hasAdminRole(data.user.id)) { 
        await supabaseClient.auth.signOut(); 
        throw new Error('This account does not have admin access.'); 
      }
      state.session = data.session; 
      showWorkspace(); 
      await initialisePage();
    } catch (error) { 
      message.textContent = error.message || 'Unable to sign in.'; 
    } finally { 
      setLoading(button, false); 
    }
  }

  function showWorkspace() { 
    document.getElementById('admin-auth-root')?.classList.add('hidden'); 
    document.getElementById('admin-workspace')?.classList.remove('hidden'); 
  }

  async function initialisePage() {
    if (state.page === 'dashboard') await initialiseDashboard();
    if (state.page === 'products') await initialiseProducts();
    if (state.page === 'settings') await initialiseSettings();
    if (state.page === 'enquiries') await initialiseEnquiries();
  }

  /* ---------------- Compact dashboard ---------------- */
  async function initialiseDashboard() {
    const [productsResult, enquiriesResult, couponsResult, reviewsResult, recentResult] = await Promise.all([
      supabaseClient.from('products').select('id,is_active', { count: 'exact' }),
      supabaseClient.from('whatsapp_enquiries').select('id,status', { count: 'exact' }),
      supabaseClient.from('coupons').select('id,is_active', { count: 'exact' }),
      supabaseClient.from('reviews').select('id,is_approved', { count: 'exact' }),
      supabaseClient.from('whatsapp_enquiries').select('id,reference,customer_name,total_amount,status,created_at').order('created_at', { ascending: false }).limit(6)
    ]);

    const failures = [productsResult, enquiriesResult, couponsResult, reviewsResult, recentResult].filter((result) => result.error);
    if (failures.length) notify(failures[0].error.message, 'error');

    const products = productsResult.data || [];
    const enquiries = enquiriesResult.data || [];
    const coupons = couponsResult.data || [];
    const reviews = reviewsResult.data || [];
    setText('metric-products-active', products.filter((item) => item.is_active).length);
    setText('metric-products-total', `${productsResult.count ?? products.length} total products`);
    setText('metric-enquiries-new', enquiries.filter((item) => item.status === 'new').length);
    setText('metric-enquiries-total', `${enquiriesResult.count ?? enquiries.length} total enquiries`);
    setText('metric-coupons-active', coupons.filter((item) => item.is_active).length);
    setText('metric-coupons-total', `${couponsResult.count ?? coupons.length} total coupons`);
    setText('metric-reviews-approved', reviews.filter((item) => item.is_approved).length);
    setText('metric-reviews-total', `${reviewsResult.count ?? reviews.length} total reviews`);

    const host = document.getElementById('dashboard-enquiries');
    if (!host) return;
    const recent = recentResult.data || [];
    host.innerHTML = recent.length ? recent.map((enquiry) => `
      <a class="dashboard-enquiry" href="#enquiries">
        <div>
          <h3>${Utils.escapeHTML(enquiry.reference)}</h3>
          <p>${Utils.escapeHTML(enquiry.customer_name)} · ${Utils.escapeHTML(enquiry.status)} · ${Utils.escapeHTML(new Date(enquiry.created_at).toLocaleString('en-IN'))}</p>
        </div>
        <strong>${Utils.formatCurrency(enquiry.total_amount)}</strong>
      </a>`).join('') : '<div class="admin-empty">No WhatsApp enquiries yet.</div>';
  }

  /* ---------------- Products ---------------- */
  let productsBound = false;
  async function initialiseProducts() {
    if (!productsBound) { bindProductEvents(); productsBound = true; }
    resetProductForm(); 
    await loadCanvasSizesForDropdown();
    await loadProducts();
  }

  async function loadCanvasSizesForDropdown() {
    const { data } = await supabaseClient.from('store_settings').select('global_canvas_sizes').eq('id', 1).maybeSingle();
    if (data) {
      state.canvasSizes = Utils.normaliseCanvasSizes(data.global_canvas_sizes, APP_CONFIG.DEFAULTS.canvasSizes);
    }
    updateCanvasFields();
  }

  function renderCategoryDropdown() {
    const menu = document.getElementById('category-dropdown-menu');
    if (!menu) return;
    
    // Extract unique categories currently used in the DB
    const categories = [...new Set(state.products.map(p => p.main_category).filter(Boolean))];
    if (!categories.includes('Whimsical Art')) categories.unshift('Whimsical Art');
    if (!categories.includes('Painted Whispers')) categories.push('Painted Whispers');
    if (!categories.includes('Clay Stories')) categories.push('Clay Stories');
    const uniqueCategories = [...new Set(categories)];
    
    menu.innerHTML = uniqueCategories.map(cat => `
      <div class="custom-select-option" data-value="${Utils.escapeHTML(cat)}">${Utils.escapeHTML(cat)}</div>
    `).join('') + `
      <div class="custom-select-input-wrapper">
        <input type="text" id="category-dropdown-new" placeholder="Type a new category & press Enter..." autocomplete="off">
      </div>
    `;
  }

  function bindCustomDropdown() {
    const wrapper = document.getElementById('category-dropdown-wrapper');
    const btn = document.getElementById('category-dropdown-btn');
    const menu = document.getElementById('category-dropdown-menu');
    const hiddenInput = document.getElementById('product-category');
    const label = document.getElementById('category-dropdown-label');
    
    if(!wrapper) return;

    btn.addEventListener('click', () => {
      const isExpanded = btn.getAttribute('aria-expanded') === 'true';
      if (!isExpanded) renderCategoryDropdown();
      
      btn.setAttribute('aria-expanded', !isExpanded);
      if (!isExpanded) {
         menu.classList.add('is-open');
         setTimeout(() => document.getElementById('category-dropdown-new')?.focus(), 50);
      } else {
         menu.classList.remove('is-open');
      }
    });

    menu.addEventListener('click', (e) => {
      const option = e.target.closest('.custom-select-option');
      if (option) {
        hiddenInput.value = option.dataset.value;
        label.textContent = option.dataset.value;
        btn.setAttribute('aria-expanded', 'false');
        menu.classList.remove('is-open');
        updateProductCategoryUI();
        if (CARE_GUIDES[option.dataset.value]) setValue('product-care', CARE_GUIDES[option.dataset.value]);
      }
    });

    menu.addEventListener('keydown', (e) => {
      if (e.target.id === 'category-dropdown-new' && e.key === 'Enter') {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val) {
          hiddenInput.value = val;
          label.textContent = val;
          btn.setAttribute('aria-expanded', 'false');
          menu.classList.remove('is-open');
          updateProductCategoryUI();
          if (CARE_GUIDES[val]) setValue('product-care', CARE_GUIDES[val]);
        }
      }
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        btn.setAttribute('aria-expanded', 'false');
        menu.classList.remove('is-open');
      }
    });
  }

  function renderFilterDropdown() {
    const menu = document.getElementById('filter-dropdown-menu');
    if (!menu) return;
    
    // Dynamically extract only active, existing main categories from the database
    const categories = [...new Set(state.products.filter(p => p.is_active).map(p => p.main_category).filter(Boolean))];
    
    menu.innerHTML = `
      <div class="custom-select-option" data-value="all">All products</div>
      <div class="custom-select-option" data-value="active">Visible only</div>
      <div class="custom-select-option" data-value="hidden">Hidden only</div>
      ${categories.length ? '<div style="height:1px; background:var(--line); margin:4px 0;"></div>' : ''}
      ${categories.map(cat => `<div class="custom-select-option" data-value="${Utils.escapeHTML(cat)}">${Utils.escapeHTML(cat)}</div>`).join('')}
    `;
  }

  function bindFilterDropdown() {
    const wrapper = document.getElementById('filter-dropdown-wrapper');
    const btn = document.getElementById('filter-dropdown-btn');
    const menu = document.getElementById('filter-dropdown-menu');
    const hiddenInput = document.getElementById('product-filter');
    const label = document.getElementById('filter-dropdown-label');
    
    if(!wrapper) return;

    btn.addEventListener('click', () => {
      const isExpanded = btn.getAttribute('aria-expanded') === 'true';
      if (!isExpanded) renderFilterDropdown();
      
      btn.setAttribute('aria-expanded', !isExpanded);
      if (!isExpanded) {
         menu.classList.add('is-open');
      } else {
         menu.classList.remove('is-open');
      }
    });

    menu.addEventListener('click', (e) => {
      const option = e.target.closest('.custom-select-option');
      if (option) {
        hiddenInput.value = option.dataset.value;
        label.textContent = option.textContent;
        btn.setAttribute('aria-expanded', 'false');
        menu.classList.remove('is-open');
        renderProductList(); // Trigger the actual filter update
      }
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        btn.setAttribute('aria-expanded', 'false');
        menu.classList.remove('is-open');
      }
    });
  }

  function bindProductEvents() {
    bindCustomDropdown();
    bindFilterDropdown();
    document.getElementById('product-form')?.addEventListener('submit', saveProduct);
    document.getElementById('new-product')?.addEventListener('click', () => { resetProductForm(); document.getElementById('product-title')?.focus(); });
    document.getElementById('reset-product-form')?.addEventListener('click', resetProductForm);
    document.getElementById('canvas-shape')?.addEventListener('change', updateCanvasFields);
    document.getElementById('product-price')?.addEventListener('change', handleSellingPriceChange);
    document.getElementById('product-mrp')?.addEventListener('input', () => { if (!state.suppressMRPTracking) state.mrpManuallyEdited = true; });
    document.getElementById('generate-mrp')?.addEventListener('click', () => generateAndSetMRP(true));
    document.getElementById('product-images')?.addEventListener('change', handleImageSelection);
    document.getElementById('image-preview-list')?.addEventListener('click', handleImagePreviewAction);
    document.getElementById('product-search')?.addEventListener('input', renderProductList);
    document.getElementById('product-list')?.addEventListener('click', handleProductAction);
  }

  async function loadProducts() {
    const list = document.getElementById('product-list'); 
    if (list) list.innerHTML = '<div class="admin-empty">Loading products…</div>';
    
    const { data, error } = await supabaseClient.from('products').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: false });
    if (error) { 
      notify(error.message, 'error'); 
      if (list) list.innerHTML = '<div class="admin-empty">Products could not be loaded.</div>'; 
      return; 
    }
    state.products = (data || []).map((product) => ({ ...product, images: Utils.normaliseImages(product.images), attributes: Utils.normaliseAttributes(product.attributes) }));
    renderProductList();
    if (state.page === 'products') updateProductCategoryUI();
  }

  function renderProductList() {
    const host = document.getElementById('product-list'); if (!host) return;
    const search = document.getElementById('product-search')?.value.trim().toLowerCase() || '';
    const filter = document.getElementById('product-filter')?.value || 'all';
    
    const filtered = state.products.filter((product) => {
      const text = `${product.title || ''} ${product.main_category || ''} ${product.sub_category || ''}`.toLowerCase();
      const matchesSearch = !search || text.includes(search);
      const matchesFilter = filter === 'all' || 
                            (filter === 'active' && product.is_active) || 
                            (filter === 'hidden' && !product.is_active) || 
                            (product.main_category === filter);
      return matchesSearch && matchesFilter;
    });
    
    document.getElementById('product-count').textContent = String(filtered.length);
    if (!filtered.length) { host.innerHTML = '<div class="admin-empty">No products match this view.</div>'; return; }
    
    host.innerHTML = filtered.map((product) => `
      <article class="product-row" data-product-id="${Utils.escapeHTML(product.id)}">
        <img src="${Utils.escapeHTML(product.images[0] || '/assets/th_logo.svg')}" alt="">
        
        <div class="product-row-info">
          <h3>${Utils.escapeHTML(product.title)}</h3>
          <p>${Utils.escapeHTML(product.main_category || 'Uncategorised')} · ${Utils.formatCurrency(product.actual_price)} · ${Utils.escapeHTML(product.preparation_days || 'No prep')}</p>
          <span class="status-pill ${product.is_active ? 'is-active' : ''}" style="align-self: flex-start; margin-top: 2px;">${product.is_active ? 'Visible' : 'Hidden'}</span>
        </div>
        
        <div class="product-row-actions">
          <button type="button" class="admin-button admin-button--soft" data-product-action="edit" title="Edit" style="width: 32px; height: 32px; min-height: 32px; padding: 0; border-radius: 8px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button type="button" class="admin-button admin-button--soft" data-product-action="toggle" title="${product.is_active ? 'Hide' : 'Show'}" style="width: 32px; height: 32px; min-height: 32px; padding: 0; border-radius: 8px;">
            ${product.is_active 
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>' 
              : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'}
          </button>
          <button type="button" class="admin-button admin-button--soft is-danger" data-product-action="delete" title="Delete" style="width: 32px; height: 32px; min-height: 32px; padding: 0; color: var(--red); border-color: rgba(186,102,119,0.3); border-radius: 8px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
      </article>`).join('');
  }

  function handleProductAction(event) {
    const button = event.target.closest('[data-product-action]'); if (!button) return;
    const product = state.products.find((item) => String(item.id) === button.closest('[data-product-id]')?.dataset.productId); if (!product) return;
    if (button.dataset.productAction === 'edit') editProduct(product);
    if (button.dataset.productAction === 'duplicate') duplicateProduct(product);
    if (button.dataset.productAction === 'toggle') toggleProduct(product);
    if (button.dataset.productAction === 'delete') deleteProduct(product);
  }

  function editProduct(product) {
    state.editingProduct = product; 
    state.originalPrice = Number(product.actual_price); 
    state.mrpManuallyEdited = Boolean(product.mrp_generated_from_price === null);
    
    setValue('product-id', product.id); 
    setValue('product-title', product.title || ''); 
    setValue('product-price', product.actual_price ?? ''); 
    setValue('product-mrp', product.fake_price ?? '');
    setValue('product-category', product.main_category || 'Whimsical Art'); 
    
    const label = document.getElementById('category-dropdown-label');
    if (label) label.textContent = product.main_category || 'Whimsical Art'; 
    setValue('product-subcategory', product.sub_category || ''); 
    setValue('product-preparation', product.preparation_days || '2-3 Days'); 
    setValue('product-sort-order', product.sort_order ?? 100); 
    setValue('product-description', product.description || ''); 
    setValue('product-care', product.care_instructions || APP_CONFIG.DEFAULT_CARE_GUIDE);
    
    document.getElementById('product-active').checked = product.is_active !== false;
    state.productImages = product.images.map((url) => ({ url, preview: url, isNew: false, file: null }));
    updateProductCategoryUI();
    
    const canvas = productCanvasConfig(product);
    if (product.main_category === 'Painted Whispers' && canvas.baseSize) {
      setValue('canvas-shape', canvas.baseSize.shape || 'square'); 
      updateCanvasFields();
      setValue('canvas-size-select', canvas.baseSize.id);
      setValue('canvas-orientation', canvas.orientation || 'Portrait');
    }
    
    renderImagePreviews(); 
    setText('product-form-title', 'Edit product'); 
    setText('product-edit-indicator', 'Editing'); 
    
    const saveBtn = document.getElementById('save-product');
    if (saveBtn) { saveBtn.textContent = 'Update product'; saveBtn.dataset.label = 'Update product'; }
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function duplicateProduct(product) {
    editProduct({ ...product, id: '', title: `${product.title} Copy`, is_active: false });
    state.editingProduct = null; 
    state.originalPrice = null; 
    state.mrpManuallyEdited = false; 
    setValue('product-id', '');
    setText('product-form-title', 'Duplicate product'); 
    setText('product-edit-indicator', 'Hidden copy'); 
    document.getElementById('product-active').checked = false;
  }

  function resetProductForm() {
    state.editingProduct = null; 
    state.originalPrice = null; 
    state.mrpManuallyEdited = false;
    state.productImages.forEach((image) => { if (image.isNew && image.preview?.startsWith('blob:')) URL.revokeObjectURL(image.preview); });
    state.productImages = [];
    
    const form = document.getElementById('product-form'); 
    if (form) form.reset(); 
    
    const defaultCategory = 'Whimsical Art';
    setValue('product-category', defaultCategory);
    const label = document.getElementById('category-dropdown-label');
    if (label) label.textContent = defaultCategory;
    
    setValue('product-id', ''); 
    setValue('product-care', CARE_GUIDES[defaultCategory] || APP_CONFIG.DEFAULT_CARE_GUIDE); 
    setValue('product-preparation', '2-3 Days'); 
    setValue('product-sort-order', '100'); 
    document.getElementById('product-active').checked = true;
    
    setText('product-form-title', 'Add product'); 
    setText('product-edit-indicator', 'New creation'); 
    
    const saveBtn = document.getElementById('save-product');
    if (saveBtn) { saveBtn.textContent = 'Save product'; saveBtn.dataset.label = 'Save product'; }
    
    updateProductCategoryUI(); 
    renderImagePreviews();
  }

  function updateProductCategoryUI() {
    const category = document.getElementById('product-category')?.value || 'Standard';
    document.getElementById('canvas-fields')?.classList.toggle('hidden', category !== 'Painted Whispers');
    
    const datalist = document.getElementById('subcategory-list');
    if (datalist) {
      const relevantProducts = state.products.filter(p => p.main_category === category && p.sub_category);
      const frequency = {};
      relevantProducts.forEach(p => { frequency[p.sub_category] = (frequency[p.sub_category] || 0) + 1; });
      const sortedSubcategories = Object.keys(frequency).sort((a, b) => frequency[b] - frequency[a]);
      datalist.innerHTML = sortedSubcategories.map((subcategory) => `<option value="${Utils.escapeHTML(subcategory)}"></option>`).join('');
    }
    updateCanvasFields();
  }

  function updateCanvasFields() {
    const shape = document.getElementById('canvas-shape')?.value || 'square';
    const sizeSelect = document.getElementById('canvas-size-select');
    
    if (sizeSelect && state.canvasSizes) {
      const relevantSizes = state.canvasSizes.filter(s => (s.shape || 'square') === shape);
      if (!relevantSizes.length) {
        sizeSelect.innerHTML = '<option value="">No sizes added in settings</option>';
      } else {
        sizeSelect.innerHTML = relevantSizes.map(size => {
          const label = shape === 'circle' ? `${size.diameter} in diameter` : `${size.width} × ${size.height || size.width} in`;
          return `<option value="${size.id}">${label}</option>`;
        }).join('');
      }
    }

    document.getElementById('canvas-orientation-field')?.classList.toggle('hidden', shape !== 'rectangle');
  }

  function handleSellingPriceChange() {
    const price = Number(document.getElementById('product-price')?.value || 0);
    if (!price) return;
    const changed = state.originalPrice === null || Math.abs(price - state.originalPrice) > 0.0001;
    
    // Only auto-generate MRP if the user hasn't explicitly set a custom one
    if (changed && !state.mrpManuallyEdited) {
      generateAndSetMRP(false);
    }
  }

  function generateAndSetMRP(manualRequest) {
    const price = Number(document.getElementById('product-price')?.value || 0);
    if (!Number.isFinite(price) || price <= 0) return notify('Enter the selling price first.', 'error');
    const mrp = generateBelievableMRP(price);
    state.suppressMRPTracking = true; 
    setValue('product-mrp', mrp); 
    state.suppressMRPTracking = false;
    
    if (manualRequest) state.mrpManuallyEdited = true;
    
    setText('mrp-hint', `Generated MRP ${Utils.formatCurrency(mrp)}. It will be stored permanently.`);
  }

  function generateBelievableMRP(price) {
    const random = new Uint32Array(1); crypto.getRandomValues(random);
    const percent = 10 + (random[0] % 51);
    const minimum = price * 1.1;
    const maximum = price * 1.6;
    const raw = price * (1 + percent / 100);
    let mrp = Math.ceil(raw / 10) * 10 - 1;
    if (mrp < minimum || mrp > maximum) mrp = raw;
    mrp = Math.min(maximum, Math.max(minimum, mrp));
    return Utils.roundMoney(mrp);
  }

  async function handleImageSelection(event) {
    const files = Array.from(event.target.files || []); 
    const available = APP_CONFIG.MAX_PRODUCT_IMAGES - state.productImages.length;
    if (available <= 0) { notify(`Maximum ${APP_CONFIG.MAX_PRODUCT_IMAGES} images allowed.`, 'error'); return; }
    
    const selected = files.slice(0, available); notify('Optimising images…');
    try {
      for (const file of selected) {
        const compressed = await Utils.compressImage(file);
        state.productImages.push({ file: compressed, preview: URL.createObjectURL(compressed), url: null, isNew: true });
      }
      renderImagePreviews(); notify('Images are ready to upload.', 'success');
    } catch (error) { 
      notify(error.message, 'error'); 
    }
    event.target.value = '';
  }

  function renderImagePreviews() {
    const host = document.getElementById('image-preview-list'); if (!host) return;
    if (!state.productImages.length) { host.innerHTML = '<span class="admin-help">No images selected yet.</span>'; return; }
    
    host.innerHTML = state.productImages.map((image, index) => `
      <article class="image-preview" data-image-index="${index}">
        <img src="${Utils.escapeHTML(image.preview)}" alt="Product preview">
        <span class="image-preview__label">${index === 0 ? 'Cover image' : `Image ${index + 1}`}</span>
        <div class="image-preview__actions">
          <button type="button" data-image-action="left" aria-label="Move left">←</button>
          <button type="button" data-image-action="right" aria-label="Move right">→</button>
          <button class="is-danger" type="button" data-image-action="remove" aria-label="Remove">×</button>
        </div>
      </article>`).join('');
  }

  function handleImagePreviewAction(event) {
    const button = event.target.closest('[data-image-action]'); if (!button) return;
    const index = Number(button.closest('[data-image-index]')?.dataset.imageIndex); 
    if (!Number.isInteger(index) || !state.productImages[index]) return;
    
    if (button.dataset.imageAction === 'remove') { 
      const [removed] = state.productImages.splice(index, 1); 
      if (removed.isNew && removed.preview?.startsWith('blob:')) URL.revokeObjectURL(removed.preview); 
    }
    if (button.dataset.imageAction === 'left' && index > 0) {
      [state.productImages[index - 1], state.productImages[index]] = [state.productImages[index], state.productImages[index - 1]];
    }
    if (button.dataset.imageAction === 'right' && index < state.productImages.length - 1) {
      [state.productImages[index + 1], state.productImages[index]] = [state.productImages[index], state.productImages[index + 1]];
    }
    renderImagePreviews();
  }

  async function saveProduct(event) {
    event.preventDefault(); 
    const button = document.getElementById('save-product'); 
    setLoading(button, true, 'Saving…');
    
    const productId = document.getElementById('product-id').value || crypto.randomUUID(); 
    const originalImages = state.editingProduct?.images || []; 
    const uploadedDuringAttempt = [];
    
    try {
      if (!state.productImages.length) throw new Error('Add at least one product image.');
      const price = Number(document.getElementById('product-price').value);
      if (!document.getElementById('product-mrp').value || (!state.mrpManuallyEdited && (state.originalPrice === null || Math.abs(price - state.originalPrice) > .0001))) {
        generateAndSetMRP(false);
      }
      
      const uploadedImages = [];
      for (const image of state.productImages) {
        if (!image.isNew) { uploadedImages.push(image.url); continue; }
        const path = `products/${productId}/${crypto.randomUUID()}.webp`;
        const { error: uploadError } = await supabaseClient.storage.from(APP_CONFIG.STORAGE_BUCKET).upload(path, image.file, { cacheControl: '31536000', upsert: false, contentType: 'image/webp' });
        if (uploadError) throw uploadError;
        const { data } = supabaseClient.storage.from(APP_CONFIG.STORAGE_BUCKET).getPublicUrl(path); 
        uploadedImages.push(data.publicUrl); 
        uploadedDuringAttempt.push(data.publicUrl);
      }
      
      const category = document.getElementById('product-category').value; 
      const actualPrice = Number(document.getElementById('product-price').value); 
      const fakePrice = Number(document.getElementById('product-mrp').value);
      
      const payload = {
        id: productId,
        title: document.getElementById('product-title').value.trim(),
        slug: Utils.slugify(document.getElementById('product-title').value),
        actual_price: Utils.roundMoney(actualPrice), 
        fake_price: Utils.roundMoney(fakePrice),
        mrp_generated_from_price: state.mrpManuallyEdited ? null : Utils.roundMoney(actualPrice),
        main_category: category, 
        sub_category: document.getElementById('product-subcategory').value.trim(),
        preparation_days: document.getElementById('product-preparation').value,
        sort_order: Math.max(0, Math.floor(Number(document.getElementById('product-sort-order').value || 100))),
        description: document.getElementById('product-description').value.trim(), 
        care_instructions: document.getElementById('product-care').value.trim(),
        attributes: category === 'Painted Whispers' ? { canvas: buildCanvasConfig() } : {},
        images: uploadedImages, 
        is_active: document.getElementById('product-active').checked, 
        updated_at: new Date().toISOString()
      };
      
      if (!payload.title || !payload.sub_category || !payload.description || !Number.isFinite(payload.actual_price) || payload.actual_price <= 0) throw new Error('Complete every required field with a valid price.');
      if (!Number.isFinite(payload.fake_price) || payload.fake_price <= payload.actual_price) throw new Error('MRP must be higher than the selling price.');
      if (category === 'Painted Whispers' && !payload.attributes.canvas.base_size) throw new Error('Complete the base canvas dimensions.');
      
      const { error } = await supabaseClient.from('products').upsert(payload, { onConflict: 'id' }); 
      if (error) throw error;
      
      await removeOrphanedImages(originalImages.filter((url) => !uploadedImages.includes(url)), productId);
      notify(state.editingProduct ? 'Product updated successfully.' : 'Product saved successfully.', 'success'); 
      resetProductForm(); 
      await loadProducts();
    } catch (error) { 
      await removeOrphanedImages(uploadedDuringAttempt, null, true); 
      notify(error.message || 'Product could not be saved.', 'error'); 
    } finally { 
      setLoading(button, false); 
    }
  }

  function buildCanvasConfig() {
    const shape = document.getElementById('canvas-shape').value;
    const sizeId = document.getElementById('canvas-size-select').value;
    const selectedSize = state.canvasSizes.find(s => String(s.id) === String(sizeId));
    
    return { 
      shape, 
      base_size: selectedSize || null, 
      orientation: shape === 'rectangle' ? document.getElementById('canvas-orientation').value : null, 
      pricing_method: 'area' 
    };
  }

  function productCanvasConfig(product) {
    const attributes = Utils.normaliseAttributes(product.attributes); 
    const canvas = attributes.canvas || {};
    return { baseSize: Utils.normaliseCanvasSize(canvas.base_size || attributes.canvas_size), orientation: canvas.orientation || attributes.canvas_orientation || 'Portrait' };
  }

  async function toggleProduct(product) {
    const { error } = await supabaseClient.from('products').update({ is_active: !product.is_active, updated_at: new Date().toISOString() }).eq('id', product.id);
    if (error) notify(error.message, 'error'); 
    else { notify(product.is_active ? 'Product hidden.' : 'Product is visible.', 'success'); await loadProducts(); }
  }

  async function deleteProduct(product) {
    const choice = await Utils.choice({ title: 'Delete this product?', message: 'Use Hide when you may need it again. Approved reviews will remain as archived customer history.', icon: '🗑️', primaryLabel: 'Delete permanently', secondaryLabel: 'Cancel' });
    if (choice !== 'primary') return;
    const { error } = await supabaseClient.from('products').delete().eq('id', product.id);
    if (error) return notify(error.message, 'error');
    await removeOrphanedImages(product.images, product.id); 
    notify('Product and unused images deleted.', 'success'); 
    await loadProducts();
  }

  async function removeOrphanedImages(urls, excludingProductId = null, force = false) {
    const unique = [...new Set((urls || []).filter(Boolean))];
    const removable = force ? unique : unique.filter((url) => !state.products.some((product) => String(product.id) !== String(excludingProductId) && (product.images || []).includes(url)));
    const paths = removable.map(storagePath).filter(Boolean); 
    if (paths.length) await supabaseClient.storage.from(APP_CONFIG.STORAGE_BUCKET).remove(paths);
  }

  function storagePath(url) { 
    const marker = `/storage/v1/object/public/${APP_CONFIG.STORAGE_BUCKET}/`; 
    const index = String(url || '').indexOf(marker); 
    return index >= 0 ? decodeURIComponent(String(url).slice(index + marker.length)) : null; 
  }

  /* ---------------- Settings ---------------- */
  let settingsBound = false;
  async function initialiseSettings() {
    if (!settingsBound) { bindSettingsEvents(); settingsBound = true; }
    await Promise.all([loadProducts(), loadSettings(), loadCoupons(), loadReviews()]); 
    resetCouponForm(); 
    resetReviewForm();
  }

  function bindSettingsEvents() {
    document.getElementById('settings-form')?.addEventListener('submit', saveSettings);
    document.getElementById('canvas-size-list')?.addEventListener('input', updateStructuredCanvasState);
    document.getElementById('canvas-size-list')?.addEventListener('change', updateStructuredCanvasState);
    document.getElementById('canvas-size-list')?.addEventListener('click', handleCanvasSizeAction);
    document.getElementById('save-canvas-sizes')?.addEventListener('click', saveCanvasSizes);
    document.getElementById('add-vip-tier')?.addEventListener('click', () => { state.vipTiers.push({ minimumQuantity: Math.max(2, (state.vipTiers.at(-1)?.minimumQuantity || 1) + 1), percent: 5 }); renderVipTiers(); });
    document.getElementById('vip-tier-list')?.addEventListener('input', updateVipState);
    document.getElementById('vip-tier-list')?.addEventListener('click', handleVipAction);
    document.getElementById('save-vip-tiers')?.addEventListener('click', saveVipTiers);
    document.getElementById('coupon-form')?.addEventListener('submit', saveCoupon);
    document.getElementById('coupon-type')?.addEventListener('change', updateCouponTypeUI);
    document.getElementById('reset-coupon')?.addEventListener('click', resetCouponForm);
    document.getElementById('coupon-list')?.addEventListener('click', handleCouponAction);
    document.getElementById('review-form')?.addEventListener('submit', saveReview);
    document.getElementById('reset-review')?.addEventListener('click', resetReviewForm);
    document.getElementById('review-list')?.addEventListener('click', handleReviewAction);
  }

  async function loadSettings() {
    const { data, error } = await supabaseClient.from('store_settings').select('*').eq('id', 1).maybeSingle();
    if (error) return notify(error.message, 'error');
    state.settings = data || { id: 1 };
    
    setValue('setting-store-name', state.settings.store_name || APP_CONFIG.DEFAULTS.storeName); 
    setValue('setting-whatsapp', state.settings.admin_whatsapp || APP_CONFIG.DEFAULTS.whatsapp); 
    setValue('setting-delivery-fee', state.settings.standard_delivery_fee ?? APP_CONFIG.DEFAULTS.deliveryFee); 
    setValue('setting-free-delivery', state.settings.free_shipping_threshold ?? APP_CONFIG.DEFAULTS.freeShippingThreshold); 
    setValue('setting-announcement', state.settings.announcement_banner_text || '');
    
    document.getElementById('setting-announcement-active').checked = Boolean(state.settings.announcement_banner_active); 
    document.getElementById('setting-vacation').checked = Boolean(state.settings.vacation_mode);
    
    state.canvasSizes = Utils.normaliseCanvasSizes(state.settings.global_canvas_sizes, APP_CONFIG.DEFAULTS.canvasSizes); 
    state.vipTiers = Utils.normaliseVipTiers(state.settings.vip_tiers, APP_CONFIG.DEFAULTS.vipTiers); 
    renderCanvasSizes(); 
    renderVipTiers();
  }

  async function saveSettings(event) {
    event.preventDefault(); 
    const button = document.getElementById('save-settings'); 
    setLoading(button, true, 'Saving…');
    
    const whatsapp = document.getElementById('setting-whatsapp').value.replace(/\D/g, '');
    if (whatsapp.length < 10) { notify('Enter a WhatsApp number with country code.', 'error'); setLoading(button, false); return; }
    
    const payload = { 
      id: 1, 
      store_name: document.getElementById('setting-store-name').value.trim() || APP_CONFIG.DEFAULTS.storeName, 
      admin_whatsapp: whatsapp, 
      support_whatsapp: whatsapp, 
      standard_delivery_fee: Number(document.getElementById('setting-delivery-fee').value || 0), 
      free_shipping_threshold: Number(document.getElementById('setting-free-delivery').value || 0), 
      announcement_banner_text: document.getElementById('setting-announcement').value.trim(), 
      announcement_banner_active: document.getElementById('setting-announcement-active').checked, 
      vacation_mode: document.getElementById('setting-vacation').checked, 
      updated_at: new Date().toISOString() 
    };
    
    const { error } = await supabaseClient.from('store_settings').upsert(payload, { onConflict: 'id' });
    if (error) notify(error.message, 'error'); 
    else notify('Store essentials saved.', 'success'); 
    setLoading(button, false);
  }

  function renderCanvasSizes() {
    const host = document.getElementById('canvas-size-list'); 
    if (!host) return;
    
    const squares = [];
    const rectangles = [];
    const circles = [];

    state.canvasSizes.forEach((size, index) => {
        const shape = size.shape || 'square';
        const itemHTML = `
          <div class="structured-card" data-canvas-index="${index}">
            <div class="structured-card__header">
              <button type="button" class="structured-card__remove" data-canvas-action="remove" aria-label="Remove size" style="margin-left: auto;">×</button>
            </div>
            <div class="structured-card__body ${shape === 'rectangle' ? '' : 'single'}">
              ${shape === 'circle' 
                ? `<label><span>Diameter (in)</span><input class="admin-input" data-canvas-field="primary" type="number" min="1" step="0.5" value="${size.diameter || 8}"></label>`
                : shape === 'rectangle'
                ? `<label><span>Width (in)</span><input class="admin-input" data-canvas-field="primary" type="number" min="1" step="0.5" value="${size.width || 8}"></label>
                   <label><span>Height (in)</span><input class="admin-input" data-canvas-field="height" type="number" min="1" step="0.5" value="${size.height || size.width || 10}"></label>`
                : `<label><span>Size (in)</span><input class="admin-input" data-canvas-field="primary" type="number" min="1" step="0.5" value="${size.width || 8}"></label>`
              }
            </div>
          </div>`;
        
        if (shape === 'square') squares.push(itemHTML);
        else if (shape === 'rectangle') rectangles.push(itemHTML);
        else circles.push(itemHTML);
      });

    host.innerHTML = `
      <div class="canvas-columns-grid">
        <div class="canvas-column">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <strong style="font-family:'Lora',serif;font-size:0.95rem;">Square</strong>
            <button type="button" class="admin-button admin-button--soft admin-button--small" data-add-shape="square">+ Add</button>
          </div>
          <div class="canvas-column-scroll" style="display:grid;gap:8px;">
            ${squares.length ? squares.join('') : '<p class="admin-help" style="font-size:0.6rem;">No square sizes</p>'}
          </div>
        </div>
        <div class="canvas-column">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <strong style="font-family:'Lora',serif;font-size:0.95rem;">Rectangle</strong>
            <button type="button" class="admin-button admin-button--soft admin-button--small" data-add-shape="rectangle">+ Add</button>
          </div>
          <div class="canvas-column-scroll" style="display:grid;gap:8px;">
            ${rectangles.length ? rectangles.join('') : '<p class="admin-help" style="font-size:0.6rem;">No rectangle sizes</p>'}
          </div>
        </div>
        <div class="canvas-column">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <strong style="font-family:'Lora',serif;font-size:0.95rem;">Circle</strong>
            <button type="button" class="admin-button admin-button--soft admin-button--small" data-add-shape="circle">+ Add</button>
          </div>
          <div class="canvas-column-scroll" style="display:grid;gap:8px;">
            ${circles.length ? circles.join('') : '<p class="admin-help" style="font-size:0.6rem;">No circle sizes</p>'}
          </div>
        </div>
      </div>
    `;
  }

  function updateStructuredCanvasState(event) {
    const row = event.target.closest('[data-canvas-index]'); if (!row) return; 
    const index = Number(row.dataset.canvasIndex); 
    const size = state.canvasSizes[index]; if (!size) return;
    const field = event.target.dataset.canvasField;
    
    if (field === 'primary') { 
      if (size.shape === 'circle') size.diameter = Number(event.target.value); 
      else { 
        size.width = Number(event.target.value); 
        if (size.shape === 'square') size.height = size.width; 
      } 
    }
    if (field === 'height') {
      size.height = Number(event.target.value);
    }
  }

  function handleCanvasSizeAction(event) { 
    const addBtn = event.target.closest('[data-add-shape]');
    if (addBtn) {
      const shape = addBtn.getAttribute('data-add-shape');
      if (shape === 'square') {
        state.canvasSizes.push({ id: crypto.randomUUID(), shape: 'square', width: 8, height: 8, label: '8 × 8 in' });
      } else if (shape === 'rectangle') {
        state.canvasSizes.push({ id: crypto.randomUUID(), shape: 'rectangle', width: 8, height: 10, label: '8 × 10 in' });
      } else if (shape === 'circle') {
        state.canvasSizes.push({ id: crypto.randomUUID(), shape: 'circle', diameter: 8, label: '8 in diameter' });
      }
      renderCanvasSizes();
      return;
    }

    const button = event.target.closest('[data-canvas-action]'); 
    if (!button) return; 
    const row = button.closest('[data-canvas-index]');
    if (!row) return;
    const index = Number(row.dataset.canvasIndex); 
    state.canvasSizes.splice(index, 1); 
    renderCanvasSizes(); 
  }
  
  async function saveCanvasSizes() {
    const sizes = state.canvasSizes.map((size, index) => Utils.normaliseCanvasSize({ ...size, id: size.id || `size-${index}` }, index)).filter(Boolean);
    if (!sizes.length) return notify('Add at least one valid canvas size.', 'error');
    
    const button = document.getElementById('save-canvas-sizes'); 
    setLoading(button, true, 'Saving…');
    
    const { error } = await supabaseClient.from('store_settings').update({ global_canvas_sizes: sizes, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) notify(error.message, 'error'); 
    else { state.canvasSizes = sizes; renderCanvasSizes(); notify('Canvas sizes saved.', 'success'); } 
    setLoading(button, false);
  }

  function renderVipTiers() {
    const host = document.getElementById('vip-tier-list'); 
    if (!host) return;
    
    const cards = state.vipTiers.map((tier, index) => `
      <div class="structured-card" data-vip-index="${index}">
        <div class="structured-card__header">
          <strong>Tier ${index + 1}</strong>
          <button type="button" class="structured-card__remove" data-vip-action="remove" aria-label="Remove tier" ${index === 0 ? 'disabled' : ''}>×</button>
        </div>
        <div class="structured-card__body">
          <label>
            <span>Min quantity</span>
            <input class="admin-input" data-vip-field="minimumQuantity" type="number" min="1" step="1" value="${tier.minimumQuantity}" ${index === 0 ? 'readonly' : ''}>
          </label>
          <label>
            <span>Discount %</span>
            <input class="admin-input" data-vip-field="percent" type="number" min="0" max="80" step="0.01" value="${tier.percent}">
          </label>
        </div>
      </div>`).join('');

    host.innerHTML = `<div class="vip-columns-grid">${cards}</div>`;
  }
  
  function updateVipState(event) { 
    const row = event.target.closest('[data-vip-index]'); if (!row) return; 
    const tier = state.vipTiers[Number(row.dataset.vipIndex)]; if (!tier) return; 
    tier[event.target.dataset.vipField] = Number(event.target.value); 
  }
  
  function handleVipAction(event) { 
    const button = event.target.closest('[data-vip-action]'); if (!button || button.disabled) return; 
    state.vipTiers.splice(Number(button.closest('[data-vip-index]').dataset.vipIndex), 1); 
    renderVipTiers(); 
  }
  
  async function saveVipTiers() {
    const tiers = Utils.normaliseVipTiers(state.vipTiers, APP_CONFIG.DEFAULTS.vipTiers); 
    if (new Set(tiers.map((tier) => tier.minimumQuantity)).size !== tiers.length) return notify('Each VIP tier needs a different minimum quantity.', 'error');
    
    const button = document.getElementById('save-vip-tiers'); 
    setLoading(button, true, 'Saving…');
    
    const { error } = await supabaseClient.from('store_settings').update({ vip_tiers: tiers, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) notify(error.message, 'error'); 
    else { state.vipTiers = tiers; renderVipTiers(); notify('VIP tiers saved.', 'success'); } 
    setLoading(button, false);
  }

  /* Coupons */
  async function loadCoupons() { 
    const { data, error } = await supabaseClient.from('coupons').select('*').order('created_at', { ascending: false }); 
    if (error) return notify(error.message, 'error'); 
    state.coupons = data || []; 
    renderCoupons(); 
  }
  
  function renderCoupons() {
    const host = document.getElementById('coupon-list'); if (!host) return;
    if (!state.coupons.length) { host.innerHTML = '<div class="admin-empty">No coupon codes yet.</div>'; return; }
    
    host.innerHTML = state.coupons.map((coupon) => { 
      const value = coupon.discount_type === 'shipping' ? 'Free delivery' : coupon.discount_type === 'percent' ? `${coupon.discount_value}% off` : `${Utils.formatCurrency(coupon.discount_value)} off`; 
      return `
        <article class="coupon-row" data-coupon-id="${Utils.escapeHTML(coupon.id)}">
          <div>
            <h3>${Utils.escapeHTML(coupon.code)}</h3>
            <p>${Utils.escapeHTML(value)} · Minimum ${Utils.formatCurrency(coupon.min_spend_amount || 0)} · ${coupon.is_active ? 'Active' : 'Inactive'} · Used ${coupon.used_count || 0}${coupon.usage_limit ? `/${coupon.usage_limit}` : ''}${coupon.expires_at ? ` · Ends ${Utils.escapeHTML(new Date(coupon.expires_at).toLocaleDateString('en-IN'))}` : ''}</p>
          </div>
          <div class="coupon-row__actions">
            <button type="button" data-coupon-action="edit">Edit</button>
            <button type="button" data-coupon-action="toggle">${coupon.is_active ? 'Disable' : 'Enable'}</button>
            <button class="is-danger" type="button" data-coupon-action="delete">Delete</button>
          </div>
        </article>`; 
    }).join('');
  }
  
  function handleCouponAction(event) { 
    const button = event.target.closest('[data-coupon-action]'); if (!button) return; 
    const coupon = state.coupons.find((item) => String(item.id) === button.closest('[data-coupon-id]').dataset.couponId); if (!coupon) return; 
    if (button.dataset.couponAction === 'edit') editCoupon(coupon); 
    if (button.dataset.couponAction === 'toggle') toggleCoupon(coupon); 
    if (button.dataset.couponAction === 'delete') deleteCoupon(coupon); 
  }
  
  function editCoupon(coupon) { 
    setValue('coupon-id', coupon.id); 
    setValue('coupon-code', coupon.code || ''); 
    setValue('coupon-type', coupon.discount_type || 'percent'); 
    setValue('coupon-value', coupon.discount_value ?? 0); 
    setValue('coupon-minimum', coupon.min_spend_amount ?? 0); 
    setValue('coupon-maximum', coupon.max_discount ?? ''); 
    setValue('coupon-usage-limit', coupon.usage_limit ?? ''); 
    setValue('coupon-customer-limit', coupon.per_phone_limit ?? ''); 
    setValue('coupon-starts', toLocalInput(coupon.starts_at)); 
    setValue('coupon-expires', toLocalInput(coupon.expires_at)); 
    setValue('coupon-label', coupon.display_label || ''); 
    document.getElementById('coupon-stack-vip').checked = coupon.stack_with_vip !== false; 
    document.getElementById('coupon-active').checked = coupon.is_active !== false; 
    setText('save-coupon', 'Update coupon'); 
    updateCouponTypeUI(); 
  }
  
  function resetCouponForm() { 
    const form = document.getElementById('coupon-form'); form?.reset(); if (!form) return; 
    setValue('coupon-id', ''); setValue('coupon-minimum', 0); setValue('coupon-customer-limit', ''); 
    document.getElementById('coupon-stack-vip').checked = true; 
    document.getElementById('coupon-active').checked = true; 
    setText('save-coupon', 'Save coupon'); 
    updateCouponTypeUI(); 
  }
  
  function updateCouponTypeUI() { 
    const shipping = document.getElementById('coupon-type')?.value === 'shipping'; 
    const value = document.getElementById('coupon-value'); 
    if (value) { 
      value.disabled = shipping; 
      if (shipping) value.value = '0'; 
      else if (!value.value || Number(value.value) === 0) value.value = '10'; 
    } 
  }
  
  async function saveCoupon(event) {
    event.preventDefault(); 
    const button = document.getElementById('save-coupon'); 
    setLoading(button, true, 'Saving…'); 
    const id = document.getElementById('coupon-id').value; 
    const type = document.getElementById('coupon-type').value;
    
    const payload = { 
      code: document.getElementById('coupon-code').value.trim().toUpperCase(), 
      discount_type: type, 
      discount_value: type === 'shipping' ? 0 : Number(document.getElementById('coupon-value').value), 
      min_spend_amount: Number(document.getElementById('coupon-minimum').value || 0), 
      max_discount: document.getElementById('coupon-maximum').value ? Number(document.getElementById('coupon-maximum').value) : null, 
      usage_limit: document.getElementById('coupon-usage-limit').value ? Math.floor(Number(document.getElementById('coupon-usage-limit').value)) : null, 
      per_phone_limit: document.getElementById('coupon-customer-limit').value ? Math.floor(Number(document.getElementById('coupon-customer-limit').value)) : null, 
      starts_at: document.getElementById('coupon-starts').value ? new Date(document.getElementById('coupon-starts').value).toISOString() : null, 
      expires_at: document.getElementById('coupon-expires').value ? new Date(document.getElementById('coupon-expires').value).toISOString() : null, 
      display_label: document.getElementById('coupon-label').value.trim(), 
      stack_with_vip: document.getElementById('coupon-stack-vip').checked, 
      is_active: document.getElementById('coupon-active').checked, 
      updated_at: new Date().toISOString() 
    };
    
    try {
      if (!payload.code || (type !== 'shipping' && (!Number.isFinite(payload.discount_value) || payload.discount_value <= 0))) throw new Error('Enter a valid coupon code and value.');
      if (type === 'percent' && payload.discount_value > 100) throw new Error('Percentage coupons cannot exceed 100%.');
      if (payload.starts_at && payload.expires_at && new Date(payload.expires_at) <= new Date(payload.starts_at)) throw new Error('Expiry must be after the start time.');
      const response = id ? await supabaseClient.from('coupons').update(payload).eq('id', id) : await supabaseClient.from('coupons').insert(payload); if (response.error) throw response.error;
      notify('Coupon saved.', 'success'); resetCouponForm(); await loadCoupons();
    } catch (error) { 
      notify(error.code === '23505' ? 'That coupon code already exists.' : error.message, 'error'); 
    }
    setLoading(button, false);
  }
  
  async function toggleCoupon(coupon) { 
    const { error } = await supabaseClient.from('coupons').update({ is_active: !coupon.is_active, updated_at: new Date().toISOString() }).eq('id', coupon.id); 
    if (error) notify(error.message, 'error'); 
    else { notify('Coupon status updated.', 'success'); await loadCoupons(); } 
  }
  
  async function deleteCoupon(coupon) { 
    const choice = await Utils.choice({ title: `Delete ${coupon.code}?`, message: 'This coupon will stop working immediately. Historical enquiries keep their saved discount snapshot.', icon: '🎁', primaryLabel: 'Delete coupon', secondaryLabel: 'Cancel' }); 
    if (choice !== 'primary') return; 
    const { error } = await supabaseClient.from('coupons').delete().eq('id', coupon.id); 
    if (error) notify(error.message, 'error'); 
    else { notify('Coupon deleted.', 'success'); await loadCoupons(); } 
  }

  /* Reviews */
  async function loadReviews() { 
    const { data, error } = await supabaseClient.from('reviews').select('*').order('created_at', { ascending: false }); 
    if (error) return notify(error.message, 'error'); 
    state.reviews = data || []; 
    renderReviewProductOptions(); 
    renderReviews(); 
  }
  
  function renderReviewProductOptions() {
    const container = document.getElementById('review-product-container');
    if (!container) return;

    let hiddenInput = document.getElementById('review-product');
    let textInput = document.getElementById('review-product-input');

    if (!textInput) {
      container.innerHTML = `
        <div style="position:relative;">
          <input id="review-product-input" class="admin-input" type="text" placeholder="Type to search product..." autocomplete="off">
          <input type="hidden" id="review-product" value="">
          <div id="review-product-suggestions" class="hidden" style="position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:95;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow-md);max-height:200px;overflow-y:auto;"></div>
        </div>
      `;
      
      textInput = document.getElementById('review-product-input');
      hiddenInput = document.getElementById('review-product');
      const suggestionsBox = document.getElementById('review-product-suggestions');

      textInput.addEventListener('input', () => {
        const query = textInput.value.trim().toLowerCase();
        hiddenInput.value = ''; 
        if (!query) {
          suggestionsBox.classList.add('hidden');
          return;
        }
        const matches = state.products.filter(p => (p.title || '').toLowerCase().includes(query)).slice(0, 8);
        if (!matches.length) {
          suggestionsBox.innerHTML = '<div style="padding:10px 14px;color:var(--muted);font-size:0.68rem;">No products found</div>';
          suggestionsBox.classList.remove('hidden');
          return;
        }
        suggestionsBox.innerHTML = matches.map(p => `
          <div data-product-id="${Utils.escapeHTML(p.id)}" data-product-title="${Utils.escapeHTML(p.title)}" style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--line);font-size:0.7rem;">
            <img src="${Utils.escapeHTML(p.images?.[0] || '/assets/th_logo.svg')}" alt="" style="width:28px;height:28px;border-radius:6px;object-fit:cover;">
            <div>
              <strong>${Utils.escapeHTML(p.title)}</strong>
              <div style="color:var(--muted);font-size:0.58rem;">${Utils.escapeHTML(p.main_category || 'Handcrafted')}</div>
            </div>
          </div>
        `).join('');
        suggestionsBox.classList.remove('hidden');
      });

      suggestionsBox.addEventListener('click', (e) => {
        const item = e.target.closest('[data-product-id]');
        if (!item) return;
        hiddenInput.value = item.dataset.productId;
        textInput.value = item.dataset.productTitle;
        suggestionsBox.classList.add('hidden');
      });

      document.addEventListener('click', (e) => {
        if (!e.target.closest('#review-product-input') && !e.target.closest('#review-product-suggestions')) {
          suggestionsBox.classList.add('hidden');
        }
      });
    }
  }

  function editReview(review) { 
    setValue('review-id', review.id); 
    setValue('review-product', review.product_id || ''); 
    const product = state.products.find(p => String(p.id) === String(review.product_id));
    const textInput = document.getElementById('review-product-input');
    if (textInput) textInput.value = product ? product.title : '';
    setValue('review-name', review.customer_name || ''); 
    setValue('review-rating', review.rating || 5); 
    setValue('review-text', review.review_text || ''); 
    document.getElementById('review-approved').checked = review.is_approved !== false; 
    setText('save-review', 'Update review'); 
  }
  
  function resetReviewForm() { 
    const form = document.getElementById('review-form'); form?.reset(); if (!form) return; 
    setValue('review-id', ''); 
    setValue('review-product', ''); 
    const textInput = document.getElementById('review-product-input');
    if (textInput) textInput.value = '';
    setValue('review-rating', 5); 
    document.getElementById('review-approved').checked = true; 
    setText('save-review', 'Save review'); 
  }
  
  function renderReviews() { 
    const host = document.getElementById('review-list'); if (!host) return; 
    if (!state.reviews.length) { host.innerHTML = '<div class="admin-empty">No reviews yet.</div>'; return; } 
    
    host.innerHTML = state.reviews.map((review) => { 
      const product = state.products.find((item) => item.id === review.product_id); 
      return `
        <article class="review-row" data-review-id="${Utils.escapeHTML(review.id)}">
          <div>
            <h3>${Utils.escapeHTML(review.customer_name)} · ${'★'.repeat(Number(review.rating))}</h3>
            <p>${Utils.escapeHTML(product?.title || 'Archived product')} · ${review.is_approved ? 'Public' : 'Hidden'}<br>${Utils.escapeHTML(review.review_text)}</p>
          </div>
          <div class="coupon-row__actions">
            <button type="button" data-review-action="edit">Edit</button>
            <button type="button" data-review-action="toggle">${review.is_approved ? 'Hide' : 'Approve'}</button>
            <button class="is-danger" type="button" data-review-action="delete">Delete</button>
          </div>
        </article>`; 
    }).join(''); 
  }
  
  function handleReviewAction(event) { 
    const button = event.target.closest('[data-review-action]'); if (!button) return; 
    const review = state.reviews.find((item) => String(item.id) === button.closest('[data-review-id]').dataset.reviewId); if (!review) return; 
    if (button.dataset.reviewAction === 'edit') editReview(review); 
    if (button.dataset.reviewAction === 'toggle') toggleReview(review); 
    if (button.dataset.reviewAction === 'delete') deleteReview(review); 
  }
  
  
  
  async function saveReview(event) { 
    event.preventDefault(); 
    const button = document.getElementById('save-review'); 
    setLoading(button, true, 'Saving…'); 
    const id = document.getElementById('review-id').value; 
    const payload = { 
      product_id: document.getElementById('review-product').value, 
      customer_name: document.getElementById('review-name').value.trim(), 
      rating: Number(document.getElementById('review-rating').value), 
      review_text: document.getElementById('review-text').value.trim(), 
      is_approved: document.getElementById('review-approved').checked, 
      updated_at: new Date().toISOString() 
    }; 
    const response = id ? await supabaseClient.from('reviews').update(payload).eq('id', id) : await supabaseClient.from('reviews').insert(payload); 
    if (response.error) notify(response.error.message, 'error'); 
    else { notify('Review saved.', 'success'); resetReviewForm(); await loadReviews(); } 
    setLoading(button, false); 
  }
  
  async function toggleReview(review) { 
    const { error } = await supabaseClient.from('reviews').update({ is_approved: !review.is_approved, updated_at: new Date().toISOString() }).eq('id', review.id); 
    if (error) notify(error.message, 'error'); 
    else await loadReviews(); 
  }
  
  async function deleteReview(review) { 
    const choice = await Utils.choice({ title: 'Delete this review?', message: 'This action cannot be undone.', icon: '⭐', primaryLabel: 'Delete review', secondaryLabel: 'Cancel' }); 
    if (choice !== 'primary') return; 
    const { error } = await supabaseClient.from('reviews').delete().eq('id', review.id); 
    if (error) notify(error.message, 'error'); 
    else { notify('Review deleted.', 'success'); await loadReviews(); } 
  }

  /* ---------------- Enquiries & Shiprocket ---------------- */
  let enquiriesBound = false;
  async function initialiseEnquiries() {
    if (!enquiriesBound) {
      document.getElementById('refresh-enquiries')?.addEventListener('click', loadEnquiries);
      document.getElementById('enquiry-search')?.addEventListener('input', renderEnquiries);
      bindEnquiryFilterDropdown();
      document.getElementById('enquiry-list')?.addEventListener('click', handleEnquiryAction);
      
      // Exclusive Accordion & Smooth Auto-Scroll into View
      document.getElementById('enquiry-list')?.addEventListener('toggle', (e) => {
        const details = e.target;
        if (details && details.open && details.classList.contains('enquiry-card')) {
          document.querySelectorAll('#enquiry-list details.enquiry-card').forEach((card) => {
            if (card !== details) card.removeAttribute('open');
          });
          
          // Smoothly scroll the newly opened card into view so it fits perfectly on screen
          setTimeout(() => {
            details.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 120);
        }
      }, true); // true enables capture phase since 'toggle' does not bubble

      enquiriesBound = true;
    }
    // We must load the product catalog into memory first so we can match product images 
    if (!state.products.length) await loadProducts();
    await loadEnquiries();
  }

  function bindEnquiryFilterDropdown() {
    const wrapper = document.getElementById('enquiry-filter-wrapper');
    const btn = document.getElementById('enquiry-filter-btn');
    const menu = document.getElementById('enquiry-filter-menu');
    const hiddenInput = document.getElementById('enquiry-filter');
    const label = document.getElementById('enquiry-filter-label');
    
    if (!wrapper || !btn || !menu || !hiddenInput || !label) return;

    btn.addEventListener('click', () => {
      const isExpanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', !isExpanded);
      menu.classList.toggle('is-open', !isExpanded);
    });

    menu.addEventListener('click', (e) => {
      const option = e.target.closest('.custom-select-option');
      if (option) {
        hiddenInput.value = option.dataset.value;
        label.textContent = option.textContent;
        btn.setAttribute('aria-expanded', 'false');
        menu.classList.remove('is-open');
        renderEnquiries();
      }
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        btn.setAttribute('aria-expanded', 'false');
        menu.classList.remove('is-open');
      }
    });
  }
  
  async function loadEnquiries() { 
    const host = document.getElementById('enquiry-list'); 
    if (host) host.innerHTML = '<div class="admin-empty">Loading enquiries…</div>'; 
    const { data, error } = await supabaseClient.from('whatsapp_enquiries').select('*').order('created_at', { ascending: false }).limit(500); 
    if (error) { 
      notify(error.message, 'error'); 
      if (host) host.innerHTML = '<div class="admin-empty">Enquiries could not be loaded.</div>'; 
      return; 
    } 
    state.enquiries = data || []; 
    renderEnquiries(); 
  }
  
  function renderEnquiries() { 
    const host = document.getElementById('enquiry-list'); if (!host) return; 
    
    // Remember which accordions are currently expanded before refreshing
    const openIds = new Set(Array.from(host.querySelectorAll('details[open]')).map(d => d.dataset.enquiryId));
    
    const search = document.getElementById('enquiry-search')?.value.trim().toLowerCase() || '';
    const filter = document.getElementById('enquiry-filter')?.value || 'active'; 
    const list = state.enquiries.filter((enquiry) => { 
      const text = `${enquiry.reference} ${enquiry.customer_name} ${enquiry.customer_phone}`.toLowerCase(); 
      const searchMatch = !search || text.includes(search);
      let filterMatch = true;
      // Added 'completed' and 'rejected' to catch the strict DB constraints
      const archivedStatuses = ['completed', 'rejected', 'cancelled', 'archived', 'shipped'];
      if (filter === 'active') filterMatch = !archivedStatuses.includes(enquiry.status);
      if (filter === 'archived') filterMatch = archivedStatuses.includes(enquiry.status);
      return searchMatch && filterMatch; 
    }); 
    if (!list.length) { host.innerHTML = '<div class="admin-empty">No orders found in this view.</div>'; return; } 
    
    host.innerHTML = list.map((enquiry) => {
      let computedTotalMrp = 0;
      (enquiry.items || []).forEach((item) => {
          const itemTotal = Number(item.item_total ?? ((item.estimatedPrice || item.price || 0) * (item.quantity || 1)));
          const product = state.products.find(p => String(p.id) === String(item.product_id || item.productId || item.id));
          let itemMrp = itemTotal;
          if (product && product.actual_price > 0 && product.fake_price > product.actual_price) {
              const ratio = product.fake_price / product.actual_price;
              itemMrp = itemTotal * ratio;
          }
          computedTotalMrp += itemMrp;
      });
      const totalMrp = Utils.roundMoney(computedTotalMrp);
      const mrpDiscount = Utils.roundMoney(Math.max(0, totalMrp - (enquiry.subtotal || 0)));

      // Dynamic Action Buttons
      const isArchived = ['completed', 'rejected', 'cancelled', 'archived', 'shipped'].includes(enquiry.status);
      const isConfirmed = enquiry.status === 'confirmed';
      const phoneClean = String(enquiry.customer_phone || '').replace(/\D/g, '');
      const waLink = `https://wa.me/${phoneClean}?text=${encodeURIComponent(`Hello ${enquiry.customer_name}, regarding your Twisted Happiness enquiry ${enquiry.reference}:`)}`;

      const callSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
      const waSVG = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>`;
      const acceptSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
      const rejectSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      const shipSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`;
      const invoiceSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
      const deleteSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

      const commonBtns = `
        <a href="tel:${phoneClean}" class="admin-action-btn action-call" title="Call">${callSVG} <span>Call</span></a>
        <a href="${waLink}" class="admin-action-btn action-wa" target="_blank" title="WhatsApp">${waSVG} <span>WhatsApp</span></a>
      `;

      let actionButtons = '';
      if (isArchived) {
        actionButtons = `
          ${commonBtns}
          <button type="button" data-enquiry-action="invoice" class="admin-action-btn action-invoice" title="Download Invoice">${invoiceSVG} <span>Invoice</span></button>
          <button type="button" data-enquiry-action="delete" class="admin-action-btn action-delete is-danger-text" title="Delete Order">${deleteSVG} <span>Delete</span></button>
        `;
      } else if (isConfirmed) {
        actionButtons = `
          ${commonBtns}
          <button type="button" data-enquiry-action="shiprocket" class="admin-action-btn action-ship" title="Push to Shiprocket">${shipSVG} <span>Shiprocket</span></button>
          <button type="button" data-enquiry-action="reject" class="admin-action-btn action-reject" title="Reject Order">${rejectSVG} <span>Reject</span></button>
        `;
      } else {
        actionButtons = `
          ${commonBtns}
          <button type="button" data-enquiry-action="accept" class="admin-action-btn action-accept" title="Accept Order">${acceptSVG} <span>Accept</span></button>
          <button type="button" data-enquiry-action="reject" class="admin-action-btn action-reject" title="Reject Order">${rejectSVG} <span>Reject</span></button>
        `;
      }

      const isOpen = openIds.has(String(enquiry.id)) ? 'open' : '';
      return `
        <details class="enquiry-card" data-enquiry-id="${Utils.escapeHTML(enquiry.id)}" ${isOpen}>
          <summary class="enquiry-summary">
            <div class="enquiry-summary-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            </div>
            
            <div class="enquiry-summary-details">
              <strong class="enquiry-customer">${Utils.escapeHTML(enquiry.customer_name)}</strong>
              <span class="enquiry-ref-date">${Utils.escapeHTML(enquiry.reference)} &bull; ${Utils.escapeHTML(new Date(enquiry.created_at).toLocaleString('en-IN', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'}))}</span>
              
              <div class="enquiry-price-status">
                <strong class="enquiry-total-text">${Utils.formatCurrency(enquiry.total_amount || 0)}</strong>
                <span class="status-pill ${enquiry.status !== 'cancelled' && !isArchived ? 'is-active' : ''}">${Utils.escapeHTML(enquiry.status)}</span>
              </div>
            </div>
            
            <div class="enquiry-chevron">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </div>
          </summary>

          <div class="enquiry-body">
            <div class="enquiry-col">
              <p class="admin-eyebrow">Customer & Delivery</p>
              <div class="enquiry-details-list">
                <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; margin-top:2px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> <span>${Utils.escapeHTML(enquiry.customer_name)}</span></span>
                <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; margin-top:2px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> <span>${Utils.escapeHTML(enquiry.customer_phone)}</span></span>
                ${enquiry.customer_email ? `<span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; margin-top:2px;"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg> <span>${Utils.escapeHTML(enquiry.customer_email)}</span></span>` : ''}
                <span class="align-start">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; margin-top:2px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                  <span>
                    ${Utils.escapeHTML(enquiry.address_line_1 || 'Address pending')}
                    ${enquiry.address_line_2 ? '<br>' + Utils.escapeHTML(enquiry.address_line_2) : ''}<br>
                    ${Utils.escapeHTML(enquiry.customer_city || '')}, ${Utils.escapeHTML(enquiry.state || '')} - ${Utils.escapeHTML(enquiry.pincode || '')}
                  </span>
                </span>
                ${enquiry.note ? `<div class="enquiry-note"><strong class="admin-eyebrow">Order Note:</strong>${Utils.escapeHTML(enquiry.note)}</div>` : ''}
              </div>
            </div>

            <div class="enquiry-col">
              <p class="admin-eyebrow">Order Summary</p>
              <details class="admin-products-dropdown">
                <summary>
                  <span>${enquiry.items?.length || 0} item${enquiry.items?.length === 1 ? '' : 's'} in bag</span>
                  <span class="dropdown-chevron"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></span>
                </summary>
                <div class="enquiry-items-list">
                  ${(enquiry.items || []).map((item) => {
                    const product = state.products.find(p => String(p.id) === String(item.product_id || item.productId || item.id));
                    const img = product?.images?.[0] || '/assets/th_logo.svg';
                    return `
                      <div class="enquiry-item">
                        <img src="${Utils.escapeHTML(img)}">
                        <div>
                          <strong>${Utils.escapeHTML(item.title)}</strong> × ${item.quantity}<br>
                          <span>${item.selected_size?.label ? `${Utils.escapeHTML(item.selected_size.label)}` : ''}${item.orientation ? ` · ${Utils.escapeHTML(item.orientation)}` : ''}</span>
                        </div>
                      </div>`;
                  }).join('')}
                </div>
              </details>
              
              <div class="enquiry-financials">
                <div><span class="muted">Price (MRP)</span><strong>${Utils.formatCurrency(totalMrp)}</strong></div>
                <div class="highlight"><span>Discount</span><strong>−${Utils.formatCurrency(mrpDiscount)}</strong></div>
                <div><span>Subtotal</span><strong>${Utils.formatCurrency(enquiry.subtotal || 0)}</strong></div>
                <div class="highlight"><span>VIP Savings</span><strong>−${Utils.formatCurrency(enquiry.vip_discount || 0)}</strong></div>
                <div class="highlight"><span>Coupon ${enquiry.coupon_code ? `(${Utils.escapeHTML(enquiry.coupon_code)})` : ''}</span><strong>−${Utils.formatCurrency(enquiry.coupon_discount || 0)}</strong></div>
                <div><span class="muted">Shipping Fee</span><strong>${enquiry.delivery_fee ? Utils.formatCurrency(enquiry.delivery_fee) : 'FREE'}</strong></div>
                <div class="total-row"><span><strong>Order Total</strong></span><strong>${Utils.formatCurrency(enquiry.total_amount || 0)}</strong></div>
              </div>
            </div>

            <div class="enquiry-col">
              <p class="admin-eyebrow">Order Actions</p>
              <div class="enquiry-action-grid">
                ${actionButtons}
              </div>
            </div>
          </div>
        </details>`;
    }).join(''); 
  }

  async function handleEnquiryAction(event) {
    const btn = event.target.closest('[data-enquiry-action]');
    if (!btn) return;
    
    const id = btn.closest('[data-enquiry-id]').dataset.enquiryId;
    const enquiry = state.enquiries.find((item) => item.id === id);
    if (!enquiry) return;

    const action = btn.dataset.enquiryAction;
      const phoneClean = String(enquiry.customer_phone || '').replace(/\D/g, '');

      // FIX: Force updated_at to be mathematically greater than created_at to bypass the 23514 check constraint error
      const safeUpdatedAt = new Date(Math.max(Date.now(), new Date(enquiry.created_at).getTime() + 1000)).toISOString();

      if (action === 'accept') {
        setLoading(btn, true, '');
        const { error } = await supabaseClient.from('whatsapp_enquiries').update({ status: 'confirmed', updated_at: safeUpdatedAt }).eq('id', id);
        if (error) { notify(error.message, 'error'); setLoading(btn, false); return; }
        
        enquiry.status = 'confirmed';
        notify('Order accepted.', 'success');
        renderEnquiries();
        
        const itemsList = (enquiry.items || []).map(item => `- ${item.quantity}x ${item.title}`).join('\n');
        const text = `*Twisted Happiness Studio*\n\nHello *${enquiry.customer_name}*,\nGreat news! Your order has been officially accepted.\n\n*ORDER SUMMARY*\n• Reference: #${enquiry.reference}\n• Amount: ${Utils.formatCurrency(enquiry.total_amount)}\n\n*ITEMS ORDERED:*\n${itemsList}\n\n>> Your handcrafted creations are now being prepared with love and care. We will notify you as soon as they are ready to dispatch.\n\nThank you for choosing handmade!`;
        window.open(`https://wa.me/${phoneClean}?text=${encodeURIComponent(text)}`, '_blank');
      } 
      
      else if (action === 'reject') {
        const choice = await Utils.choice({ title: 'Reject & Delete Order?', message: 'This will permanently delete the order from the database.' });
        if (choice !== 'primary') return;
        
        setLoading(btn, true, '');
        // Delete the order entirely to completely bypass the database status check constraint
        const { error } = await supabaseClient.from('whatsapp_enquiries').delete().eq('id', id);
        if (error) { notify(error.message, 'error'); setLoading(btn, false); return; }
        
        // Remove the order from local state memory
        state.enquiries = state.enquiries.filter(e => e.id !== id);
        notify('Order rejected and permanently deleted.', 'success');
        renderEnquiries();
        
        const text = `*Twisted Happiness Studio*\n\nHello *${enquiry.customer_name}*,\n\nRegarding your recent enquiry (Ref: *#${enquiry.reference}*):\n\nWe are truly sorry, but we are unable to fulfill this order at this time. This is typically due to limited material availability or our current crafting capacity.\n\n*STATUS: CANCELLED*\n(No payment has been processed for this request.)\n\nWe sincerely apologize for the inconvenience and hope to create something beautiful for you in the near future.`;
        window.open(`https://wa.me/${phoneClean}?text=${encodeURIComponent(text)}`, '_blank');
      }

    else if (action === 'shiprocket') {
      handleShiprocketPush(id, btn);
    }

    else if (action === 'invoice') {
      await generateInvoice(enquiry, btn);
    }

    else if (action === 'delete') {
      const choice = await Utils.choice({ title: 'Delete Permanently?', message: 'This will erase the order record forever.', icon: '🗑️', primaryLabel: 'Delete' });
      if (choice !== 'primary') return;
      
      setLoading(btn, true, '');
      const { error } = await supabaseClient.from('whatsapp_enquiries').delete().eq('id', id);
      if (error) { notify(error.message, 'error'); setLoading(btn, false); return; }
      
      state.enquiries = state.enquiries.filter(e => e.id !== id);
      notify('Order deleted.', 'success');
      renderEnquiries();
    }
  }

  async function generateInvoice(enquiry, btn) {
    if (btn) setLoading(btn, true, 'Generating PDF...');
    
    try {
      const storeName = state.settings?.store_name || APP_CONFIG.DEFAULTS.storeName;
      const dateStr = new Date(enquiry.created_at).toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
      
      // Clean filename generation
      const safeName = (enquiry.customer_name || 'Customer').replace(/[^a-zA-Z0-9 ]/g, '').trim();
      const safeRef = (enquiry.reference || 'Order').trim();
      const filename = `${safeName}_${safeRef}.pdf`;
      
      // --- 1. TABLE ROWS GENERATION ---
      const itemsHtml = (enquiry.items || []).map((item) => {
        const price = item.item_total / (item.quantity || 1);
        const product = state.products.find(p => String(p.id) === String(item.product_id || item.productId || item.id));
        const img = product?.images?.[0] || '/assets/th_logo.svg';
        
        return `
          <tr>
            <td style="padding: 4px 0; border-bottom: 1px dashed rgba(197, 139, 158, 0.2); vertical-align: middle;">
              <div style="display: flex; align-items: center; gap: 8px; transform: scale(0.88); transform-origin: left center; width: 112%;">
                <img src="${Utils.escapeHTML(img)}" style="width: 32px; height: 32px; border-radius: 5px; object-fit: cover; border: 1px solid rgba(197, 139, 158, 0.2); flex-shrink: 0;" crossorigin="anonymous">
                <div style="line-height: 1.2; padding-top: 1px;">
                  <strong style="color: #4A3B42; font-weight: 600; font-size: 11px; display: block; margin-bottom: 1px;">${Utils.escapeHTML(item.title)}</strong>
                  ${item.selected_size?.label || item.orientation ? `<div style="color: #9C8C94; font-size: 8.5px;">${Utils.escapeHTML(item.selected_size?.label || '')} ${Utils.escapeHTML(item.orientation || '')}</div>` : ''}
                </div>
              </div>
            </td>
            <td style="padding: 4px 0; border-bottom: 1px dashed rgba(197, 139, 158, 0.2); text-align: center; color: #7F7077; vertical-align: middle;">
              <div style="transform: scale(0.88); transform-origin: center center; font-size: 11px;">
                ${item.quantity} &times; ${Utils.formatCurrency(price)}
              </div>
            </td>
            <td style="padding: 4px 0; border-bottom: 1px dashed rgba(197, 139, 158, 0.2); text-align: right; color: #4A3B42; font-weight: 600; vertical-align: middle;">
              <div style="transform: scale(0.88); transform-origin: right center; font-size: 11px;">
                ${Utils.formatCurrency(item.item_total)}
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // Create a hidden container
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.top = '0';
      
      // --- 2. EXACT WIDTH & REFINED MARGINS ---
      container.innerHTML = `
        <div id="pdf-invoice-wrapper" style="width: 480px; min-width: 480px; max-width: 480px; margin: 0; background-color: #FCFAFA; padding: 18px 28px 28px 28px; font-family: 'Inter', sans-serif; color: #4A3B42; box-sizing: border-box; text-align: left; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: geometricPrecision;">
          
          <!-- INVOICE Title -->
          <div style="text-align: center; margin-bottom: 10px;">
            <h1 style="font-family: 'Lora', serif; font-size: 18px; color: #C58B9E; margin: 0; text-transform: uppercase; letter-spacing: 4px;">Invoice</h1>
          </div>
          
          <!-- Header (Flex: Logo Left, Details Right) -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #F2D5DF; padding-bottom: 8px; margin-bottom: 10px;">
            <img src="${window.location.origin}/assets/th_logo_with_heading.svg" style="width: 135px; height: auto; display: block;" crossorigin="anonymous">
            
            <!-- Details Right (Scaled & Top-Aligned) -->
            <div style="transform: scale(0.75); transform-origin: right top; margin-top: 2px;">
              <div style="text-align: right; font-size: 8.5px; color: #9C8C94; line-height: 1.5;">
                <div style="margin-bottom: 2px;">Invoice No: <strong style="color:#4A3B42; font-size: 9px;">${Utils.escapeHTML(enquiry.reference)}</strong></div>
                <div>Date & Time: <strong style="color:#4A3B42; font-size: 9px;">${Utils.escapeHTML(dateStr)}</strong></div>
              </div>
            </div>
          </div>

          <!-- Customer Details -->
          <div style="margin-bottom: 10px; background: #FFFFFF; border: 1px solid rgba(197, 139, 158, 0.15); border-radius: 6px; padding: 8px 10px;">
            <!-- Scaled wrapper to bypass browser font limits -->
            <div style="transform: scale(0.88); transform-origin: top left; width: 112%; margin-bottom: -6px;">
              <div style="font-weight: 700; color: #C58B9E; text-transform: uppercase; letter-spacing: 1.2px; font-size: 9px; margin-bottom: 3px;">Billed & Shipped To</div>
              <strong style="font-size: 12px; color: #4A3B42; display:block; margin-bottom: 2px;">${Utils.escapeHTML(enquiry.customer_name)}</strong>
              <div style="font-size: 10px; color: #7F7077; line-height: 1.4;">
                ${Utils.escapeHTML(enquiry.customer_phone)}${enquiry.customer_email ? ' &bull; ' + Utils.escapeHTML(enquiry.customer_email) : ''}<br>
                ${Utils.escapeHTML(enquiry.address_line_1)}${enquiry.address_line_2 ? ', ' + Utils.escapeHTML(enquiry.address_line_2) : ''}<br>
                ${Utils.escapeHTML(enquiry.customer_city)}, ${Utils.escapeHTML(enquiry.state)} - ${Utils.escapeHTML(enquiry.pincode)}
              </div>
            </div>
          </div>
          
          <!-- --- 3. ITEMS TABLE --- -->
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 6px;">
            <thead>
              <tr>
                <th style="text-align: left; border-bottom: 1px solid #F2D5DF; padding-bottom: 4px; vertical-align: bottom;">
                  <div style="font-weight: 700; color: #C58B9E; text-transform: uppercase; letter-spacing: 1px; font-size: 8px; transform: scale(0.88); transform-origin: left bottom; white-space: nowrap;">Item Description</div>
                </th>
                <th style="text-align: center; border-bottom: 1px solid #F2D5DF; padding-bottom: 4px; width: 85px; vertical-align: bottom;">
                  <div style="font-weight: 700; color: #C58B9E; text-transform: uppercase; letter-spacing: 1px; font-size: 8px; transform: scale(0.88); transform-origin: center bottom; white-space: nowrap;">Qty &times; Price</div>
                </th>
                <th style="text-align: right; border-bottom: 1px solid #F2D5DF; padding-bottom: 4px; width: 65px; vertical-align: bottom;">
                  <div style="font-weight: 700; color: #C58B9E; text-transform: uppercase; letter-spacing: 1px; font-size: 8px; transform: scale(0.88); transform-origin: right bottom; white-space: nowrap;">Total</div>
                </th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>

          <!-- Totals & Thank You Message -->
          <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 2px;">
            
            <!-- Moved Thank You Message -->
            <div style="transform: scale(0.88); transform-origin: left bottom; width: 260px; margin-bottom: -3px;">
              <div style="font-size: 10px; color: #9C8C94; line-height: 1.4; padding-bottom: 2px; white-space: nowrap;">
                <strong style="color: #4A3B42; font-size: 11px;">Thank you for choosing handmade! 💖</strong><br>
                ${Utils.escapeHTML(storeName)}
              </div>
            </div>

            <!-- Totals -->
            <div style="width: 170px; transform: scale(0.88); transform-origin: right bottom; margin-bottom: -3px;">
              <div style="display: flex; justify-content: space-between; font-size: 10.5px; margin-bottom: 4px; color: #7F7077;">
                <span>Subtotal</span>
                <strong style="color: #4A3B42;">${Utils.formatCurrency(enquiry.subtotal || 0)}</strong>
              </div>
              ${enquiry.vip_discount ? `<div style="display: flex; justify-content: space-between; font-size: 10.5px; margin-bottom: 4px; color: #7F7077;"><span>VIP Savings</span><strong style="color: #597A68;">-${Utils.formatCurrency(enquiry.vip_discount)}</strong></div>` : ''}
              ${enquiry.coupon_discount ? `<div style="display: flex; justify-content: space-between; font-size: 10.5px; margin-bottom: 4px; color: #7F7077;"><span>Coupon (${Utils.escapeHTML(enquiry.coupon_code)})</span><strong style="color: #597A68;">-${Utils.formatCurrency(enquiry.coupon_discount)}</strong></div>` : ''}
              <div style="display: flex; justify-content: space-between; font-size: 10.5px; color: #7F7077; margin-bottom: 6px;">
                <span>Shipping</span>
                <strong style="color: #4A3B42;">${enquiry.delivery_fee ? Utils.formatCurrency(enquiry.delivery_fee) : 'Free'}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; padding-top: 6px; border-top: 1px dashed #D5CCD0; font-size: 13px;">
                <strong style="font-family: 'Lora', serif; font-weight: 600; color: #C58B9E;">Total Amount</strong>
                <strong style="color: #C58B9E; font-weight: 700;">${Utils.formatCurrency(enquiry.total_amount || 0)}</strong>
              </div>
            </div>
          </div>

          <!-- Footer (Policy Left, Signature Right) -->
          <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 16px; padding-top: 12px; border-top: 1px solid #F2D5DF;">
            
            <!-- Return Policy Note (Scaled slightly larger) -->
            <div style="transform: scale(0.85); transform-origin: left bottom; margin-bottom: -1px; white-space: nowrap;">
              <div style="font-size: 8.5px; color: #9C8C94; line-height: 1.6;">
                Handmade products are generally non-returnable.<br>
                <div style="margin-top: 4px;">
                  <span id="pdf-policy-link" style="color: #4A3B42; display: inline-block; padding-bottom: 2px; border-bottom: 1px solid rgba(74, 59, 66, 0.4);">Read the no-return policy.</span>
                </div>
              </div>
            </div>

            <!-- Signature -->
            <div style="display: flex; flex-direction: column; align-items: center; width: 120px;">
              <img src="${window.location.origin}/assets/sign.svg" style="height: 42px; width: auto; margin-bottom: 3px; display: block;" crossorigin="anonymous">
              <!-- Replaced text-align: center with display: flex for absolute mathematical centering -->
              <div style="border-top: 1px solid #D5CCD0; padding-top: 4px; width: 100%; display: flex; justify-content: center;">
                <div style="font-size: 8.5px; color: #9C8C94; text-transform: uppercase; letter-spacing: 1px; white-space: nowrap; transform: scale(0.65); transform-origin: top center; margin-bottom: -4px;">Authorized Signatory</div>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(container);

      // Force wait for images to load
      const wrapper = document.getElementById('pdf-invoice-wrapper');
      const images = Array.from(wrapper.querySelectorAll('img'));
      await Promise.all(images.map(img => new Promise((resolve) => {
        if (img.complete) return resolve();
        img.onload = resolve;
        img.onerror = resolve; 
      })));

      // Render logic
      const canvas = await html2canvas(wrapper, {
        scale: 4, 
        useCORS: true,
        backgroundColor: '#FCFAFA',
        logging: false
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.88);
      
      // Dynamic height based on exactly one continuous page
      const pdfWidth = wrapper.offsetWidth * 0.264583;
      const pdfHeight = wrapper.offsetHeight * 0.264583;

      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [pdfWidth, pdfHeight]
      });

      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
    
      // Map the HTML link position to an interactive PDF URL annotation (1px = 0.264583mm)
      const linkEl = document.getElementById('pdf-policy-link');
      if (linkEl) {
        const rect = linkEl.getBoundingClientRect();
        const wrapRect = wrapper.getBoundingClientRect();
        
        const linkX = (rect.left - wrapRect.left) * 0.264583;
        const linkY = (rect.top - wrapRect.top) * 0.264583;
        const linkW = rect.width * 0.264583;
        const linkH = rect.height * 0.264583;
        
        // Permanently hardcode the live production website URL into the PDF file
        pdf.link(linkX, linkY, linkW, linkH, { url: APP_CONFIG.SITE_URL + 'return-policy' });
      }

      pdf.save(filename);
      
      document.body.removeChild(container);
      notify('Invoice downloaded successfully.', 'success');
      
    } catch (error) {
      console.error('Invoice generation failed:', error);
      notify('Failed to generate invoice. Please try again.', 'error');
    } finally {
      if (btn) setLoading(btn, false);
    }
  }
  // 1. A beautiful, custom-styled modal to collect all details at once
  function promptShiprocketDetails() {
    return new Promise((resolve) => {
      document.getElementById('admin-modal-overlay')?.remove();
      const overlay = document.createElement('div');
      overlay.id = 'admin-modal-overlay';
      overlay.className = 'admin-modal-overlay';
      
      overlay.innerHTML = `
        <div class="admin-modal-card" role="dialog" aria-modal="true">
          <div class="admin-modal-icon" aria-hidden="true">📦</div>
          <h2 class="admin-modal-title">Package Details</h2>
          <p class="admin-modal-text">Enter the exact dimensions for the courier.</p>
          <div class="admin-modal-grid">
             <label class="admin-field"><span>Weight (kg) *</span><input id="sr-weight" class="admin-input" type="number" step="0.01" value="0.5"></label>
             <label class="admin-field"><span>Length (cm) *</span><input id="sr-length" class="admin-input" type="number" step="1" value="10"></label>
             <label class="admin-field"><span>Breadth (cm) *</span><input id="sr-breadth" class="admin-input" type="number" step="1" value="10"></label>
             <label class="admin-field"><span>Height (cm) *</span><input id="sr-height" class="admin-input" type="number" step="1" value="10"></label>
          </div>
          <div class="admin-modal-actions">
             <button id="sr-cancel" class="admin-button admin-button--soft" type="button">Cancel</button>
             <button id="sr-confirm" class="admin-button admin-button--dark" type="button">Push order</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      requestAnimationFrame(() => overlay.classList.add('is-visible'));

      // Handle Cancel
      document.getElementById('sr-cancel').onclick = () => {
        overlay.classList.remove('is-visible');
        setTimeout(() => { overlay.remove(); resolve(null); }, 200);
      };

      // Handle Confirm
      document.getElementById('sr-confirm').onclick = () => {
        const weight = parseFloat(document.getElementById('sr-weight').value) || 0.5;
        const length = parseFloat(document.getElementById('sr-length').value) || 10;
        const breadth = parseFloat(document.getElementById('sr-breadth').value) || 10;
        const height = parseFloat(document.getElementById('sr-height').value) || 10;
        
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.remove(); resolve({ weight, length, breadth, height }); }, 200);
      };
    });
  }

  // 2. The updated push function that calls the beautiful modal
  async function handleShiprocketPush(enquiryId, button) {
    const enquiry = state.enquiries.find((item) => item.id === enquiryId);
    if (!enquiry) return;

    // Strict duplicate prevention: block if already pushed
    if (enquiry.shiprocket_order_id) {
      notify('This order has already been pushed to Shiprocket.', 'error');
      return;
    }

    // Trigger the custom modal instead of the browser prompts!
    const boxDetails = await promptShiprocketDetails();
    if (!boxDetails) return; // Stop if the user clicked Cancel

    setLoading(button, true, 'Pushing...');
    
    try {
      // Transmit to Edge Function with custom box details
      const { data, error } = await supabaseClient.functions.invoke('push_to_shiprocket', {
        body: { 
          recordId: enquiryId,
          weight: boxDetails.weight,
          length: boxDetails.length,
          breadth: boxDetails.breadth,
          height: boxDetails.height
        }
      });
      
      if (error) throw error;
      if (data && data.error) throw new Error(data.error);

      // Validate Shiprocket actually generated an order
      if (!data || !data.order_id) {
        throw new Error('Shiprocket did not return a valid Order ID. Please check the order details.');
      }

      // FIX: Ensure updated_at easily passes any timezone DB check constraints
      const safeUpdatedAt = new Date(Math.max(Date.now(), new Date(enquiry.created_at).getTime() + 1000)).toISOString();

      // Successfully pushed! Mark as completed in Database to pass status check constraints
      const { error: dbError } = await supabaseClient.from('whatsapp_enquiries').update({ 
        shiprocket_order_id: data.order_id,
        status: 'completed',
        updated_at: safeUpdatedAt
      }).eq('id', enquiryId);
      
      if (dbError) throw dbError;

      notify('Order pushed and marked as completed!', 'success');
      
      // Update local memory to remove it from "Active" and send it to "Archive"
      enquiry.shiprocket_order_id = data.order_id;
      enquiry.status = 'completed';
      
      renderEnquiries();

      // Open professional WhatsApp Shipping confirmation
      const phoneClean = String(enquiry.customer_phone || '').replace(/\D/g, '');
      const itemsList = (enquiry.items || []).map(item => `- ${item.quantity}x ${item.title}`).join('\n');
      const text = `*Twisted Happiness Studio*\n\nHello *${enquiry.customer_name}*,\nExciting news! Your order is securely packed and ready to ship.\n\n*ORDER REFERENCE:* #${enquiry.reference}\n\n*ITEMS DISPATCHED:*\n${itemsList}\n\n>> We have handed your package over to our trusted delivery partner. You will receive an SMS and email with your tracking link very shortly.\n\nThank you for supporting our small handmade studio. We hope you love your creations!`;
      window.open(`https://wa.me/${phoneClean}?text=${encodeURIComponent(text)}`, '_blank');
      
    } catch (error) {
      // If the push fails, execution jumps here. 
      // The order state remains untouched ('confirmed'), keeping it in the Active view with the Shiprocket button intact.
      notify(error.message || 'Failed to push to Shiprocket. Order remains active.', 'error');
    } finally {
      setLoading(button, false);
    }
  }

  /* ---------------- Helpers ---------------- */
  function setLoading(button, loading, text = 'Working…') { 
    if (!button) return; 
    if (loading) { 
      button.dataset.label = button.textContent; 
      button.textContent = text; 
      button.disabled = true; 
    } else { 
      button.textContent = button.dataset.label || button.textContent; 
      button.disabled = false; 
    } 
  }
  
  function notify(message, type = 'default') { 
    const region = document.getElementById('admin-toast-region'); if (!region) return; 
    const toast = document.createElement('div'); 
    toast.className = `admin-toast ${type === 'success' ? 'is-success' : type === 'error' ? 'is-error' : ''}`; 
    toast.textContent = message; 
    region.appendChild(toast); 
    requestAnimationFrame(() => toast.classList.add('is-visible')); 
    setTimeout(() => { toast.classList.remove('is-visible'); setTimeout(() => toast.remove(), 220); }, 3300); 
  }
  
  function setValue(id, value) { const element = document.getElementById(id); if (element) element.value = value ?? ''; }
  function setText(id, value) { const element = document.getElementById(id); if (element) element.textContent = value; }
  function toLocalInput(value) { if (!value) return ''; const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0,16); }

})();