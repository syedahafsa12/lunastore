/**
 * Luna Apparel Storefront Application Logic
 * Implements: hash router, cart state, checkout flow, order database (pre-seeded with TEST12345), and UI rendering
 */

(function () {
  'use strict';

  // --- Product Catalog ---
  // Single source of truth is data/products.json, served live via
  // GET /api/products (see server.js). The merchant admin (admin.html)
  // edits that same file, so a price/stock change there is reflected here
  // on next load without touching this file. `products` starts empty and
  // is populated by loadProducts() before the first router() render.
  let products = [];

  async function loadProducts() {
    try {
      const res = await fetch('/api/products');
      const data = await res.json();
      products = (data.products || []).map((p) => ({ ...p, quantity: p.quantity }));
    } catch (err) {
      console.error('Luna Apparel: could not load live product data from /api/products', err);
      products = [];
    }
  }

  // --- Local Database States ---
  let cart = JSON.parse(localStorage.getItem('luna_cart')) || [];
  let orders = JSON.parse(localStorage.getItem('luna_orders')) || [];

  // Seed the standard test order for tResolv widget simulation compatibility
  const seedOrderNum = 'TEST12345';
  const seedEmail = 'test@hafsa.com';
  if (!orders.some(o => o.orderNumber === seedOrderNum)) {
    orders.push({
      orderNumber: seedOrderNum,
      email: seedEmail,
      customerName: 'Sarah Mitchell',
      date: 'August 20, 2026',
      status: 'Processing',
      items: [
        { id: 'premium-hoodie-v23', name: 'Premium Hoodie V23', size: 'M', color: 'Oatmeal Beige', qty: 1, price: 88.00 },
        { id: 'relaxed-cotton-tee', name: 'Relaxed Cotton Tee', size: 'L', color: 'Off-White', qty: 1, price: 45.00 }
      ],
      subtotal: 133.00,
      shipping: 0.00,
      total: 133.00,
      shippingAddress: {
        address1: '123 Editorial Way',
        address2: 'Suite 100',
        city: 'New York',
        state: 'NY',
        zip: '10001',
        country: 'United States'
      },
      trackingNumber: 'LN-77492819',
      trackingUrl: 'https://track.lunaapparel.com/LN-77492819'
    });
    localStorage.setItem('luna_orders', JSON.stringify(orders));
  }

  // --- Utility Helpers ---
  function formatMoney(amount) {
    return '$' + amount.toFixed(2);
  }

  // --- Cart State Actions ---
  function saveCart() {
    localStorage.setItem('luna_cart', JSON.stringify(cart));
    updateCartUI();
  }

  function addToCart(productId, size, colorName, qty = 1) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const existingIndex = cart.findIndex(
      item => item.id === productId && item.size === size && item.color === colorName
    );

    if (existingIndex > -1) {
      cart[existingIndex].qty += qty;
    } else {
      cart.push({
        id: productId,
        name: product.name,
        price: product.price,
        image: product.colors.find(c => c.name === colorName).image,
        size: size,
        color: colorName,
        qty: qty
      });
    }
    saveCart();
    openCartDrawer();
  }

  function updateCartQty(productId, size, colorName, qty) {
    const itemIndex = cart.findIndex(
      item => item.id === productId && item.size === size && item.color === colorName
    );
    if (itemIndex > -1) {
      if (qty <= 0) {
        cart.splice(itemIndex, 1);
      } else {
        cart[itemIndex].qty = qty;
      }
      saveCart();
    }
  }

  function removeFromCart(productId, size, colorName) {
    cart = cart.filter(
      item => !(item.id === productId && item.size === size && item.color === colorName)
    );
    saveCart();
  }

  function clearCart() {
    cart = [];
    saveCart();
  }

  function getCartSubtotal() {
    return cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  }

  // --- Cart UI Sync ---
  function updateCartUI() {
    const countBadge = document.getElementById('cart-count');
    const drawerCount = document.getElementById('cart-drawer-count');
    const itemsContainer = document.getElementById('cart-drawer-items');
    const subtotalLabel = document.getElementById('cart-drawer-subtotal');
    const checkoutBtn = document.getElementById('cart-checkout-btn');

    const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
    if (countBadge) {
      countBadge.textContent = totalQty;
      countBadge.style.display = totalQty > 0 ? 'flex' : 'none';
    }
    if (drawerCount) {
      drawerCount.textContent = `(${totalQty})`;
    }

    if (!itemsContainer) return;

    if (cart.length === 0) {
      itemsContainer.innerHTML = `
        <div class="empty-cart-message">
          <p>Your cart is empty.</p>
          <a href="#shop" class="btn btn-primary" onclick="closeCartDrawer()">Shop the Collection</a>
        </div>
      `;
      if (subtotalLabel) subtotalLabel.textContent = formatMoney(0);
      if (checkoutBtn) checkoutBtn.disabled = true;
      return;
    }

    if (checkoutBtn) checkoutBtn.disabled = false;
    itemsContainer.innerHTML = '';

    cart.forEach(item => {
      const itemRow = document.createElement('div');
      itemRow.className = 'cart-item-row';
      itemRow.innerHTML = `
        <img src="${item.image}" alt="${item.name}" class="cart-item-image">
        <div class="cart-item-details">
          <div class="cart-item-meta-top">
            <h4 class="cart-item-title">${item.name}</h4>
            <button class="cart-item-remove" data-id="${item.id}" data-size="${item.size}" data-color="${item.color}">✕</button>
          </div>
          <p class="cart-item-variants">${item.color} / ${item.size}</p>
          <div class="cart-item-qty-price">
            <div class="quantity-selector small">
              <button class="qty-btn dec" data-id="${item.id}" data-size="${item.size}" data-color="${item.color}">-</button>
              <input type="number" class="qty-val" value="${item.qty}" min="1" readonly>
              <button class="qty-btn inc" data-id="${item.id}" data-size="${item.size}" data-color="${item.color}">+</button>
            </div>
            <span class="cart-item-price">${formatMoney(item.price * item.qty)}</span>
          </div>
        </div>
      `;
      itemsContainer.appendChild(itemRow);
    });

    if (subtotalLabel) {
      subtotalLabel.textContent = formatMoney(getCartSubtotal());
    }

    // Set up listeners for quantity adjust and remove
    itemsContainer.querySelectorAll('.qty-btn.dec').forEach(btn => {
      btn.onclick = function () {
        const id = this.dataset.id;
        const size = this.dataset.size;
        const color = this.dataset.color;
        const item = cart.find(i => i.id === id && i.size === size && i.color === color);
        if (item) updateCartQty(id, size, color, item.qty - 1);
      };
    });

    itemsContainer.querySelectorAll('.qty-btn.inc').forEach(btn => {
      btn.onclick = function () {
        const id = this.dataset.id;
        const size = this.dataset.size;
        const color = this.dataset.color;
        const item = cart.find(i => i.id === id && i.size === size && i.color === color);
        if (item) updateCartQty(id, size, color, item.qty + 1);
      };
    });

    itemsContainer.querySelectorAll('.cart-item-remove').forEach(btn => {
      btn.onclick = function () {
        removeFromCart(this.dataset.id, this.dataset.size, this.dataset.color);
      };
    });
  }

  function openCartDrawer() {
    const drawer = document.getElementById('cart-drawer');
    const overlay = document.getElementById('drawer-overlay');
    if (drawer && overlay) {
      drawer.classList.add('open');
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeCartDrawer() {
    const drawer = document.getElementById('cart-drawer');
    const overlay = document.getElementById('drawer-overlay');
    if (drawer && overlay) {
      drawer.classList.remove('open');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }
  }

  // --- Router & Views ---
  const views = {
    home: function () {
      const featuredProducts = products.filter(p => p.featured);
      let featuredHtml = '';

      featuredProducts.forEach(product => {
        const defaultColor = product.colors[0];
        featuredHtml += `
          <div class="product-card" onclick="window.location.hash = '#product?id=${product.id}'">
            <div class="product-card-image-wrap">
              <img src="${defaultColor.image}" alt="${product.name}" class="product-card-image" id="card-img-${product.id}">
              <span class="product-card-badge">Essential</span>
            </div>
            <div class="product-card-details">
              <h3 class="product-card-title">${product.name}</h3>
              <p class="product-card-price">${formatMoney(product.price)}</p>
              <div class="product-card-colors">
                ${product.colors.map((c, index) => `
                  <span class="color-swatch ${index === 0 ? 'active' : ''}" 
                        style="background-color: ${c.hex};" 
                        title="${c.name}"
                        onclick="event.stopPropagation(); changeCardColor('${product.id}', '${c.image}', '${c.name}', this)">
                  </span>
                `).join('')}
              </div>
            </div>
          </div>
        `;
      });

      return `
        <!-- Hero Section -->
        <section class="hero-section">
          <div class="hero-image-container">
            <img src="assets/couple-hero.png" alt="Luna Apparel Collection" class="hero-image">
          </div>
          <div class="hero-content">
            <span class="hero-tagline">FW / 26 Collection</span>
            <h1 class="hero-title">Refined Comfort.</h1>
            <p class="hero-subtitle">Artisan-crafted staples designed to complement a minimalist lifestyle. Ethically sourced, thoughtfully engineered.</p>
            <div class="hero-buttons">
              <a href="#shop" class="btn btn-primary">Shop the Collection</a>
              <a href="#shop?category=outerwear" class="btn btn-secondary">Explore Outerwear</a>
            </div>
          </div>
        </section>

        <!-- Brand Highlights -->
        <section class="highlights-section container">
          <div class="highlight-item">
            <span class="highlight-icon">🌱</span>
            <h3 class="highlight-title">Ethical Sourcing</h3>
            <p class="highlight-text">We use 100% GOTS-certified organic cotton and European flax linen.</p>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">📐</span>
            <h3 class="highlight-title">Crafted for Longevity</h3>
            <p class="highlight-text">Heavyweight knits, double-stitched seams, and meticulous quality control.</p>
          </div>
          <div class="highlight-item">
            <span class="highlight-icon">✨</span>
            <h3 class="highlight-title">Minimalist Design</h3>
            <p class="highlight-text">Neutral palettes and timeless silhouettes that effortlessly layer.</p>
          </div>
        </section>

        <!-- Curated Grid -->
        <section class="featured-section container">
          <div class="section-header">
            <h2 class="section-title">Curated Essentials</h2>
            <a href="#shop" class="section-link">View All Products →</a>
          </div>
          <div class="products-grid">
            ${featuredHtml}
          </div>
        </section>

        <!-- Editorial Spotlight -->
        <section class="editorial-spotlight container">
          <div class="editorial-grid">
            <div class="editorial-image-column">
              <img src="assets/lounge-set.png" alt="Ribbed Lounge Set detail" class="editorial-image">
            </div>
            <div class="editorial-content-column">
              <span class="editorial-label">Material Spotlight</span>
              <h2 class="editorial-title">Pima Cotton & Organic Flax Linen</h2>
              <p class="editorial-text">Our knitwear is spun from pure Pima cotton fibres for a silk-like touch, while our linen garments are crafted from organically harvested Belgian flax, garment-dyed for a broken-in softness from day one.</p>
              <p class="editorial-text">Designed to breathe, hang beautifully, and handle years of regular wear without losing structure.</p>
              <a href="#shop" class="btn btn-outline" style="margin-top: 15px;">Read the Source Book</a>
            </div>
          </div>
        </section>

        <!-- Newsletter -->
        <section class="newsletter-section">
          <div class="newsletter-content container">
            <h2 class="newsletter-title">Subscribe to the Studio</h2>
            <p class="newsletter-subtitle">Receive seasonal lookbooks, early product drops, and editorial features. No spam.</p>
            <form class="newsletter-form" onsubmit="event.preventDefault(); alert('Thank you for subscribing to Luna Apparel.'); this.reset();">
              <input type="email" placeholder="Enter your email address" required class="newsletter-input">
              <button type="submit" class="btn btn-primary">Join</button>
            </form>
          </div>
        </section>
      `;
    },
    shop: function (params) {
      const activeCategory = params.category || 'all';
      const activeSort = params.sort || 'featured';
      let filteredProducts = products;

      if (activeCategory !== 'all') {
        filteredProducts = products.filter(p => p.category === activeCategory);
      }

      filteredProducts = [...filteredProducts];
      if (activeSort === 'price-asc') filteredProducts.sort((a, b) => a.price - b.price);
      else if (activeSort === 'price-desc') filteredProducts.sort((a, b) => b.price - a.price);
      else filteredProducts.sort((a, b) => (b.featured === true) - (a.featured === true));

      let gridHtml = '';
      if (filteredProducts.length === 0) {
        gridHtml = '<p class="no-products">No products found in this category.</p>';
      } else {
        filteredProducts.forEach(product => {
          const defaultColor = product.colors[0];
          gridHtml += `
            <div class="product-card" onclick="window.location.hash = '#product?id=${product.id}'">
              <div class="product-card-image-wrap">
                <img src="${defaultColor.image}" alt="${product.name}" class="product-card-image" id="card-img-${product.id}">
              </div>
              <div class="product-card-details">
                <h3 class="product-card-title">${product.name}</h3>
                <p class="product-card-price">${formatMoney(product.price)}</p>
                <div class="product-card-colors">
                  ${product.colors.map((c, index) => `
                    <span class="color-swatch ${index === 0 ? 'active' : ''}" 
                          style="background-color: ${c.hex};" 
                          title="${c.name}"
                          onclick="event.stopPropagation(); changeCardColor('${product.id}', '${c.image}', '${c.name}', this)">
                    </span>
                  `).join('')}
                </div>
              </div>
            </div>
          `;
        });
      }

      const categories = [
        { id: 'all', name: 'All Collection' },
        { id: 'outerwear', name: 'Outerwear' },
        { id: 'shirts', name: 'Shirts' },
        { id: 'basics', name: 'Basics' },
        { id: 'sets', name: 'Sets' }
      ];

      return `
        <div class="page-header container">
          <nav class="breadcrumb"><a href="#home">Home</a> / <span>Shop</span></nav>
          <h1 class="page-title">Shop Collection</h1>
        </div>

        <section class="shop-container container">
          <!-- Filters & Sidebar -->
          <div class="shop-layout">
            <div class="shop-sidebar">
              <h3 class="sidebar-heading">Categories</h3>
              <ul class="category-filters">
                ${categories.map(c => `
                  <li>
                    <a href="#shop?category=${c.id}" class="filter-link ${activeCategory === c.id ? 'active' : ''}">
                      ${c.name}
                    </a>
                  </li>
                `).join('')}
              </ul>

              <div class="sidebar-info-card">
                <h4>Need Help?</h4>
                <p>Use the chat bubble in the corner to track, cancel, or ask about any order.</p>
              </div>
            </div>

            <!-- Product Grid Column -->
            <div class="shop-grid-container">
              <div class="grid-toolbar">
                <span class="product-count">${filteredProducts.length} items</span>
                <select class="grid-sort" onchange="window.location.hash = '#shop?category=${activeCategory}&sort=' + event.target.value;">
                  <option value="featured" ${activeSort === 'featured' ? 'selected' : ''}>Featured</option>
                  <option value="price-asc" ${activeSort === 'price-asc' ? 'selected' : ''}>Price: Low to High</option>
                  <option value="price-desc" ${activeSort === 'price-desc' ? 'selected' : ''}>Price: High to Low</option>
                </select>
              </div>
              <div class="products-grid">
                ${gridHtml}
              </div>
            </div>
          </div>
        </section>
      `;
    },
    product: function (params) {
      const productId = params.id;
      const product = products.find(p => p.id === productId);

      if (!product) {
        return `
          <div class="container error-view" style="padding: 100px 20px; text-align: center;">
            <h2>Product Not Found</h2>
            <p>The product you are looking for does not exist in our catalog.</p>
            <a href="#shop" class="btn btn-primary" style="margin-top: 20px;">Back to Shop</a>
          </div>
        `;
      }

      // Default details
      const defaultColor = product.colors[0];

      return `
        <div class="page-header container" style="padding-bottom: 0;">
          <nav class="breadcrumb">
            <a href="#home">Home</a> / <a href="#shop">Shop</a> / <span>${product.name}</span>
          </nav>
        </div>

        <section class="product-detail container">
          <div class="product-detail-grid">
            
            <!-- Left Column: Gallery -->
            <div class="product-gallery">
              <div class="main-image-wrap">
                <img src="${defaultColor.image}" id="product-detail-img" alt="${product.name}" class="product-main-image">
              </div>
              <!-- Thumbnails -->
              <div class="thumbnail-row">
                ${product.colors.map((c, i) => `
                  <div class="thumbnail-wrap ${i === 0 ? 'active' : ''}" onclick="changeDetailColor('${c.image}', '${c.name}', this)">
                    <img src="${c.image}" alt="${c.name}">
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- Right Column: Info & Purchase -->
            <div class="product-info-panel">
              <span class="product-tag">${product.category.toUpperCase()}</span>
              <h1 class="product-title">${product.name}</h1>
              <p class="product-price">${formatMoney(product.price)}</p>
              
              <div class="product-divider"></div>

              <p class="product-description">${product.description}</p>

              <form id="add-to-cart-form" onsubmit="event.preventDefault(); handleAddToCartFormSubmit('${product.id}')">
                
                <!-- Color Selector -->
                <div class="selector-group">
                  <span class="selector-label">Color: <strong id="selected-color-name">${defaultColor.name}</strong></span>
                  <div class="color-options-row">
                    ${product.colors.map((c, i) => `
                      <label class="color-option-container">
                        <input type="radio" name="product-color" value="${c.name}" ${i === 0 ? 'checked' : ''} 
                               onchange="changeDetailColor('${c.image}', '${c.name}', null); document.getElementById('selected-color-name').textContent = '${c.name}'">
                        <span class="color-option-swatch" style="background-color: ${c.hex};" title="${c.name}"></span>
                      </label>
                    `).join('')}
                  </div>
                </div>

                <!-- Size Selector -->
                <div class="selector-group">
                  <span class="selector-label">Size: <strong id="selected-size-name">${product.sizes[0]}</strong></span>
                  <div class="size-options-row">
                    ${product.sizes.map((size, i) => `
                      <label class="size-option-container">
                        <input type="radio" name="product-size" value="${size}" ${i === 0 ? 'checked' : ''} 
                               onchange="document.getElementById('selected-size-name').textContent = '${size}'">
                        <span class="size-option-label">${size}</span>
                      </label>
                    `).join('')}
                  </div>
                </div>

                <!-- Quantity and Add Button -->
                <div class="purchase-row" style="margin-top: 30px;">
                  <div class="quantity-selector">
                    <button type="button" class="qty-btn" onclick="adjustProductQty(-1)">-</button>
                    <input type="number" id="product-qty" value="1" min="1" readonly>
                    <button type="button" class="qty-btn" onclick="adjustProductQty(1)">+</button>
                  </div>
                  <button type="submit" class="btn btn-primary add-to-cart-submit">Add to Cart</button>
                </div>

              </form>

              <!-- Collapsible Information Accordion -->
              <div class="accordion-group">
                <details class="accordion-item" open>
                  <summary class="accordion-title">Composition & Details</summary>
                  <div class="accordion-content">
                    <ul>
                      <li>Material: ${product.material}</li>
                      <li>Standard fit designed for clean draping</li>
                      <li>Ethically milled and tailored in certified facilities</li>
                      <li>Maintain quality by washing cold and laying flat to dry</li>
                    </ul>
                  </div>
                </details>
                <details class="accordion-item">
                  <summary class="accordion-title">Shipping & Returns</summary>
                  <div class="accordion-content">
                    <p>Complimentary carbon-neutral standard delivery on orders above $150.</p>
                    <p>Returns and exchanges accepted within 30 days of shipment. Items must be unworn and in original packaging. Use our automated AI support to stage a return or check status instantly.</p>
                  </div>
                </details>
              </div>

            </div>
          </div>
        </section>
      `;
    },
    support: function () {
      return `
        <div class="page-header container">
          <nav class="breadcrumb"><a href="#home">Home</a> / <span>Support Portal</span></nav>
          <h1 class="page-title">Support & Order Lookup</h1>
        </div>

        <section class="support-view container">
          <div class="support-grid">
            
            <!-- Lookup Form Column -->
            <div class="support-form-card">
              <h2 class="support-card-title">Track or Manage Order</h2>
              <p class="support-card-subtitle">Enter your order confirmation number and email address to search details, track status, or cancel an unfulfilled request.</p>
              
              <form id="order-lookup-form" onsubmit="event.preventDefault(); handleOrderLookup();">
                <div class="form-group">
                  <label for="lookup-email">Email Address</label>
                  <input type="email" id="lookup-email" required placeholder="your@email.com" class="form-input">
                </div>
                <div class="form-group">
                  <label for="lookup-order">Order Number</label>
                  <input type="text" id="lookup-order" required placeholder="e.g. LA-48213" class="form-input">
                </div>
                <button type="submit" class="btn btn-primary btn-block">Search Details</button>
              </form>

              <div id="lookup-results" class="lookup-results-wrap" style="display:none">
                <!-- Search details will render dynamically here -->
              </div>
            </div>

            <!-- FAQ & Live chat instructions column -->
            <div class="support-faq-card">
              <h2 class="support-card-title">Frequently Asked Questions</h2>
              
              <div class="accordion-group compact">
                <details class="accordion-item">
                  <summary class="accordion-title">How do I cancel my order?</summary>
                  <div class="accordion-content">
                    <p>Orders that are still in "Processing" status can be cancelled instantly. You can request a cancellation directly through our <strong>Luna AI Support Assistant</strong> in the bottom right corner of the page. Simply state: "I want to cancel my order" and verify your details.</p>
                  </div>
                </details>
                <details class="accordion-item">
                  <summary class="accordion-title">What is your refund policy?</summary>
                  <div class="accordion-content">
                    <p>Refunds are processed back to the original method of payment within 5-7 business days of the returned item reaching our warehouse. For cancellations, refunds are staged immediately.</p>
                  </div>
                </details>
              </div>

              <div class="live-chat-highlight">
                <h4>Need Immediate Help?</h4>
                <p>Click the circular chat icon in the bottom right. <strong>Luna</strong> is active 24/7 to help resolve orders, process returns, and answer sizing queries.</p>
              </div>
            </div>

          </div>
        </section>
      `;
    }
  };

  // --- Inline Swatch Helpers (Homepage & Shop Cards) ---
  window.changeCardColor = function (productId, imgPath, colorName, swatchEl) {
    const cardImg = document.getElementById(`card-img-${productId}`);
    if (cardImg) cardImg.src = imgPath;

    // Toggle active class on swatches of this specific card
    const cardColors = swatchEl.parentElement;
    cardColors.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    swatchEl.classList.add('active');
  };

  // --- Product Detail Helpers ---
  window.changeDetailColor = function (imgPath, colorName, thumbnailEl) {
    const mainImg = document.getElementById('product-detail-img');
    if (mainImg) mainImg.src = imgPath;

    if (thumbnailEl) {
      const container = thumbnailEl.parentElement;
      container.querySelectorAll('.thumbnail-wrap').forEach(w => w.classList.remove('active'));
      thumbnailEl.classList.add('active');

      // Update color radio button to match if available
      const radios = document.getElementsByName('product-color');
      for (let r of radios) {
        if (r.value === colorName) {
          r.checked = true;
          document.getElementById('selected-color-name').textContent = colorName;
          break;
        }
      }
    }
  };

  window.adjustProductQty = function (delta) {
    const input = document.getElementById('product-qty');
    if (input) {
      let val = parseInt(input.value) + delta;
      if (val < 1) val = 1;
      input.value = val;
    }
  };

  window.handleAddToCartFormSubmit = function (productId) {
    const form = document.getElementById('add-to-cart-form');
    if (!form) return;

    const color = form.elements['product-color'].value;
    const size = form.elements['product-size'].value;
    const qty = parseInt(document.getElementById('product-qty').value) || 1;

    addToCart(productId, size, color, qty);
    
    // Reset quantity input to 1
    document.getElementById('product-qty').value = 1;
  };

  // --- Order Lookup Logic ---
  window.handleOrderLookup = function () {
    const emailInput = document.getElementById('lookup-email');
    const orderInput = document.getElementById('lookup-order');
    const resultsDiv = document.getElementById('lookup-results');

    if (!emailInput || !orderInput || !resultsDiv) return;

    const email = emailInput.value.trim().toLowerCase();
    const orderNum = orderInput.value.trim().toUpperCase();

    const matchedOrder = orders.find(
      o => o.orderNumber.toUpperCase() === orderNum && o.email.toLowerCase() === email
    );

    resultsDiv.style.display = 'block';
    resultsDiv.scrollIntoView({ behavior: 'smooth' });

    if (!matchedOrder) {
      resultsDiv.innerHTML = `
        <div class="lookup-error">
          <p>✕ No matching order found with the provided details.</p>
          <span>Please check your order confirmation number and spelling of the email address.</span>
        </div>
      `;
      return;
    }

    // Render beautiful order details
    const itemsHtml = matchedOrder.items.map(item => `
      <div class="lookup-order-item">
        <div>
          <strong>${item.name}</strong>
          <span class="lookup-item-variant">${item.color} / ${item.size} (Qty: ${item.qty})</span>
        </div>
        <span>${formatMoney(item.price * item.qty)}</span>
      </div>
    `).join('');

    let statusClass = 'status-processing';
    if (matchedOrder.status.toLowerCase() === 'shipped' || matchedOrder.status.toLowerCase() === 'fulfilled') statusClass = 'status-shipped';
    if (matchedOrder.status.toLowerCase() === 'cancelled') statusClass = 'status-cancelled';
    if (matchedOrder.status.toLowerCase() === 'refunded') statusClass = 'status-refunded';

    resultsDiv.innerHTML = `
      <div class="lookup-success-card">
        <div class="lookup-header-row">
          <div>
            <h3>Order #${matchedOrder.orderNumber}</h3>
            <span class="lookup-date">Placed on ${matchedOrder.date}</span>
          </div>
          <span class="lookup-status-badge ${statusClass}">${matchedOrder.status}</span>
        </div>
        
        <div class="lookup-divider"></div>
        
        <div class="lookup-items-section">
          <h4>Items Ordered</h4>
          ${itemsHtml}
        </div>

        <div class="lookup-divider"></div>

        <div class="lookup-totals-section">
          <div class="lookup-total-row">
            <span>Subtotal</span>
            <span>${formatMoney(matchedOrder.subtotal)}</span>
          </div>
          <div class="lookup-total-row">
            <span>Shipping</span>
            <span>${matchedOrder.shipping === 0 ? 'Free' : formatMoney(matchedOrder.shipping)}</span>
          </div>
          <div class="lookup-total-row final">
            <span>Total</span>
            <span>${formatMoney(matchedOrder.total)}</span>
          </div>
        </div>

        <div class="lookup-divider"></div>

        <div class="lookup-shipping-section">
          <h4>Shipping Address</h4>
          <p>${matchedOrder.customerName}</p>
          <p>${matchedOrder.shippingAddress.address1}${matchedOrder.shippingAddress.address2 ? ', ' + matchedOrder.shippingAddress.address2 : ''}</p>
          <p>${matchedOrder.shippingAddress.city}, ${matchedOrder.shippingAddress.state} ${matchedOrder.shippingAddress.zip}</p>
          <p>${matchedOrder.shippingAddress.country}</p>
        </div>

        ${matchedOrder.trackingNumber ? `
          <div class="lookup-tracking-box">
            <span>📦 <strong>Tracking:</strong> ${matchedOrder.trackingNumber}</span>
            <a href="${matchedOrder.trackingUrl}" target="_blank" class="tracking-link-btn">Track Package ↗</a>
          </div>
        ` : ''}

        ${matchedOrder.status.toLowerCase() === 'processing' ? `
          <div class="lookup-cancel-box">
            <p>Need to modify or cancel this order?</p>
            <span>Ask our <strong>Luna chatbot</strong> in the bottom right corner to cancel it instantly.</span>
          </div>
        ` : ''}
      </div>
    `;
  };

  // --- Checkout Flow Logic ---
  window.openCheckoutModal = function () {
    if (cart.length === 0) return;
    const modal = document.getElementById('checkout-modal');
    const overlay = document.getElementById('modal-overlay');
    const totalLabel = document.getElementById('checkout-modal-total');

    if (modal && overlay) {
      if (totalLabel) totalLabel.textContent = formatMoney(getCartSubtotal());
      modal.classList.add('open');
      overlay.classList.add('open');
      closeCartDrawer();
      document.body.style.overflow = 'hidden';
    }
  };

  window.closeCheckoutModal = function () {
    const modal = document.getElementById('checkout-modal');
    const overlay = document.getElementById('modal-overlay');
    if (modal && overlay) {
      modal.classList.remove('open');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      // Clear form
      document.getElementById('checkout-form').reset();
    }
  };

  window.handleCheckoutSubmit = function (event) {
    event.preventDefault();
    const form = document.getElementById('checkout-form');
    if (!form) return;

    // Collect data
    const email = form.elements['checkout-email'].value.trim();
    const name = form.elements['checkout-name'].value.trim();
    const address = form.elements['checkout-address'].value.trim();
    const city = form.elements['checkout-city'].value.trim();
    const zip = form.elements['checkout-zip'].value.trim();

    // Create unique order number
    const randNum = Math.floor(10000 + Math.random() * 90000);
    const orderNumber = 'LA-' + randNum;
    const orderSubtotal = getCartSubtotal();
    const orderShipping = orderSubtotal >= 150 ? 0.00 : 10.00;
    const orderTotal = orderSubtotal + orderShipping;

    // Build order object
    const newOrder = {
      orderNumber: orderNumber,
      email: email,
      customerName: name,
      date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      status: 'Processing',
      items: [...cart],
      subtotal: orderSubtotal,
      shipping: orderShipping,
      total: orderTotal,
      shippingAddress: {
        address1: address,
        address2: '',
        city: city,
        state: 'NY',
        zip: zip,
        country: 'United States'
      },
      trackingNumber: null,
      trackingUrl: null
    };

    // Save to list
    orders.push(newOrder);
    localStorage.setItem('luna_orders', JSON.stringify(orders));

    // Clear cart
    clearCart();

    // Show Thank you screen content inside the modal
    const modalContainer = document.getElementById('checkout-modal-inner');
    if (modalContainer) {
      modalContainer.innerHTML = `
        <div class="thank-you-view">
          <span class="thank-you-icon">✓</span>
          <h2 class="thank-you-title">Order Confirmed</h2>
          <p class="thank-you-text">Thank you for your purchase, ${name}. Your order number is <strong>${orderNumber}</strong>.</p>
          <p class="thank-you-meta">We have sent a confirmation email to <strong>${email}</strong>. Once shipped, a tracking link will be provided.</p>
          <div class="thank-you-highlight">
            <p><strong>Need to check on this order later?</strong></p>
            <span>Look it up anytime in the <strong>Support Portal</strong> with your email and order number, or ask <strong>Luna</strong>, our AI support assistant, in the chat bubble in the bottom right corner.</span>
          </div>
          <button class="btn btn-primary" onclick="closeCheckoutModal(); window.location.reload();">Continue Shopping</button>
        </div>
      `;
    }
  };

  // --- Routing Execution ---
  function router() {
    const rawHash = window.location.hash;
    let viewName = 'home';
    let params = {};

    if (rawHash) {
      // Parse query parameters if any (e.g. #product?id=premium-hoodie-v23)
      const hashPart = rawHash.replace('#', '');
      const parts = hashPart.split('?');
      viewName = parts[0];

      if (parts[1]) {
        const queryParams = new URLSearchParams(parts[1]);
        queryParams.forEach((value, key) => {
          params[key] = value;
        });
      }
    }

    // Nav active styling sync
    document.querySelectorAll('.nav-link').forEach(link => {
      const href = link.getAttribute('href');
      if (href === '#' + viewName || (viewName === 'home' && href === '#')) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Render viewport
    const appViewport = document.getElementById('app-viewport');
    if (appViewport) {
      const renderFn = views[viewName] || views.home;
      appViewport.innerHTML = renderFn(params);
      window.scrollTo(0, 0);
    }
  }

  // --- Initial Setup ---
  window.addEventListener('hashchange', router);
  
  document.addEventListener('DOMContentLoaded', async () => {
    // Load live product data before the first render so every view (home,
    // shop grid, product detail) renders with current price/stock from the
    // merchant admin, not a stale snapshot.
    await loadProducts();

    // Initialise UI components
    updateCartUI();

    // Close drawers on overlay clicks
    const drawerOverlay = document.getElementById('drawer-overlay');
    if (drawerOverlay) drawerOverlay.onclick = closeCartDrawer;

    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) modalOverlay.onclick = closeCheckoutModal;

    // Run router
    router();
  });

  // Export helper functions to let widget and DOM read
  window.openCartDrawer = openCartDrawer;
  window.closeCartDrawer = closeCartDrawer;

})();
