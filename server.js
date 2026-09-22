require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose');
const crypto = require('crypto');

// Cloudinary Configuration (credentials come only from .env / the host's environment variables)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// MongoDB Atlas Configuration
const MONGODB_URI = process.env.MONGODB_URI;
let isMongoConnected = false;
let mongoLastError = MONGODB_URI ? null : 'MONGODB_URI is not set on this server';

const modelMap = {
  products: 'Product',
  orders: 'Order',
  banners: 'Banner',
  promo_cards: 'PromoCard',
  reviews: 'Review',
  coupons: 'Coupon',
  settings: 'Setting'
};

const MongoModels = {};
for (const [key, modelName] of Object.entries(modelMap)) {
  // id: false — Mongoose's built-in `id` virtual otherwise swallows our own `id` field (prod-..., ord-...),
  // so every Atlas round-trip stripped the ids that the storefront, cart and admin panel rely on.
  MongoModels[key] = mongoose.models[modelName] || mongoose.model(modelName, new mongoose.Schema({}, { strict: false, timestamps: true, id: false }));
}

const app = express();
const PORT = process.env.PORT || 3050;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure directories exist
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const EXTRACTED_DIR = path.join(__dirname, 'public', 'extracted');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(EXTRACTED_DIR)) fs.mkdirSync(EXTRACTED_DIR, { recursive: true });

// Static Files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/extracted', express.static(EXTRACTED_DIR));

// Multer Storage Configuration for File Uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const cleanName = 'upload_' + Date.now() + '_' + Math.round(Math.random() * 1e6) + ext;
    cb(null, cleanName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// ----------------------------------------------------
// Database Layer: MongoDB Atlas Cloud + Resilient Local Fallback
// ----------------------------------------------------
async function connectMongoDB() {
  if (!MONGODB_URI) {
    console.warn('⚠️ MONGODB_URI not found in environment variables, running with local file storage.');
    return;
  }
  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000
    });
    isMongoConnected = true;
    console.log('🍃 Connected to MongoDB Atlas Cloud Successfully!');

    // Initialize & sync collections safely without data loss
    for (const [key, Model] of Object.entries(MongoModels)) {
      try {
        const count = await Model.countDocuments();
        const filePath = path.join(DATA_DIR, key + '.json');
        
        if (count > 0) {
          // Atlas is the source of truth: load latest cloud data into local cache
          const docs = await Model.find({}).lean();
          if (key === 'settings') {
            const settingObj = { ...docs[0] };
            delete settingObj._id;
            delete settingObj.__v;
            fs.writeFileSync(filePath, JSON.stringify(settingObj, null, 2), 'utf-8');
          } else {
            const cleanDocs = docs.map(d => {
              const copy = { ...d };
              delete copy._id;
              delete copy.__v;
              return copy;
            });
            fs.writeFileSync(filePath, JSON.stringify(cleanDocs, null, 2), 'utf-8');
          }
          console.log(`[MongoDB Atlas] Loaded ${count} ${key} from Cloud into local cache.`);
        } else {
          // Cloud collection is empty: seed from local seed file if available
          const localData = readData(key + '.json');
          if (Array.isArray(localData) && localData.length > 0) {
            await Model.insertMany(localData);
            console.log(`[MongoDB Atlas] Seeded ${localData.length} ${key} into Cloud.`);
          } else if (localData && typeof localData === 'object' && Object.keys(localData).length > 0) {
            await Model.create(localData);
            console.log(`[MongoDB Atlas] Seeded settings into Cloud.`);
          }
        }
      } catch (colErr) {
        console.warn(`[MongoDB Atlas] Notice reading/seeding ${key}:`, colErr.message);
      }
    }
  } catch (err) {
    isMongoConnected = false;
    mongoLastError = err.message;
    // Never give up: while disconnected, changes only live on this server's temporary disk and are
    // wiped when the host restarts or sleeps, so keep retrying until Atlas is reachable.
    console.error('❌ MongoDB Atlas connection failed, retrying in 15s:', err.message);
    setTimeout(connectMongoDB, 15000);
  }
}

mongoose.connection.on('disconnected', () => {
  isMongoConnected = false;
  console.warn('⚠️ MongoDB disconnected.');
});
mongoose.connection.on('connected', () => {
  isMongoConnected = true;
  mongoLastError = null;
  console.log('🍃 MongoDB reconnected.');
});

