const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API = process.env.SHOPIFY_API_VERSION || '2024-07';
const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!SHOP || !TOKEN) return res.status(500).json({ error: 'Missing SHOPIFY_SHOP or SHOPIFY_ADMIN_TOKEN' });

  try {
    const { orderNumber, email } = req.body || {};
    if (!orderNumber || !email) return res.status(400).json({ error: 'orderNumber and email required' });

    const name = String(orderNumber).replace(/^#/, '');
    const url = `https://${SHOP}/admin/api/${API}/orders.json?name=${encodeURIComponent(name)}&status=any&limit=1`;
    const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': TOKEN } });
    const j = await r.json();
    const order = j.orders?.[0];
    if (!order) return res.status(404).json({ error: 'Not found' });

    const match = (order.email || order.contact_email || '').toLowerCase() === String(email).trim().toLowerCase();
    if (!match) return res.status(403).json({ error: 'Email mismatch' });

    const shipments = (order.fulfillments || []).flatMap(f => ({
      status: f.status,
      tracking_company: f.tracking_company,
      tracking_numbers: f.tracking_numbers
    }));

    res.json({
      order_name: order.name,
      financial_status: order.financial_status,
      fulfillment_status: order.fulfillment_status,
      shipments,
      shipping_address: order.shipping_address,
      created_at: order.created_at
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
}
