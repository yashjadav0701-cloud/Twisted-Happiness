export default async function handler(req, res) {
  const { pid } = req.query;
  const siteUrl = 'https://twistedhappiness.in';

  // Fallback for missing PIDs
  if (!pid) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(`<script>window.location.replace('/');</script>`);
  }

  try {
    const supabaseUrl = 'https://jlszvfevobpqqrmmjzpp.supabase.co';
    const anonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsc3p2ZmV2b2JwcXFybW1qenBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MzMwMTYsImV4cCI6MjEwMDMwOTAxNn0.WsaLFBk365cSO-nj2tezcLEtbxwKGm3YwZK1_eWoBmE';
    
    const response = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${pid}&select=id,title,description,images`, {
      headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}` }
    });
    
    const products = await response.json();
    const product = products[0];

    // Fallback if product doesn't exist
    if (!product) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(`<script>window.location.replace('/');</script>`);
    }

    const title = `${product.title} | Twisted Happiness`;
    const description = (product.description || 'A handcrafted creation by Twisted Happiness.').replace(/\s+/g, ' ').trim().slice(0, 180);
    
    let imageArray = product.images;
    if (typeof imageArray === 'string') {
        try { imageArray = JSON.parse(imageArray.replace('{', '[').replace('}', ']')); } catch (e) { imageArray = []; }
    }
    
    const image = imageArray?.[0] || `${siteUrl}/assets/share-icon.png?v=mtbkw1n3`;
    const productUrl = `${siteUrl}/?view=product&pid=${product.id}`;

    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <meta name="description" content="${description}">
        
        <!-- Open Graph / WhatsApp / Facebook -->
        <meta property="og:type" content="product">
        <meta property="og:site_name" content="Twisted Happiness">
        <meta property="og:url" content="${productUrl}">
        <meta property="og:title" content="${title}">
        <meta property="og:description" content="${description}">
        <meta property="og:image" content="${image}">
        
        <!-- Twitter -->
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="${title}">
        <meta name="twitter:description" content="${description}">
        <meta name="twitter:image" content="${image}">
        
        <script>
          // Instantly redirect real users. Crawlers will ignore this and read the tags above.
          window.location.replace("${productUrl}");
        </script>
      </head>
      <body style="background:#fcf7f8; font-family:sans-serif; text-align:center; padding:2rem; color:#4A3B42;">
        <p>Opening ${title}...</p>
        <p style="font-size: 0.85rem; color:#9C8C94;">If you are not redirected automatically, <a href="${productUrl}" style="color:#C58B9E;">click here</a>.</p>
      </body>
      </html>
    `);
  } catch (error) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(`<script>window.location.replace('/');</script>`);
  }
}