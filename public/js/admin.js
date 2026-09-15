// ===============================================
// OMAR LUXURY / MUCCI BAGS - Admin Panel Logic
// ===============================================

// Every admin API call carries the admin PIN; the server rejects admin actions without it.
function getAdminPin() {
  let pin = sessionStorage.getItem('admin_pin');
  if (!pin) {
    pin = (prompt('أدخل رمز الدخول للوحة التحكم (Admin PIN):') || '').trim();
    if (pin) sessionStorage.setItem('admin_pin', pin);
  }
  return pin || '';
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async function (url, opts = {}) {
  const headers = new Headers(opts.headers || {});
  headers.set('x-admin-pin', getAdminPin());
  const res = await nativeFetch(url, { ...opts, headers });
  if (res.status === 401) {
    sessionStorage.removeItem('admin_pin');
    alert('رمز الدخول غير صحيح. حاول مرة أخرى.');
    location.reload();
  }
  return res;
};

// Escape customer-supplied text before inserting it into the page
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const AdminState = {
  products: [],
  orders: [],
  banners: [],
  promoCards: [],
  reviews: [],
  coupons: [],
  settings: {},
  stats: {},
  activeTab: 'dashboard',
  currentOrderFilter: 'all'
};

// Switch Sidebar Tabs
window.switchTab = function (tabName) {
  AdminState.activeTab = tabName;
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.admin-nav-item').forEach(el => el.classList.remove('active'));

  const targetTab = document.getElementById(`tab-${tabName}`);
  if (targetTab) targetTab.classList.add('active');

  // Activate nav button
  const navBtns = document.querySelectorAll('.admin-nav-item');
  const titles = {
    'dashboard': 'نظرة عامة على المتجر',
    'products': 'إدارة المنتجات والأسعار',
    'orders': 'إدارة الطلبات الواردة',
    'banners': 'إدارة البنر الرئيسي والعروض',
    'promo-cards': 'بطاقات الأقسام الستة',
    'reviews': 'المراجعات والتقييمات',
    'coupons': 'كوبونات وأكواد الخصم',
    'settings': 'إعدادات المتجر والتوصيل'
  };

  const titleEl = document.getElementById('tab-heading');
  if (titleEl && titles[tabName]) titleEl.textContent = titles[tabName];

  // Refresh tab data
  if (tabName === 'dashboard') loadStats();
  if (tabName === 'products') loadProducts();
  if (tabName === 'orders') loadOrders();
  if (tabName === 'banners') loadBanners();
  if (tabName === 'promo-cards') loadPromoCards();
  if (tabName === 'reviews') loadReviews();
  if (tabName === 'coupons') loadCoupons();
  if (tabName === 'settings') loadSettings();
};

// Load Stats
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    AdminState.stats = await res.json();
    
    document.getElementById('stat-revenue').textContent = `$${AdminState.stats.total_revenue.toFixed(2)}`;
    document.getElementById('stat-orders').textContent = AdminState.stats.total_orders;
    document.getElementById('stat-pending').textContent = AdminState.stats.pending_orders;
    document.getElementById('stat-products').textContent = AdminState.stats.total_products;

    const badgePending = document.getElementById('badge-orders-pending');
    if (badgePending) badgePending.textContent = AdminState.stats.pending_orders;

    // Render Recent Orders
    const tbody = document.getElementById('dashboard-recent-orders');
    if (tbody && AdminState.stats.recent_orders) {
      if (AdminState.stats.recent_orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#999;">لا توجد طلبات حتى الآن</td></tr>`;
        return;
      }
      tbody.innerHTML = AdminState.stats.recent_orders.map(o => `
        <tr>
          <td><strong>${o.order_number}</strong></td>
          <td>${esc(o.customer_name)}</td>
          <td dir="ltr" style="text-align:right;">${esc(o.customer_phone)}</td>
          <td>${esc(o.customer_city || '-')}</td>
          <td>${o.items.length} قطع</td>
          <td><strong>$${o.total.toFixed(2)}</strong></td>
          <td><span class="badge-status status-${(o.status||'pending').toLowerCase()}">${o.status}</span></td>
          <td>
            <button class="btn-action btn-action-outline" style="padding:4px 10px; font-size:12px;" onclick="viewOrderInvoice('${o.id}')">تفاصيل</button>
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Error loading stats:', err);
  }
}

// -------------------------------------------------------------------
// PRODUCTS MANAGEMENT
// -------------------------------------------------------------------
async function loadProducts() {
  try {
    const res = await fetch('/api/products?all=true');
    AdminState.products = await res.json();
    renderProductsTable(AdminState.products);

    const badgeProd = document.getElementById('badge-products-count');
    if (badgeProd) badgeProd.textContent = AdminState.products.length;
  } catch (err) {
    console.error('Error loading products:', err);
  }
}

function renderProductsTable(products) {
  const tbody = document.getElementById('admin-products-table');
  if (!tbody) return;

  if (products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:40px; color:#999;">لا توجد منتجات مطابقة</td></tr>`;
    return;
  }

  tbody.innerHTML = products.map(p => `
    <tr>
      <td>
        <img src="${p.image}" alt="${p.title}" style="width:48px; height:48px; object-fit:contain; background:#faf8f5; border-radius:4px; padding:2px; border:1px solid #eee;">
      </td>
      <td>
        <strong>${p.title}</strong>
        <div style="font-size:11.5px; color:#888;">${p.subtitle || ''}</div>
      </td>
      <td><span style="font-size:12px; background:#f0ebe3; padding:3px 8px; border-radius:4px;">${p.category}</span></td>
      <td>
        <!-- In-place Price Editing -->
        <span class="price-editable" title="انقر لتعديل السعر فوراً" onclick="quickEditPrice('${p.id}', ${p.price}, ${p.original_price || 0})">
          $${p.price.toFixed(2)} ✏️
        </span>
      </td>
      <td>${p.original_price ? `<span style="color:#999; text-decoration:line-through;">$${p.original_price.toFixed(2)}</span>` : '-'}</td>
      <td>
        <span style="font-weight:600; color:${p.stock < 5 ? '#b33' : '#222'}">${p.stock}</span>
      </td>
      <td>
        ${p.badge ? `<span style="background:#141414; color:#fff; font-size:10px; padding:2px 6px; border-radius:3px;">${p.badge}</span>` : '-'}
      </td>
      <td>
        <span style="color:${p.active ? '#2e7d32' : '#999'}; font-weight:600; font-size:12px;">
          ${p.active ? '● معروض' : '○ مخفي'}
        </span>
      </td>
      <td>
        <div style="display:flex; gap:6px;">
          <button class="btn-action btn-action-outline" style="padding:4px 8px; font-size:12px;" onclick="editProductModal('${p.id}')">تعديل</button>
          <button class="btn-action btn-action-danger" style="padding:4px 8px; font-size:12px;" onclick="deleteProduct('${p.id}')">حذف</button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.filterAdminProducts = function () {
  const query = (document.getElementById('admin-search-products')?.value || '').toLowerCase().trim();
  const cat = document.getElementById('admin-cat-filter')?.value || 'all';

  let filtered = AdminState.products;
  if (cat !== 'all') {
    filtered = filtered.filter(p => p.category === cat);
  }
  if (query) {
    filtered = filtered.filter(p => 
      p.title.toLowerCase().includes(query) || 
      (p.subtitle && p.subtitle.toLowerCase().includes(query))
    );
  }
  renderProductsTable(filtered);
};

// In-place Quick Price Edit
window.quickEditPrice = async function (prodId, currentPrice, currentOrigPrice) {
  const newPriceStr = prompt(`تعديل سعر المنتج:\nأدخل السعر الجديد ($):`, currentPrice);
  if (newPriceStr === null) return;
  const newPrice = parseFloat(newPriceStr);
  if (isNaN(newPrice) || newPrice < 0) {
    alert('الرجاء إدخال سعر صحيح');
    return;
  }

  try {
    const res = await fetch(`/api/products/${prodId}/price`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: newPrice })
    });
    const data = await res.json();
    if (data.success) {
      loadProducts();
    }
  } catch (err) {
    alert('تعذر حفظ السعر.');
  }
};

window.openAddProductModal = function () {
  document.getElementById('product-modal-title').textContent = 'إضافة منتج جديد للمتجر';
  document.getElementById('product-form').reset();
  document.getElementById('prod-id').value = '';
  document.getElementById('form-prod-image-url').value = '/extracted/prod_tote_classic.jpg';
  document.getElementById('form-prod-img-preview').src = '/extracted/prod_tote_classic.jpg';
  document.getElementById('product-modal').classList.add('open');
};

window.editProductModal = function (prodId) {
  const prod = AdminState.products.find(p => p.id === prodId);
  if (!prod) return;

  document.getElementById('product-modal-title').textContent = 'تعديل بيانات المنتج';
  document.getElementById('prod-id').value = prod.id;
  document.getElementById('form-prod-title').value = prod.title;
  document.getElementById('form-prod-category').value = prod.category || 'Tote Bags';
  document.getElementById('form-prod-subtitle').value = prod.subtitle || '';
  document.getElementById('form-prod-desc').value = prod.description || '';
  document.getElementById('form-prod-price').value = prod.price;
  document.getElementById('form-prod-orig-price').value = prod.original_price || '';
  document.getElementById('form-prod-stock').value = prod.stock || 10;
  document.getElementById('form-prod-badge').value = prod.badge || '';
  document.getElementById('form-prod-image-url').value = prod.image;
  document.getElementById('form-prod-img-preview').src = prod.image;

  document.getElementById('product-modal').classList.add('open');
};

window.handleProductImageUpload = async function (input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('form-prod-image-url').value = data.url;
      document.getElementById('form-prod-img-preview').src = data.url;
    } else {
      alert('فشل رفع الصورة: ' + (data.message || ''));
    }
  } catch (err) {
    alert('حدث خطأ أثناء رفع الصورة');
  }
};

window.saveProductForm = async function (e) {
  e.preventDefault();
  const id = document.getElementById('prod-id').value;
  const title = document.getElementById('form-prod-title').value.trim();
  const category = document.getElementById('form-prod-category').value;
  const subtitle = document.getElementById('form-prod-subtitle').value.trim();
  const description = document.getElementById('form-prod-desc').value.trim();
  const price = parseFloat(document.getElementById('form-prod-price').value);
  const origPrice = parseFloat(document.getElementById('form-prod-orig-price').value) || 0;
  const stock = parseInt(document.getElementById('form-prod-stock').value) || 10;
  const badge = document.getElementById('form-prod-badge').value;
  const image = document.getElementById('form-prod-image-url').value || '/extracted/prod_tote_classic.jpg';

  const payload = {
    title,
    category,
    subtitle,
    description,
    price,
    original_price: origPrice,
    stock,
    badge,
    image,
    active: true
  };

  try {
    const url = id ? `/api/products/${id}` : '/api/products';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      closeModal('product-modal');
      loadProducts();
    }
  } catch (err) {
    alert('فشل حفظ المنتج');
  }
};

window.deleteProduct = async function (prodId) {
  if (!confirm('هل أنت متأكد من رغبتك في حذف هذا المنتج من المتجر؟')) return;
  try {
    const res = await fetch(`/api/products/${prodId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadProducts();
    }
  } catch (err) {
    alert('تعذر حذف المنتج');
  }
};

// -------------------------------------------------------------------
// ORDERS MANAGEMENT
// -------------------------------------------------------------------
async function loadOrders() {
  try {
    const res = await fetch('/api/orders');
    AdminState.orders = await res.json();
    renderOrdersTable();
  } catch (err) {
    console.error('Error loading orders:', err);
  }
}

window.filterOrdersByStatus = function (status) {
  AdminState.currentOrderFilter = status;
  document.querySelectorAll('.order-filter-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  renderOrdersTable();
};

function renderOrdersTable() {
  const tbody = document.getElementById('admin-orders-table');
  if (!tbody) return;

  let orders = AdminState.orders;
  if (AdminState.currentOrderFilter !== 'all') {
    orders = orders.filter(o => o.status === AdminState.currentOrderFilter);
  }

  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:40px; color:#999;">لا توجد طلبات في هذه الحالة</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map(o => {
    const waClean = (o.customer_phone || '').replace(/[^0-9]/g, '');
    const waText = encodeURIComponent(`مرحباً ${o.customer_name}، نتواصل معك من متجر Omar Luxury بخصوص طلبك رقم #${o.order_number}`);
    const dateStr = new Date(o.created_at).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    return `
      <tr>
        <td><strong>${o.order_number}</strong></td>
        <td style="font-size:12px; color:#888;">${dateStr}</td>
        <td><strong>${esc(o.customer_name)}</strong></td>
        <td>
          <div dir="ltr" style="text-align:right; font-weight:600;">${esc(o.customer_phone)}</div>
          <a href="https://wa.me/${waClean}?text=${waText}" target="_blank" style="color:#25d366; font-size:11.5px; font-weight:700; display:inline-flex; align-items:center; gap:3px;">
            واتساب مباشر ↗
          </a>
        </td>
        <td>
          <div>${esc(o.customer_city)}</div>
          <div style="font-size:11.5px; color:#888;">${esc(o.customer_address)}</div>
        </td>
        <td>
          <div style="font-size:12.5px;">
            ${o.items.map(i => `• ${esc(i.title)} (${esc(i.color)}) × ${esc(i.quantity)}`).join('<br>')}
          </div>
        </td>
        <td><strong style="font-size:15px;">$${o.total.toFixed(2)}</strong></td>
        <td><span style="font-size:11.5px; color:#555;">${esc(o.payment_method || 'Cash on Delivery')}</span></td>
        <td>
          <select class="form-control" style="font-size:12px; padding:4px 8px; width:130px;" onchange="updateOrderStatus('${o.id}', this.value)">
            <option value="Pending" ${o.status === 'Pending' ? 'selected' : ''}>⏳ جديد (Pending)</option>
            <option value="Processing" ${o.status === 'Processing' ? 'selected' : ''}>⚙️ جاري التجهيز</option>
            <option value="Shipped" ${o.status === 'Shipped' ? 'selected' : ''}>🚚 تم الشحن</option>
            <option value="Delivered" ${o.status === 'Delivered' ? 'selected' : ''}>✅ تم التسليم</option>
            <option value="Cancelled" ${o.status === 'Cancelled' ? 'selected' : ''}>❌ ملغي</option>
          </select>
        </td>
        <td>
          <button class="btn-action btn-action-outline" style="padding:4px 10px; font-size:12px;" onclick="viewOrderInvoice('${o.id}')">الفاتورة</button>
        </td>
      </tr>
    `;
  }).join('');
}

