import { createClient } from '@supabase/supabase-js';

export default async function sitemap() {
  const baseUrl = 'https://twistedhappiness.vercel.app';
  
  // 1. Initialize Supabase client
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL, 
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  
  // 2. Fetch all active products from your catalog
  // Adjust 'products', 'slug', and 'updated_at' to match your actual schema
  const { data: products } = await supabase
    .from('products')
    .select('slug, updated_at')
    .eq('is_active', true); 

  // 3. Map the database rows to the sitemap format
  const dynamicProductUrls = products?.map((product) => ({
    url: `${baseUrl}/products/${product.slug}`,
    lastModified: new Date(product.updated_at),
    changeFrequency: 'weekly',
    priority: 0.8,
  })) || [];

  // 4. Define your static, hardcoded routes
  const staticUrls = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0, // Highest priority for the homepage
    },
    {
      url: `${baseUrl}/about`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    }
  ];

  // 5. Combine and return the array
  return [...staticUrls, ...dynamicProductUrls];
}