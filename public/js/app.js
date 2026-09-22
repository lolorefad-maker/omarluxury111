// ==========================================
// OMAR LUXURY / MUCCI BAGS - Storefront Logic
// ==========================================

const State = {
  products: [],
  newArrivals: [],
  promoCards: [],
  banners: [],
  reviews: [],
  settings: {},
  activeCategory: 'all',
  activeBrand: null,
  cart: JSON.parse(localStorage.getItem('mucci_cart') || '[]'),
  currency: localStorage.getItem('mucci_curr') || 'JOD',
  rates: {
    JOD: { symbol: ' د.أ', rate: 1 },
    USD: { symbol: '$', rate: 1.41 },
    ILS: { symbol: '₪', rate: 5.2 },
    AED: { symbol: 'AED ', rate: 5.18 },
    SAR: { symbol: 'SAR ', rate: 5.29 }
  },
  appliedCoupon: null
};

// Formatting currency
function formatPrice(amount) {
  const c = State.rates[State.currency] || State.rates.JOD;
  const converted = amount * c.rate;
  if (State.currency === 'JOD') {
    return `${converted.toFixed(0)} د.أ`;
  }
  return `${c.symbol}${converted.toFixed(2)}`;
}

// Toast Notification
function showToast(message, icon = '🛍️') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Save & Update Cart
function saveCart() {
  localStorage.setItem('mucci_cart', JSON.stringify(State.cart));
  updateCartUI();
}

function updateCartUI() {
  const totalCount = State.cart.reduce((sum, item) => sum + item.quantity, 0);
  document.querySelectorAll('.cart-count').forEach(el => {
    el.textContent = totalCount;
  });

  const cartList = document.getElementById('cart-items-list');
  const cartSubtotalEl = document.getElementById('cart-subtotal');
  const cartDiscountEl = document.getElementById('cart-discount');
  const cartShippingEl = document.getElementById('cart-shipping');
  const cartTotalEl = document.getElementById('cart-total');
  const freeShipBar = document.getElementById('free-shipping-progress');
  const freeShipMsg = document.getElementById('free-shipping-msg');

  if (!cartList) return;

  if (State.cart.length === 0) {
    cartList.innerHTML = `
      <div style="text-align:center; padding: 50px 20px; color: var(--color-text-muted);">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="margin: 0 auto 16px; opacity: 0.5;">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <path d="M16 10a4 4 0 0 1-8 0"></path>
        </svg>
        <p style="font-size: 15px; font-weight: 500; margin-bottom: 6px;">Your bag is currently empty</p>
        <p style="font-size: 12.5px;">Explore our luxury collection and find your timeless piece.</p>
      </div>
    `;
    if (cartSubtotalEl) cartSubtotalEl.textContent = formatPrice(0);
    if (cartTotalEl) cartTotalEl.textContent = formatPrice(0);
    if (cartShippingEl) cartShippingEl.textContent = formatPrice(0);
    return;
  }

  cartList.innerHTML = State.cart.map((item, index) => `
    <div class="cart-item">
      <img src="${item.image}" alt="${item.title}" class="cart-item-img">
      <div class="cart-item-details">
        <h4 class="cart-item-title">${item.title}</h4>
        <div class="cart-item-color">Color: <strong>${item.color || 'Default'}</strong></div>
        <div class="cart-item-bottom">
          <div class="qty-controls">
            <button class="qty-btn" onclick="changeCartQty(${index}, -1)">-</button>
            <span class="qty-num">${item.quantity}</span>
            <button class="qty-btn" onclick="changeCartQty(${index}, 1)">+</button>
          </div>
          <span style="font-weight: 600; font-size: 14px;">${formatPrice(item.price * item.quantity)}</span>
          <button onclick="removeCartItem(${index})" style="color:#b33; font-size:16px; margin-left:10px;" title="Remove">✕</button>
        </div>
      </div>
    </div>
  `).join('');

  const subtotal = State.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  let discount = 0;
  if (State.appliedCoupon) {
    discount = State.appliedCoupon.discount_type === 'percentage'
      ? (subtotal * State.appliedCoupon.discount_value) / 100
      : State.appliedCoupon.discount_value;
  }

  const freeLimit = State.settings.free_shipping_threshold || 100;
  const shippingFee = (subtotal >= freeLimit) ? 0 : (State.settings.shipping_fee || 15);
  const total = Math.max(0, subtotal - discount + shippingFee);

  if (cartSubtotalEl) cartSubtotalEl.textContent = formatPrice(subtotal);
  if (cartDiscountEl) cartDiscountEl.textContent = `-${formatPrice(discount)}`;
  if (cartShippingEl) cartShippingEl.textContent = (shippingFee === 0) ? 'Free Shipping' : formatPrice(shippingFee);
  if (cartTotalEl) cartTotalEl.textContent = formatPrice(total);

  // Free shipping progress
  if (freeShipBar && freeShipMsg) {
    const percent = Math.min(100, Math.round((subtotal / freeLimit) * 100));
    freeShipBar.style.width = `${percent}%`;
    if (subtotal >= freeLimit) {
      freeShipMsg.innerHTML = `🎉 Congratulations! You unlocked <strong>Free Standard Shipping</strong>!`;
      freeShipBar.style.backgroundColor = 'var(--color-success)';
    } else {
      const needed = freeLimit - subtotal;
      freeShipMsg.innerHTML = `Add <strong>${formatPrice(needed)}</strong> more to enjoy <strong>Free Shipping</strong>!`;
      freeShipBar.style.backgroundColor = 'var(--color-dark)';
    }
  }
}