window.updateOrderStatus = async function (orderId, newStatus) {
  try {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const data = await res.json();
    if (data.success) {
      loadOrders();
      loadStats();
    }
  } catch (err) {
    alert('فشل تحديث حالة الطلب');
  }
};

window.viewOrderInvoice = function (orderId) {
  const o = AdminState.orders.find(ord => ord.id === orderId) || (AdminState.stats.recent_orders || []).find(ord => ord.id === orderId);
  if (!o) return;

  const content = document.getElementById('order-invoice-content');
  if (!content) return;

  content.innerHTML = `
    <div style="padding:10px 0;">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #141414; padding-bottom:16px; margin-bottom:20px;">
        <div>
          <h2 class="font-serif" style="font-size:26px; font-weight:700;">فاتورة شحن وتأكيد طلب</h2>
          <div style="color:#777; font-size:12.5px;">Omar Luxury Bags & Leather Goods</div>
        </div>
        <div style="text-align:left;">
          <div style="font-size:18px; font-weight:700;">#${o.order_number}</div>
          <div style="font-size:12px; color:#888;">${new Date(o.created_at).toLocaleString('ar-EG')}</div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; background:#faf8f5; padding:16px; border-radius:8px; margin-bottom:20px;">
        <div>
          <div style="font-size:12px; color:#888; font-weight:700;">بيانات العميل:</div>
          <div style="font-size:15px; font-weight:700; margin-top:2px;">${esc(o.customer_name)}</div>
          <div dir="ltr" style="text-align:right; font-size:13px; color:#444;">${esc(o.customer_phone)}</div>
        </div>
        <div>
          <div style="font-size:12px; color:#888; font-weight:700;">عنوان التوصيل:</div>
          <div style="font-size:14px; font-weight:600; margin-top:2px;">${esc(o.customer_city)}</div>
          <div style="font-size:13px; color:#555;">${esc(o.customer_address)}</div>
        </div>
      </div>

      ${o.notes ? `<div style="background:#fff8e1; padding:10px 14px; border-radius:6px; font-size:12.5px; margin-bottom:18px;"><strong>ملاحظات العميل:</strong> ${esc(o.notes)}</div>` : ''}

      <table style="width:100%; border-collapse:collapse; margin-bottom:20px; font-size:13px;">
        <thead>
          <tr style="border-bottom:1px solid #ddd; background:#f5f3ee;">
            <th style="padding:10px; text-align:right;">المنتج</th>
            <th style="padding:10px; text-align:center;">اللون</th>
            <th style="padding:10px; text-align:center;">الكمية</th>
            <th style="padding:10px; text-align:left;">السعر</th>
            <th style="padding:10px; text-align:left;">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${o.items.map(i => `
            <tr style="border-bottom:1px solid #eee;">
              <td style="padding:10px;"><strong>${esc(i.title)}</strong></td>
              <td style="padding:10px; text-align:center;">${esc(i.color)}</td>
              <td style="padding:10px; text-align:center;">${i.quantity}</td>
              <td style="padding:10px; text-align:left;">$${i.price.toFixed(2)}</td>
              <td style="padding:10px; text-align:left;"><strong>$${(i.price * i.quantity).toFixed(2)}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="display:flex; flex-direction:column; gap:6px; max-width:240px; margin-right:auto; margin-bottom:24px; font-size:13.5px;">
        <div style="display:flex; justify-content:space-between;">
          <span style="color:#777;">المجموع الفرعي:</span>
          <strong>$${o.subtotal.toFixed(2)}</strong>
        </div>
        ${o.discount ? `
          <div style="display:flex; justify-content:space-between; color:#2e7d32;">
            <span>خصم الكوبون:</span>
            <strong>-$${o.discount.toFixed(2)}</strong>
          </div>
        ` : ''}
        <div style="display:flex; justify-content:space-between;">
          <span style="color:#777;">رسوم التوصيل:</span>
          <strong>${o.shipping === 0 ? 'شحن مجاني' : '$' + o.shipping.toFixed(2)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:16px; font-weight:700; border-top:1.5px solid #141414; padding-top:8px;">
          <span>المبلغ المطلوب:</span>
          <span>$${o.total.toFixed(2)}</span>
        </div>
      </div>

      <div style="display:flex; gap:12px;">
        <button class="btn-action btn-action-primary" style="flex-grow:1; padding:12px;" onclick="window.print()">
          🖨️ طباعة الفاتورة للطلب
        </button>
        <button class="btn-action btn-action-outline" onclick="closeModal('order-modal')">
          إغلاق
        </button>
      </div>
    </div>
  `;

  document.getElementById('order-modal').classList.add('open');
};

// -------------------------------------------------------------------
// HERO BANNERS MANAGEMENT (Matching user requirement)
// -------------------------------------------------------------------
async function loadBanners() {
  try {
    const res = await fetch('/api/banners?all=true');
    AdminState.banners = await res.json();
    renderBannersList();
  } catch (err) {
    console.error('Error loading banners:', err);
  }
}

function renderBannersList() {
  const container = document.getElementById('admin-banners-list');
  if (!container) return;

  container.innerHTML = AdminState.banners.map((b, idx) => `
    <div style="background:#fff; border-radius:10px; border:1px solid var(--color-border); padding:20px; display:flex; gap:24px; align-items:center;">
      <img src="${b.image_url}" alt="${b.title}" style="width:160px; height:110px; object-fit:contain; background:#faf8f5; border-radius:6px; padding:6px; border:1px solid #eee;">
      
      <div style="flex-grow:1;">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
          <span style="background:var(--color-accent-gold-dark); color:#fff; font-size:11px; padding:2px 8px; border-radius:4px; font-weight:700;">${b.badge_text || 'عرض رئيسي'}</span>
          <h3 style="font-size:18px; font-weight:700;">${b.title}</h3>
        </div>
        <p style="font-size:13.5px; color:#666; margin-bottom:10px;">${b.subtitle || ''}</p>
        <div style="font-size:12.5px; color:#444;">
          <strong>نص الزر:</strong> "${b.button_text}" • <strong>الرابط:</strong> ${b.button_link}
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <button class="btn-action btn-action-outline" onclick="editBannerModal('${b.id}')">تعديل البنر</button>
        <button class="btn-action ${b.active ? 'btn-action-success' : 'btn-action-outline'}" onclick="toggleBannerActive('${b.id}', ${!b.active})">
          ${b.active ? 'نشط بالمتجر ✓' : 'مخفي ✕'}
        </button>
      </div>
    </div>
  `).join('');
}

window.openAddBannerModal = function () {
  document.getElementById('banner-modal-title').textContent = 'إضافة بنر / عرض رئيسي جديد';
  document.getElementById('banner-id').value = '';
  document.getElementById('banner-title').value = '';
  document.getElementById('banner-subtitle').value = '';
  document.getElementById('banner-btn-text').value = 'Shop Collection';
  document.getElementById('banner-badge-text').value = 'NEW COLLECTION 2026';
  document.getElementById('banner-image-url').value = '/extracted/hero_model.jpg';
  document.getElementById('banner-img-preview').src = '/extracted/hero_model.jpg';
  document.getElementById('banner-modal').classList.add('open');
};

window.editBannerModal = function (bannerId) {
  const b = AdminState.banners.find(x => x.id === bannerId);
  if (!b) return;

  document.getElementById('banner-modal-title').textContent = 'تعديل البنر الرئيسي';
  document.getElementById('banner-id').value = b.id;
  document.getElementById('banner-title').value = b.title;
  document.getElementById('banner-subtitle').value = b.subtitle || '';
  document.getElementById('banner-btn-text').value = b.button_text || 'Shop Collection';
  document.getElementById('banner-badge-text').value = b.badge_text || '';
  document.getElementById('banner-image-url').value = b.image_url;
  document.getElementById('banner-img-preview').src = b.image_url;
  document.getElementById('banner-modal').classList.add('open');
};

window.handleBannerImageUpload = async function (input) {
  if (!input.files || !input.files[0]) return;
  const formData = new FormData();
  formData.append('image', input.files[0]);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      document.getElementById('banner-image-url').value = data.url;
      document.getElementById('banner-img-preview').src = data.url;
    }
  } catch (err) {
    alert('حدث خطأ في رفع الصورة');
  }
};

window.saveBannerForm = async function (e) {
  e.preventDefault();
  const id = document.getElementById('banner-id').value;
  const title = document.getElementById('banner-title').value.trim();
  const subtitle = document.getElementById('banner-subtitle').value.trim();
  const button_text = document.getElementById('banner-btn-text').value.trim();
  const badge_text = document.getElementById('banner-badge-text').value.trim();
  const image_url = document.getElementById('banner-image-url').value;

  const payload = { title, subtitle, button_text, badge_text, image_url, active: true };

  try {
    const url = id ? `/api/banners/${id}` : '/api/banners';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      closeModal('banner-modal');
      loadBanners();
    }
  } catch (err) {
    alert('تعذر حفظ البنر');
  }
};

window.toggleBannerActive = async function (bannerId, newStatus) {
  try {
    await fetch(`/api/banners/${bannerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: newStatus })
    });
    loadBanners();
  } catch (err) {
    alert('خطأ في التحديث');
  }
};

