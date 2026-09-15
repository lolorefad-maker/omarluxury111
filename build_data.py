import json
import os
import glob

os.makedirs('data', exist_ok=True)

products = [
    {
        'id': 'prod-1',
        'title': 'Classic Tote Bag',
        'subtitle': 'Minimal design with maximum space',
        'description': 'Crafted from supple Italian full-grain pebble leather with gold-tone hardware. Generous main compartment fits a 13-inch laptop, cosmetics, and daily essentials with effortless elegance.',
        'category': 'Tote Bags',
        'price': 129.00,
        'original_price': 185.00,
        'badge': 'New',
        'image': '/extracted/prod_tote_classic.jpg',
        'images': [
            '/extracted/prod_tote_classic.jpg',
            '/extracted/cat_tote_promo.jpg',
            '/uploads/luxury_bag_f1_01.jpg'
        ],
        'colors': [
            { 'name': 'Cognac Brown', 'hex': '#9f5b32', 'image': '/extracted/prod_tote_classic.jpg' },
            { 'name': 'Obsidian Black', 'hex': '#1c1b1a', 'image': '/uploads/luxury_bag_f1_01.jpg' },
            { 'name': 'Oatmeal Beige', 'hex': '#dfd2c0', 'image': '/uploads/luxury_bag_f1_02.jpg' },
            { 'name': 'Caramel Tan', 'hex': '#c48858', 'image': '/extracted/prod_tote_classic.jpg' }
        ],
        'stock': 24,
        'rating': 4.9,
        'reviews_count': 18,
        'featured': True,
        'is_new_arrival': True,
        'active': True
    },
    {
        'id': 'prod-2',
        'title': 'Luna Shoulder Bag',
        'subtitle': 'Chic and versatile for every occasion',
        'description': 'A contemporary crescent silhouette that nestles smoothly under your arm. Featuring signature magnetic closure, tailored edge paint, and an adjustable shoulder strap.',
        'category': 'Shoulder Bags',
        'price': 99.00,
        'original_price': 139.00,
        'badge': 'New',
        'image': '/extracted/prod_luna_shoulder.jpg',
        'images': [
            '/extracted/prod_luna_shoulder.jpg',
            '/extracted/cat_shoulder_promo.jpg',
            '/uploads/luxury_bag_f1_03.jpg'
        ],
        'colors': [
            { 'name': 'Alabaster Cream', 'hex': '#ece6d8', 'image': '/extracted/prod_luna_shoulder.jpg' },
            { 'name': 'Moka Brown', 'hex': '#5e4335', 'image': '/uploads/luxury_bag_f1_03.jpg' },
            { 'name': 'Onyx Black', 'hex': '#1a1a1a', 'image': '/uploads/luxury_bag_f1_04.jpg' },
            { 'name': 'Warm Taupe', 'hex': '#a48a7b', 'image': '/uploads/luxury_bag_f1_05.jpg' }
        ],
        'stock': 18,
        'rating': 4.8,
        'reviews_count': 14,
        'featured': True,
        'is_new_arrival': True,
        'active': True
    },
    {
        'id': 'prod-3',
        'title': 'Quilted Crossbody Bag',
        'subtitle': 'Compact, stylish & perfectly practical',
        'description': 'Diamond-quilted lambskin with a sliding curb-chain strap that can be worn doubled or long. Accented with a lustrous brushed gold lock clasp.',
        'category': 'Crossbody Bags',
        'price': 89.00,
        'original_price': 115.00,
        'badge': 'New',
        'image': '/extracted/prod_quilted_crossbody.jpg',
        'images': [
            '/extracted/prod_quilted_crossbody.jpg',
            '/extracted/cat_crossbody_promo.jpg',
            '/uploads/luxury_bag_f1_06.jpg'
        ],
        'colors': [
            { 'name': 'Noir Black', 'hex': '#181818', 'image': '/extracted/prod_quilted_crossbody.jpg' },
            { 'name': 'Chalk Cream', 'hex': '#f5f3ee', 'image': '/uploads/luxury_bag_f1_06.jpg' },
            { 'name': 'Chestnut Tan', 'hex': '#98603c', 'image': '/uploads/luxury_bag_f1_07.jpg' },
            { 'name': 'Burgundy Wine', 'hex': '#581c23', 'image': '/uploads/luxury_bag_f1_08.jpg' }
        ],
        'stock': 15,
        'rating': 5.0,
        'reviews_count': 29,
        'featured': True,
        'is_new_arrival': True,
        'active': True
    },
    {
        'id': 'prod-4',
        'title': 'Elegant Clutch',
        'subtitle': 'Sophistication in the palm of your hand',
        'description': 'Sleek envelope profile with subtle shimmer texture. Includes a detachable delicate shoulder chain for effortless day-to-evening transition.',
        'category': 'Clutches',
        'price': 59.00,
        'original_price': 79.00,
        'badge': 'New',
        'image': '/extracted/prod_elegant_clutch.jpg',
        'images': [
            '/extracted/prod_elegant_clutch.jpg',
            '/extracted/cat_clutches_promo.jpg',
            '/uploads/luxury_bag_f1_09.jpg'
        ],
        'colors': [
            { 'name': 'Pearl White', 'hex': '#faf8f5', 'image': '/extracted/prod_elegant_clutch.jpg' },
            { 'name': 'Midnight Black', 'hex': '#1a1a1a', 'image': '/uploads/luxury_bag_f1_09.jpg' },
            { 'name': 'Champagne Beige', 'hex': '#e4d5be', 'image': '/extracted/prod_elegant_clutch.jpg' },
            { 'name': 'Dusty Rose', 'hex': '#d5afad', 'image': '/uploads/luxury_bag_f1_10.jpg' }
        ],
        'stock': 30,
        'rating': 4.7,
        'reviews_count': 11,
        'featured': True,
        'is_new_arrival': True,
        'active': True
    }
]

