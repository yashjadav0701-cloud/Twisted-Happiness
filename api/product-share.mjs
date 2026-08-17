const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  'https://jlszvfevobpqqrmmjzpp.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmF0ZSIsInJlZiI6Impsc3p2ZmVvYm9wcXFybW1qenBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MzMwMTYsImV4cCI6MjEwMDMwOTAxNn0.WsaLFBk365cSO-nj2tezcLEtbxwKGm3YwZK1_eWoBmE';

function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

function plainText(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimDescription(value = '', maximum = 160) {
  const text =
    plainText(value) ||
    'A handcrafted creation by Twisted Happiness.';

  if (text.length <= maximum) return text;

  return `${text.slice(0, maximum - 1).trim()}…`;
}

function normaliseImage(value, origin) {
  try {
    const url = new URL(String(value || ''), origin);

    if (!['http:', 'https:'].includes(url.protocol)) {
      return '';
    }

    return url.href;
  } catch {
    return '';
  }
}

function imageMimeType(imageURL) {
  try {
    const path = new URL(imageURL).pathname.toLowerCase();

    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.webp')) return 'image/webp';
    if (path.endsWith('.gif')) return 'image/gif';

    return 'image/jpeg';
  } catch {
    return 'image/jpeg';
  }
}

function genericPage(origin, destinationURL, status = 200) {
  const title = 'Twisted Happiness — Handcrafted Art Studio';

  const description =
    'Premium handcrafted art, personalised with care and ordered simply through WhatsApp.';

  const image =
    `${origin}/assets/share-icon.png?v=2`;

  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">

  <meta name="robots" content="noindex,follow">

  <meta property="og:type" content="product">
  <meta property="og:url" content="${escapeHTML(destinationURL)}">
  <meta property="og:title" content="${escapeHTML(title)}">
  <meta property="og:description" content="${escapeHTML(description)}">

  <meta property="og:image" content="${escapeHTML(image)}">
  <meta property="og:image:secure_url" content="${escapeHTML(image)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:alt" content="Twisted Happiness">

  <meta property="og:site_name" content="Twisted Happiness">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="${escapeHTML(destinationURL)}">
  <meta name="twitter:title" content="${escapeHTML(title)}">
  <meta name="twitter:description" content="${escapeHTML(description)}">
  <meta name="twitter:image" content="${escapeHTML(image)}">
  <meta name="twitter:image:alt" content="Twisted Happiness">

  <link rel="canonical" href="${escapeHTML(destinationURL)}">

  <title>${escapeHTML(title)}</title>
</head>

<body>
  <p>
    <a href="${escapeHTML(destinationURL)}">
      Continue to Twisted Happiness
    </a>
  </p>
</body>
</html>`,
    {
      status,
      headers: {
        'content-type': 'text/html; charset=UTF-8',
        'cache-control':
          'public, max-age=60, s-maxage=60, stale-while-revalidate=300'
      }
    }
  );
}

export async function GET(request) {
  const requestURL = new URL(request.url);
  const origin = requestURL.origin;

  const pid = (requestURL.searchParams.get('pid') || '').trim();

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      pid
    )
  ) {
    return genericPage(origin, `${origin}/`, 400);
  }

  const productURL =
    `${origin}/product.html?pid=${encodeURIComponent(pid)}`;

  try {
    const endpoint =
      new URL(`${SUPABASE_URL}/rest/v1/products`);

    endpoint.searchParams.set(
      'select',
      'id,title,description,images,actual_price,fake_price,main_category,sub_category'
    );

    endpoint.searchParams.set('id', `eq.${pid}`);
    endpoint.searchParams.set('is_active', 'eq.true');
    endpoint.searchParams.set('limit', '1');

    const response = await fetch(endpoint, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Supabase returned ${response.status}`);
    }

    const rows = await response.json();
    const product = Array.isArray(rows) ? rows[0] : null;

    if (!product) {
      return genericPage(origin, productURL, 404);
    }

    const title =
      plainText(product.title) ||
      'Twisted Happiness Product';

    const descriptionBase = trimDescription(
      product.description ||
      `A handcrafted ${
        product.sub_category ||
        product.main_category ||
        'creation'
      } by Twisted Happiness.`
    );

    const price = Number(product.actual_price);

    const description =
      Number.isFinite(price) && price > 0
        ? `${descriptionBase} Price: ₹${Math.round(price).toLocaleString('en-IN')}.`
        : descriptionBase;

    const image =
      normaliseImage(
        Array.isArray(product.images)
          ? product.images[0]
          : product.images,
        origin
      ) ||
      `${origin}/assets/share-icon.png?v=2`;

    const mime = imageMimeType(image);

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">

  <meta name="robots" content="noindex,follow">

  <meta property="og:type" content="product">
  <meta property="og:url" content="${escapeHTML(productURL)}">
  <meta property="og:title" content="${escapeHTML(title)}">
  <meta property="og:description" content="${escapeHTML(description)}">

  <meta property="og:image" content="${escapeHTML(image)}">
  <meta property="og:image:secure_url" content="${escapeHTML(image)}">
  <meta property="og:image:type" content="${escapeHTML(mime)}">
  <meta property="og:image:alt" content="${escapeHTML(title)}">

  <meta property="og:site_name" content="Twisted Happiness">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="${escapeHTML(productURL)}">
  <meta name="twitter:title" content="${escapeHTML(title)}">
  <meta name="twitter:description" content="${escapeHTML(description)}">
  <meta name="twitter:image" content="${escapeHTML(image)}">
  <meta name="twitter:image:alt" content="${escapeHTML(title)}">

  <link rel="canonical" href="${escapeHTML(productURL)}">

  <title>${escapeHTML(title)} | Twisted Happiness</title>
</head>

<body>
  <main
    style="
      font-family:system-ui,sans-serif;
      max-width:720px;
      margin:40px auto;
      padding:20px;
      text-align:center;
    "
  >
    <img
      src="${escapeHTML(image)}"
      alt="${escapeHTML(title)}"
      style="
        display:block;
        width:100%;
        max-width:560px;
        height:auto;
        margin:0 auto 24px;
        border-radius:16px;
      "
    >

    <h1>${escapeHTML(title)}</h1>

    <p>${escapeHTML(descriptionBase)}</p>

    <p>
      <a href="${escapeHTML(productURL)}">
        View this creation on Twisted Happiness
      </a>
    </p>
  </main>

  <script>
    window.location.replace(${JSON.stringify(productURL)});
  </script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=UTF-8',
        'cache-control':
          'public, max-age=60, s-maxage=60, stale-while-revalidate=300'
      }
    });
  } catch (error) {
    console.error(
      'Product share metadata generation failed:',
      error
    );

    return genericPage(origin, productURL, 502);
  }
}