// -------------------------------------------------------------------
// 6 PROMO CARDS MANAGEMENT (Matching photo)
// -------------------------------------------------------------------
async function loadPromoCards() {
  try {
    const res = await fetch('/api/promo-cards');
    AdminState.promoCards = await res.json();
    renderPromoCardsTable();
  } catch (err) {
    console.error('Error loading promo cards:', err);
  }
}

function renderPromoCardsTable() {
  const tbody = document.getElementById('admin-promos-table');
  if (!tbody) return;

  tbody.innerHTML = AdminState.promoCards.map(c => `
    <tr>
      <td>
        <img src="${c.image_url}" alt="${c.category}" style="width:50px; height:50px; object-fit:contain; background:#faf8f5; border-radius:4px;">
      </td>
      <td><strong>${c.category}</strong></td>
      <td>
        <input type="text" class="form-control" value="${c.badge}" style="width:180px; font-weight:700;" onchange="updatePromoCard('${c.id}', 'badge', this.value)">
      </td>
      <td>
        <input type="text" class="form-control" value="${c.button_text}" style="width:120px;" onchange="updatePromoCard('${c.id}', 'button_text', this.value)">
      </td>
      <td>
        <input type="text" class="form-control" value="${c.button_link}" style="width:150px;" onchange="updatePromoCard('${c.id}', 'button_link', this.value)">
      </td>
      <td>
        <span style="color:#2e7d32; font-size:12px; font-weight:600;">يتم الحفظ تلقائياً ✓</span>
      </td>
    </tr>
  `).join('');
}

