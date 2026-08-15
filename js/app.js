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
    try {
      injectSharedCart();
      bindSharedCartEvents();
      bindGlobalEvents();
      setCurrentYear();
      
      try { await fetchStoreConfiguration(); } catch (e) { console.warn('Store config warning:', e); }
      try { applyStoreConfiguration(); } catch (e) { console.warn('Apply config warning:', e); }
      
      await fetchProducts();
      renderCart();

      if (state.page === 'catalog' || !document.body.dataset.page) {
        try { initialiseCatalog(); } catch (e) { 
          console.error('Catalog init error:', e); 
          document.getElementById('catalog-loading')?.classList.add('hidden');
          renderCatalogProducts();
        }
      }
      if (state.page === 'product') initialiseProduct();
      if (state.page === 'checkout') initialiseCheckout();
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
      image: Utils.safeImageURL(item.image || item.thumbImg || '', '/assets/th_logo.svg'),
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
    const tiers = Array.isArray(state.store?.vip_tiers) ? state.store.vip_tiers : [];
    if (!tiers.length) return;
    host.innerHTML = tiers.map((tier, index) => {
      const next = tiers[index + 1];
      const range = next ? `${tier.minimumQuantity}${next.minimumQuantity - tier.minimumQuantity > 1 ? `–${next.minimumQuantity - 1}` : ''}` : `${tier.minimumQuantity}+`;
      return `<div class="vip-tier"><span>${Utils.escapeHTML(range)}</span><div><strong>${tier.percent ? `${tier.percent}% off` : 'Standard price'}</strong><small>${tier.percent ? 'Applied automatically' : 'Start your bag'}</small></div></div>`;
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
        <img src="${Utils.escapeHTML(result.product.images?.[0] || '/assets/th_logo.svg')}" alt="" loading="lazy" decoding="async">
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

    if (event.key === 'Enter' && state.searchSuggestionIndex >= 0) {
      event.preventDefault();
      const result = results[state.searchSuggestionIndex];

      if (result?.product) {
        window.location.href = productURL(result.product);
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
        window.location.href = productURL(product);
      }

      return;
    }

    if (event.target.closest('[data-search-all]')) {
      hideSearchSuggestions();
      document.getElementById('collection')?.scrollIntoView({ behavior: 'smooth' });
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
        <img src="${Utils.escapeHTML(product.images[0] || '/assets/th_logo.svg')}" alt="${Utils.escapeHTML(product.title)}" loading="lazy" decoding="async">
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
      
      const getCareIcon = (text) => {
        const lower = text.toLowerCase();
        if (lower.includes('water') || lower.includes('humidity') || lower.includes('moisture')) return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`;
        if (lower.includes('sunlight') || lower.includes('fading')) return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
        if (lower.includes('dust') || lower.includes('wipe') || lower.includes('brush') || lower.includes('cloth')) return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
        if (lower.includes('handle') || lower.includes('delicate') || lower.includes('drop') || lower.includes('adjust')) return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5M14 11V4a2 2 0 0 0-4 0v7M10 11V5a2 2 0 0 0-4 0v10M6 15v-1a2 2 0 0 0-4 0v3c0 3.87 3.13 7 7 7h4c3.87 0 7-3.13 7-7v-5a2 2 0 0 0-4 0v3"/></svg>`;
        // Default star/sparkle for everything else
        return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L14.5 8.5L21 11L14.5 13.5L12 20L9.5 13.5L3 11L9.5 8.5L12 2Z"/></svg>`;
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
    const images = product.images.length ? product.images : ['/assets/th_logo.svg'];
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
        
        <div class="cart-frozen-top" style="padding: 14px 18px; border-bottom: 1px solid var(--line); background: var(--cream);">
          <div class="savings-card"><div class="savings-card__icon">♕</div><div><strong id="cart-savings-title">Buy more, save more</strong><span id="cart-savings-message">Add products to unlock automatic savings.</span><div class="progress-track"><i id="cart-savings-progress" style="width:0%"></i></div></div></div>
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
      image: product.images?.[0] || '/assets/th_logo.svg',
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
      <img src="${Utils.escapeHTML(item.image || '/assets/th_logo.svg')}" alt="${Utils.escapeHTML(item.title)}">
      <div><h3>${Utils.escapeHTML(item.title)}</h3>${item.selectedSize ? `<p>${Utils.escapeHTML(item.selectedSize.label)}${item.orientation ? ` · ${Utils.escapeHTML(item.orientation)}` : ''}</p>` : ''}${item.note ? `<p>Note: ${Utils.escapeHTML(item.note)}</p>` : ''}<p>${Utils.formatCurrency(item.estimatedPrice)} each · Prep ${Utils.escapeHTML(item.preparationDays)}</p><div><span class="quantity-control"><button type="button" data-${actionPrefix}-action="decrease" aria-label="Decrease quantity">−</button><input ${location === 'checkout' ? 'readonly' : 'data-cart-quantity'} type="number" min="1" max="${APP_CONFIG.MAX_ITEM_QUANTITY}" value="${item.quantity}" aria-label="Quantity"><button type="button" data-${actionPrefix}-action="increase" aria-label="Increase quantity">+</button></span><button class="remove-link" type="button" data-${actionPrefix}-action="remove">Remove</button></div></div>
      <strong class="${location === 'checkout' ? '' : 'cart-item__price'}">${Utils.formatCurrency(item.estimatedPrice * item.quantity)}</strong>
    </article>`;
  }

  function totalQuantity(items = activeCheckoutItems()) { return items.reduce((sum, item) => sum + Number(item.quantity || 0), 0); }
  function vipTier(quantity = totalQuantity()) { return [...state.store.vip_tiers].reverse().find((tier) => quantity >= tier.minimumQuantity) || state.store.vip_tiers[0]; }
  function nextVipTier(quantity = totalQuantity()) { return state.store.vip_tiers.find((tier) => tier.minimumQuantity > quantity) || null; }

  function calculateTotals(items = activeCheckoutItems()) {
    const subtotal = Utils.roundMoney(items.reduce((sum, item) => sum + Number(item.estimatedPrice) * Number(item.quantity), 0));
    
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
    return { totalMrp, mrpDiscount, subtotal, quantity, tier, vipDiscount, couponDiscount, merchandiseTotal, shipping, total: Utils.roundMoney(merchandiseTotal + shipping), threshold };
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
    setText(`${prefix}-mrp`, Utils.formatCurrency(totals.totalMrp));
    setText(`${prefix}-mrp-discount`, `−${Utils.formatCurrency(totals.mrpDiscount)}`);
    setText(`${prefix}-subtotal`, Utils.formatCurrency(totals.subtotal));
    setText(`${prefix}-shipping`, totals.shipping ? Utils.formatCurrency(totals.shipping) : 'FREE');
    setText(`${prefix}-total`, Utils.formatCurrency(totals.total));
    
    setText(`${prefix}-vip-label`, `VIP Savings (${totals.tier.percent}%)`); 
    setText(`${prefix}-vip-discount`, `−${Utils.formatCurrency(totals.vipDiscount)}`);
    
    setText(`${prefix}-coupon-label`, state.coupon ? `Coupon (${state.coupon.code})` : 'Coupon Savings');
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
    host.innerHTML = choices.map((product) => `<article class="recommendation-card" data-recommendation-id="${Utils.escapeHTML(product.id)}"><img src="${Utils.escapeHTML(product.images[0] || '/assets/th_logo.svg')}" alt=""><strong>${Utils.escapeHTML(product.title)}</strong><span>${Utils.formatCurrency(product.actual_price)}</span><button type="button" data-recommendation-action="${isCanvasProduct(product) ? 'choose' : 'add'}">${isCanvasProduct(product) ? 'Choose size' : 'Quick add'}</button></article>`).join('');
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
    setInputValue('customer-name', stored.name || ''); 
    setInputValue('customer-phone', stored.phone || ''); 
    setInputValue('customer-email', stored.email || ''); 
    setInputValue('customer-address-1', stored.address_line_1 || ''); 
    setInputValue('customer-address-2', stored.address_line_2 || ''); 
    setInputValue('customer-city', stored.city || ''); 
    setInputValue('customer-state', stored.state || ''); 
    setInputValue('customer-pincode', stored.pincode || '');
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
    
    if (action.dataset.checkoutAction === 'increase') {
      item.quantity = Math.floor(Utils.clamp(item.quantity + 1, 1, APP_CONFIG.MAX_ITEM_QUANTITY));
      if (state.checkoutMode === 'single') {
        state.quickOrder = item;
        writeSession(QUICK_ORDER_KEY, item);
      }
    } else if (action.dataset.checkoutAction === 'decrease') {
      item.quantity = Math.floor(Utils.clamp(item.quantity - 1, 1, APP_CONFIG.MAX_ITEM_QUANTITY));
      if (state.checkoutMode === 'single') {
        state.quickOrder = item;
        writeSession(QUICK_ORDER_KEY, item);
      }
    } else if (action.dataset.checkoutAction === 'remove') {
      if (state.checkoutMode === 'single') {
        state.quickOrder = null;
        sessionStorage.removeItem(QUICK_ORDER_KEY);
      } else {
        state.cart = state.cart.filter((entry) => entry.key !== item.key);
        persistCart();
      }
    }
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
      
      // 1. Show the beautiful success animation
      showCheckoutSuccessAnimation();

      // 2. Wait exactly 2 seconds, then redirect to WhatsApp
      setTimeout(() => {
        window.location.assign(secureWhatsAppURL);
      }, 2000);

    } catch (error) {
      console.error('Secure checkout failed:', error);
      await Utils.alert({ title: 'We could not prepare the order', message: friendlyDatabaseError(error, 'Please try again. No payment has been taken and your bag is safe.'), icon: '🌷', button: 'Return to bag' });
      button.disabled = false; 
      button.textContent = 'Review bag & order on WhatsApp';
    } 
  }

  function showCheckoutSuccessAnimation() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(252,247,248,0.95);backdrop-filter:blur(10px);display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0;transition:opacity 0.4s ease;';
    
    overlay.innerHTML = `
      <div style="text-align:center; animation: popIn 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;">
        <div style="font-size: 4.5rem; margin-bottom: 16px; animation: floatHeart 2.5s ease-in-out infinite;">🌸</div>
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

})();
