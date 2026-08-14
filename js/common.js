/** Shared, dependency-free utilities for storefront and admin. */
(() => {
  'use strict';

  const Utils = {
    parseJSON(value, fallback = null) {
      if (value === null || value === undefined || value === '') return fallback;
      if (typeof value !== 'string') return value;
      try { return JSON.parse(value); } catch { return fallback; }
    },

    escapeHTML(value = '') {
      return String(value).replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
      })[character]);
    },

    safeImageURL(value, fallback = '') {
      if (!value) return fallback;
      try {
        const url = new URL(String(value), window.location.origin);
        if (['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) return url.href;
      } catch { /* invalid URL */ }
      return fallback;
    },

    normaliseImages(value) {
      let images = value;
      if (typeof images === 'string') {
        const parsed = Utils.parseJSON(images, null);
        images = Array.isArray(parsed) ? parsed : images.split(',');
      }
      if (!Array.isArray(images)) return [];
      return [...new Set(images.map((item) => Utils.safeImageURL(String(item).trim())).filter(Boolean))];
    },

    normaliseAttributes(value) {
      const parsed = Utils.parseJSON(value, value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    },

    normaliseVipTiers(value, fallback = []) {
      const parsed = Utils.parseJSON(value, value);
      if (!Array.isArray(parsed)) return [...fallback];
      const tiers = parsed
        .map((tier) => ({
          minimumQuantity: Math.max(1, Math.floor(Number(tier.minimumQuantity ?? tier.minimum_quantity ?? 1))),
          percent: Math.min(80, Math.max(0, Number(tier.percent ?? tier.discount_percent ?? 0)))
        }))
        .filter((tier) => Number.isFinite(tier.minimumQuantity) && Number.isFinite(tier.percent))
        .sort((a, b) => a.minimumQuantity - b.minimumQuantity);
      if (!tiers.length || tiers[0].minimumQuantity !== 1) tiers.unshift({ minimumQuantity: 1, percent: 0 });
      return tiers;
    },

    normaliseCanvasSizes(value, fallback = []) {
      const parsed = Utils.parseJSON(value, value);
      if (Array.isArray(parsed)) {
        return parsed.map((entry, index) => Utils.normaliseCanvasSize(entry, index)).filter(Boolean);
      }
      if (typeof parsed === 'string') {
        return parsed.split(',').map((label, index) => Utils.normaliseCanvasSize(label.trim(), index)).filter(Boolean);
      }
      return [...fallback];
    },

    normaliseCanvasSize(entry, index = 0) {
      if (!entry) return null;
      if (typeof entry === 'string') {
        const text = entry.replace(/×/g, 'x').trim();
        const rectangle = text.match(/(\d+(?:\.\d+)?)\s*["']?\s*x\s*(\d+(?:\.\d+)?)/i);
        if (rectangle) {
          const width = Number(rectangle[1]);
          const height = Number(rectangle[2]);
          return {
            id: `size-${index}-${width}-${height}`,
            shape: width === height ? 'square' : 'rectangle',
            width, height,
            label: `${Utils.cleanNumber(width)} × ${Utils.cleanNumber(height)} in`
          };
        }
        const circle = text.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|inches|["'])?/i);
        if (circle && /circle|diameter/i.test(text)) {
          const diameter = Number(circle[1]);
          return { id: `circle-${index}-${diameter}`, shape: 'circle', diameter, label: `${Utils.cleanNumber(diameter)} in diameter` };
        }
        return null;
      }

      const shape = String(entry.shape || 'square').toLowerCase();
      const width = Number(entry.width || 0);
      const height = Number(entry.height || (shape === 'square' ? width : 0));
      const diameter = Number(entry.diameter || 0);
      if (shape === 'circle' && diameter > 0) {
        return {
          id: String(entry.id || `circle-${index}-${diameter}`), shape, diameter,
          label: String(entry.label || `${Utils.cleanNumber(diameter)} in diameter`)
        };
      }
      if (width > 0 && height > 0) {
        return {
          id: String(entry.id || `${shape}-${index}-${width}-${height}`),
          shape: width === height ? 'square' : 'rectangle', width, height,
          label: String(entry.label || `${Utils.cleanNumber(width)} × ${Utils.cleanNumber(height)} in`)
        };
      }
      return null;
    },

    cleanNumber(value) {
      const number = Number(value);
      return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2)));
    },

    canvasArea(size) {
      const normalised = Utils.normaliseCanvasSize(size);
      if (!normalised) return 0;
      if (normalised.shape === 'circle') return Math.PI * Math.pow(normalised.diameter / 2, 2);
      return normalised.width * normalised.height;
    },

    sameCanvasSize(first, second) {
      const a = Utils.normaliseCanvasSize(first);
      const b = Utils.normaliseCanvasSize(second);
      if (!a || !b || a.shape !== b.shape) return false;
      if (a.shape === 'circle') return Math.abs(a.diameter - b.diameter) < 0.0001;
      return Math.abs(a.width - b.width) < 0.0001 && Math.abs(a.height - b.height) < 0.0001;
    },

    calculateCanvasPrice(basePrice, baseSize, selectedSize) {
      const storedPrice = Math.round(Number(basePrice || 0));
      if (Utils.sameCanvasSize(baseSize, selectedSize)) return storedPrice;
      const baseArea = Utils.canvasArea(baseSize);
      const selectedArea = Utils.canvasArea(selectedSize);
      if (!baseArea || !selectedArea) return storedPrice;
      return Math.round(storedPrice * selectedArea / baseArea);
    },

    roundMoney(value) {
      return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
    },

    formatCurrency(value) {
      const number = Utils.roundMoney(value);
      return new Intl.NumberFormat('en-IN', {
        style: 'currency', currency: 'INR',
        minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
        maximumFractionDigits: 2
      }).format(number);
    },

    clamp(value, minimum, maximum) {
      const numeric = Number(value);
      return Math.min(maximum, Math.max(minimum, Number.isFinite(numeric) ? numeric : minimum));
    },

    debounce(callback, wait = 180) {
      let timer;
      return (...argumentsList) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => callback(...argumentsList), wait);
      };
    },

    parseMaximumDays(value) {
      const values = String(value || '').match(/\d+/g)?.map(Number) || [];
      return values.length ? Math.max(...values) : 0;
    },

    createLocalReference(prefix = 'TH') {
      const now = new Date();
      const date = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      return `${prefix}-${date}-${time}-${Math.floor(Math.random() * 900 + 100)}`;
    },

    slugify(value) {
      return String(value || '')
        .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
    },

    setBodyLocked(locked) {
      document.documentElement.classList.toggle('is-locked', Boolean(locked));
      document.body.classList.toggle('is-locked', Boolean(locked));
    },

    toast(message, type = 'default') {
      let region = document.getElementById('toast-region');
      if (!region) {
        region = document.createElement('div');
        region.id = 'toast-region';
        region.className = 'toast-region';
        region.setAttribute('aria-live', 'polite');
        document.body.appendChild(region);
      }
      const toast = document.createElement('div');
      toast.className = `app-toast app-toast--${type}`;
      toast.textContent = message;
      region.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('is-visible'));
      window.setTimeout(() => {
        toast.classList.remove('is-visible');
        window.setTimeout(() => toast.remove(), 220);
      }, 3200);
    },

    alert({ title = 'Twisted Happiness', message = '', icon = '🌸', button = 'Continue' } = {}) {
      return Utils.choice({ title, message, icon, primaryLabel: button, hideSecondary: true });
    },

    choice({ title = 'Please choose', message = '', icon = '✨', primaryLabel = 'Continue', secondaryLabel = 'Cancel', hideSecondary = false } = {}) {
      return new Promise((resolve) => {
        Utils.closeModal();
        Utils.setBodyLocked(true);
        const overlay = document.createElement('div');
        overlay.id = 'app-modal-overlay';
        overlay.className = 'app-modal-overlay';
        overlay.innerHTML = `
          <section class="app-modal" role="dialog" aria-modal="true" aria-labelledby="app-modal-title">
            <div class="app-modal__icon" aria-hidden="true">${Utils.escapeHTML(icon)}</div>
            <h2 id="app-modal-title">${Utils.escapeHTML(title)}</h2>
            <p>${Utils.escapeHTML(message)}</p>
            <div class="app-modal__actions">
              ${hideSecondary ? '' : `<button type="button" class="app-button app-button--soft" data-modal-secondary>${Utils.escapeHTML(secondaryLabel)}</button>`}
              <button type="button" class="app-button app-button--dark" data-modal-primary>${Utils.escapeHTML(primaryLabel)}</button>
            </div>
          </section>`;
        document.body.appendChild(overlay);
        const primary = overlay.querySelector('[data-modal-primary]');
        const secondary = overlay.querySelector('[data-modal-secondary]');
        primary?.focus();
        primary?.addEventListener('click', () => { Utils.closeModal(); resolve('primary'); });
        secondary?.addEventListener('click', () => { Utils.closeModal(); resolve('secondary'); });
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay && !hideSecondary) { Utils.closeModal(); resolve('dismiss'); }
        });
      });
    },

    closeModal() {
      document.getElementById('app-modal-overlay')?.remove();
      Utils.setBodyLocked(false);
    },

    installLoader() {
      if (document.getElementById('app-loader')) return;
      const loader = document.createElement('div');
      loader.id = 'app-loader';
      loader.className = 'app-loader';
      loader.setAttribute('role', 'status');
      loader.setAttribute('aria-label', 'Loading Twisted Happiness');
      loader.innerHTML = `
        <div class="app-loader__inner">
          <span class="app-loader__halo"></span>
          <img src="/assets/th_logo.svg" alt="Twisted Happiness" style="width: 120px; height: 120px; object-fit: contain; position: relative; z-index: 2;">
          <span class="app-loader__text">Crafting your experience…</span>
        </div>`;
      document.body.prepend(loader);
    },

    hideLoader() {
      const loader = document.getElementById('app-loader');
      if (!loader) return;
      loader.classList.add('is-leaving');
      window.setTimeout(() => loader.remove(), 420);
    },

    installAdminShortcut() {
      document.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          window.location.assign('/admin/admin-dashboard.html');
        }
      });
    },

    async share({ title, text, url }) {
      const payload = { title: title || document.title, text: text || '', url: url || window.location.href };
      if (navigator.share) {
        try { await navigator.share(payload); return true; } catch (error) {
          if (error?.name === 'AbortError') return false;
        }
      }
      try {
        await navigator.clipboard.writeText(payload.url);
        Utils.toast('Product link copied.', 'success');
        return true;
      } catch {
        window.prompt('Copy this product link:', payload.url);
        return true;
      }
    },

    async compressImage(file, options = {}) {
      const maxDimension = Number(options.maxDimension || window.APP_CONFIG?.MAX_IMAGE_DIMENSION || 1920);
      const maxBytes = Number(options.maxBytes || window.APP_CONFIG?.MAX_IMAGE_BYTES || 500000);
      const maxSourceBytes = Number(options.maxSourceBytes || window.APP_CONFIG?.MAX_IMAGE_SOURCE_BYTES || 15 * 1024 * 1024);
      if (!file?.type?.startsWith('image/')) throw new Error('Select a JPG, PNG or WebP image.');
      if (file.size > maxSourceBytes) throw new Error('Each original image must be under 15 MB.');

      let source;
      let objectURL = null;
      if ('createImageBitmap' in window) {
        source = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } else {
        objectURL = URL.createObjectURL(file);
        source = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error('This image could not be opened.'));
          image.src = objectURL;
        });
      }

      try {
        const sourceWidth = source.width || source.naturalWidth;
        const sourceHeight = source.height || source.naturalHeight;
        if (!sourceWidth || !sourceHeight) throw new Error('This image has invalid dimensions.');

        let scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
        let blob = null;
        let quality = 0.9;

        for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(sourceWidth * scale));
          canvas.height = Math.max(1, Math.round(sourceHeight * scale));
          const context = canvas.getContext('2d', { alpha: true });
          if (!context) throw new Error('Image processing is unavailable in this browser.');
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          context.drawImage(source, 0, 0, canvas.width, canvas.height);

          quality = 0.9;
          for (let qualityAttempt = 0; qualityAttempt < 8; qualityAttempt += 1) {
            blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
            if (!blob) throw new Error('Image conversion failed.');
            if (blob.size <= maxBytes) break;
            quality -= 0.08;
          }
          canvas.width = 1;
          canvas.height = 1;
          if (blob?.size <= maxBytes) break;
          scale *= 0.82;
        }

        if (!blob || blob.size > maxBytes) throw new Error('This image could not be compressed below 500 KB. Try a smaller source image.');
        const cleanName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'product';
        return new File([blob], `${cleanName}.webp`, { type: 'image/webp', lastModified: Date.now() });
      } finally {
        source?.close?.();
        if (objectURL) URL.revokeObjectURL(objectURL);
      }
    }
  };

  window.Utils = Object.freeze(Utils);
  Utils.installLoader();
  Utils.installAdminShortcut();
  
  // Force the loader to remain visible for exactly 2 seconds
  window.setTimeout(Utils.hideLoader, 2000);
})();