window.updatePromoCard = async function (cardId, field, val) {
  try {
    await fetch(`/api/promo-cards/${cardId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: val })
    });
  } catch (err) {
    alert('فشل تحديث البطاقة');
  }
};

// -------------------------------------------------------------------
// REVIEWS MANAGEMENT (Customer review approvals & manual)
// -------------------------------------------------------------------
async function loadReviews() {
  try {
    const res = await fetch('/api/reviews?all=true');
    AdminState.reviews = await res.json();
    renderReviewsTable();
  } catch (err) {
    console.error('Error loading reviews:', err);
  }
}

function renderReviewsTable() {
  const tbody = document.getElementById('admin-reviews-table');
  if (!tbody) return;

  tbody.innerHTML = AdminState.reviews.map(r => `
    <tr>
      <td><strong>${esc(r.author_name)}</strong></td>
      <td>${esc(r.product_name || '-')}</td>
      <td style="color:#d97706;">${'★'.repeat(Math.min(5, Math.max(1, parseInt(r.rating) || 5)))}</td>
      <td style="max-width:300px; font-size:12.5px;">"${esc(r.comment)}"</td>
      <td style="font-size:12px; color:#888;">${new Date(r.created_at).toLocaleDateString('ar-EG')}</td>
      <td>
        <span style="background:${r.status === 'approved' ? '#e8f5e9' : '#fff3e0'}; color:${r.status === 'approved' ? '#2e7d32' : '#e65100'}; padding:3px 8px; border-radius:4px; font-size:11.5px; font-weight:700;">
          ${r.status === 'approved' ? 'منشور في المتجر' : 'قيد الانتظار'}
        </span>
      </td>
      <td>
        <div style="display:flex; gap:6px;">
          ${r.status !== 'approved' ? `
            <button class="btn-action btn-action-success" style="padding:4px 8px; font-size:11.5px;" onclick="approveReview('${r.id}', 'approved')">موافقة ونشر</button>
          ` : `
            <button class="btn-action btn-action-outline" style="padding:4px 8px; font-size:11.5px;" onclick="approveReview('${r.id}', 'pending')">إخفاء</button>
          `}
          <button class="btn-action btn-action-danger" style="padding:4px 8px; font-size:11.5px;" onclick="deleteReview('${r.id}')">حذف</button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.approveReview = async function (revId, status) {
  try {
    await fetch(`/api/reviews/${revId}/approve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    loadReviews();
  } catch (err) {
    alert('فشل التحديث');
  }
};

window.deleteReview = async function (revId) {
  if (!confirm('حذف هذا التقييم؟')) return;
  try {
    await fetch(`/api/reviews/${revId}`, { method: 'DELETE' });
    loadReviews();
  } catch (err) {
    alert('فشل الحذف');
  }
};

window.openAddReviewModal = function () {
  document.getElementById('admin-review-modal').classList.add('open');
};

window.saveAdminReview = async function (e) {
  e.preventDefault();
  const author_name = document.getElementById('adm-rev-name').value.trim();
  const product_name = document.getElementById('adm-rev-prod').value.trim();
  const rating = parseInt(document.getElementById('adm-rev-rating').value) || 5;
  const comment = document.getElementById('adm-rev-comment').value.trim();

  try {
    await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author_name, product_name, rating, comment })
    });
    closeModal('admin-review-modal');
    e.target.reset();
    loadReviews();
  } catch (err) {
    alert('تعذر إضافة المراجعة');
  }
};

// -------------------------------------------------------------------
// COUPONS MANAGEMENT
// -------------------------------------------------------------------
async function loadCoupons() {
  try {
    const res = await fetch('/api/coupons');
    AdminState.coupons = await res.json();
    renderCouponsTable();
  } catch (err) {
    console.error('Error loading coupons:', err);
  }
}

function renderCouponsTable() {
  const tbody = document.getElementById('admin-coupons-table');
  if (!tbody) return;

  tbody.innerHTML = AdminState.coupons.map(c => `
    <tr>
      <td><strong style="letter-spacing:0.05em; font-size:14px; background:#faf8f5; padding:3px 10px; border-radius:4px; border:1px dashed #ccc;">${c.code}</strong></td>
      <td>${c.discount_type === 'percentage' ? 'نسبة مئوية (%)' : 'مبلغ ثابت ($)'}</td>
      <td><strong>${c.discount_type === 'percentage' ? c.discount_value + '%' : '$' + c.discount_value}</strong></td>
      <td>$${c.min_order || 0}</td>
      <td><span style="color:#2e7d32; font-weight:700;">نشط</span></td>
      <td>
        <button class="btn-action btn-action-danger" style="padding:4px 8px; font-size:11.5px;" onclick="deleteCoupon('${c.code}')">حذف الكوبون</button>
      </td>
    </tr>
  `).join('');
}

window.openAddCouponModal = async function () {
  const code = prompt('أدخل كود الخصم الجديد (مثال: LUXURY25):');
  if (!code) return;
  const val = prompt('أدخل قيمة الخصم (مثال: 15):', '10');
  if (!val) return;
  const minOrder = prompt('الحد الأدنى لقيمة الطلب لاستخدام الكوبون ($):', '100');

  try {
    await fetch('/api/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code.trim(),
        discount_type: 'percentage',
        discount_value: parseFloat(val),
        min_order: parseFloat(minOrder) || 0
      })
    });
    loadCoupons();
  } catch (err) {
    alert('فشل إنشاء الكوبون');
  }
};

window.deleteCoupon = async function (code) {
  if (!confirm(`حذف الكوبون ${code}؟`)) return;
  try {
    await fetch(`/api/coupons/${code}`, { method: 'DELETE' });
    loadCoupons();
  } catch (err) {
    alert('فشل حذف الكوبون');
  }
};

// -------------------------------------------------------------------
// STORE SETTINGS
// -------------------------------------------------------------------
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    AdminState.settings = await res.json();
    
    document.getElementById('setting-store-name').value = AdminState.settings.store_name || '';
    document.getElementById('setting-tagline').value = AdminState.settings.tagline || '';
    document.getElementById('setting-announcement').value = AdminState.settings.announcement || '';
    document.getElementById('setting-shipping').value = AdminState.settings.shipping_fee || 15;
    document.getElementById('setting-free-shipping').value = AdminState.settings.free_shipping_threshold || 100;
    document.getElementById('setting-whatsapp').value = AdminState.settings.whatsapp_number || '';
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

window.saveSettings = async function (e) {
  e.preventDefault();
  const payload = {
    store_name: document.getElementById('setting-store-name').value.trim(),
    tagline: document.getElementById('setting-tagline').value.trim(),
    announcement: document.getElementById('setting-announcement').value.trim(),
    shipping_fee: parseFloat(document.getElementById('setting-shipping').value),
    free_shipping_threshold: parseFloat(document.getElementById('setting-free-shipping').value),
    whatsapp_number: document.getElementById('setting-whatsapp').value.trim()
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      alert('تم حفظ إعدادات المتجر بنجاح!');
    }
  } catch (err) {
    alert('فشل حفظ الإعدادات');
  }
};

window.closeModal = function (id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('open');
};

async function checkDatabaseStatus() {
  const badge = document.getElementById('db-status-badge');
  const dot = document.getElementById('db-status-dot');
  const text = document.getElementById('db-status-text');
  if (!badge || !dot || !text) return;

  try {
    const res = await fetch('/api/db-status');
    const data = await res.json();
    if (data.connected) {
      badge.style.background = '#e8f5e9';
      badge.style.borderColor = '#c8e6c9';
      badge.style.color = '#2e7d32';
      dot.style.background = '#2e7d32';
      text.textContent = 'قاعدة بيانات سحابية: متصلة (محفوظة دائماً)';
      badge.title = `قاعدة البيانات متصلة بنجاح: ${data.products_count} منتج، ${data.orders_count} طلب في السحابة.`;
    } else {
      badge.style.background = '#fff3e0';
      badge.style.borderColor = '#ffe0b2';
      badge.style.color = '#e65100';
      dot.style.background = '#e65100';
      text.textContent = 'تنبيه: تخزين محلي مؤقت (غير متصل بالسحابة)';
      badge.title = 'تأكد من إعداد متغير البيئة MONGODB_URI و IP Whitelist في MongoDB Atlas';
    }
  } catch (err) {
    if (dot) dot.style.background = '#d32f2f';
    if (text) text.textContent = 'خطأ في فحص قاعدة البيانات';
  }
}

// Start on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  checkDatabaseStatus();
  loadStats();
  setInterval(checkDatabaseStatus, 25000);
});