# Additional luxury products using the user's uploaded bag images
upload_imgs = sorted(glob.glob('public/uploads/luxury_bag_*.jpg'))
categories = ['Tote Bags', 'Shoulder Bags', 'Crossbody Bags', 'Clutches', 'Accessories', 'Best Seller']
bag_titles = [
    'Monogram Saddle Handbag', 'Palermo Woven Leather Tote', 'Milano Chain Flap Bag',
    'Capri Top-Handle Satchel', 'Monaco Structured Satchel', 'Verona Suede Hobo',
    'Bellagio Mini Crossbody', 'Florence Signature Belt Bag', 'Venice Micro Bucket Bag',
    'Siena Croc-Embossed Bag', 'Riviera Raffia Luxury Bag', 'Amalfi Quilted Wallet On Chain',
    'Roma Dual-Tone City Tote', 'Como Vintage Shoulder Flap', 'Portofino Envelope Evening Clutch',
    'Torino Pebble Leather Satchel', 'Ravello Slim Cardholder & Belt Set', 'Napoli Studded Leather Bag'
]

for idx, f in enumerate(upload_imgs[:18]):
    web_path = '/' + f.replace('\\', '/').replace('public/', '')
    cat = categories[idx % len(categories)]
    title = bag_titles[idx % len(bag_titles)]
    price = 69.0 + (idx * 11) % 95
    orig_price = round(price * 1.35, 2)
    badge = 'Sale' if idx % 2 == 0 else ('Best Seller' if idx % 3 == 0 else 'Popular')
    
    prod = {
        'id': f'prod-{idx+5}',
        'title': title,
        'subtitle': 'Handcrafted premium luxury collection',
        'description': 'Exquisite craftsmanship featuring hand-stitched detailing, premium hardware, and durable lining designed for longevity and timeless style.',
        'category': cat,
        'price': price,
        'original_price': orig_price,
        'badge': badge,
        'image': web_path,
        'images': [web_path],
        'colors': [
            { 'name': 'Noir Black', 'hex': '#1c1b1a', 'image': web_path },
            { 'name': 'Camel Tan', 'hex': '#c08959', 'image': web_path },
            { 'name': 'Cream Beige', 'hex': '#e8ded0', 'image': web_path }
        ],
        'stock': 12 + idx,
        'rating': round(4.6 + (idx % 4) * 0.1, 1),
        'reviews_count': 6 + idx * 2,
        'featured': (idx < 6),
        'is_new_arrival': (idx % 3 == 0),
        'active': True
    }
    products.append(prod)

with open('data/products.json', 'w', encoding='utf-8') as out:
    json.dump(products, out, ensure_ascii=False, indent=2)

print(f'Successfully built {len(products)} products in data/products.json!')
