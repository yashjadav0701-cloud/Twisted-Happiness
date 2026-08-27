const fs = require('fs');
const path = require('path');

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

module.exports = async function handler(req, res) {
  // Extract product ID robustly across all Vercel invocation methods
  let pid = req.query.pid;
  
  if (!pid && req.url) {
    const urlParts = req.url.split('?')[0].split('/');
    const prodIdx = urlParts.indexOf('product');
    if (prodIdx !== -1 && urlParts[prodIdx + 1]) {
      pid = urlParts[prodIdx + 1];
    } else if (urlParts.includes('share') && req.query.pid) {
      pid = req.query.pid;
    }
  }

  let html = '';
  try {
    html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  } catch (err) {
    return res.status(500).send('Error loading application shell');
  }

  // If no product ID is present, return clean index.html
  if (!pid) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(html);
  }

  const SUPABASE_URL = 'https://jlszvfevobpqqrmmjzpp.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsc3p2ZmV2b2JwcXFybW1qenBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MzMwMTYsImV4cCI6MjEwMDMwOTAxNn0.WsaLFBk365cSO-nj2tezcLEtbxwKGm3YwZK1_eWoBmE';
  
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(pid)}&select=title,description,images`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      const product = data?.[0];

      if (product) {
        const title = escapeHTML((product.title || '') + ' | Twisted Happiness');
        const desc = escapeHTML((product.description || '').replace(/\s+/g, ' ').substring(0, 160));
        const url = escapeHTML(`https://twistedhappiness.vercel.app/product/${encodeURIComponent(pid)}`);
        
        let img = 'https://twistedhappiness.vercel.app/assets/share-icon.png';
        
        let parsedImgs = product.images;
        if (typeof parsedImgs === 'string') {
            try { parsedImgs = JSON.parse(parsedImgs); } catch(e) { parsedImgs = parsedImgs.split(','); }
        }
        if (Array.isArray(parsedImgs) && parsedImgs[0]) {
           const rawImg = String(parsedImgs[0]).trim();
           try {
             const urlObj = new URL(rawImg, 'https://twistedhappiness.vercel.app');
             if (['http:', 'https:'].includes(urlObj.protocol)) {
               img = escapeHTML(urlObj.href);
             }
           } catch(e) {}
        }

        // Inject dynamic metadata into the HTML template for crawlers & human browsers
        html = html
          .replace(/<title>.*?<\/title>/i, `<title>${title}</title>`)
          .replace(/content="Twisted Happiness — Handcrafted Art Studio"/gi, `content="${title}"`)
          .replace(/content="Where creativity comes to life.*?smile\. 💜"/gi, `content="${desc}"`)
          .replace(/content="https:\/\/twistedhappiness\.vercel\.app\/\/assets\/share-icon\.png\?v=mtbne5lx"/gi, `content="${img}"`)
          .replace(/content="https:\/\/twistedhappiness\.vercel\.app\/\/"/gi, `content="${url}"`)
          .replace(/href="https:\/\/twistedhappiness\.vercel\.app\/\/"/gi, `href="${url}"`);
      }
    }
  } catch (e) {
    // Fail silently to standard HTML shell if database errors occur
  }

  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
};