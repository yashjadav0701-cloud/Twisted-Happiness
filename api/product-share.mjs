const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  'https://jlszvfevobpqqrmmjzpp.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY;

const FALLBACK_IMAGE =
  'https://twistedhappiness.vercel.app/assets/share-icon.png';

function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    };

    return map[character] || character;
  });
}

function cleanText(value = '') {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseImages(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return [];
  }

  const text = value.trim();

  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (typeof parsed === 'string') {
      return [parsed];
    }
  } catch {
    // Continue with plain-string parsing.
  }

  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normaliseImageURL(value) {
  if (!value) {
    return '';
  }

  try {
    const url = new URL(String(value).trim());

    if (
      url.protocol !== 'https:' &&
      url.protocol !== 'http:'
    ) {
      return '';
    }

    return url.href;
  } catch {
    return '';
  }
}

function isUUID(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function getProductId(req) {
  const url = new URL(
    req.url,
    `https://${req.headers.host}`
  );

  return (
    url.searchParams.get('pid') ||
    url.searchParams.get('id') ||
    ''
  ).trim();
}

function sendHTML(res, status, html) {
  res.statusCode = status;

  res.setHeader(
    'Content-Type',
    'text/html; charset=utf-8'
  );

  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate'
  );

  res.setHeader(
    'Pragma',
    'no-cache'
  );

  res.setHeader(
    'Expires',
    '0'
  );

  res.end(html);
}

function debugPage({
  productId,
  stage,
  details,
  productURL,
  product,
  image
}) {
  return `<!doctype html>
<html lang="en">

<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width,initial-scale=1"
  >
  <title>Twisted Happiness Share Debug</title>
</head>

<body style="
  font-family:Arial,sans-serif;
  padding:30px;
  line-height:1.6;
  color:#222;
">

<h1>Twisted Happiness Share Debug</h1>

<p>
  <strong>Status:</strong>
  ${escapeHTML(stage)}
</p>

<p>
  <strong>Product ID:</strong><br>
  ${escapeHTML(productId)}
</p>

<p>
  <strong>Details:</strong><br>
  ${escapeHTML(details)}
</p>

${
  product
    ? `
<p>
  <strong>Product:</strong><br>
  ${escapeHTML(product.title || '')}
</p>

<p>
  <strong>Images field type:</strong><br>
  ${escapeHTML(typeof product.images)}
</p>

<pre style="
  background:#f5f5f5;
  padding:15px;
  overflow:auto;
">${escapeHTML(
  JSON.stringify(product.images, null, 2)
)}</pre>
`
    : ''
}

${
  image
    ? `
<p>
  <strong>Resolved image URL:</strong>
</p>

<p>
<a
  href="${escapeHTML(image)}"
  target="_blank"
  rel="noopener"
>
${escapeHTML(image)}
</a>
</p>

<img
  src="${escapeHTML(image)}"
  alt="Product image"
  style="
    display:block;
    width:100%;
    max-width:700px;
    height:auto;
    margin-top:20px;
  "
>
`
    : ''
}

<p>
<a href="${escapeHTML(productURL)}">
  View normal product page
</a>
</p>

</body>
</html>`;
}

function buildOGPage({
  title,
  description,
  image,
  productURL,
  imageType
}) {
  return `<!doctype html>
<html lang="en">

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<meta
  property="og:type"
  content="product"
>

<meta
  property="og:site_name"
  content="Twisted Happiness"
>

<meta
  property="og:title"
  content="${escapeHTML(title)}"
>

<meta
  property="og:description"
  content="${escapeHTML(description)}"
>

<meta
  property="og:url"
  content="${escapeHTML(productURL)}"
>

<meta
  property="og:image"
  content="${escapeHTML(image)}"
>

<meta
  property="og:image:secure_url"
  content="${escapeHTML(image)}"
>

<meta
  property="og:image:type"
  content="${escapeHTML(imageType)}"
>

<meta
  property="og:image:width"
  content="1200"
>

<meta
  property="og:image:height"
  content="630"
>

<meta
  property="og:image:alt"
  content="${escapeHTML(title)}"
>

<meta
  name="twitter:card"
  content="summary_large_image"
>

<meta
  name="twitter:title"
  content="${escapeHTML(title)}"
>

<meta
  name="twitter:description"
  content="${escapeHTML(description)}"
>

<meta
  name="twitter:image"
  content="${escapeHTML(image)}"
>

<meta
  name="twitter:image:alt"
  content="${escapeHTML(title)}"
>

<link
  rel="canonical"
  href="${escapeHTML(productURL)}"
>

<title>
${escapeHTML(title)} | Twisted Happiness
</title>

</head>

<body>

<p>
<a href="${escapeHTML(productURL)}">
View ${escapeHTML(title)}
</a>
</p>

<script>
setTimeout(function () {
  window.location.replace(
    ${JSON.stringify(productURL)}
  );
}, 500);
</script>

</body>

</html>`;
}

