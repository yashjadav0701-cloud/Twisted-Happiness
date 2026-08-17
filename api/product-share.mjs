const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  'https://jlszvfevobpqqrmmjzpp.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsc3p2ZmVvYm9wcXFybXFnenBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MzMwMTYsImV4cCI6MjEwMDMwOTAxNn0.WsaLFBk365cSO-nj2tezcLEtbxwKGm3YwZK1_eWoBmE';

function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function cleanText(value = '') {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildDescription(product) {
  const raw =
    cleanText(product.description) ||
    `A handcrafted ${
      product.sub_category ||
      product.main_category ||
      'creation'
    } by Twisted Happiness.`;

  const price = Number(product.actual_price);

  const base =
    raw.length > 180
      ? `${raw.slice(0, 177).trim()}…`
      : raw;

  if (Number.isFinite(price) && price > 0) {
    return `${base} Price: ₹${Math.round(price).toLocaleString('en-IN')}.`;
  }

  return base;
}

function parseImages(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return [];
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (typeof parsed === 'string') {
      return [parsed];
    }
  } catch {
    // Not JSON; continue with comma-separated fallback.
  }

  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveImageURL(value, origin) {
  try {
    const url = new URL(String(value || '').trim(), origin);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return '';
    }

    return url.href;
  } catch {
    return '';
  }
}

function detectImageType(imageURL) {
  try {
    const pathname = new URL(imageURL).pathname.toLowerCase();

    if (pathname.endsWith('.png')) return 'image/png';
    if (pathname.endsWith('.webp')) return 'image/webp';
    if (pathname.endsWith('.gif')) return 'image/gif';
    if (
      pathname.endsWith('.jpg') ||
      pathname.endsWith('.jpeg')
    ) {
      return 'image/jpeg';
    }
  } catch {
    // Ignore malformed URL.
  }

  return 'image/jpeg';
}

function getProductID(requestURL) {
  return (
    requestURL.searchParams.get('pid') ||
    requestURL.searchParams.get('id') ||
    ''
  ).trim();
}

function isValidUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function buildProductURL(origin, productID) {
  return `${origin}/product.html?pid=${encodeURIComponent(productID)}`;
}

function fallbackPage(origin, productURL, status = 404) {
  const title = 'Twisted Happiness — Handcrafted Art Studio';
  const description =
    'Premium handcrafted art, personalised with care and ordered simply through WhatsApp.';
  const image =
    `${origin}/assets/share-icon.png?v=3`;

  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">

  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHTML(title)}">
  <meta property="og:description" content="${escapeHTML(description)}">
  <meta property="og:url" content="${escapeHTML(productURL)}">

  <meta property="og:image" content="${escapeHTML(image)}">
  <meta property="og:image:secure_url" content="${escapeHTML(image)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${escapeHTML(title)}">
  <meta property="og:site_name" content="Twisted Happiness">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHTML(title)}">
  <meta name="twitter:description" content="${escapeHTML(description)}">
  <meta name="twitter:url" content="${escapeHTML(productURL)}">
  <meta name="twitter:image" content="${escapeHTML(image)}">
  <meta name="twitter:image:alt" content="${escapeHTML(title)}">

  <title>${escapeHTML(title)}</title>
</head>
<body>
  <p>
    <a href="${escapeHTML(productURL)}">
      View on Twisted Happiness
    </a>
  </p>
</body>
</html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'X-Robots-Tag': 'noindex, follow'
      }
    }
  );
}

