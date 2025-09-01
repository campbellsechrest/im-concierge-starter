(()=>{
  const API_BASE = document.currentScript?.dataset.apiBase || "";
  const BRAND_EMAIL = document.currentScript?.dataset.brandEmail || "info@intelligentmolecules.com";

  const css = `
  :root{color-scheme:light}
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Helvetica,Arial,sans-serif;background:#A7C6ED;color:#111}
  .frame{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .app{display:flex;flex-direction:column;width:100%;max-width:760px;height:80vh;max-height:90vh;background:#fff;border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.15);overflow:hidden}
  .header{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #eee;font-weight:700;font-size:22px}
  .subnote{font-size:12px;color:#6b7280;font-weight:400}
  .actions{flex:0 0 auto;display:flex;gap:8px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid #eee}
  .chip{font-size:12px;border:1px solid #e5e7eb;border-radius:999px;padding:6px 10px;background:#fff;cursor:pointer}
  .body{flex:1 1 auto;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#fafafa}
  .msg{font-size:15px;line-height:1.45;border-radius:10px;padding:10px 12px;max-width:800px}
  .user{align-self:flex-end;background:#eef2ff;border:1px solid #c7d2fe}
  .bot{align-self:flex-start;background:#ffffff;border:1px solid #eee}
  .note{font-size:12px;color:#6b7280;margin-top:2px}
  .foot{flex:0 0 auto;border-top:1px solid #eee;padding:12px;display:flex;gap:8px}
  .input{flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:14px}
  .send{background:#111;color:#fff;border:none;border-radius:8px;padding:12px 14px;cursor:pointer}
  .footer-note{padding:0 16px 16px 16px}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  const frame = document.createElement('div');
  frame.className = 'frame';
  const app = document.createElement('div');
  app.className = 'app';
  app.innerHTML = `
    <div class="header">Intelligent Molecules Concierge <span class="subnote">General info only — not medical advice</span></div>
    <div class="actions">
      <span class="chip" data-q="When should I take A‑Minus?">When to take</span>
      <span class="chip" data-q="Can I take A‑Minus with my medications?">Meds & spacing</span>
      <span class="chip" data-q="What is your return policy?">Returns</span>
      <span class="chip" data-order="1">Where’s my order?</span>
      <span class="chip" data-q="What can I stack A‑Minus with?">Stacking</span>
    </div>
    <div class="body" id="chatBody"></div>
    <div class="foot">
      <input id="chatInput" class="input" placeholder="Ask about timing, stacking, safety…"/>
      <button id="chatSend" class="send">Send</button>
    </div>
    <div class="note footer-note">The statements on this website have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure or prevent any disease.</div>
  `;
  document.body.appendChild(frame);
  frame.appendChild(app);

  const bodyEl = app.querySelector('#chatBody');
  const inputEl = app.querySelector('#chatInput');
  const sendEl = app.querySelector('#chatSend');

  const addMsg = (html, who='bot', sources=[]) => {
    const div = document.createElement('div');
    div.className = `msg ${who}`;
    div.innerHTML = html;
    bodyEl.appendChild(div);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  };

  const ask = async (q) => {
    addMsg(q, 'user'); inputEl.value = '';
    try {
      const r = await fetch(`${API_BASE}/api/chat`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ message: q })
      });
      const j = await r.json();
      const answer = (j && (j.answer || j.text || 'Sorry, I could not answer.'));
      addMsg(answer, 'bot');
    } catch (e){
      addMsg('Hmm, I hit a snag. Please try again or email '+BRAND_EMAIL+'.');
    }
  };

  const orderFlow = async () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div class="msg bot">I can check your order. Please enter your <b>Order #</b> (e.g., #1234) and the <b>email</b> used at checkout.</div>
      <div class="msg user" style="display:block">
        <form id="orderForm" style="display:flex;flex-direction:column;gap:8px">
          <input name="orderNumber" placeholder="Order #" class="input" required/>
          <input name="email" placeholder="Email" class="input" required/>
          <button class="send" type="submit">Check status</button>
        </form>
      </div>`;
    bodyEl.appendChild(wrapper); bodyEl.scrollTop = bodyEl.scrollHeight;
    const form = wrapper.querySelector('#orderForm');
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        const r = await fetch(`${API_BASE}/api/order`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data)});
        const j = await r.json();
        if (j.error) return addMsg('Order lookup: '+j.error);
        const shipLines = (j.shipments||[]).map(s=>`${s.tracking_company||'Carrier'} ${Array.isArray(s.tracking_numbers)?s.tracking_numbers.join(', '):''}`).join('<br>');
        addMsg(`<b>${j.order_name}</b><br>Financial status: ${j.financial_status||'-'}<br>Fulfillment: ${j.fulfillment_status||'-'}<br>${shipLines?('Tracking: <br>'+shipLines):'Tracking: not yet available'}`);
      } catch(e){ addMsg('Could not retrieve order right now. Please email '+BRAND_EMAIL+'.'); }
    };
  };

  sendEl.onclick = () => { const q = inputEl.value.trim(); if(q) ask(q); };
  inputEl.onkeydown = (e) => { if(e.key==='Enter'){ e.preventDefault(); const q = inputEl.value.trim(); if(q) ask(q); }};
  app.querySelectorAll('.chip').forEach(ch => {
    ch.addEventListener('click', () => {
      if (ch.dataset.order) return orderFlow();
      const q = ch.dataset.q; if (q) ask(q);
    });
  });

  // Welcome message
  addMsg("Hi! I’m the Intelligent Molecules Concierge. Ask about timing, stacking, safety, or orders.");
})();
