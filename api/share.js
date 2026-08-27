'use strict';

const SITE_URL = 'https://twistedhappiness.vercel.app/';
const SUPABASE_URL = 'https://jlszvfevobpqqrmmjzpp.supabase.co';

const FALLBACK_IMAGE = `${SITE_URL}/assets/share-icon.png?v=mtbkw1n3`;

const FALLBACK_DESCRIPTION =
  'A handcrafted creation by Twisted Happiness.';

const escapeHTML = (value = '') =>
  String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));

const parseImages = (value) => {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map(String);
  }

  if (typeof value !== 'string') {
    return [];
  }

  const text = value.trim();
  if (!text) return [];

  // Normal JSON array
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.filter(Boolean).map(String);
    }
  } catch {
    // Continue with other formats.
  }

  // PostgreSQL-style array: {"url1","url2"}
  if (text.startsWith('{') && text.endsWith('}')) {
    return text
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^"(.*)"$/, '$1'))
      .filter(Boolean);
  }

  // Legacy comma-separated fallback
  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const absoluteImageURL = (value) => {
  if (!value) return FALLBACK_IMAGE;

  try {
    const url = new URL(String(value), SITE_URL);

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.href;
    }
  } catch {
    // Fall back below.
  }

  return FALLBACK_IMAGE;
};

module.exports = async function handler(req, res) {
  const pid = String(req.query?.pid || '').trim();

  if (!pid) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${SITE_URL}/">
  <title>Twisted Happiness</title>
</head>
<body>
  <a href="${SITE_URL}/">Open Twisted Happiness</a>
</body>
</html>`);
  }

  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJqc3N6dmVvYm9wcXFybW1qenBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MzMwMTYsImV4cCI6MjEwMDMwOTAxNn0.WsaLFBk365cSO-nj2tezcLEtbxwKGm3YwZK1_eWoBmI';

  try {
    const queryURL =
      `${SUPABASE_URL}/rest/v1/products` +
      `?id=eq.${encodeURIComponent(pid)}` +
      `&select=id,title,description,images` +
      `&limit=1`;

    const response = await fetch(queryURL, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Supabase returned ${response.status}`);
    }

    const products = await response.json();
    const product = products?.[0];

    if (!product) {
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${SITE_URL}/">
  <title>Twisted Happiness</title>
</head>
<body>
  <a href="${SITE_URL}/">Open Twisted Happiness</a>
</body>
</html>`);
    }

    const title =
      `${String(product.title || 'Twisted Happiness')} | Twisted Happiness`;

    const description =
      String(product.description || FALLBACK_DESCRIPTION)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);

    const images = parseImages(product.images);
    const image = absoluteImageURL(images[0]);

    const productURL =
      `${SITE_URL}/?view=product&pid=${encodeURIComponent(product.id)}`;

    // Prevent cached HTML from becoming stale too aggressively.
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=86400'
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    const safeTitle = escapeHTML(title);
    const safeDescription = escapeHTML(description);
    const safeImage = escapeHTML(image);
    const safeProductURL = escapeHTML(productURL);

    return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">

  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}">

  <!-- Open Graph -->
  <meta property="og:type" content="product">
  <meta property="og:site_name" content="Twisted Happiness">
  <meta property="og:url" content="${safeProductURL}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:image" content="${safeImage}">
  <meta property="og:image:secure_url" content="${safeImage}">

  <!-- Twitter / X -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDescription}">
  <meta name="twitter:image" content="${safeImage}">

  <meta http-equiv="refresh" content="0;url=${safeProductURL}">
</head>

<body>
  <p>Opening ${safeTitle}...</p>
  <p>
    <a href="${safeProductURL}">Open product</a>
  </p>
</body>
</html>`);
  } catch (error) {
    console.error('Product share preview error:', error);

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0;url=${SITE_URL}/">
  <title>Twisted Happiness</title>
</head>
<body>
  <a href="${SITE_URL}/">Open Twisted Happiness</a>
</body>
</html>`);
  }
};