export default async function handler(req, res) {

  const requestURL = new URL(
    req.url,
    `https://${req.headers.host}`
  );

  const productId =
    getProductId(req);

  const productURL =
    `${requestURL.origin}/product.html?pid=${encodeURIComponent(
      productId
    )}`;

  /*
   * Verify environment configuration.
   */

  if (!SUPABASE_ANON_KEY) {

    sendHTML(
      res,
      500,
      debugPage({
        productId,
        stage:
          'FAILED — SUPABASE_ANON_KEY IS MISSING',
        details:
          'Add SUPABASE_ANON_KEY to the Vercel project Environment Variables and redeploy.',
        productURL
      })
    );

    return;
  }

  /*
   * Validate product ID.
   */

  if (!productId) {

    sendHTML(
      res,
      400,
      debugPage({
        productId: '',
        stage:
          'FAILED — PRODUCT ID MISSING',
        details:
          'No pid parameter was supplied.',
        productURL
      })
    );

    return;
  }

  if (!isUUID(productId)) {

    sendHTML(
      res,
      400,
      debugPage({
        productId,
        stage:
          'FAILED — INVALID PRODUCT UUID',
        details:
          'The supplied pid is not a valid UUID.',
        productURL
      })
    );

    return;
  }

  try {

    /*
     * Fetch product directly from Supabase REST API.
     */

    const endpoint =
      new URL(
        `${SUPABASE_URL}/rest/v1/products`
      );

    endpoint.searchParams.set(
      'select',
      'id,title,description,images,actual_price,main_category,sub_category,is_active'
    );

    endpoint.searchParams.set(
      'id',
      `eq.${productId}`
    );

    endpoint.searchParams.set(
      'limit',
      '1'
    );

    const response =
      await fetch(
        endpoint.toString(),
        {
          method: 'GET',

          headers: {
            apikey:
              SUPABASE_ANON_KEY,

            Authorization:
              `Bearer ${SUPABASE_ANON_KEY}`,

            Accept:
              'application/json'
          }
        }
      );

    if (!response.ok) {

      const errorText =
        await response.text();

      sendHTML(
        res,
        500,
        debugPage({
          productId,
          stage:
            'FAILED — SUPABASE REQUEST',
          details:
            `Supabase returned HTTP ${response.status}: ${errorText}`,
          productURL
        })
      );

      return;
    }

    const rows =
      await response.json();

    /*
     * Product must exist.
     */

    if (
      !Array.isArray(rows) ||
      rows.length === 0
    ) {

      sendHTML(
        res,
        404,
        debugPage({
          productId,
          stage:
            'FAILED — PRODUCT NOT FOUND',
          details:
            'Supabase returned zero rows for this product UUID.',
          productURL
        })
      );

      return;
    }

    const product =
      rows[0];

    /*
     * Extract images.
     */

    const images =
      parseImages(product.images);

    const resolvedImages =
      images
        .map(normaliseImageURL)
        .filter(Boolean);

    if (
      resolvedImages.length === 0
    ) {

      sendHTML(
        res,
        500,
        debugPage({
          productId,
          stage:
            'FAILED — NO VALID PRODUCT IMAGE',
          details:
            'The product exists, but its images field does not contain a valid HTTP/HTTPS image URL.',
          productURL,
          product
        })
      );

      return;
    }

    /*
     * First product image becomes OG image.
     */

    const productImage =
      resolvedImages[0];

    /*
     * Verify the image is publicly accessible.
     */

    let imageResponse;

    try {

      imageResponse =
        await fetch(
          productImage,
          {
            method: 'HEAD'
          }
        );

    } catch (imageError) {

      sendHTML(
        res,
        500,
        debugPage({
          productId,
          stage:
            'FAILED — VERCEL CANNOT FETCH IMAGE',
          details:
            imageError.message ||
            String(imageError),
          productURL,
          product,
          image: productImage
        })
      );

      return;
    }

    if (
      !imageResponse.ok
    ) {

      /*
       * Some storage/CDN servers don't support HEAD.
       *
       * Try GET before declaring failure.
       */

      try {

        imageResponse =
          await fetch(
            productImage,
            {
              method: 'GET',
              headers: {
                Range: 'bytes=0-1023'
              }
            }
          );

      } catch (imageError) {

        sendHTML(
          res,
          500,
          debugPage({
            productId,
            stage:
              'FAILED — PRODUCT IMAGE NOT PUBLICLY ACCESSIBLE',
            details:
              imageError.message ||
              String(imageError),
            productURL,
            product,
            image: productImage
          })
        );

        return;
      }
    }

    if (
      !imageResponse.ok
    ) {

      sendHTML(
        res,
        500,
        debugPage({
          productId,
          stage:
            'FAILED — PRODUCT IMAGE RETURNED HTTP ERROR',
          details:
            `Image URL returned HTTP ${imageResponse.status}.`,
          productURL,
          product,
          image: productImage
        })
      );

      return;
    }

    /*
     * Everything succeeded.
     */

    const title =
      cleanText(product.title) ||
      'Twisted Happiness Product';

    const description =
      cleanText(product.description) ||
      'A handcrafted creation by Twisted Happiness.';

    const contentType =
      imageResponse.headers.get(
        'content-type'
      ) || 'image/jpeg';

    const imageType =
      contentType.startsWith('image/')
        ? contentType
        : 'image/jpeg';

    const html =
      buildOGPage({
        title,
        description,
        image: productImage,
        productURL,
        imageType
      });

    sendHTML(
      res,
      200,
      html
    );

  } catch (error) {

    sendHTML(
      res,
      500,
      debugPage({
        productId,
        stage:
          'FAILED — UNEXPECTED SERVER ERROR',
        details:
          error.message ||
          String(error),
        productURL
      })
    );
  }
}