export async function GET(request) {
  const requestURL = new URL(request.url);
  const origin = requestURL.origin;

  const productID = getProductID(requestURL);

  if (!isValidUUID(productID)) {
    return fallbackPage(
      origin,
      `${origin}/`,
      400
    );
  }

  const productURL =
    buildProductURL(origin, productID);

  try {
    const endpoint =
      new URL(`${SUPABASE_URL}/rest/v1/products`);

    endpoint.searchParams.set(
      'select',
      'id,title,description,images,actual_price,fake_price,main_category,sub_category'
    );

    endpoint.searchParams.set(
      'id',
      `eq.${productID}`
    );

    endpoint.searchParams.set(
      'is_active',
      'eq.true'
    );

    endpoint.searchParams.set(
      'limit',
      '1'
    );

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(
        `Supabase request failed: HTTP ${response.status}`
      );
    }

    const rows = await response.json();

    if (!Array.isArray(rows) || !rows.length) {
      return fallbackPage(
        origin,
        productURL,
        404
      );
    }

    const product = rows[0];

    const productTitle =
      cleanText(product.title) ||
      'Twisted Happiness Product';

    const description =
      buildDescription(product);

    const images =
      parseImages(product.images);

    const productImage =
      images
        .map((image) =>
          resolveImageURL(image, origin)
        )
        .find(Boolean) ||
      `${origin}/assets/share-icon.png?v=3`;

    const imageType =
      detectImageType(productImage);

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">

  <meta name="viewport"
        content="width=device-width,initial-scale=1">

  <!-- Open Graph -->
  <meta property="og:type"
        content="product">

  <meta property="og:title"
        content="${escapeHTML(productTitle)}">

  <meta property="og:description"
        content="${escapeHTML(description)}">

  <meta property="og:url"
        content="${escapeHTML(productURL)}">

  <meta property="og:image"
        content="${escapeHTML(productImage)}">

  <meta property="og:image:secure_url"
        content="${escapeHTML(productImage)}">

  <meta property="og:image:type"
        content="${escapeHTML(imageType)}">

  <meta property="og:image:width"
        content="1200">

  <meta property="og:image:height"
        content="630">

  <meta property="og:image:alt"
        content="${escapeHTML(productTitle)}">

  <meta property="og:site_name"
        content="Twisted Happiness">

  <!-- Twitter -->
  <meta name="twitter:card"
        content="summary_large_image">

  <meta name="twitter:title"
        content="${escapeHTML(productTitle)}">

  <meta name="twitter:description"
        content="${escapeHTML(description)}">

  <meta name="twitter:url"
        content="${escapeHTML(productURL)}">

  <meta name="twitter:image"
        content="${escapeHTML(productImage)}">

  <meta name="twitter:image:alt"
        content="${escapeHTML(productTitle)}">

  <link rel="canonical"
        href="${escapeHTML(productURL)}">

  <title>
    ${escapeHTML(productTitle)} | Twisted Happiness
  </title>

  <style>
    html,body{
      margin:0;
      padding:0;
      background:#fcf7f8;
      font-family:system-ui,sans-serif;
      color:#31262b;
    }

    .share-page{
      max-width:760px;
      margin:0 auto;
      padding:24px;
      text-align:center;
    }

    .share-page img{
      width:100%;
      height:auto;
      max-height:720px;
      object-fit:contain;
      border-radius:18px;
      display:block;
      margin:0 auto 24px;
    }

    .share-page h1{
      font-size:28px;
      margin:0 0 12px;
    }

    .share-page p{
      line-height:1.6;
      margin:0 0 20px;
    }

    .share-page a{
      display:inline-block;
      padding:12px 18px;
      border-radius:12px;
      text-decoration:none;
      background:#4a103b;
      color:#fff;
    }
  </style>
</head>

<body>
  <main class="share-page">
    <img
      src="${escapeHTML(productImage)}"
      alt="${escapeHTML(productTitle)}"
      width="1200"
      height="630"
    >

    <h1>${escapeHTML(productTitle)}</h1>

    <p>${escapeHTML(description)}</p>

    <a href="${escapeHTML(productURL)}">
      View this creation on Twisted Happiness
    </a>
  </main>

  <script>
    setTimeout(() => {
      window.location.replace(
        ${JSON.stringify(productURL)}
      );
    }, 250);
  </script>
</body>
</html>`;

    return new Response(
      html,
      {
        status: 200,
        headers: {
          'Content-Type':
            'text/html; charset=utf-8',

          'Cache-Control':
            'no-store, max-age=0, must-revalidate',

          'X-Robots-Tag':
            'noindex, follow'
        }
      }
    );
  } catch (error) {
    console.error(
      'PRODUCT SHARE ERROR:',
      error
    );

    return fallbackPage(
      origin,
      productURL,
      500
    );
  }
}