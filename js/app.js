/** Twisted Happiness WhatsApp-first storefront. */
(() => {
  'use strict';

  const { APP_CONFIG, supabaseClient, Utils } = window;
  if (!APP_CONFIG || !Utils) return;

  const QUICK_ORDER_KEY = 'twisted_happiness_quick_order_v1';

// Fresh seed for each page load.
// The Featured Mix order changes after every full refresh,
// while remaining stable during filtering/sorting within the same page session.
const CATALOG_REFRESH_SEED = `${Date.now()}-${Math.random()}`;
  const state = {
    page: document.body.dataset.page || 'catalog',
    products: [],
    filteredProducts: [],
    cart: loadCart(),
    quickOrder: readSession(QUICK_ORDER_KEY, null),
    checkoutMode: new URLSearchParams(window.location.search).get('mode') === 'single' ? 'single' : 'cart',
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
    searchSuggestionIndex: -1
  };

  document.addEventListener('DOMContentLoaded', initialise);

  async function initialise() {
    injectSharedCart();
    bindSharedCartEvents();
    bindGlobalEvents();
    setCurrentYear();
    await fetchStoreConfiguration();
    applyStoreConfiguration();
    await fetchProducts();
    renderCart();

    if (state.page === 'catalog') initialiseCatalog();
    if (state.page === 'product') initialiseProduct();
    if (state.page === 'checkout') initialiseCheckout();
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
      image: Utils.safeImageURL(item.image || item.thumbImg || '', '/assets/logo.webp'),
      estimatedPrice: Utils.roundMoney(item.estimatedPrice ?? item.price ?? 0),
      quantity: Math.floor(Utils.clamp(item.quantity || item.qty || 1, 1, APP_CONFIG.MAX_ITEM_QUANTITY)),
      selectedSize,
      orientation,
      note,
      preparationDays: String(item.preparationDays || item.prepDays || 'Made to order')
    };
  }

  function activeCheckoutItems() {
    if (state.checkoutMode === 'single' && state.quickOrder) {
      const item = normaliseCartItem(state.quickOrder);
      return item ? [item] : [];
    }
    return state.cart;
  }

  function persistCart() {
    writeStorage(APP_CONFIG.STORAGE_KEYS.cart, state.cart);
    validateStoredCoupon();
    renderCart();
    if (state.page === 'checkout' && state.checkoutMode === 'cart') renderCheckout();
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
    const dismissed = readStorage(APP_CONFIG.STORAGE_KEYS.announcement, '') === state.store.announcement_banner_text;
    if (announcement && text && !dismissed && state.store.announcement_banner_active && state.store.announcement_banner_text) {
      text.textContent = state.store.announcement_banner_text;
      announcement.classList.remove('hidden');
    }
    document.getElementById('announcement-close')?.addEventListener('click', () => {
      announcement?.classList.add('hidden');
      writeStorage(APP_CONFIG.STORAGE_KEYS.announcement, state.store.announcement_banner_text);
    });

    const helpMessage = state.store.vacation_mode
      ? 'Hello Twisted Happiness 🌸 I would like to join the waitlist for a handcrafted order.'
      : 'Hello Twisted Happiness 🌸 I need help choosing a handcrafted product.';
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
  }

  function setCurrentYear() {
    document.querySelectorAll('[data-current-year]').forEach((element) => { element.textContent = String(new Date().getFullYear()); });
  }

  /* ---------------- Catalog and search ---------------- */
  function initialiseCatalog() {
    const search = document.getElementById('catalog-search');
    const clear = document.getElementById('catalog-search-clear');
    const sort = document.getElementById('catalog-sort');
    renderHomeVipTiers();
    renderCategoryChips();
    applyCatalogFilters();

    search?.addEventListener('input', Utils.debounce(() => {
      state.search = search.value.trim().toLowerCase();
      state.visibleCount = APP_CONFIG.PRODUCT_PAGE_SIZE;
      state.searchSuggestionIndex = -1;
      clear?.classList.toggle('hidden', !state.search);
      renderSearchSuggestions();
      applyCatalogFilters();
    }, 120));
    search?.addEventListener('keydown', handleSearchKeyboard);
    search?.addEventListener('focus', renderSearchSuggestions);

    clear?.addEventListener('click', () => {
      search.value = '';
      state.search = '';
      clear.classList.add('hidden');
      hideSearchSuggestions();
      applyCatalogFilters();
      search.focus();
    });

    sort?.addEventListener('change', () => {
      state.sort = sort.value;
      state.visibleCount = APP_CONFIG.PRODUCT_PAGE_SIZE;
      applyCatalogFilters();
    });
    document.getElementById('reset-catalog')?.addEventListener('click', resetCatalog);
    document.getElementById('load-more')?.addEventListener('click', () => { state.visibleCount += APP_CONFIG.PRODUCT_PAGE_SIZE; renderCatalogProducts(); });
    document.getElementById('product-grid')?.addEventListener('click', handleProductGridClick);
    document.getElementById('search-suggestions')?.addEventListener('click', handleSearchSuggestionClick);
    document.addEventListener('click', (event) => { if (!event.target.closest('.search-shell')) hideSearchSuggestions(); });
  }

  function renderHomeVipTiers() {
    const host = document.getElementById('home-vip-tiers');
    if (!host) return;
    host.innerHTML = state.store.vip_tiers.map((tier, index) => {
      const next = state.store.vip_tiers[index + 1];
      const range = next ? `${tier.minimumQuantity}${next.minimumQuantity - tier.minimumQuantity > 1 ? `–${next.minimumQuantity - 1}` : ''}` : `${tier.minimumQuantity}+`;
      return `<div class="vip-tier"><span>${Utils.escapeHTML(range)}</span><div><strong>${tier.percent ? `${tier.percent}% off` : 'Standard price'}</strong><small>${tier.percent ? 'Applied automatically' : 'Start your bag'}</small></div></div>`;
    }).join('');
  }

  function renderSearchSuggestions() {
    const host = document.getElementById('search-suggestions');
    if (!host) return;
    const query = state.search.trim();
    if (!query) return hideSearchSuggestions();
    const results = state.products.filter((product) => productSearchText(product).includes(query)).slice(0, 6);
    if (!results.length) {
      host.innerHTML = '<div class="search-suggestions__all">No matching products</div>';
      host.classList.remove('hidden');
      return;
    }
    host.innerHTML = results.map((product, index) => `
      <button class="search-suggestion ${index === state.searchSuggestionIndex ? 'is-active' : ''}" type="button" role="option" data-search-product="${Utils.escapeHTML(product.id)}">
        <img src="${Utils.escapeHTML(product.images[0] || '/assets/logo.webp')}" alt="">
        <span><strong>${Utils.escapeHTML(product.title)}</strong><small>${Utils.escapeHTML(product.sub_category || product.main_category || 'Handcrafted')}</small></span>
        <span>${Utils.formatCurrency(product.actual_price)}</span>
      </button>`).join('') + '<button class="search-suggestions__all" type="button" data-search-all>View all matching creations</button>';
    host.classList.remove('hidden');
  }

  function handleSearchKeyboard(event) {
    const results = state.products.filter((product) => productSearchText(product).includes(state.search)).slice(0, 6);
    if (!results.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); state.searchSuggestionIndex = Math.min(results.length - 1, state.searchSuggestionIndex + 1); renderSearchSuggestions(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); state.searchSuggestionIndex = Math.max(0, state.searchSuggestionIndex - 1); renderSearchSuggestions(); }
    if (event.key === 'Enter' && state.searchSuggestionIndex >= 0) { event.preventDefault(); window.location.href = productURL(results[state.searchSuggestionIndex]); }
    if (event.key === 'Escape') hideSearchSuggestions();
  }

  function handleSearchSuggestionClick(event) {
    const productButton = event.target.closest('[data-search-product]');
    if (productButton) {
      const product = state.products.find((item) => String(item.id) === productButton.dataset.searchProduct);
      if (product) window.location.href = productURL(product);
    }
    if (event.target.closest('[data-search-all]')) { hideSearchSuggestions(); document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth' }); }
  }

  function hideSearchSuggestions() { document.getElementById('search-suggestions')?.classList.add('hidden'); }
  function productSearchText(product) { return `${product.title || ''} ${product.main_category || ''} ${product.sub_category || ''}`.toLowerCase(); }

  function renderCategoryChips() {
    const host = document.getElementById('category-chips');
    if (!host) return;
    const categories = ['All', ...new Set(state.products.map((product) => product.main_category).filter(Boolean))];
    host.innerHTML = categories.map((category) => `<button type="button" class="category-chip ${state.category === category ? 'is-active' : ''}" data-category="${Utils.escapeHTML(category)}">${Utils.escapeHTML(category)}</button>`).join('');
    host.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => {
      state.category = button.dataset.category;
      state.visibleCount = APP_CONFIG.PRODUCT_PAGE_SIZE;
      renderCategoryChips();
      applyCatalogFilters();
    }));
  }

  function resetCatalog() {
    state.category = 'All'; state.search = ''; state.sort = 'featured'; state.visibleCount = APP_CONFIG.PRODUCT_PAGE_SIZE;
    const search = document.getElementById('catalog-search'); if (search) search.value = '';
    const sort = document.getElementById('catalog-sort'); if (sort) sort.value = 'featured';
    document.getElementById('catalog-search-clear')?.classList.add('hidden');
    hideSearchSuggestions(); renderCategoryChips(); applyCatalogFilters();
  }

  function applyCatalogFilters() {
    let products = state.products.filter((product) => {
      const categoryMatch = state.category === 'All' || product.main_category === state.category;
      return categoryMatch && (!state.search || productSearchText(product).includes(state.search));
    });
    if (state.sort === 'price-low') products.sort((a, b) => a.actual_price - b.actual_price);
    else if (state.sort === 'price-high') products.sort((a, b) => b.actual_price - a.actual_price);
    else if (state.sort === 'newest') products.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    else products = seededMix(products);
    state.filteredProducts = products;
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
    const count = document.getElementById('catalog-count');
    if (!grid) return;
    loading?.classList.add('hidden');
    if (count) count.textContent = `${state.filteredProducts.length} creation${state.filteredProducts.length === 1 ? '' : 's'}`;
    if (!state.filteredProducts.length) { grid.classList.add('hidden'); empty?.classList.remove('hidden'); loadWrap?.classList.add('hidden'); return; }
    empty?.classList.add('hidden'); grid.classList.remove('hidden');
    const visible = state.filteredProducts.slice(0, state.visibleCount);
    grid.innerHTML = visible.map((product) => productCard(product)).join('');
    loadWrap?.classList.toggle('hidden', visible.length >= state.filteredProducts.length);
  }

  function productCard(product, compact = false) {
    const discount = product.fake_price > product.actual_price ? Math.round((1 - product.actual_price / product.fake_price) * 100) : 0;
    const isCanvas = isCanvasProduct(product);
    return `<article class="product-card" data-product-id="${Utils.escapeHTML(product.id)}">
      <a class="product-card__image" href="${Utils.escapeHTML(productURL(product))}" aria-label="View ${Utils.escapeHTML(product.title)}">
        <img src="${Utils.escapeHTML(product.images[0] || '/assets/logo.webp')}" alt="${Utils.escapeHTML(product.title)}" loading="lazy" decoding="async">
        ${product.sub_category ? `<span class="product-card__badge">${Utils.escapeHTML(product.sub_category)}</span>` : ''}
      </a>
      <div class="product-card__body">
        <p class="product-card__category">${Utils.escapeHTML(product.main_category || 'Handcrafted')}</p>
        <h3><a href="${Utils.escapeHTML(productURL(product))}">${Utils.escapeHTML(product.title)}</a></h3>
        <div class="product-card__price"><strong>${Utils.formatCurrency(product.actual_price)}</strong>${product.fake_price > product.actual_price ? `<del>${Utils.formatCurrency(product.fake_price)}</del><span class="product-card__discount">${discount}% off</span>` : ''}</div>
        <div class="product-card__meta"><span>⏳ ${Utils.escapeHTML(product.preparation_days || 'Made to order')}</span>${compact ? '' : '<span>WhatsApp order</span>'}</div>
        <button type="button" class="product-card__action ${isCanvas ? 'is-secondary' : ''}" data-card-action="${isCanvas ? 'choose' : 'add'}">${isCanvas ? 'Choose size' : 'Add to saving bag'}</button>
      </div>
    </article>`;
  }

  function handleProductGridClick(event) {
    const action = event.target.closest('[data-card-action]');
    if (!action) return;
    const product = state.products.find((item) => String(item.id) === action.closest('[data-product-id]')?.dataset.productId);
    if (!product) return;
    if (action.dataset.cardAction === 'choose') window.location.href = productURL(product);
    else addProductToCart(product, { quantity: 1 });
  }

  function productURL(product) { return `/product.html?pid=${encodeURIComponent(product.id)}`; }
  function showCatalogError(message) {
    document.getElementById('catalog-loading')?.classList.add('hidden');
    const empty = document.getElementById('catalog-empty');
    if (empty) { empty.classList.remove('hidden'); empty.querySelector('h3').textContent = 'Unable to load the collection'; empty.querySelector('p').textContent = message; }
  }

  /* ---------------- Product page ---------------- */
  function initialiseProduct() {
    const productId = new URLSearchParams(window.location.search).get('pid');
    const product = state.products.find((item) => String(item.id) === String(productId));
    if (!product) return showProductError();
    state.activeProduct = product;
    renderProduct(product);
    bindProductEvents();
    fetchProductReviews(product.id);
  }

  function renderProduct(product) {
    state.activePrice = product.actual_price;
    state.activeMRP = product.fake_price || 0;
    document.title = `${product.title} | Twisted Happiness`;
    document.getElementById('og-title')?.setAttribute('content', product.title);
    document.getElementById('og-description')?.setAttribute('content', String(product.description || '').slice(0, 180));
    document.getElementById('og-image')?.setAttribute('content', product.images[0] || `${APP_CONFIG.SITE_URL}/assets/logo.png`);
    setText('breadcrumb-product', product.title); setText('product-category', product.sub_category || product.main_category || 'Collection'); setText('product-prep', `Prep: ${product.preparation_days || 'Made to order'}`); setText('product-title', product.title);
    updateProductPrice();
    renderGallery(product);
    renderCanvasControls(product);
    const description = document.getElementById('product-description');
    if (description) description.innerHTML = paragraphMarkup(product.description || 'Every Twisted Happiness creation is handcrafted with patience, detail and care.');
    const careLines = String(product.care_instructions || '').split('\n').map((line) => line.trim()).filter(Boolean);
    if (careLines.length) {
      document.getElementById('care-section')?.classList.remove('hidden');
      document.getElementById('product-care').innerHTML = careLines.map((line) => `<li><span aria-hidden="true">✨</span> ${Utils.escapeHTML(line)}</li>`).join('');
    }
    setText('product-vip-text', vipProductNudge());
    document.getElementById('product-loading')?.classList.add('hidden');
    document.getElementById('product-detail')?.classList.remove('hidden');
    renderRelatedProducts(product);
  }

  function renderGallery(product) {
    const images = product.images.length ? product.images : ['/assets/logo.webp'];
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
    if (!isCanvasProduct(product)) return;
    const config = productCanvasConfig(product);
    if (!config.baseSize) return;
    const sizes = canvasSizesForProduct(product, config.baseSize);
    state.activeCanvasSize = config.baseSize;
    const host = document.getElementById('canvas-size-options');
    host.innerHTML = sizes.map((size, index) => `<button class="size-option ${Utils.sameCanvasSize(size, config.baseSize) || (!index && !state.activeCanvasSize) ? 'is-active' : ''}" type="button" data-canvas-size="${Utils.escapeHTML(JSON.stringify(size))}">${Utils.escapeHTML(size.label)}</button>`).join('');
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
    state.activePrice = Utils.calculateCanvasPrice(product.actual_price, baseSize, state.activeCanvasSize);
    state.activeMRP = product.fake_price > product.actual_price ? Utils.calculateCanvasPrice(product.fake_price, baseSize, state.activeCanvasSize) : 0;
    updateProductPrice();
  }

  function updateOrientationVisibility() {
    const wrap = document.getElementById('orientation-wrap');
    if (!wrap) return;
    wrap.classList.toggle('hidden', state.activeCanvasSize?.shape !== 'rectangle');
  }

  function updateProductPrice() {
    setText('product-price', Utils.formatCurrency(state.activePrice));
    const mrp = document.getElementById('product-mrp');
    const discount = document.getElementById('product-discount');
    if (state.activeMRP > state.activePrice) {
      mrp.textContent = Utils.formatCurrency(state.activeMRP); mrp.classList.remove('hidden');
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
      state.activeCanvasSize = Utils.normaliseCanvasSize(Utils.parseJSON(option.dataset.canvasSize));
      option.parentElement.querySelectorAll('.size-option').forEach((button) => button.classList.toggle('is-active', button === option));
      updateOrientationVisibility(); updateCanvasPrice();
    });
    document.getElementById('product-qty-minus')?.addEventListener('click', () => { quantity.value = String(Math.floor(Utils.clamp(Number(quantity.value) - 1, 1, APP_CONFIG.MAX_ITEM_QUANTITY))); });
    document.getElementById('product-qty-plus')?.addEventListener('click', () => { quantity.value = String(Math.floor(Utils.clamp(Number(quantity.value) + 1, 1, APP_CONFIG.MAX_ITEM_QUANTITY))); });
    quantity?.addEventListener('change', () => { quantity.value = String(Math.floor(Utils.clamp(quantity.value, 1, APP_CONFIG.MAX_ITEM_QUANTITY))); });
    document.getElementById('add-to-cart')?.addEventListener('click', () => { addProductToCart(state.activeProduct, productSelections()); openCart(); });
    document.getElementById('single-whatsapp')?.addEventListener('click', orderSingleProduct);
    document.getElementById('share-product')?.addEventListener('click', () => Utils.share({ title: state.activeProduct.title, text: `See this handcrafted creation from Twisted Happiness: ${state.activeProduct.title}`, url: window.location.href }));
    document.getElementById('related-grid')?.addEventListener('click', handleProductGridClick);
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

  async function orderSingleProduct() {
    const selection = productSelections();
    const choice = await Utils.choice({ icon: '♕', title: 'A bigger bag saves more', message: 'You can add this creation to your bag and unlock automatic VIP savings, or continue with only this item.', primaryLabel: 'Add to saving bag', secondaryLabel: 'Order only this' });
    if (choice === 'primary') { addProductToCart(state.activeProduct, selection); openCart(); return; }
    if (choice !== 'secondary') return;
    const quickItem = buildCartItem(state.activeProduct, selection);
    writeSession(QUICK_ORDER_KEY, quickItem);
    window.location.href = '/checkout.html?mode=single';
  }

  function renderRelatedProducts(product) {
    const related = state.products.filter((item) => item.id !== product.id && item.main_category === product.main_category).slice(0, 4);
    if (!related.length) return;
    document.getElementById('related-section')?.classList.remove('hidden');
    document.getElementById('related-grid').innerHTML = related.map((item) => productCard(item, true)).join('');
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
    root.innerHTML = `<div id="cart-overlay" class="cart-overlay" aria-hidden="true"></div>
      <aside id="cart-drawer" class="cart-drawer" aria-labelledby="cart-title" aria-hidden="true">
        <header class="cart-head"><h2 id="cart-title">Your Saving Bag</h2><button id="cart-close" class="round-button" type="button" aria-label="Close bag">×</button></header>
        <div id="cart-items" class="cart-items"></div>
        <footer class="cart-footer">
          <div class="savings-card"><div class="savings-card__icon">♕</div><div><strong id="cart-savings-title">Buy more, save more</strong><span id="cart-savings-message">Add products to unlock automatic savings.</span><div class="progress-track"><i id="cart-savings-progress" style="width:0%"></i></div></div></div>
          <div id="cart-shipping-progress" class="shipping-progress"></div>
          <div class="coupon-control"><input id="cart-coupon" type="text" maxlength="40" placeholder="Coupon code"><button id="cart-apply-coupon" class="app-button app-button--dark app-button--small" type="button">Apply</button></div>
          <p id="cart-coupon-status" class="coupon-status"></p>
          <div id="cart-recommendations" class="recommendations hidden"><h3>Complete the gift</h3><div id="cart-recommendation-row" class="recommendation-row no-scrollbar"></div></div>
          <div class="cart-totals"><div class="cart-total-row"><span>Products subtotal</span><strong id="cart-subtotal">₹0</strong></div><div id="cart-vip-row" class="cart-total-row is-saving hidden"><span id="cart-vip-label">VIP discount</span><strong id="cart-vip-discount">−₹0</strong></div><div id="cart-coupon-row" class="cart-total-row is-saving hidden"><span id="cart-coupon-label">Coupon</span><strong id="cart-coupon-discount">−₹0</strong></div><div class="cart-total-row"><span>Estimated delivery</span><strong id="cart-shipping">₹0</strong></div><div class="cart-total-row is-total"><span>Estimated total</span><strong id="cart-total">₹0</strong></div></div>
          <button id="cart-checkout" class="app-button app-button--dark app-button--full" type="button">Review bag & order on WhatsApp</button>
        </footer>
      </aside>`;
  }

  function bindSharedCartEvents() {
    document.getElementById('cart-overlay')?.addEventListener('click', closeCart);
    document.getElementById('cart-close')?.addEventListener('click', closeCart);
    document.getElementById('cart-items')?.addEventListener('click', handleCartItemClick);
    document.getElementById('cart-items')?.addEventListener('change', handleCartQuantityChange);
    document.getElementById('cart-apply-coupon')?.addEventListener('click', () => applyCoupon('cart'));
    document.getElementById('cart-checkout')?.addEventListener('click', () => { if (state.cart.length) window.location.href = '/checkout.html'; });
    document.getElementById('cart-recommendation-row')?.addEventListener('click', handleRecommendationClick);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeCart(); });
  }

  function openCart() {
    renderCart();
    document.getElementById('cart-overlay')?.classList.add('is-open');
    document.getElementById('cart-drawer')?.classList.add('is-open');
    document.getElementById('cart-overlay')?.setAttribute('aria-hidden', 'false');
    document.getElementById('cart-drawer')?.setAttribute('aria-hidden', 'false');
    Utils.setBodyLocked(true);
    document.getElementById('cart-close')?.focus();
  }

  function closeCart() {
    document.getElementById('cart-overlay')?.classList.remove('is-open');
    document.getElementById('cart-drawer')?.classList.remove('is-open');
    document.getElementById('cart-overlay')?.setAttribute('aria-hidden', 'true');
    document.getElementById('cart-drawer')?.setAttribute('aria-hidden', 'true');
    Utils.setBodyLocked(false);
  }

  function buildCartItem(product, selections = {}) {
    const selectedSize = selections.selectedSize ? Utils.normaliseCanvasSize(selections.selectedSize) : null;
    const orientation = selections.orientation || null;
    const note = String(selections.note || '').trim().slice(0, 180);
    return {
      key: cartKey(product.id, selectedSize, orientation, note),
      productId: String(product.id),
      title: product.title,
      image: product.images?.[0] || '/assets/logo.webp',
      estimatedPrice: Utils.roundMoney(selections.estimatedPrice ?? product.actual_price),
      quantity: Math.floor(Utils.clamp(selections.quantity || 1, 1, APP_CONFIG.MAX_ITEM_QUANTITY)),
      selectedSize, orientation, note,
      preparationDays: product.preparation_days || 'Made to order'
    };
  }

  function addProductToCart(product, selections = {}) {
    if (!product) return;
    const item = buildCartItem(product, selections);
    const existing = state.cart.find((entry) => entry.key === item.key);
    if (!existing && state.cart.length >= APP_CONFIG.MAX_CART_LINES) return Utils.alert({ title: 'Bag limit reached', message: `Your bag can contain up to ${APP_CONFIG.MAX_CART_LINES} different selections.`, icon: '🛍️' });
    if (existing) existing.quantity = Math.floor(Utils.clamp(existing.quantity + item.quantity, 1, APP_CONFIG.MAX_ITEM_QUANTITY));
    else state.cart.push(item);
    persistCart();
    Utils.toast(`${product.title} added to your saving bag.`, 'success');
  }

  function cartKey(productId, selectedSize, orientation, note) {
    const sizeKey = selectedSize ? JSON.stringify({ shape: selectedSize.shape, width: selectedSize.width || null, height: selectedSize.height || null, diameter: selectedSize.diameter || null }) : 'standard';
    return [productId, sizeKey, orientation || 'default', String(note || '').trim().toLowerCase()].join('::');
  }

  function handleCartItemClick(event) {
    const action = event.target.closest('[data-cart-action]');
    if (!action) return;
    const item = state.cart.find((entry) => entry.key === action.closest('[data-cart-key]')?.dataset.cartKey);
    if (!item) return;
    if (action.dataset.cartAction === 'increase') item.quantity = Math.floor(Utils.clamp(item.quantity + 1, 1, APP_CONFIG.MAX_ITEM_QUANTITY));
    if (action.dataset.cartAction === 'decrease') item.quantity = Math.floor(Utils.clamp(item.quantity - 1, 1, APP_CONFIG.MAX_ITEM_QUANTITY));
    if (action.dataset.cartAction === 'remove') state.cart = state.cart.filter((entry) => entry.key !== item.key);
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
    if (!state.cart.length) host.innerHTML = '<div class="empty-state"><span>🌸</span><h3>Your bag is empty</h3><p>Add creations to unlock automatic VIP savings.</p></div>';
    else host.innerHTML = state.cart.map((item) => cartItemMarkup(item, 'cart')).join('');
    renderFinancialSummary('cart', state.cart);
    renderRecommendations('cart', state.cart);
    const checkout = document.getElementById('cart-checkout'); if (checkout) checkout.disabled = !state.cart.length;
    syncCouponControls();
  }

  function cartItemMarkup(item, location) {
    const actionPrefix = location === 'checkout' ? 'checkout' : 'cart';
    return `<article class="${location === 'checkout' ? 'checkout-item' : 'cart-item'}" data-cart-key="${Utils.escapeHTML(item.key)}">
      <img src="${Utils.escapeHTML(item.image || '/assets/logo.webp')}" alt="${Utils.escapeHTML(item.title)}">
      <div><h3>${Utils.escapeHTML(item.title)}</h3>${item.selectedSize ? `<p>${Utils.escapeHTML(item.selectedSize.label)}${item.orientation ? ` · ${Utils.escapeHTML(item.orientation)}` : ''}</p>` : ''}${item.note ? `<p>Note: ${Utils.escapeHTML(item.note)}</p>` : ''}<p>${Utils.formatCurrency(item.estimatedPrice)} each · Prep ${Utils.escapeHTML(item.preparationDays)}</p><div><span class="quantity-control"><button type="button" data-${actionPrefix}-action="decrease" aria-label="Decrease quantity">−</button><input ${location === 'checkout' ? 'readonly' : 'data-cart-quantity'} type="number" min="1" max="${APP_CONFIG.MAX_ITEM_QUANTITY}" value="${item.quantity}" aria-label="Quantity"><button type="button" data-${actionPrefix}-action="increase" aria-label="Increase quantity">+</button></span><button class="remove-link" type="button" data-${actionPrefix}-action="remove">Remove</button></div></div>
      <strong class="${location === 'checkout' ? '' : 'cart-item__price'}">${Utils.formatCurrency(item.estimatedPrice * item.quantity)}</strong>
    </article>`;
  }

  function totalQuantity(items = activeCheckoutItems()) { return items.reduce((sum, item) => sum + Number(item.quantity || 0), 0); }
  function vipTier(quantity = totalQuantity()) { return [...state.store.vip_tiers].reverse().find((tier) => quantity >= tier.minimumQuantity) || state.store.vip_tiers[0]; }
  function nextVipTier(quantity = totalQuantity()) { return state.store.vip_tiers.find((tier) => tier.minimumQuantity > quantity) || null; }

  function calculateTotals(items = activeCheckoutItems()) {
    const subtotal = Utils.roundMoney(items.reduce((sum, item) => sum + Number(item.estimatedPrice) * Number(item.quantity), 0));
    const quantity = totalQuantity(items);
    const tier = vipTier(quantity);
    const validCoupon = couponIsValid(state.coupon, subtotal);
    let vipDiscount = Utils.roundMoney(subtotal * tier.percent / 100);
    if (validCoupon && state.coupon.stackWithVip === false) vipDiscount = 0;
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
    return { subtotal, quantity, tier, vipDiscount, couponDiscount, merchandiseTotal, shipping, total: Utils.roundMoney(merchandiseTotal + shipping), threshold };
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

  function renderFinancialSummary(prefix, items = activeCheckoutItems()) {
    const totals = calculateTotals(items);
    setText(`${prefix}-subtotal`, Utils.formatCurrency(totals.subtotal));
    setText(`${prefix}-shipping`, totals.shipping ? Utils.formatCurrency(totals.shipping) : 'FREE');
    setText(`${prefix}-total`, Utils.formatCurrency(totals.total));
    const vipRow = document.getElementById(`${prefix}-vip-row`); vipRow?.classList.toggle('hidden', totals.vipDiscount <= 0);
    setText(`${prefix}-vip-label`, `VIP discount (${totals.tier.percent}%)`); setText(`${prefix}-vip-discount`, `−${Utils.formatCurrency(totals.vipDiscount)}`);
    const couponRow = document.getElementById(`${prefix}-coupon-row`); couponRow?.classList.toggle('hidden', totals.couponDiscount <= 0 && state.coupon?.discountType !== 'shipping');
    setText(`${prefix}-coupon-label`, state.coupon ? `Coupon (${state.coupon.code})` : 'Coupon');
    setText(`${prefix}-coupon-discount`, state.coupon?.discountType === 'shipping' ? 'Free delivery' : `−${Utils.formatCurrency(totals.couponDiscount)}`);
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
    host.innerHTML = choices.map((product) => `<article class="recommendation-card" data-recommendation-id="${Utils.escapeHTML(product.id)}"><img src="${Utils.escapeHTML(product.images[0] || '/assets/logo.webp')}" alt=""><strong>${Utils.escapeHTML(product.title)}</strong><span>${Utils.formatCurrency(product.actual_price)}</span><button type="button" data-recommendation-action="${isCanvasProduct(product) ? 'choose' : 'add'}">${isCanvasProduct(product) ? 'Choose size' : 'Quick add'}</button></article>`).join('');
  }

  function handleRecommendationClick(event) {
    const button = event.target.closest('[data-recommendation-action]'); if (!button) return;
    const product = state.products.find((item) => String(item.id) === button.closest('[data-recommendation-id]')?.dataset.recommendationId); if (!product) return;
    if (button.dataset.recommendationAction === 'choose') window.location.href = productURL(product);
    else { addProductToCart(product, { quantity: 1 }); if (state.page === 'checkout') window.location.href = '/checkout.html'; }
  }

  async function applyCoupon(location) {
    const input = document.getElementById(`${location}-coupon`); const status = document.getElementById(`${location}-coupon-status`); const button = document.getElementById(`${location}-apply-coupon`);
    if (state.coupon) {
      state.coupon = null; localStorage.removeItem(APP_CONFIG.STORAGE_KEYS.coupon); if (status) status.textContent = 'Coupon removed.'; renderCart(); if (state.page === 'checkout') renderCheckout(); return;
    }
    const code = input?.value.trim().toUpperCase(); if (!code) { if (status) status.textContent = 'Enter a coupon code.'; return; }
    button.disabled = true; button.textContent = 'Checking…';
    try {
      const subtotal = calculateTotals(location === 'checkout' ? activeCheckoutItems() : state.cart).subtotal;
      const { data, error } = await supabaseClient.rpc(APP_CONFIG.RPC.validateCoupon, { p_code: code, p_subtotal: subtotal });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const coupon = normaliseCoupon(row);
      if (!coupon || !coupon.active) throw new Error('This coupon is invalid or inactive.');
      state.coupon = coupon; writeStorage(APP_CONFIG.STORAGE_KEYS.coupon, coupon);
      if (status) status.textContent = `${code} applied successfully.`;
      Utils.toast(`${code} applied.`, 'success');
    } catch (error) {
      state.coupon = null; localStorage.removeItem(APP_CONFIG.STORAGE_KEYS.coupon); if (status) status.textContent = friendlyDatabaseError(error, 'Coupon could not be applied.');
    } finally { button.disabled = false; renderCart(); if (state.page === 'checkout') renderCheckout(); }
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
      const input = document.getElementById(`${location}-coupon`); const button = document.getElementById(`${location}-apply-coupon`);
      if (input) { input.value = state.coupon?.code || ''; input.disabled = Boolean(state.coupon); }
      if (button) button.textContent = state.coupon ? 'Remove' : 'Apply';
    });
  }

  /* ---------------- Checkout and secure enquiry ---------------- */
  function initialiseCheckout() {
    if (state.checkoutMode === 'single' && !state.quickOrder) state.checkoutMode = 'cart';
    const stored = readStorage(APP_CONFIG.STORAGE_KEYS.customer, {});
    setInputValue('customer-name', stored.name || ''); setInputValue('customer-phone', stored.phone || ''); setInputValue('customer-city', stored.city || '');
    document.getElementById('checkout-items')?.addEventListener('click', handleCheckoutItemClick);
    document.getElementById('checkout-apply-coupon')?.addEventListener('click', () => applyCoupon('checkout'));
    document.getElementById('checkout-recommendations')?.addEventListener('click', handleRecommendationClick);
    document.getElementById('clear-cart')?.addEventListener('click', clearCheckoutItems);
    document.getElementById('checkout-form')?.addEventListener('submit', checkoutWhatsApp);
    renderCheckout();
  }

  function renderCheckout() {
    const items = activeCheckoutItems();
    const empty = document.getElementById('checkout-empty'); const content = document.getElementById('checkout-content');
    if (!items.length) { empty?.classList.remove('hidden'); content?.classList.add('hidden'); return; }
    empty?.classList.add('hidden'); content?.classList.remove('hidden');
    document.getElementById('checkout-items').innerHTML = items.map((item) => cartItemMarkup(item, 'checkout')).join('');
    const clear = document.getElementById('clear-cart'); if (clear) clear.textContent = state.checkoutMode === 'single' ? 'Cancel single item' : 'Clear bag';
    renderFinancialSummary('checkout', items); renderRecommendations('checkout', items); syncCouponControls();
  }

  function handleCheckoutItemClick(event) {
    const action = event.target.closest('[data-checkout-action]'); if (!action) return;
    const items = activeCheckoutItems(); const item = items.find((entry) => entry.key === action.closest('[data-cart-key]')?.dataset.cartKey); if (!item) return;
    if (action.dataset.checkoutAction === 'increase') item.quantity = Math.floor(Utils.clamp(item.quantity + 1, 1, APP_CONFIG.MAX_ITEM_QUANTITY));
    if (action.dataset.checkoutAction === 'decrease') item.quantity = Math.floor(Utils.clamp(item.quantity - 1, 1, APP_CONFIG.MAX_ITEM_QUANTITY));
    if (action.dataset.checkoutAction === 'remove') {
      if (state.checkoutMode === 'single') { state.quickOrder = null; sessionStorage.removeItem(QUICK_ORDER_KEY); }
      else state.cart = state.cart.filter((entry) => entry.key !== item.key);
    }
    if (state.checkoutMode === 'single' && state.quickOrder) writeSession(QUICK_ORDER_KEY, item); else persistCart();
    renderCheckout();
  }

  async function clearCheckoutItems() {
    const choice = await Utils.choice({ title: state.checkoutMode === 'single' ? 'Cancel this single-item order?' : 'Clear your saving bag?', message: state.checkoutMode === 'single' ? 'You can return to the product or continue shopping.' : 'This removes every selected product and the applied coupon from this browser.', icon: '🛍️', primaryLabel: 'Clear selection', secondaryLabel: 'Keep items' });
    if (choice !== 'primary') return;
    if (state.checkoutMode === 'single') { state.quickOrder = null; sessionStorage.removeItem(QUICK_ORDER_KEY); }
    else { state.cart = []; persistCart(); }
    state.coupon = null; localStorage.removeItem(APP_CONFIG.STORAGE_KEYS.coupon); renderCheckout();
  }

  async function checkoutWhatsApp(event) {
    event.preventDefault();
    const items = activeCheckoutItems(); if (!items.length) return;
    const name = document.getElementById('customer-name')?.value.trim();
    const phone = document.getElementById('customer-phone')?.value.replace(/\D/g, '');
    const city = document.getElementById('customer-city')?.value.trim();
    const note = document.getElementById('customer-note')?.value.trim().slice(0, 260);
    if (!name) return focusError('customer-name', 'Please enter your name.');
    if (!phone || phone.length < 10 || phone.length > 15) return focusError('customer-phone', 'Enter a valid WhatsApp number.');
    writeStorage(APP_CONFIG.STORAGE_KEYS.customer, { name, phone, city });

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
      const customerPayload = { name, phone, city: city || null, note: note || null };
      const { data, error } = await supabaseClient.rpc(APP_CONFIG.RPC.createEnquiry, {
        p_cart: cartPayload,
        p_customer: customerPayload,
        p_coupon_code: state.coupon?.code || null,
        p_client_reference: Utils.createLocalReference()
      });
      if (error) throw error;
      const quote = Array.isArray(data) ? data[0] : data;
      const secureWhatsAppURL = quote?.whatsapp_url || (quote?.whatsapp_message && quote?.whatsapp_number
        ? `https://wa.me/${String(quote.whatsapp_number).replace(/\D/g, '')}?text=${encodeURIComponent(quote.whatsapp_message)}`
        : null);
      if (!secureWhatsAppURL) throw new Error('The secure quote did not return WhatsApp details.');
      if (quote.reference) Utils.toast(`Enquiry ${quote.reference} created securely.`, 'success');
      window.location.assign(secureWhatsAppURL);
    } catch (error) {
      console.error('Secure checkout failed:', error);
      await Utils.alert({ title: 'We could not prepare the order', message: friendlyDatabaseError(error, 'Please try again. No payment has been taken and your bag is safe.'), icon: '🌷', button: 'Return to bag' });
    } finally { button.disabled = false; button.textContent = 'Confirm & open WhatsApp'; }
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
})();
