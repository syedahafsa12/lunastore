/**
 * Luna Apparel — tiny merchant server.
 *
 * Serves the existing static storefront AS-IS, plus a small read-only
 * merchant API (products/policies/capabilities) backed by data/products.json
 * and data/policies.json, and one write endpoint (PATCH /api/admin/products/:id)
 * used by admin.html. No framework, no database: this is the single source
 * of truth the storefront, the admin page, and (eventually) an external
 * shopping-agent connector all read from.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PRODUCTS_FILE = path.join(ROOT, 'data', 'products.json');
const POLICIES_FILE = path.join(ROOT, 'data', 'policies.json');
const PORT = process.env.PORT || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

function publicProduct(p, policies) {
  // Wire shape returned to the storefront / agent: derive `inStock` from
  // quantity rather than trusting a possibly-stale `availability` flag, and
  // compute free shipping from the live price against the live policy.
  const inStock = p.availability !== false && p.quantity > 0;
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    currency: 'USD',
    description: p.description,
    material: p.material,
    category: p.category,
    tags: p.tags,
    sizes: p.sizes,
    colors: p.colors,
    featured: !!p.featured,
    quantity: p.quantity,
    inStock,
    availability: inStock ? 'in_stock' : 'out_of_stock',
    shipping: {
      isFree: p.price >= policies.shipping.freeShippingThreshold,
      standardDays: `${policies.shipping.standard.estimatedDaysMin}-${policies.shipping.standard.estimatedDaysMax} business days`,
      expressAvailable: true,
    },
    retrievedAt: new Date().toISOString(),
  };
}

// Wire shape the platform's existing RestMerchantConnector expects
// (src/server/connectors/rest-connector.ts in agentic_commerce) — title
// instead of name, category collapsed to "product", a single representative
// color, and shipping/returns/warranty as separate typed objects. This is
// deliberately a second, narrower view of the same underlying product: the
// richer /api/products (name, colors[], sizes, material, tags) stays the
// storefront/admin's own shape, this is only for plugging into the existing
// typed capability contract without changing it. Material is folded into
// the description text, since that's the field the contract actually
// carries end-to-end to the model.
function agentProductWire(p, policies) {
  const retrievedAt = new Date().toISOString();
  const isFree = p.price >= policies.shipping.freeShippingThreshold;
  return {
    id: p.id,
    title: p.name,
    description: `${p.description} Material: ${p.material}.`,
    category: 'product',
    price: p.price,
    currency: 'USD',
    color: (p.colors && p.colors[0] && p.colors[0].name) || null,
    quantity: p.quantity,
    shipping: {
      isFree,
      cost: isFree ? null : policies.shipping.standard.cost,
      estimatedDays: policies.shipping.standard.estimatedDaysMax,
      available: true,
    },
    returns: {
      windowDays: policies.returns.windowDays,
      isFreeReturns: policies.returns.freeReturns,
      notes: policies.returns.condition,
    },
    warranty: { months: null, notes: 'Not applicable to apparel; covered by the 30-day return policy instead.' },
    retrievedAt,
  };
}

function capabilitiesManifest(origin) {
  return {
    schema: 'agentic-capabilities/0.1',
    store: { name: 'Luna Apparel', origin, category: 'Premium minimalist fashion (DTC)' },
    capabilities: [
      { id: 'search_products', scope: 'catalog:read', risk: 'read', method: 'GET', path: '/api/products',
        description: 'Search the catalog by keyword, category, material, tag, and max price.' },
      { id: 'get_product', scope: 'catalog:read', risk: 'read', method: 'GET', path: '/api/products/{id}',
        description: 'Read full structured details for one product.' },
      { id: 'check_availability', scope: 'inventory:read', risk: 'read', method: 'GET', path: '/api/products/{id}/availability',
        description: 'Check live stock/availability for one product.' },
      { id: 'get_policies', scope: 'policies:read', risk: 'read', method: 'GET', path: '/api/policies',
        description: 'Read shipping, returns, and support policies.' },
      { id: 'get_shipping_info', scope: 'policies:read', risk: 'read', method: 'GET', path: '/api/policies',
        description: 'Read shipping thresholds and delivery windows (subset of get_policies).' },
    ],
  };
}

function matchesFilters(p, { query, category, material, tag, maxPrice, inStockOnly }) {
  if (category && p.category !== category) return false;
  if (material && !p.material.toLowerCase().includes(material.toLowerCase())) return false;
  if (tag && !(p.tags || []).some((t) => t.toLowerCase() === tag.toLowerCase())) return false;
  if (maxPrice !== null && p.price > maxPrice) return false;
  if (inStockOnly && !(p.availability !== false && p.quantity > 0)) return false;
  if (query) {
    const q = query.toLowerCase();
    const haystack = `${p.name} ${p.description} ${p.material} ${p.category} ${(p.tags || []).join(' ')}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(ROOT, decodeURIComponent(filePath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;
  const origin = `${url.protocol}//${url.host}`;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PATCH,OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
    });
    return res.end();
  }

  // --- Read-only merchant capability API ---
  if (pathname === '/api/capabilities' && req.method === 'GET') {
    return sendJson(res, 200, capabilitiesManifest(origin));
  }

  if (pathname === '/api/policies' && req.method === 'GET') {
    return sendJson(res, 200, readJson(POLICIES_FILE));
  }

  if (pathname === '/api/products' && req.method === 'GET') {
    const products = readJson(PRODUCTS_FILE);
    const policies = readJson(POLICIES_FILE);
    const filters = {
      query: url.searchParams.get('query'),
      category: url.searchParams.get('category'),
      material: url.searchParams.get('material'),
      tag: url.searchParams.get('tag'),
      maxPrice: url.searchParams.has('maxPrice') ? Number(url.searchParams.get('maxPrice')) : null,
      inStockOnly: url.searchParams.get('inStock') === 'true',
    };
    const items = products.filter((p) => matchesFilters(p, filters)).map((p) => publicProduct(p, policies));
    return sendJson(res, 200, { products: items });
  }

  const productIdMatch = pathname.match(/^\/api\/products\/([^/]+)(\/availability)?$/);
  if (productIdMatch && req.method === 'GET') {
    const [, id, availabilitySuffix] = productIdMatch;
    const products = readJson(PRODUCTS_FILE);
    const policies = readJson(POLICIES_FILE);
    const item = products.find((p) => p.id === id);
    if (!item) return sendJson(res, 404, { error: `product ${id} not found` });
    const wire = publicProduct(item, policies);
    if (availabilitySuffix) {
      return sendJson(res, 200, { id: wire.id, inStock: wire.inStock, quantity: wire.quantity, availability: wire.availability, retrievedAt: wire.retrievedAt });
    }
    return sendJson(res, 200, wire);
  }

  // --- Agent-facing adapter: matches RestMerchantConnector's wire contract ---
  if (pathname === '/api/agent/products' && req.method === 'GET') {
    const products = readJson(PRODUCTS_FILE);
    const policies = readJson(POLICIES_FILE);
    const query = (url.searchParams.get('query') || '').toLowerCase();
    const items = products
      .filter((p) => !query || `${p.name} ${p.category} ${(p.tags || []).join(' ')}`.toLowerCase().includes(query))
      .map((p) => agentProductWire(p, policies));
    return sendJson(res, 200, { products: items });
  }

  const agentSubMatch = pathname.match(/^\/api\/agent\/products\/([^/]+)(?:\/(inventory|shipping|returns|warranty))?$/);
  if (agentSubMatch && req.method === 'GET') {
    const [, id, sub] = agentSubMatch;
    const products = readJson(PRODUCTS_FILE);
    const policies = readJson(POLICIES_FILE);
    const item = products.find((p) => p.id === id);
    if (!item) return sendJson(res, 404, { error: `product ${id} not found` });
    const wire = agentProductWire(item, policies);
    if (sub === 'inventory') return sendJson(res, 200, { inStock: wire.quantity > 0, quantity: wire.quantity, retrievedAt: wire.retrievedAt });
    if (sub === 'shipping') return sendJson(res, 200, wire.shipping);
    if (sub === 'returns') return sendJson(res, 200, wire.returns);
    if (sub === 'warranty') return sendJson(res, 200, wire.warranty);
    return sendJson(res, 200, wire);
  }

  // --- Merchant admin (local prototype control panel) ---
  if (pathname === '/api/admin/products' && req.method === 'GET') {
    return sendJson(res, 200, { products: readJson(PRODUCTS_FILE) });
  }

  const adminIdMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (adminIdMatch && req.method === 'PATCH') {
    const [, id] = adminIdMatch;
    const products = readJson(PRODUCTS_FILE);
    const idx = products.findIndex((p) => p.id === id);
    if (idx === -1) return sendJson(res, 404, { error: `product ${id} not found` });
    let patch;
    try { patch = await readBody(req); } catch { return sendJson(res, 400, { error: 'invalid JSON body' }); }
    const allowed = ['price', 'quantity', 'availability', 'material', 'category'];
    for (const key of allowed) {
      if (key in patch) products[idx][key] = patch[key];
    }
    // Keep availability and quantity consistent unless the merchant explicitly
    // forces availability while quantity is 0 (e.g. "available to pre-order").
    if ('quantity' in patch && !('availability' in patch)) {
      products[idx].availability = products[idx].quantity > 0;
    }
    writeJson(PRODUCTS_FILE, products);
    const policies = readJson(POLICIES_FILE);
    return sendJson(res, 200, publicProduct(products[idx], policies));
  }

  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, { error: 'not found' });
  }

  return serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Luna Apparel server running at http://localhost:${PORT}`);
});