function addToCart(product, colorObj = null, qty = 1) {
  const chosenColor = colorObj || (product.colors && product.colors[0]) || { name: 'Standard', image: product.image };
  const existingIdx = State.cart.findIndex(
    item => item.product_id === product.id && item.color === chosenColor.name
  );

  if (existingIdx > -1) {
    State.cart[existingIdx].quantity += qty;
  } else {
    State.cart.push({
      product_id: product.id,
      title: product.title,
      price: product.price,
      image: chosenColor.image || product.image,
      color: chosenColor.name,
      quantity: qty
    });
  }

  saveCart();
  showToast(`Added "${product.title}" to your bag!`);
  openCartDrawer();
}

function changeCartQty(index, delta) {
  if (!State.cart[index]) return;
  State.cart[index].quantity += delta;
  if (State.cart[index].quantity <= 0) {
    State.cart.splice(index, 1);
  }
  saveCart();
}

function removeCartItem(index) {
  State.cart.splice(index, 1);
  saveCart();
}

function openCartDrawer() {
  document.getElementById('cart-drawer').classList.add('open');
  document.getElementById('cart-overlay').classList.add('open');
}

function closeCartDrawer() {
  document.getElementById('cart-drawer').classList.remove('open');
  document.getElementById('cart-overlay').classList.remove('open');
}

// Fetch Initial Data
async function initApp() {
  try {
    // 1. Settings
    const resSettings = await fetch('/api/settings');
    State.settings = await resSettings.json();
    applySettings();

    // 2. Banners
    const resBanners = await fetch('/api/banners');
    State.banners = await resBanners.json();
    renderHeroBanner();

    // 3. Promo Cards
    const resPromo = await fetch('/api/promo-cards');
    State.promoCards = await resPromo.json();
    renderPromoCards();

    // 4. Products
    const resProducts = await fetch('/api/products');
    State.products = await resProducts.json();
    
    // Divide into New Arrivals (first 4 or tagged) and Full Catalog
    State.newArrivals = State.products.slice(0, 4);
    renderNewArrivals();
    renderCatalog();
    renderDrawerNav();

    // 5. Reviews
    const resReviews = await fetch('/api/reviews');
    State.reviews = await resReviews.json();
    renderReviews();

    updateCartUI();
  } catch (err) {
    console.error('Failed loading data:', err);
  }
}

function applySettings() {
  const storeLogo = document.getElementById('store-name');
  if (storeLogo && State.settings.store_name) {
    storeLogo.textContent = State.settings.store_name;
  }
  const announcement = document.getElementById('announcement-text');
  if (announcement && State.settings.announcement) {
    announcement.textContent = State.settings.announcement;
  }
}

