/** Twisted Happiness secure studio admin. */
(() => {
  'use strict';

  const { APP_CONFIG, supabaseClient, Utils } = window;
  if (!APP_CONFIG || !supabaseClient || !Utils) return;

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
    'Clay Stories': `Keep strictly away from water and extreme moisture.\nDust gently using a small, soft-bristled brush.\nHandle delicate, sculpted details with extreme care.\nAvoid dropping on hard surfaces, as clay can chip.\nStore in a sturdy, dry box if not actively displayed.`,
    'Standard': `Keep away from direct water contact and heat sources.\nDust gently with a clean, dry brush or soft cloth.\nHandle any delicate handmade elements with care.\nAvoid direct sunlight to maintain the original finish.\nProtect from heavy objects resting on or crushing the piece.`
  };

  document.addEventListener('DOMContentLoaded', initialise);

  async function initialise() {
    bindGlobalAdminEvents();
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && await hasAdminRole(session.user.id)) {
      state.session = session;
      showWorkspace();
      await initialisePage();
    } else {
      if (session) await supabaseClient.auth.signOut();
      showLogin();
    }
  }

  async function hasAdminRole(userId) {
    if (!userId) return false;
    const { data, error } = await supabaseClient.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    return !error && data?.role === 'admin';
  }

  function bindGlobalAdminEvents() {
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
      <a class="dashboard-enquiry" href="/admin/admin-enquiries.html">
        <div>
          <h3>${Utils.escapeHTML(enquiry.reference)}</h3>
          <p>${Utils.escapeHTML(enquiry.customer_name)} · ${Utils.escapeHTML(enquiry.status)} · ${Utils.escapeHTML(new Date(enquiry.created_at).toLocaleString('en-IN'))}</p>
        </div>
        <strong>${Utils.formatCurrency(enquiry.total_amount)}</strong>
      </a>`).join('') : '<div class="admin-empty">No WhatsApp enquiries yet.</div>';
  }

  /* ---------------- Products ---------------- */
  async function initialiseProducts() {
    bindProductEvents(); 
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

  function bindProductEvents() {
    document.getElementById('product-form')?.addEventListener('submit', saveProduct);
    document.getElementById('new-product')?.addEventListener('click', () => { resetProductForm(); document.getElementById('product-title')?.focus(); });
    document.getElementById('reset-product-form')?.addEventListener('click', resetProductForm);
    document.getElementById('product-category')?.addEventListener('change', (event) => {
      updateProductCategoryUI();
      const category = event.target.value || 'Standard';
      if (CARE_GUIDES[category]) {
        setValue('product-care', CARE_GUIDES[category]);
      }
    });
    document.getElementById('canvas-shape')?.addEventListener('change', updateCanvasFields);
    document.getElementById('product-price')?.addEventListener('change', handleSellingPriceChange);
    document.getElementById('product-mrp')?.addEventListener('input', () => { if (!state.suppressMRPTracking) state.mrpManuallyEdited = true; });
    document.getElementById('generate-mrp')?.addEventListener('click', () => generateAndSetMRP(true));
    document.getElementById('upload-zone')?.addEventListener('click', (event) => { if (!event.target.closest('input')) document.getElementById('product-images')?.click(); });
    document.getElementById('product-images')?.addEventListener('change', handleImageSelection);
    document.getElementById('image-preview-list')?.addEventListener('click', handleImagePreviewAction);
    document.getElementById('product-search')?.addEventListener('input', renderProductList);
    document.getElementById('product-filter')?.addEventListener('change', renderProductList);
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
      return (!search || text.includes(search)) && (filter === 'all' || (filter === 'active' && product.is_active) || (filter === 'hidden' && !product.is_active));
    });
    
    document.getElementById('product-count').textContent = String(filtered.length);
    if (!filtered.length) { host.innerHTML = '<div class="admin-empty">No products match this view.</div>'; return; }
    
    host.innerHTML = filtered.map((product) => `
      <article class="product-row" data-product-id="${Utils.escapeHTML(product.id)}">
        <img src="${Utils.escapeHTML(product.images[0] || '/assets/th_logo.svg')}" alt="">
        <div>
          <h3>${Utils.escapeHTML(product.title)}</h3>
          <p>${Utils.escapeHTML(product.main_category || 'Uncategorised')} · ${Utils.formatCurrency(product.actual_price)} · ${Utils.escapeHTML(product.preparation_days || 'No prep time')}</p>
          <span class="status-pill ${product.is_active ? 'is-active' : ''}">${product.is_active ? 'Visible' : 'Hidden'}</span>
        </div>
        <div class="product-row__actions">
          <button type="button" data-product-action="edit">Edit</button>
          <button type="button" data-product-action="duplicate">Duplicate</button>
          <button type="button" data-product-action="toggle">${product.is_active ? 'Hide' : 'Show'}</button>
          <button type="button" class="is-danger" data-product-action="delete">Delete</button>
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
    setValue('product-category', product.main_category || 'Standard'); 
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
    
    const defaultCategory = document.getElementById('product-category')?.value || 'Whimsical Art';
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
    if (changed && !state.mrpManuallyEdited) generateAndSetMRP(false);
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
  async function initialiseSettings() {
    bindSettingsEvents(); 
    await Promise.all([loadProducts(), loadSettings(), loadCoupons(), loadReviews()]); 
    resetCouponForm(); 
    resetReviewForm();
  }

  function bindSettingsEvents() {
    document.getElementById('settings-form')?.addEventListener('submit', saveSettings);
    document.getElementById('add-canvas-size')?.addEventListener('click', () => { state.canvasSizes.push({ id: crypto.randomUUID(), shape: 'square', width: 8, height: 8, label: '8 × 8 in' }); renderCanvasSizes(); });
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
        <div class="structured-row" data-canvas-index="${index}" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:8px;border:1px solid var(--line);border-radius:10px;background:#fff;">
          <div style="display:grid;gap:4px;">
            ${shape === 'circle' 
              ? `<label style="display:grid;gap:2px;"><span style="font-size:0.55rem;font-weight:900;color:var(--muted);">Diameter (in)</span><input class="admin-input" data-canvas-field="primary" type="number" min="1" step="0.5" value="${size.diameter || 8}"></label>`
              : shape === 'rectangle'
              ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                   <label style="display:grid;gap:2px;"><span style="font-size:0.55rem;font-weight:900;color:var(--muted);">Width (in)</span><input class="admin-input" data-canvas-field="primary" type="number" min="1" step="0.5" value="${size.width || 8}"></label>
                   <label style="display:grid;gap:2px;"><span style="font-size:0.55rem;font-weight:900;color:var(--muted);">Height (in)</span><input class="admin-input" data-canvas-field="height" type="number" min="1" step="0.5" value="${size.height || size.width || 10}"></label>
                 </div>`
              : `<label style="display:grid;gap:2px;"><span style="font-size:0.55rem;font-weight:900;color:var(--muted);">Size (in)</span><input class="admin-input" data-canvas-field="primary" type="number" min="1" step="0.5" value="${size.width || 8}"></label>`
            }
          </div>
          <button type="button" data-canvas-action="remove" aria-label="Remove size" style="width:28px;height:28px;border:1px solid var(--line);border-radius:50%;background:#fff;color:var(--red);cursor:pointer;display:grid;place-items:center;font-size:14px;">×</button>
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
      <div class="structured-row is-vip" data-vip-index="${index}" style="display:grid;gap:8px;padding:12px;border:1px solid var(--line);border-radius:14px;background:#fff;position:relative;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:0.65rem;color:var(--muted);">Tier ${index + 1}</strong>
          <button type="button" data-vip-action="remove" aria-label="Remove tier" ${index === 0 ? 'disabled' : ''} style="width:24px;height:24px;border:1px solid var(--line);border-radius:50%;background:#fff;color:var(--red);cursor:pointer;display:grid;place-items:center;font-size:12px;${index === 0 ? 'opacity:0.3;cursor:not-allowed;' : ''}">×</button>
        </div>
        <label style="display:grid;gap:2px;">
          <span style="font-size:0.55rem;font-weight:900;color:var(--muted);">Min quantity</span>
          <input class="admin-input" data-vip-field="minimumQuantity" type="number" min="1" step="1" value="${tier.minimumQuantity}" ${index === 0 ? 'readonly' : ''}>
        </label>
        <label style="display:grid;gap:2px;">
          <span style="font-size:0.55rem;font-weight:900;color:var(--muted);">Discount %</span>
          <input class="admin-input" data-vip-field="percent" type="number" min="0" max="80" step="0.01" value="${tier.percent}">
        </label>
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
    setValue('coupon-customer-limit', coupon.per_phone_limit ?? 1); 
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
    setValue('coupon-id', ''); setValue('coupon-minimum', 0); setValue('coupon-customer-limit', 1); 
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
    const container = document.getElementById('review-product')?.parentElement;
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
  async function initialiseEnquiries() {
    document.getElementById('refresh-enquiries')?.addEventListener('click', loadEnquiries);
    document.getElementById('enquiry-search')?.addEventListener('input', renderEnquiries);
    document.getElementById('enquiry-filter')?.addEventListener('change', renderEnquiries);
    document.getElementById('enquiry-list')?.addEventListener('change', handleEnquiryStatusChange);
    document.getElementById('enquiry-list')?.addEventListener('click', handleShiprocketPush); 
    
    // We must load the product catalog into memory first so we can match product images 
    // and calculate the exact original MRP for the price distribution list.
    await loadProducts();
    await loadEnquiries();
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
    const search = document.getElementById('enquiry-search')?.value.trim().toLowerCase() || ''; 
    const filter = document.getElementById('enquiry-filter')?.value || 'all'; 
    const list = state.enquiries.filter((enquiry) => { 
      const text = `${enquiry.reference} ${enquiry.customer_name} ${enquiry.customer_phone}`.toLowerCase(); 
      return (!search || text.includes(search)) && (filter === 'all' || enquiry.status === filter); 
    }); 
    if (!list.length) { host.innerHTML = '<div class="admin-empty">No enquiries match this view.</div>'; return; } 
    
    host.innerHTML = list.map((enquiry) => {
      // Conditionally render the Shiprocket button
      let shiprocketButton = '';
      if (enquiry.shiprocket_order_id) {
        shiprocketButton = `<a href="https://app.shiprocket.in/orders/processing" class="admin-button admin-button--soft" target="_blank" rel="noopener" style="width: 100%; min-height: 36px; font-size: 0.65rem;">Track on Shiprocket</a>`;
      } else if (enquiry.status === 'completed') {
        shiprocketButton = `<button class="admin-button admin-button--dark" type="button" data-push-shiprocket="${Utils.escapeHTML(enquiry.id)}" style="width: 100%; min-height: 36px; font-size: 0.65rem;">Push to Shiprocket</button>`;
      }

      // Calculate the exact Total MRP dynamically for the admin view
      let computedTotalMrp = 0;
      (enquiry.items || []).forEach((item) => {
          const product = state.products.find(p => String(p.id) === String(item.product_id || item.productId || item.id));
          let itemMrp = item.item_total;
          if (product && product.actual_price > 0 && product.fake_price > product.actual_price) {
              const ratio = product.fake_price / product.actual_price;
              itemMrp = item.item_total * ratio;
          }
          computedTotalMrp += itemMrp;
      });
      const totalMrp = Utils.roundMoney(computedTotalMrp);
      const mrpDiscount = Utils.roundMoney(Math.max(0, totalMrp - (enquiry.subtotal || 0)));

      // Render the full row with the exact 3-column flex layout
      return `
        <article class="enquiry-row admin-card" data-enquiry-id="${Utils.escapeHTML(enquiry.id)}" style="display: flex; flex-wrap: wrap; gap: 20px; padding: 18px; border-bottom: none; margin-bottom: 16px; background: rgba(255,255,255,0.7);">
          
          <!-- Column 1: Customer Details -->
          <div style="flex: 1 1 0%; min-width: 220px; display: flex; flex-direction: column; gap: 10px;">
            <h2 style="margin:0; font-size:1.05rem; font-family: monospace;">${Utils.escapeHTML(enquiry.reference)}</h2>
            <div style="font-size: 0.75rem; color: var(--charcoal); display: flex; flex-direction: column; gap: 6px;">
              <span style="display: flex; gap: 8px; align-items: center; color: var(--muted);"><strong>👤</strong> <span style="color: var(--charcoal);">${Utils.escapeHTML(enquiry.customer_name)}</span></span>
              <span style="display: flex; gap: 8px; align-items: center; color: var(--muted);"><strong>📱</strong> <span style="color: var(--charcoal);">${Utils.escapeHTML(enquiry.customer_phone)}</span></span>
              ${enquiry.customer_email ? `<span style="display: flex; gap: 8px; align-items: center; color: var(--muted);"><strong>✉️</strong> <span style="color: var(--charcoal);">${Utils.escapeHTML(enquiry.customer_email)}</span></span>` : ''}
              <span style="display: flex; gap: 8px; align-items: start; line-height: 1.4; color: var(--muted);">
                <strong>📍</strong> 
                <span style="color: var(--charcoal);">
                  ${Utils.escapeHTML(enquiry.address_line_1 || 'Address pending')}
                  ${enquiry.address_line_2 ? '<br>' + Utils.escapeHTML(enquiry.address_line_2) : ''}<br>
                  ${Utils.escapeHTML(enquiry.customer_city || '')}, ${Utils.escapeHTML(enquiry.state || '')} - ${Utils.escapeHTML(enquiry.pincode || '')}
                </span>
              </span>
              <span style="display: flex; gap: 8px; align-items: center; color: var(--muted); margin-top: 4px;"><strong>🕒</strong> <span style="color: var(--charcoal);">${Utils.escapeHTML(new Date(enquiry.created_at).toLocaleString('en-IN'))}</span></span>
            </div>
          </div>

          <!-- Column 2: Order Details & Price Distribution -->
          <div style="flex: 1 1 0%; min-width: 220px; display: flex; flex-direction: column; gap: 12px;">
            <div style="background: rgba(244,143,177,0.05); border: 1px solid var(--line); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
              ${(enquiry.items || []).map((item) => {
                const product = state.products.find(p => String(p.id) === String(item.product_id || item.productId || item.id));
                const img = product?.images?.[0] || '/assets/th_logo.svg';
                return `
                  <div style="display: flex; gap: 10px; align-items: center;">
                    <img src="${Utils.escapeHTML(img)}" style="width: 40px; height: 40px; border-radius: 6px; object-fit: cover; border: 1px solid var(--line);">
                    <div style="font-size: 0.72rem; line-height: 1.3;">
                      <strong style="color: var(--charcoal);">${Utils.escapeHTML(item.title)}</strong> × ${item.quantity}<br>
                      <span style="color: var(--muted);">${item.selected_size?.label ? `${Utils.escapeHTML(item.selected_size.label)}` : ''}${item.orientation ? ` · ${Utils.escapeHTML(item.orientation)}` : ''}</span>
                    </div>
                  </div>`;
              }).join('')}
            </div>
            
            <div style="font-size: 0.72rem; display: flex; flex-direction: column; gap: 4px; padding: 0 4px;">
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--muted);">Price (MRP)</span>
                <strong>${Utils.formatCurrency(totalMrp)}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; color: var(--green);">
                <span>Discount</span>
                <strong>−${Utils.formatCurrency(mrpDiscount)}</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--charcoal);">Subtotal</span>
                <strong>${Utils.formatCurrency(enquiry.subtotal || 0)}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; color: var(--green);">
                <span>VIP Savings</span>
                <strong>−${Utils.formatCurrency(enquiry.vip_discount || 0)}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; color: var(--green);">
                <span>Coupon ${enquiry.coupon_code ? `(${Utils.escapeHTML(enquiry.coupon_code)})` : ''}</span>
                <strong>−${Utils.formatCurrency(enquiry.coupon_discount || 0)}</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--muted);">Shipping Fee</span>
                <strong>${enquiry.delivery_fee ? Utils.formatCurrency(enquiry.delivery_fee) : 'FREE'}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--line); font-size: 0.82rem; color: var(--charcoal);">
                <span><strong>Order Total</strong></span>
                <strong>${Utils.formatCurrency(enquiry.total_amount || 0)}</strong>
              </div>
            </div>
          </div>

          <!-- Column 3: Actions -->
          <div style="flex: 0 0 140px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; height: 100%;">
            <span class="status-pill ${enquiry.status !== 'cancelled' ? 'is-active' : ''}" style="margin:0; margin-bottom: auto; padding: 4px 10px; font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.05em;">${Utils.escapeHTML(enquiry.status)}</span>
            
            <div style="width: 100%; display: flex; flex-direction: column; gap: 6px;">
              <label style="display:flex; flex-direction: column; gap: 2px; font-size: 0.58rem; font-weight: 900; color: var(--muted); text-transform: uppercase;">
                Update Status
                <select class="admin-input" data-enquiry-status style="font-size: 0.72rem; font-weight: 700; cursor: pointer; padding: 4px 8px; min-height: 28px;">
                  ${['new','contacted','confirmed','completed','cancelled'].map((status) => `<option value="${status}" ${enquiry.status === status ? 'selected' : ''}>${status}</option>`).join('')}
                </select>
              </label>
              
              <a href="https://wa.me/${String(enquiry.customer_phone || '').replace(/\D/g,'')}?text=${encodeURIComponent(`Hello ${enquiry.customer_name}, regarding your Twisted Happiness enquiry ${enquiry.reference}:`)}" class="admin-button" target="_blank" rel="noopener" style="justify-content: center; background: #178a59; color: #fff; border: none; width: 100%; min-height: 36px; font-size: 0.65rem;">
                <svg viewBox="0 0 24 24" style="width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; margin-right: 4px;"><path d="M20 11.6a8 8 0 0 1-11.8 7L4 20l1.4-4A8 8 0 1 1 20 11.6Z"></path><path d="M9 8.5c.4 2 2 3.7 4.2 4.6l1.1-1.1 2 .9c.2.1.3.3.2.5-.2 1.1-1.2 1.8-2.3 1.7-4.5-.5-7.8-4-8.2-8.3-.1-1.1.7-2.1 1.8-2.2.2 0 .4.1.5.3l.8 2-1 1.1"></path></svg>
                WhatsApp
              </a>
              
              ${shiprocketButton ? shiprocketButton.replace('class="admin-button admin-button--dark"', 'class="admin-button admin-button--dark" style="width: 100%; min-height: 36px; font-size: 0.65rem;"') : ''}
            </div>
          </div>

        </article>`;
    }).join(''); 
  }
  
  async function handleEnquiryStatusChange(event) { 
    if (!event.target.matches('[data-enquiry-status]')) return; 
    const id = event.target.closest('[data-enquiry-id]').dataset.enquiryId; 
    const { error } = await supabaseClient.from('whatsapp_enquiries').update({ status: event.target.value, updated_at: new Date().toISOString() }).eq('id', id); 
    if (error) notify(error.message, 'error'); 
    else { 
      notify('Enquiry status updated.', 'success'); 
      const enquiry = state.enquiries.find((item) => item.id === id); 
      if (enquiry) enquiry.status = event.target.value; 
      renderEnquiries(); // Re-render to show/hide Shiprocket button if needed
    } 
  }

  // 1. A beautiful, custom-styled modal to collect all details at once
  function promptShiprocketDetails() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      // Using inline layout styles to ensure it floats perfectly in the center of the screen
      // while recycling your existing admin CSS classes for the inputs and buttons!
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:9999;opacity:0;transition:opacity 0.2s ease;';
      
      overlay.innerHTML = `
        <div style="background:#fff;padding:24px;border-radius:16px;width:90%;max-width:380px;box-shadow:0 10px 40px rgba(0,0,0,0.15);transform:translateY(10px);transition:transform 0.2s ease;">
          <div style="text-align:center;margin-bottom:20px;">
             <span style="font-size:24px;display:block;margin-bottom:8px;">📦</span>
             <h2 style="margin:0;font-family:'Lora',serif;font-size:1.4rem;color:var(--charcoal);">Package Details</h2>
             <p style="margin:4px 0 0;color:var(--muted);font-size:0.8rem;">Enter the exact dimensions for the courier.</p>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px;">
             <label class="admin-field"><span>Weight (kg) *</span><input id="sr-weight" class="admin-input" type="number" step="0.01" value="0.5"></label>
             <label class="admin-field"><span>Length (cm) *</span><input id="sr-length" class="admin-input" type="number" step="1" value="10"></label>
             <label class="admin-field"><span>Breadth (cm) *</span><input id="sr-breadth" class="admin-input" type="number" step="1" value="10"></label>
             <label class="admin-field"><span>Height (cm) *</span><input id="sr-height" class="admin-input" type="number" step="1" value="10"></label>
          </div>
          <div style="display:flex;gap:10px;">
             <button id="sr-cancel" class="admin-button admin-button--soft" style="flex:1;" type="button">Cancel</button>
             <button id="sr-confirm" class="admin-button admin-button--dark" style="flex:1;" type="button">Push order</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      // Trigger a tiny delay so the fade-in animation plays smoothly
      requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        overlay.firstElementChild.style.transform = 'translateY(0)';
      });

      // Handle Cancel
      document.getElementById('sr-cancel').onclick = () => {
        overlay.style.opacity = '0';
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
  async function handleShiprocketPush(event) {
    const button = event.target.closest('[data-push-shiprocket]');
    if (!button) return;
    
    const enquiryId = button.dataset.pushShiprocket;

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

      notify('Order pushed to Shiprocket successfully!', 'success');
      
      // Update local memory to display the tracking link button
      const enquiry = state.enquiries.find((item) => item.id === enquiryId);
      if (enquiry) enquiry.shiprocket_order_id = data.order_id;
      
      renderEnquiries();
      
    } catch (error) {
      notify(error.message || 'Failed to push to Shiprocket.', 'error');
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