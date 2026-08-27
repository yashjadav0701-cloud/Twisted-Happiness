export default async function handler(req, res) {
  const { pid } = req.query;
  const siteUrl = 'https://twistedhappiness.in';

  if (!pid) return res.redirect(302, '/');

  try {
    // 1. Fetch minimal product data via Supabase REST API (fastest method)
    const supabaseUrl = 'https://jlszvfevobpqqrmmjzpp.supabase.co';
    const anonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsc3p2ZmV2b2JwcXFybW1qenBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MzMwMTYsImV4cCI6MjEwMDMwOTAxNn0.WsaLFBk365cSO-nj2tezcLEtbxwKGm3YwZK1_eWoBmE';
    
    const response = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${pid}&select=id,title,description,images`, {
      headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}` }
    });
    
    const products = await response.json();
    const product = products[0];

    if (!product) return res.redirect(302, '/');

    // 2. Format Metadata
    const title = `${product.title} | Twisted Happiness`;
    const description = (product.description || 'A handcrafted creation by Twisted Happiness.').replace(/\s+/g, ' ').trim().slice(0, 180);
    
    // Attempt to parse Postgres Array format if needed, otherwise use the array directly
    let imageArray = product.images;
    if (typeof imageArray === 'string') {
        try { imageArray = JSON.parse(imageArray.replace('{', '[').replace('}', ']')); } catch (e) { imageArray = []; }
    }
    const image = imageArray?.[0] || `${siteUrl}/assets/share-icon.png?v=2.0`;
    const productUrl = `${siteUrl}/?view=product&pid=${product.id}`;

    // 3. Detect Social Crawlers vs Real Users
    const ua = req.headers['user-agent'] || '';
    const isCrawler = /bot|facebook|whatsapp|telegram|twitter|linkedin|pinterest|slack/i.test(ua.toLowerCase());

    if (isCrawler) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>${title}</title>
          <meta name="description" content="${description}">
          <meta property="og:type" content="product">
          <meta property="og:url" content="${productUrl}">
          <meta property="og:title" content="${title}">
          <meta property="og:description" content="${description}">
          <meta property="og:image" content="${image}">
          <meta name="twitter:card" content="summary_large_image">
          <meta name="twitter:title" content="${title}">
          <meta name="twitter:description" content="${description}">
          <meta name="twitter:image" content="${image}">
        </head>
        <body><p>Redirecting to <a href="${productUrl}">${title}</a>...</p></body>
        </html>
      `);
    } else {
      // It's a real user on a browser, bounce them instantly to the client-side app
      return res.redirect(302, productUrl);
    }
  } catch (error) {
    return res.redirect(302, '/');
  }
}