connectMongoDB();

function readData(filename) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Error reading ${filename}:`, err);
    return [];
  }
}

function writeData(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`Error writing ${filename}:`, err);
    return false;
  }
}

// Asynchronous Data Access Layer: queries MongoDB directly when online, falls back to disk
async function getData(key) {
  if (isMongoConnected && MongoModels[key]) {
    try {
      const docs = await MongoModels[key].find({}).lean();
      if (docs && docs.length > 0) {
        if (key === 'settings') {
          const settingObj = { ...docs[0] };
          delete settingObj._id;
          delete settingObj.__v;
          return settingObj;
        }
        return docs.map(d => {
          const copy = { ...d };
          delete copy._id;
          delete copy.__v;
          return copy;
        });
      }
    } catch (err) {
      console.warn(`[MongoDB getData] Error for ${key}:`, err.message);
    }
  }
  return readData(key + '.json');
}

// ----------------------------------------------------
// Admin guard: anything that changes store data or exposes customer data needs the admin PIN
// (header "x-admin-pin"). Set ADMIN_PIN in the server's environment; settings.admin_pin or 123456 fallback.
// ----------------------------------------------------
const PUBLIC_API = [
  ['GET', /^\/products(\/[^/]+)?$/],
  ['GET', /^\/banners$/],
  ['GET', /^\/promo-cards$/],
  ['GET', /^\/reviews$/],
  ['GET', /^\/settings$/],
  ['GET', /^\/db-status$/],
  ['POST', /^\/orders$/],
  ['POST', /^\/reviews$/],
  ['POST', /^\/coupons\/validate$/]
];

function isAdminRequest(req) {
  const expectedPin = String(process.env.ADMIN_PIN || readData('settings.json').admin_pin || '123456');
  const expected = Buffer.from(expectedPin);
  const given = Buffer.from(String(req.get('x-admin-pin') || ''));
  return expected.length > 0 && given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

app.use('/api', (req, res, next) => {
  const isPublic = req.query.all !== 'true' && PUBLIC_API.some(([method, path]) => req.method === method && path.test(req.path));
  if (isPublic || isAdminRequest(req)) return next();
  res.status(401).json({ success: false, message: 'Admin authorization required' });
});

// Database Health & Status Endpoint
app.get('/api/db-status', async (req, res) => {
  let productsCount = 0;
  let ordersCount = 0;
  if (isMongoConnected && MongoModels.products && MongoModels.orders) {
    try {
      productsCount = await MongoModels.products.countDocuments();
      ordersCount = await MongoModels.orders.countDocuments();
    } catch (e) {}
  } else {
    productsCount = (readData('products.json') || []).length;
    ordersCount = (readData('orders.json') || []).length;
  }

  res.json({
    connected: isMongoConnected,
    storage: isMongoConnected ? 'MongoDB Atlas Cloud' : 'Local Fallback',
    has_mongo_uri: !!process.env.MONGODB_URI,
    mongo_error: mongoLastError,
    products_count: productsCount,
    orders_count: ordersCount,
    readyState: mongoose.connection.readyState
  });
});

// ----------------------------------------------------
// API: File Upload (Cloudinary with Local Fallback)
// ----------------------------------------------------
app.post('/api/upload', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  try {
    // Upload directly to Cloudinary with automatic WebP optimization
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'omar_luxury',
      use_filename: true,
      quality: 'auto:best',
      fetch_format: 'auto'
    });

    console.log('[Cloudinary] Successfully uploaded:', result.secure_url);
    return res.json({
      success: true,
      url: result.secure_url,
      filename: req.file.filename,
      public_id: result.public_id,
      storage: 'cloudinary'
    });
  } catch (err) {
    console.warn('[Cloudinary Fallback] Upload error:', err.message);
    const localUrl = `/uploads/${req.file.filename}`;
    return res.json({
      success: true,
      url: localUrl,
      filename: req.file.filename,
      storage: 'local'
    });
  }
});

app.post('/api/upload-multiple', upload.array('images', 8), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: 'No files uploaded' });
  }

  const urls = [];
  for (const file of req.files) {
    try {
      const result = await cloudinary.uploader.upload(file.path, {
        folder: 'omar_luxury',
        use_filename: true,
        quality: 'auto:best',
        fetch_format: 'auto'
      });
      urls.push(result.secure_url);
    } catch (err) {
      console.warn('[Cloudinary Fallback] Single file upload error:', err.message);
      urls.push(`/uploads/${file.filename}`);
    }
  }

  res.json({ success: true, urls });
});

// ----------------------------------------------------
// API: Products & Pricing Management
// ----------------------------------------------------
app.get('/api/products', async (req, res) => {
  let products = await getData('products');
  const { category, search, sort, is_new, featured } = req.query;

  // Filter only active for public requests (unless admin is querying)
  if (req.query.all !== 'true') {
    products = products.filter(p => p.active !== false);
  }

  if (category && category !== 'all' && category !== 'All') {
    const catLower = category.toLowerCase().trim();
    products = products.filter(p => {
      const pCat = (p.category || '').toLowerCase().trim();
      return pCat === catLower || pCat.includes(catLower) || (catLower === 'tote' && pCat.includes('tote'));
    });
  }

  if (is_new === 'true') {
    products = products.filter(p => p.is_new_arrival || p.badge === 'New');
  }

  if (featured === 'true') {
    products = products.filter(p => p.featured);
  }

  if (search) {
    const q = search.toLowerCase().trim();
    products = products.filter(p => 
      (p.title && p.title.toLowerCase().includes(q)) ||
      (p.subtitle && p.subtitle.toLowerCase().includes(q)) ||
      (p.category && p.category.toLowerCase().includes(q))
    );
  }

  // Sorting
  if (sort === 'price_asc') {
    products.sort((a, b) => a.price - b.price);
  } else if (sort === 'price_desc') {
    products.sort((a, b) => b.price - a.price);
  } else if (sort === 'rating') {
    products.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  res.json(products);
});

app.get('/api/products/:id', async (req, res) => {
  const products = await getData('products');
  const product = products.find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ message: 'Product not found' });
  res.json(product);
});

app.post('/api/products', async (req, res) => {
  const products = await getData('products');
  const newProduct = {
    id: 'prod-' + Date.now(),
    title: req.body.title || 'Untitled Luxury Bag',
    subtitle: req.body.subtitle || '',
    description: req.body.description || '',
    category: req.body.category || 'Tote Bags',
    price: parseFloat(req.body.price) || 0,
    original_price: parseFloat(req.body.original_price) || 0,
    badge: req.body.badge || '',
    image: req.body.image || '/extracted/prod_tote_classic.jpg',
    images: req.body.images && req.body.images.length > 0 ? req.body.images : [req.body.image || '/extracted/prod_tote_classic.jpg'],
    colors: req.body.colors || [
      { name: 'Classic Black', hex: '#1c1b1a', image: req.body.image || '/extracted/prod_tote_classic.jpg' }
    ],
    stock: parseInt(req.body.stock) || 10,
    rating: 5.0,
    reviews_count: 0,
    featured: req.body.featured === true || req.body.featured === 'true',
    is_new_arrival: req.body.is_new_arrival === true || req.body.is_new_arrival === 'true',
    active: req.body.active !== false && req.body.active !== 'false',
    created_at: new Date().toISOString()
  };

  products.unshift(newProduct);
  writeData('products.json', products);

  if (isMongoConnected && MongoModels.products) {
    try {
      await MongoModels.products.create(newProduct);
    } catch (err) {
      console.error('[MongoDB] Error creating product:', err.message);
    }
  }

  res.status(201).json({ success: true, product: newProduct });
});

app.put('/api/products/:id', async (req, res) => {
  const products = await getData('products');
  const index = products.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ message: 'Product not found' });

  const updated = {
    ...products[index],
    ...req.body,
    price: req.body.price !== undefined ? parseFloat(req.body.price) : products[index].price,
    original_price: req.body.original_price !== undefined ? parseFloat(req.body.original_price) : products[index].original_price,
    stock: req.body.stock !== undefined ? parseInt(req.body.stock) : products[index].stock,
    updated_at: new Date().toISOString()
  };

  products[index] = updated;
  writeData('products.json', products);

  if (isMongoConnected && MongoModels.products) {
    try {
      await MongoModels.products.findOneAndUpdate({ id: req.params.id }, updated, { upsert: true, new: true });
    } catch (err) {
      console.error('[MongoDB] Error updating product:', err.message);
    }
  }

  res.json({ success: true, product: updated });
});

// Quick price update endpoint for Admin table
app.patch('/api/products/:id/price', async (req, res) => {
  const products = await getData('products');
  const index = products.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ message: 'Product not found' });

  const { price, original_price } = req.body;
  if (price !== undefined) products[index].price = parseFloat(price);
  if (original_price !== undefined) products[index].original_price = parseFloat(original_price);
  products[index].updated_at = new Date().toISOString();

  writeData('products.json', products);

  if (isMongoConnected && MongoModels.products) {
    try {
      await MongoModels.products.updateOne(
        { id: req.params.id },
        { $set: { price: products[index].price, original_price: products[index].original_price, updated_at: products[index].updated_at } }
      );
    } catch (err) {
      console.error('[MongoDB] Error patching price:', err.message);
    }
  }

  res.json({ success: true, product: products[index] });
});

app.delete('/api/products/:id', async (req, res) => {
  let products = await getData('products');
  const initialLen = products.length;
  products = products.filter(p => p.id !== req.params.id);
  if (products.length === initialLen) {
    return res.status(404).json({ message: 'Product not found' });
  }

  writeData('products.json', products);

  if (isMongoConnected && MongoModels.products) {
    try {
      await MongoModels.products.deleteOne({ id: req.params.id });
    } catch (err) {
      console.error('[MongoDB] Error deleting product:', err.message);
    }
  }

  res.json({ success: true, message: 'Product deleted' });
});

// ----------------------------------------------------
// API: Hero Banners & Offers
// ----------------------------------------------------
app.get('/api/banners', async (req, res) => {
  const banners = await getData('banners');
  if (req.query.all === 'true') {
    return res.json(banners);
  }
  res.json(banners.filter(b => b.active));
});

app.post('/api/banners', async (req, res) => {
  const banners = await getData('banners');
  const newBanner = {
    id: 'banner-' + Date.now(),
    title: req.body.title || 'New Luxury Offer',
    subtitle: req.body.subtitle || '',
    button_text: req.body.button_text || 'Shop Now',
    button_link: req.body.button_link || '#shop',
    image_url: req.body.image_url || '/extracted/hero_model.jpg',
    badge_text: req.body.badge_text || 'LIMITED EDITION',
    discount_badge: req.body.discount_badge || '',
    active: req.body.active !== false && req.body.active !== 'false',
    sort_order: banners.length + 1,
    created_at: new Date().toISOString()
  };
  banners.push(newBanner);
  writeData('banners.json', banners);

  if (isMongoConnected && MongoModels.banners) {
    try {
      await MongoModels.banners.create(newBanner);
    } catch (err) {
      console.error('[MongoDB] Error creating banner:', err.message);
    }
  }

  res.status(201).json({ success: true, banner: newBanner });
});

app.put('/api/banners/:id', async (req, res) => {
  const banners = await getData('banners');
  const index = banners.findIndex(b => b.id === req.params.id);
  if (index === -1) return res.status(404).json({ message: 'Banner not found' });

  banners[index] = {
    ...banners[index],
    ...req.body
  };
  writeData('banners.json', banners);

  if (isMongoConnected && MongoModels.banners) {
    try {
      await MongoModels.banners.findOneAndUpdate({ id: req.params.id }, banners[index], { upsert: true, new: true });
    } catch (err) {
      console.error('[MongoDB] Error updating banner:', err.message);
    }
  }

  res.json({ success: true, banner: banners[index] });
});

app.delete('/api/banners/:id', async (req, res) => {
  let banners = await getData('banners');
  banners = banners.filter(b => b.id !== req.params.id);
  writeData('banners.json', banners);

  if (isMongoConnected && MongoModels.banners) {
    try {
      await MongoModels.banners.deleteOne({ id: req.params.id });
    } catch (err) {
      console.error('[MongoDB] Error deleting banner:', err.message);
    }
  }

  res.json({ success: true });
});

// ----------------------------------------------------
// API: Promo Cards
// ----------------------------------------------------
app.get('/api/promo-cards', async (req, res) => {
  const cards = await getData('promo_cards');
  res.json(cards);
});

app.put('/api/promo-cards/:id', async (req, res) => {
  const cards = await getData('promo_cards');
  const idx = cards.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ message: 'Card not found' });
  cards[idx] = { ...cards[idx], ...req.body };
  writeData('promo_cards.json', cards);

  if (isMongoConnected && MongoModels.promo_cards) {
    try {
      await MongoModels.promo_cards.findOneAndUpdate({ id: req.params.id }, cards[idx], { upsert: true, new: true });
    } catch (err) {
      console.error('[MongoDB] Error updating promo card:', err.message);
    }
  }

  res.json({ success: true, card: cards[idx] });
});

// ----------------------------------------------------
// API: Orders Management
// ----------------------------------------------------
app.get('/api/orders', async (req, res) => {
  const orders = await getData('orders');
  res.json(orders);
});

app.get('/api/orders/:id', async (req, res) => {
  const orders = await getData('orders');
  const order = orders.find(o => o.id === req.params.id || o.order_number === req.params.id);
  if (!order) return res.status(404).json({ message: 'Order not found' });
  res.json(order);
});

app.post('/api/orders', async (req, res) => {
  const orders = await getData('orders');
  const settings = await getData('settings');
  const products = await getData('products');

  const { customer_name, customer_phone, customer_city, customer_address, notes, items, payment_method, coupon_code } = req.body;

  if (!customer_name || !customer_phone || !items || items.length === 0) {
    return res.status(400).json({ success: false, message: 'Please provide all required fields' });
  }

  // Prices, titles and images always come from catalog
  if (!Array.isArray(items) || items.some(item => !products.find(prod => prod.id === item.product_id))) {
    return res.status(400).json({ success: false, message: 'One of the items is no longer available. Please refresh your bag.' });
  }

  let subtotal = 0;
  const processedItems = items.map(item => {
    const p = products.find(prod => prod.id === item.product_id);
    const qty = Math.min(20, Math.max(1, parseInt(item.quantity) || 1));
    const color = (p.colors || []).find(c => c.name === item.color);
    subtotal += p.price * qty;

    // Decrement stock in catalog
    if (p.stock !== undefined) {
      p.stock = Math.max(0, p.stock - qty);
    }

    return {
      product_id: p.id,
      title: p.title,
      color: color ? color.name : String(item.color || 'Standard').slice(0, 60),
      price: p.price,
      quantity: qty,
      image: (color && color.image) || p.image
    };
  });

  // Calculate discount if coupon applied
  let discount = 0;
  if (coupon_code) {
    const coupons = await getData('coupons');
    const coupon = coupons.find(c => c.code.toUpperCase() === coupon_code.toUpperCase() && c.active);
    if (coupon && subtotal >= (coupon.min_order || 0)) {
      discount = coupon.discount_type === 'percentage' 
        ? (subtotal * coupon.discount_value) / 100 
        : coupon.discount_value;
    }
  }

  // Calculate shipping
  const freeThreshold = settings.free_shipping_threshold || 50;
  const shippingFee = (subtotal >= freeThreshold) ? 0 : (settings.shipping_fee || 3);
  const total = Math.max(0, subtotal - discount + shippingFee);

  const newOrder = {
    id: 'ord-' + Date.now(),
    order_number: 'ORD-' + Math.floor(1000 + Math.random() * 9000),
    customer_name,
    customer_phone,
    customer_city: customer_city || '',
    customer_address: customer_address || '',
    notes: notes || '',
    items: processedItems,
    subtotal: parseFloat(subtotal.toFixed(2)),
    shipping: parseFloat(shippingFee.toFixed(2)),
    discount: parseFloat(discount.toFixed(2)),
    total: parseFloat(total.toFixed(2)),
    payment_method: payment_method || 'Cash on Delivery',
    status: 'Pending',
    created_at: new Date().toISOString()
  };

  orders.unshift(newOrder);
  writeData('orders.json', orders);
  writeData('products.json', products);

  // Directly persist order & decrement stocks in MongoDB Atlas Cloud
  if (isMongoConnected) {
    try {
      if (MongoModels.orders) {
        await MongoModels.orders.create(newOrder);
      }
      if (MongoModels.products) {
        for (const item of processedItems) {
          await MongoModels.products.updateOne(
            { id: item.product_id },
            { $inc: { stock: -item.quantity } }
          );
        }
      }
      console.log(`[MongoDB Atlas] Successfully saved new order ${newOrder.order_number}`);
    } catch (dbErr) {
      console.error('[MongoDB Atlas] Error saving order to cloud:', dbErr.message);
    }
  }

  res.status(201).json({ success: true, order: newOrder });
});

app.patch('/api/orders/:id/status', async (req, res) => {
  const orders = await getData('orders');
  const index = orders.findIndex(o => o.id === req.params.id);
  if (index === -1) return res.status(404).json({ message: 'Order not found' });

  const { status } = req.body;
  const validStatuses = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }

  orders[index].status = status;
  orders[index].updated_at = new Date().toISOString();
  writeData('orders.json', orders);

  if (isMongoConnected && MongoModels.orders) {
    try {
      await MongoModels.orders.updateOne(
        { id: req.params.id },
        { $set: { status, updated_at: orders[index].updated_at } }
      );
    } catch (err) {
      console.error('[MongoDB] Error updating order status:', err.message);
    }
  }

  res.json({ success: true, order: orders[index] });
});

app.delete('/api/orders/:id', async (req, res) => {
  let orders = await getData('orders');
  orders = orders.filter(o => o.id !== req.params.id);
  writeData('orders.json', orders);

  if (isMongoConnected && MongoModels.orders) {
    try {
      await MongoModels.orders.deleteOne({ id: req.params.id });
    } catch (err) {
      console.error('[MongoDB] Error deleting order:', err.message);
    }
  }

  res.json({ success: true });
});

// ----------------------------------------------------
// API: Reviews & Testimonials
// ----------------------------------------------------
app.get('/api/reviews', async (req, res) => {
  const reviews = await getData('reviews');
  if (req.query.all === 'true') {
    return res.json(reviews);
  }
  // Public view: only approved
  res.json(reviews.filter(r => r.status === 'approved'));
});

app.post('/api/reviews', async (req, res) => {
  const reviews = await getData('reviews');
  const { author_name, product_name, rating, comment } = req.body;

  if (!author_name || !comment) {
    return res.status(400).json({ message: 'Please provide your name and review' });
  }

  const newReview = {
    id: 'rev-' + Date.now(),
    author_name: String(author_name).slice(0, 80),
    product_name: String(product_name || '').slice(0, 120),
    rating: Math.min(5, Math.max(1, parseInt(rating) || 5)),
    comment: String(comment).slice(0, 2000),
    verified: false,
    status: isAdminRequest(req) ? 'approved' : 'pending',
    created_at: new Date().toISOString()
  };

  reviews.unshift(newReview);
  writeData('reviews.json', reviews);

  if (isMongoConnected && MongoModels.reviews) {
    try {
      await MongoModels.reviews.create(newReview);
    } catch (err) {
      console.error('[MongoDB] Error saving review:', err.message);
    }
  }

  res.status(201).json({ success: true, review: newReview });
});

app.patch('/api/reviews/:id/approve', async (req, res) => {
  const reviews = await getData('reviews');
  const index = reviews.findIndex(r => r.id === req.params.id);
  if (index === -1) return res.status(404).json({ message: 'Review not found' });

  reviews[index].status = req.body.status || 'approved';
  writeData('reviews.json', reviews);

  if (isMongoConnected && MongoModels.reviews) {
    try {
      await MongoModels.reviews.updateOne(
        { id: req.params.id },
        { $set: { status: reviews[index].status } }
      );
    } catch (err) {
      console.error('[MongoDB] Error approving review:', err.message);
    }
  }

  res.json({ success: true, review: reviews[index] });
});

app.delete('/api/reviews/:id', async (req, res) => {
  let reviews = await getData('reviews');
  reviews = reviews.filter(r => r.id !== req.params.id);
  writeData('reviews.json', reviews);

  if (isMongoConnected && MongoModels.reviews) {
    try {
      await MongoModels.reviews.deleteOne({ id: req.params.id });
    } catch (err) {
      console.error('[MongoDB] Error deleting review:', err.message);
    }
  }

  res.json({ success: true });
});

// ----------------------------------------------------
// API: Coupons
// ----------------------------------------------------
app.get('/api/coupons', async (req, res) => {
  res.json(await getData('coupons'));
});

app.post('/api/coupons/validate', async (req, res) => {
  const coupons = await getData('coupons');
  const { code, amount } = req.body;
  if (!code) return res.status(400).json({ valid: false, message: 'Please enter a coupon code' });

  const coupon = coupons.find(c => c.code.toUpperCase() === code.toUpperCase() && c.active);
  if (!coupon) {
    return res.status(404).json({ valid: false, message: 'Invalid or expired promo code' });
  }

  if (amount && amount < (coupon.min_order || 0)) {
    return res.status(400).json({ valid: false, message: `Minimum order of $${coupon.min_order} required for this code` });
  }

  let discount = coupon.discount_type === 'percentage' 
    ? (amount * coupon.discount_value) / 100 
    : coupon.discount_value;

  res.json({
    valid: true,
    code: coupon.code,
    discount_type: coupon.discount_type,
    discount_value: coupon.discount_value,
    calculated_discount: parseFloat(discount.toFixed(2))
  });
});

app.post('/api/coupons', async (req, res) => {
  const coupons = await getData('coupons');
  const newCoupon = {
    code: (req.body.code || 'SALE10').toUpperCase().trim(),
    discount_type: req.body.discount_type || 'percentage',
    discount_value: parseFloat(req.body.discount_value) || 10,
    min_order: parseFloat(req.body.min_order) || 0,
    active: req.body.active !== false
  };
  coupons.push(newCoupon);
  writeData('coupons.json', coupons);

  if (isMongoConnected && MongoModels.coupons) {
    try {
      await MongoModels.coupons.create(newCoupon);
    } catch (err) {
      console.error('[MongoDB] Error creating coupon:', err.message);
    }
  }

  res.status(201).json({ success: true, coupon: newCoupon });
});

app.delete('/api/coupons/:code', async (req, res) => {
  let coupons = await getData('coupons');
  const code = req.params.code.toUpperCase();
  coupons = coupons.filter(c => c.code.toUpperCase() !== code);
  writeData('coupons.json', coupons);

  if (isMongoConnected && MongoModels.coupons) {
    try {
      await MongoModels.coupons.deleteOne({ code });
    } catch (err) {
      console.error('[MongoDB] Error deleting coupon:', err.message);
    }
  }

  res.json({ success: true });
});

// ----------------------------------------------------
// API: Store Settings
// ----------------------------------------------------
app.get('/api/settings', async (req, res) => {
  const settings = await getData('settings');
  const { admin_pin, ...publicSettings } = settings;
  res.json(publicSettings);
});

app.put('/api/settings', async (req, res) => {
  const current = await getData('settings');
  const updated = { ...current, ...req.body };
  writeData('settings.json', updated);

  if (isMongoConnected && MongoModels.settings) {
    try {
      await MongoModels.settings.findOneAndUpdate({}, updated, { upsert: true, new: true });
    } catch (err) {
      console.error('[MongoDB] Error saving settings:', err.message);
    }
  }

  res.json({ success: true, settings: updated });
});

// ----------------------------------------------------
// API: Stats Overview (For Admin Dashboard)
// ----------------------------------------------------
app.get('/api/stats', async (req, res) => {
  const orders = await getData('orders');
  const products = await getData('products');
  const reviews = await getData('reviews');

  const totalRevenue = orders
    .filter(o => o.status !== 'Cancelled')
    .reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);

  const pendingOrders = orders.filter(o => o.status === 'Pending').length;
  const lowStockProducts = products.filter(p => (p.stock || 0) < 5).length;
  const pendingReviews = reviews.filter(r => r.status === 'pending').length;

  res.json({
    total_revenue: parseFloat(totalRevenue.toFixed(2)),
    total_orders: orders.length,
    pending_orders: pendingOrders,
    total_products: products.length,
    low_stock_count: lowStockProducts,
    pending_reviews_count: pendingReviews,
    recent_orders: orders.slice(0, 5)
  });
});

// Routes for Storefront & Admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`✨ OMAR LUXURY Server is running on http://localhost:${PORT}`);
  console.log(`🛍️ Storefront: http://localhost:${PORT}`);
  console.log(`👑 Admin Panel: http://localhost:${PORT}/admin`);
});