// Render Hero Banner
function renderHeroBanner() {
  const heroWrap = document.getElementById('hero-banner-container');
  if (!heroWrap || State.banners.length === 0) return;
  const b = State.banners[0]; // Active main hero

  heroWrap.innerHTML = `
    <div class="container">
      <div class="hero-inner">
        <div class="hero-content">
          ${b.badge_text ? `<span class="hero-badge">${b.badge_text}</span>` : ''}
          <h1 class="hero-title font-serif">${b.title}</h1>
          <p class="hero-subtitle">${b.subtitle || 'Elevate your style with our elegant & premium collection.'}</p>
          <a href="${b.button_link || '#shop'}" class="btn-luxury">
            ${b.button_text || 'Shop Collection'}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M5 12h14"></path>
              <path d="m12 5 7 7-7 7"></path>
            </svg>
          </a>
        </div>
        <div class="hero-image-wrap">
          <div class="hero-image-card">
            <img src="${b.image_url}" alt="Luxury Bag Collection" class="hero-image">
          </div>
        </div>
      </div>
    </div>
  `;
}

// Render New Arrivals Grid (Matching the 4 items in photo)
function renderNewArrivals() {
  const grid = document.getElementById('new-arrivals-grid');
  if (!grid) return;

  grid.innerHTML = State.newArrivals.map((prod) => createProductCardHTML(prod)).join('');
}

// ---- Brands & categories used by the catalog filter and the sidebar ----
const KNOWN_BRANDS = ['Louis Vuitton', 'Christian Dior', 'Dior', 'Chanel', 'Hermès', 'Hermes', 'Gucci', 'Prada',
  'Saint Laurent', 'YSL', 'Bottega Veneta', 'Celine', 'Fendi', 'Coach', 'Burberry', 'Valentino', 'Balenciaga',
  'Givenchy', 'Miu Miu', 'Loewe', 'Versace', 'Goyard', 'Michael Kors', 'Tory Burch', 'Marc Jacobs'];
const BRAND_ALIASES = { 'christian dior': 'Dior', 'hermes': 'Hermès', 'ysl': 'Saint Laurent' };

const SHOP_CATEGORIES = [
  { key: 'top handle', label: 'حقائب بمقبض • Top Handle' },
  { key: 'tote', label: 'حقائب توت • Tote Bags' },
  { key: 'shoulder', label: 'حقائب كتف • Shoulder Bags' },
  { key: 'crossbody', label: 'كروس بودي • Crossbody Bags' },
  { key: 'clutch', label: 'كلاتش ومناسبات • Clutches' },
  { key: 'accessories', label: 'إكسسوارات • Accessories' },
  { key: 'best seller', label: 'الأكثر مبيعاً • Best Sellers' }
];

// Brand comes from the product's brand field, otherwise from the start of its title ("Louis Vuitton Diane — ...")
function getBrand(p) {
  const title = (p.title || '').toLowerCase();
  const raw = (p.brand || KNOWN_BRANDS.find(b => title.startsWith(b.toLowerCase())) || '').trim();
  return BRAND_ALIASES[raw.toLowerCase()] || raw || 'Other';
}

function matchesCategory(p, cat) {
  if (!cat || cat === 'all') return true;
  const c = (p.category || '').toLowerCase();
  const target = cat.toLowerCase();
  // "Best Sellers" is a badge on the product, not a bag type
  if (target.startsWith('best')) return (p.badge || '').toLowerCase() === 'best seller' || c.includes('best seller');
  return c.includes(target);
}

// Render Full Catalog Grid
function renderCatalog() {
  const grid = document.getElementById('catalog-grid');
  if (!grid) return;

  const filtered = State.products.filter(p =>
    matchesCategory(p, State.activeCategory) && (!State.activeBrand || getBrand(p) === State.activeBrand));

  renderActiveFilter(grid);

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--color-text-muted);">No products found in this category.</div>`;
    return;
  }

  grid.innerHTML = filtered.map(prod => createProductCardHTML(prod)).join('');
}

