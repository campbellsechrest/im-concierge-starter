(()=>{
  const API_BASE = document.currentScript?.dataset.apiBase || "";
  const BRAND_EMAIL = document.currentScript?.dataset.brandEmail || "info@intelligentmolecules.com";

  const css = `
  .im-bubble{position:fixed;right:16px;bottom:16px;width:56px;height:56px;border-radius:9999px;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.2);z-index:999999}
  .im-panel{position:fixed;right:16px;bottom:80px;width:360px;max-height:70vh;background:#fff;border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.2);display:none;flex-direction:column;overflow:hidden;z-index:999999}
  .im-header{padding:12px 14px;border-bottom:1px solid #eee;font-weight:600;display:flex;align-items:center;justify-content:space-between}
  .im-body{padding:12px;overflow:auto;display:flex;flex-direction:column;gap:10px}
  .im-msg{font-size:14px;line-height:1.45;border-radius:10px;padding:10px 12px;max-width:90%}
  .im-user{align-self:flex-end;background:#eef2ff;border:1px solid #c7d2fe}
  .im-bot{align-self:flex-start;background:#f9fafb;border:1px solid #eee}
  .im-foot{border-top:1px solid #eee;padding:10px;display:flex;gap:8px}
  .im-input{flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:10px;font-size:14px}
  .im-send{background:#111;color:#fff;border:none;border-radius:8px;padding:10px 12px;cursor:pointer}
  .im-note{font-size:11px;color:#6b7280;margin-top:4px}
  .im-actions{display:flex;gap:8px;padding:8px 12px;border-bottom:1px solid #eee;flex-wrap:wrap}
  .im-chip{font-size:12px;border:1px solid #e5e7eb;border-radius:999px;padding:6px 10px;background:#fff;cursor:pointer}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  const bubble = document.createElement('button');
  bubble.className = 'im-bubble'; bubble.title = 'Ask A‑Minus Concierge'; bubble.innerHTML = 'IM';

  const panel = document.createElement('div'); panel.className = 'im-panel';
  panel.innerHTML = `
    <div class="im-header">A‑Minus Concierge <button id="imClose" style="border:none;background:transparent;font-size:18px;cursor:pointer">×</button></div>
    <div class="im-actions">
      <span class="im-chip" data-q="When should I take A‑Minus?">When to take</span>
      <span class="im-chip" data-q="Can I take A‑Minus with my medications?">Meds & spacing</span>
      <span class="im-chip" data-q="What is your return policy?">Returns</span>
      <span class="im-chip" data-order="1">Where’s my order?</span>
      <span class="im-chip" data-q="What can I stack A‑Minus with?">Stacking</span>
    </div>
    <div class="im-body" id="imBody"></div>
    <div class="im-foot">
      <input id="imInput" class="im-input" placeholder="Ask about timing, stacking, safety…"/>
      <button id="imSend" class="im-send">Send</button>
    </div>
    <div class="im-note" style="padding:0 12px 12px 12px;">General information only — not medical advice. Email <a href="mailto:${BRAND_EMAIL}">${BRAND_EMAIL}</a> for human support.</div>
  `;

  document.body.appendChild(bubble); document.body.appendChild(panel);

  const bodyEl = panel.querySelector('#imBody');
  const inputEl = panel.querySelector('#imInput');
  const sendEl = panel.querySelector('#imSend');
  const closeEl = panel.querySelector('#imClose');

  const addMsg = (text, who='bot', sources=[]) => {
    const div = document.createElement('div');
    div.className = `im-msg im-${who}`;
    div.innerHTML = text;
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
      <div class="im-msg im-bot">I can check your order. Please enter your <b>Order #</b> (e.g., #1234) and the <b>email</b> used at checkout.</div>
      <div class="im-msg im-user" style="display:block">
        <form id="imOrderForm" style="display:flex;flex-direction:column;gap:8px">
          <input name="orderNumber" placeholder="Order #" class="im-input" required/>
          <input name="email" placeholder="Email" class="im-input" required/>
          <button class="im-send" type="submit">Check status</button>
        </form>
      </div>`;
    bodyEl.appendChild(wrapper); bodyEl.scrollTop = bodyEl.scrollHeight;
    const form = wrapper.querySelector('#imOrderForm');
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

  bubble.onclick = () => { panel.style.display = panel.style.display==='flex' ? 'none' : 'flex'; if(panel.style.display!=='none') panel.style.display='flex'; };
  closeEl.onclick = () => { panel.style.display = 'none'; };
  sendEl.onclick = () => { const q = inputEl.value.trim(); if(q) ask(q); };
  inputEl.onkeydown = (e) => { if(e.key==='Enter'){ e.preventDefault(); const q = inputEl.value.trim(); if(q) ask(q); }};
  panel.querySelectorAll('.im-chip').forEach(ch => {
    ch.addEventListener('click', () => {
      if (ch.dataset.order) return orderFlow();
      const q = ch.dataset.q; if (q) ask(q);
    });
  });
})();