// // Helper to generate a single Product Card HTML
function createProductCardHTML(prod) {
  const colors = prod.colors || [
    { name: 'Noir Black', hex: '#1c1b1a', image: prod.image },
    { name: 'Warm Tan', hex: '#b5794c', image: prod.image }
  ];

  const swatchesHTML = colors.map((col, cIdx) => `
    <span 
      class="color-dot ${cIdx === 0 ? 'active' : ''}" 
      style="background-color: ${col.hex};" 
      title="${col.name}"
      onclick="selectCardColor('${prod.id}', ${cIdx}, event)"
    ></span>
  `).join('');

  return `
    <div class="product-card" id="card-${prod.id}">
      <div class="product-image-box" onclick="openQuickView('${prod.id}')">
        ${prod.badge ? `<span class="product-badge ${prod.badge.toLowerCase() === 'sale' ? 'sale' : ''}">${prod.badge}</span>` : ''}
        <img src="${prod.image}" alt="${prod.title}" class="product-image" id="img-${prod.id}" loading="lazy">
        
        <div class="quick-actions">
          <button class="action-btn" title="معاينة سريعة" onclick="openQuickView('${prod.id}'); event.stopPropagation();">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          <button class="action-btn action-btn-add" title="أضف للحقيبة" onclick="quickAddToCart('${prod.id}'); event.stopPropagation();">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <path d="M16 10a4 4 0 0 1-8 0"></path>
            </svg>
          </button>
        </div>
      </div>
      
      <div class="product-info">
        <div class="product-cat-tag">${prod.category || 'Luxury Handbag'}</div>
        <h3 class="product-title font-serif" onclick="openQuickView('${prod.id}')">${prod.title}</h3>
        ${prod.subtitle ? `<p class="product-subtitle">${prod.subtitle}</p>` : ''}
        
        <div class="product-pricing">
          <span class="product-price">${formatPrice(prod.price)}</span>
          ${prod.original_price && prod.original_price > prod.price ? `<span class="product-orig-price">${formatPrice(prod.original_price)}</span>` : ''}
        </div>
        
        <div class="product-card-footer">
          <div class="color-swatches" id="swatches-${prod.id}">
            ${swatchesHTML}
          </div>
          <button class="card-mobile-quick-btn" onclick="openQuickView('${prod.id}')">
            <span>طلب سريع</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

// Interactive Color Dot selection
window.selectCardColor = function (prodId, colorIndex, event) {
  if (event) event.stopPropagation();
  const prod = State.products.find(p => p.id === prodId);
  if (!prod || !prod.colors || !prod.colors[colorIndex]) return;

  const chosen = prod.colors[colorIndex];
  const imgEl = document.getElementById(`img-${prodId}`);
  if (imgEl && chosen.image) {
    imgEl.style.opacity = '0.3';
    setTimeout(() => {
      imgEl.src = chosen.image;
      imgEl.style.opacity = '1';
    }, 150);
  }

  // Toggle active swatch dot
  const swatchesBox = document.getElementById(`swatches-${prodId}`);
  if (swatchesBox) {
    const dots = swatchesBox.querySelectorAll('.color-dot');
    dots.forEach((d, idx) => {
      if (idx === colorIndex) d.classList.add('active');
      else d.classList.remove('active');
    });
  }
};

window.quickAddToCart = function (prodId) {
  const prod = State.products.find(p => p.id === prodId);
  if (!prod) return;
  addToCart(prod);
};

// Render 6 Category Promo Cards (Matching Photo)
function renderPromoCards() {
  const container = document.getElementById('promo-cards-grid');
  if (!container || State.promoCards.length === 0) return;

  container.innerHTML = State.promoCards.map(card => `
    <div class="promo-card" onclick="filterByPromo('${card.category}')">
      <div class="promo-card-content">
        <div class="promo-cat-name">${card.category}</div>
        <h3 class="promo-badge-text font-serif">${card.badge}</h3>
        <a href="${card.button_link || '#shop'}" class="promo-btn">${card.button_text || 'Shop Now'}</a>
      </div>
      <div class="promo-card-img-wrap">
        <img src="${card.image_url}" alt="${card.category}" class="promo-card-img">
      </div>
    </div>
  `).join('');
}

window.filterByPromo = function (category) {
  // map the promo card's category to the matching catalog tab (e.g. "Best Seller" -> "best seller", "Clutches" -> "clutch")
  const key = category.toLowerCase().split(' ')[0];
  const tab = [...document.querySelectorAll('.tab-btn')].find(b => b.dataset.cat !== 'all' && (key.startsWith(b.dataset.cat) || b.dataset.cat.startsWith(key)));
  filterCategory(tab ? tab.dataset.cat : key);
  const shopEl = document.getElementById('shop');
  if (shopEl) shopEl.scrollIntoView({ behavior: 'smooth' });
};

window.filterCategory = function (cat) {
  State.activeCategory = cat;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.cat === cat) btn.classList.add('active');
    else btn.classList.remove('active');
  });
  renderCatalog();
};

// Label above the grid when a brand (or a category without its own tab) is selected, with one tap back to everything
function renderActiveFilter(grid) {
  let bar = document.getElementById('catalog-active-filter');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'catalog-active-filter';
    bar.className = 'catalog-active-filter';
    grid.parentNode.insertBefore(bar, grid);
  }
  const cat = SHOP_CATEGORIES.find(c => c.key === State.activeCategory);
  const hasTab = !!document.querySelector(`.tab-btn[data-cat="${State.activeCategory}"]`);
  const show = !!State.activeBrand || (!!cat && !hasTab);
  const label = [State.activeBrand, cat && cat.label].filter(Boolean).join(' · ');
  bar.hidden = !show;
  bar.innerHTML = show
    ? `<span class="active-filter-pill">${esc(label)}<button type="button" onclick="shopBy('all')" aria-label="عرض كل التشكيلة">✕</button></span>`
    : '';
}

// Sidebar: categories and brands built from the live catalog, so new products and brands appear automatically
function renderDrawerNav() {
  const catBox = document.getElementById('drawer-categories');
  const brandBox = document.getElementById('drawer-brands');
  const allCount = document.getElementById('drawer-count-all');
  if (!catBox || !brandBox) return;
  if (allCount) allCount.textContent = State.products.length;

  const count = (brand, cat) => State.products.filter(p => (!brand || getBrand(p) === brand) && matchesCategory(p, cat)).length;
  const link = (label, n, cat, brand, cls) => `
    <a class="${cls}" href="javascript:void(0)" data-cat="${cat}" data-brand="${esc(brand || '')}" onclick="shopBy(this.dataset.cat, this.dataset.brand)">
      <span>${esc(label)}</span><span class="drawer-count">${n}</span>
    </a>`;

  catBox.innerHTML = SHOP_CATEGORIES
    .map(c => ({ ...c, n: count(null, c.key) }))
    .filter(c => c.n > 0)
    .map(c => link(c.label, c.n, c.key, '', 'mobile-drawer-link'))
    .join('');

  const brands = [...new Set(State.products.map(getBrand))]
    .map(name => ({ name, n: count(name, 'all') }))
    .sort((a, b) => (a.name === 'Other') - (b.name === 'Other') || b.n - a.n || a.name.localeCompare(b.name));

  brandBox.innerHTML = brands.map(b => {
    const title = b.name === 'Other' ? 'أخرى • Other' : b.name;
    const subs = SHOP_CATEGORIES
      .filter(c => c.key !== 'best seller')
      .map(c => ({ ...c, n: count(b.name, c.key) }))
      .filter(c => c.n > 0);
    return `
      <details class="drawer-brand">
        <summary>
          <span class="drawer-brand-name">${esc(title)}</span>
          <span class="drawer-brand-meta"><span class="drawer-count">${b.n}</span><span class="drawer-chev">›</span></span>
        </summary>
        <div class="drawer-brand-subs">
          ${link(`كل منتجات ${title}`, b.n, 'all', b.name, 'drawer-sub-link drawer-sub-all')}
          ${subs.map(c => link(c.label, c.n, c.key, b.name, 'drawer-sub-link')).join('')}
        </div>
      </details>`;
  }).join('');
}

// Show the catalog filtered by category and/or brand (used by the sidebar and the filter label)
window.shopBy = function (cat, brand) {
  State.activeBrand = brand || null;
  const drawer = document.getElementById('mobile-nav-drawer');
  if (drawer && drawer.classList.contains('open')) toggleMobileNav();
  filterCategory(cat || 'all');
  const shopEl = document.getElementById('shop');
  if (shopEl) shopEl.scrollIntoView({ behavior: 'smooth' });
};

// Mobile Navigation Drawer Toggle
window.toggleMobileNav = function () {
  const drawer = document.getElementById('mobile-nav-drawer');
  const backdrop = document.getElementById('mobile-nav-backdrop');
  if (!drawer) return;
  const isOpen = drawer.classList.contains('open');
  if (isOpen) {
    drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    document.body.style.overflow = '';
  } else {
    drawer.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
};

// Mobile Search Toggle
window.toggleMobileSearch = function () {
  const bar = document.getElementById('mobile-search-bar');
  if (!bar) return;
  bar.classList.toggle('open');
  if (bar.classList.contains('open')) {
    const input = document.getElementById('mobile-search-input');
    if (input) setTimeout(() => input.focus(), 150);
  }
};

window.handleMobileSearch = function (e) {
  const q = e.target.value;
  const desktopInput = document.getElementById('live-search-input');
  if (desktopInput) desktopInput.value = q;
  handleSearch(e);
};

// Quick View Modal
let currentQuickProd = null;
let currentQuickColor = null;

window.openQuickView = function (prodId) {
  const prod = State.products.find(p => p.id === prodId);
  if (!prod) return;
  currentQuickProd = prod;
  currentQuickColor = prod.colors && prod.colors[0] ? prod.colors[0] : null;
  quickQty = 1;

  const modal = document.getElementById('quick-view-modal');
  const body = document.getElementById('quick-view-body');
  if (!modal || !body) return;

  const colorSwatches = (prod.colors || []).map((col, idx) => `
    <button 
      class="quick-color-chip ${idx === 0 ? 'selected' : ''}" 
      onclick="selectQuickColor(${idx})"
      type="button"
    >
      <span class="chip-color-circle" style="background-color:${col.hex};"></span>
      <span class="chip-color-title">${col.name}</span>
    </button>
  `).join('');

  body.innerHTML = `
    <div class="quick-view-grid">
      <div class="quick-view-media-wrap">
        <div class="quick-view-img-box">
          <img id="quick-main-img" src="${currentQuickColor ? currentQuickColor.image : prod.image}" alt="${prod.title}">
        </div>
      </div>
      
      <div class="quick-view-info">
        <div class="quick-header-block">
          <div class="quick-cat-badge">${prod.category || 'Luxury Handbag'}</div>
          <h2 class="quick-prod-title font-serif">${prod.title}</h2>
          
          <div class="quick-price-row">
            <span class="quick-price-val">${formatPrice(prod.price)}</span>
            ${prod.original_price ? `<span class="quick-price-orig">${formatPrice(prod.original_price)}</span>` : ''}
            <span class="stock-pill">✓ متوفر جاهز للشحن</span>
          </div>
        </div>

        <p class="quick-desc">${prod.description || prod.subtitle || 'حقيبة يد فاخرة مصنوعة من أرقى أنواع الجلود ومصممة بأناقة كلاسيكية تدوم طويلاً.'}</p>
        
        <div class="quick-color-section">
          <div class="quick-section-label">
            <span>اللون:</span> 
            <strong id="quick-color-name">${currentQuickColor ? currentQuickColor.name : 'الأساسي'}</strong>
          </div>
          <div class="quick-chips-row" id="quick-color-list">
            ${colorSwatches}
          </div>
        </div>

        <div class="quick-action-bar">
          <div class="quick-qty-wrapper">
            <span class="quick-qty-label">الكمية:</span>
            <div class="quick-qty-box">
              <button class="qty-btn" type="button" onclick="changeQuickQty(-1)" aria-label="Decrease quantity">−</button>
              <span class="qty-num" id="quick-qty">1</span>
              <button class="qty-btn" type="button" onclick="changeQuickQty(1)" aria-label="Increase quantity">+</button>
            </div>
          </div>
          
          <button class="quick-add-btn" type="button" onclick="addQuickToCart()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
            <span>أضف إلى حقيبة التسوق</span>
          </button>
        </div>
      </div>
    </div>
  `;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
};

let quickQty = 1;
window.changeQuickQty = function (delta) {
  quickQty = Math.max(1, quickQty + delta);
  const el = document.getElementById('quick-qty');
  if (el) el.textContent = quickQty;
};

window.selectQuickColor = function (idx) {
  if (!currentQuickProd || !currentQuickProd.colors) return;
  currentQuickColor = currentQuickProd.colors[idx];
  const imgEl = document.getElementById('quick-main-img');
  const nameEl = document.getElementById('quick-color-name');
  if (imgEl && currentQuickColor.image) imgEl.src = currentQuickColor.image;
  if (nameEl) nameEl.textContent = currentQuickColor.name;

  document.querySelectorAll('.quick-color-chip').forEach((opt, i) => {
    if (i === idx) {
      opt.classList.add('selected');
    } else {
      opt.classList.remove('selected');
    }
  });
};

window.addQuickToCart = function () {
  if (!currentQuickProd) return;
  addToCart(currentQuickProd, currentQuickColor, quickQty);
  closeModal('quick-view-modal');
  quickQty = 1;
};

window.closeModal = function (modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.remove('open');
  document.body.style.overflow = '';
};

// Escape visitor-supplied text (reviews) before inserting it into the page
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Reviews Section
function renderReviews() {
  const grid = document.getElementById('reviews-grid');
  if (!grid) return;

  grid.innerHTML = State.reviews.map(r => {
    const stars = Math.min(5, Math.max(1, parseInt(r.rating) || 5));
    return `
    <div class="review-card">
      <div class="review-stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</div>
      <p class="review-comment">"${esc(r.comment)}"</p>
      <div class="review-meta">
        <div>
          <div class="review-author">${esc(r.author_name)}</div>
          <div style="font-size:11px; color:var(--color-text-light);">${esc(r.product_name || 'Verified Customer')}</div>
        </div>
        ${r.verified ? `<div class="review-verified"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Verified</div>` : ''}
      </div>
    </div>
  `;
  }).join('');
}

// Submit Review Form
window.submitReview = async function (e) {
  e.preventDefault();
  const name = document.getElementById('rev-author').value.trim();
  const rating = parseInt(document.getElementById('rev-rating').value) || 5;
  const comment = document.getElementById('rev-comment').value.trim();
  const prodName = document.getElementById('rev-product').value.trim();

  if (!name || !comment) {
    alert('Please fill out your name and review');
    return;
  }

  try {
    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author_name: name,
        rating,
        comment,
        product_name: prodName
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Thank you! Your review was submitted.');
      closeModal('write-review-modal');
      e.target.reset();
      // Reload reviews
      const rRes = await fetch('/api/reviews');
      State.reviews = await rRes.json();
      renderReviews();
    }
  } catch (err) {
    alert('Failed to submit review. Please try again.');
  }
};

// Checkout & Orders
window.openCheckoutModal = function () {
  if (State.cart.length === 0) {
    alert('Your shopping bag is empty.');
    return;
  }
  closeCartDrawer();
  const modal = document.getElementById('checkout-modal');
  if (modal) modal.classList.add('open');
};

window.submitCheckout = async function (e) {
  e.preventDefault();
  const btn = document.getElementById('place-order-btn');
  btn.disabled = true;
  btn.textContent = 'Processing Order...';

  const customer_name = document.getElementById('order-name').value.trim();
  const customer_phone = document.getElementById('order-phone').value.trim();
  const customer_city = document.getElementById('order-city').value.trim();
  const customer_address = document.getElementById('order-address').value.trim();
  const notes = document.getElementById('order-notes').value.trim();
  const payment_method = document.querySelector('input[name="payment_method"]:checked')?.value || 'Cash on Delivery';

  const orderPayload = {
    customer_name,
    customer_phone,
    customer_city,
    customer_address,
    notes,
    payment_method,
    items: State.cart,
    coupon_code: State.appliedCoupon ? State.appliedCoupon.code : null
  };

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    });

    const data = await res.json();
    if (data.success) {
      const order = data.order;
      // Clear Cart
      State.cart = [];
      saveCart();
      closeModal('checkout-modal');

      // Open Success Confirmation Modal
      showOrderSuccess(order);
    } else {
      alert(data.message || 'Error processing order');
    }
  } catch (err) {
    alert('Network error. Please check your connection.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Complete Order';
  }
};

function showOrderSuccess(order) {
  const modal = document.getElementById('order-success-modal');
  const body = document.getElementById('order-success-body');
  if (!modal || !body) return;

  const waNum = (State.settings.whatsapp_number || '+972599000000').replace(/[^0-9+]/g, '');
  const waMsg = encodeURIComponent(
    `Hello Omar Luxury! I just placed order #${order.order_number} for ${formatPrice(order.total)}. My name is ${order.customer_name}. Please confirm my order.`
  );
  const waUrl = `https://wa.me/${waNum}?text=${waMsg}`;

  body.innerHTML = `
    <div style="text-align:center; padding: 10px 0;">
      <div style="width:64px; height:64px; background:#e8f5e9; color:#2e7d32; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 16px; font-size:28px;">✓</div>
      <h2 class="font-serif" style="font-size:28px; margin-bottom:8px;">Thank You For Your Order!</h2>
      <p style="color:var(--color-text-muted); font-size:14px; margin-bottom:20px;">
        Order reference: <strong style="color:var(--color-dark);">${order.order_number}</strong>
      </p>
      
      <div style="background:var(--color-bg-soft); border-radius:6px; padding:18px; text-align:left; font-size:13px; margin-bottom:24px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span style="color:var(--color-text-muted);">Customer:</span>
          <strong>${order.customer_name} (${order.customer_phone})</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span style="color:var(--color-text-muted);">Delivery to:</span>
          <strong>${order.customer_city} - ${order.customer_address}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span style="color:var(--color-text-muted);">Payment:</span>
          <strong>${order.payment_method}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; padding-top:8px; border-top:1px dashed var(--color-border); font-size:15px; font-weight:700;">
          <span>Total Amount:</span>
          <span>${formatPrice(order.total)}</span>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:12px;">
        <a href="${waUrl}" target="_blank" class="btn-luxury" style="background:#25d366; color:#fff; border-color:#25d366;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="margin-right:8px;"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.007c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.2.662.591 1.221.774 1.394.86.173.086.274.072.375-.043.101-.116.433-.506.549-.68.116-.173.231-.144.39-.086s1.011.477 1.184.564.289.13.332.202c.045.072.045.419-.099.824z"/></svg>
          Confirm Order via WhatsApp
        </a>
        <button onclick="closeModal('order-success-modal')" style="font-size:13px; color:var(--color-text-muted); padding:8px;">
          Continue Browsing Store
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');
}

// Live Search
window.handleSearch = function (e) {
  const query = e.target.value.toLowerCase().trim();
  const filtered = State.products.filter(p => 
    p.title.toLowerCase().includes(query) || 
    (p.subtitle && p.subtitle.toLowerCase().includes(query)) ||
    (p.category && p.category.toLowerCase().includes(query))
  );
  
  const grid = document.getElementById('catalog-grid');
  if (!grid) return;
  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--color-text-muted);">No luxury bags matched "${query}".</div>`;
    return;
  }
  grid.innerHTML = filtered.map(prod => createProductCardHTML(prod)).join('');
  document.getElementById('shop').scrollIntoView({ behavior: 'smooth' });
};

// Currency Switcher
window.changeCurrency = function (curr) {
  State.currency = curr;
  localStorage.setItem('mucci_curr', curr);
  renderNewArrivals();
  renderCatalog();
  updateCartUI();
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initApp();

  // Search toggle
  const searchInput = document.getElementById('live-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', handleSearch);
  }
});
