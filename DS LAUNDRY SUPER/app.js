// ============================================================
//  DS LAUNDRY — app.js  v4  (Multi-Branch)
//  + Customer live-search in order modal
//  + Service & add-on price editing
//  + Expenses (salary, utilities, supplies, rent, maintenance, other)
//  + Daily & monthly revenue / net income reports
// ============================================================

let CURRENT_BRANCH = null;

function bCol(name) {
  return db.collection('branches').doc(CURRENT_BRANCH.id).collection(name);
}

firebase.auth().onAuthStateChanged(async user => {
  if (!user) { window.location.href = 'login.html'; return; }
  const raw = localStorage.getItem('ds_branch');
  if (!raw) { window.location.href = 'login.html'; return; }
  try { CURRENT_BRANCH = JSON.parse(raw); }
  catch(e) { window.location.href = 'login.html'; return; }
  if (!CURRENT_BRANCH?.id) { window.location.href = 'login.html'; return; }
  init();
});

function doLogout() {
  firebase.auth().signOut().then(() => {
    localStorage.removeItem('ds_branch');
    localStorage.removeItem('ds_user_role');
    window.location.href = 'login.html';
  });
}

const db = firebase.firestore();

// ── Cached data ──
let allOrders     = [];
let allCustomers  = [];
let allServices   = [];
let allAddons     = [];
let allEmployees  = [];
let allExpenses   = [];
let currentOrderFilter = 'all';
let currentReportPeriod = 'today';
let pendingSchedule = {};

const SERVICE_PRICE_MAP = {
  'Drop-Off, Wash, Fold': 210,
  'Drop-Off, Wash':       180,
  'Drop Off (Wash, Dry, Fold)':   210,
  'Self Service (Wash/Dry Only)': 180,
};

function getSvcPrice(svcObj) {
  if (!svcObj) return 0;
  const p = Number(svcObj.price !== undefined ? svcObj.price : svcObj.pricePerKg);
  if (!isNaN(p) && p > 0) return p;
  return SERVICE_PRICE_MAP[svcObj.name] || 0;
}

const unsubs = {};

// ─────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────
function init() {
  setPageDate();
  applyBranchTheme();
  setupNav();
  setupOrderTabs();
  startListeners();

  const serviceSelect  = document.getElementById('order-service');
  const loadSizeSelect = document.getElementById('order-load-size');
  if (serviceSelect)  serviceSelect.addEventListener('change', recalcAmount);
  if (loadSizeSelect) loadSizeSelect.addEventListener('change', recalcAmount);
  updateCustomerPhotoPreview();

  // Close customer dropdown when clicking outside
  document.addEventListener('click', e => {
    const wrap = document.querySelector('.cust-search-wrap');
    if (wrap && !wrap.contains(e.target)) {
      const dd = document.getElementById('order-cust-dd');
      if (dd) dd.style.display = 'none';
    }
  });
}

function setPageDate() {
  const el = document.getElementById('page-date');
  if (el) el.textContent = new Date().toLocaleDateString('en-PH', {
    weekday:'long', year:'numeric', month:'long', day:'numeric'
  });
}

function applyBranchTheme() {
  if (!CURRENT_BRANCH) return;
  const wrap  = document.getElementById('branch-badge-wrap');
  const badge = document.getElementById('branch-badge');
  if (wrap && badge) {
    wrap.style.display = 'block';
    badge.textContent  = '📍 ' + CURRENT_BRANCH.name + ' Branch';
    badge.style.cssText = `display:inline-block;padding:5px 12px;border-radius:20px;font-size:13px;font-weight:700;letter-spacing:0.04em;background:${CURRENT_BRANCH.grad||CURRENT_BRANCH.color};color:#fff;box-shadow:0 2px 8px ${CURRENT_BRANCH.color}55;width:100%;text-align:center;`;
  }
  const titleSub = document.createElement('span');
  titleSub.id = 'branch-topbar-label';
  titleSub.style.cssText = `display:inline-block;margin-left:8px;padding:2px 8px;border-radius:12px;font-size:13px;font-weight:700;background:${CURRENT_BRANCH.color}18;color:${CURRENT_BRANCH.color};vertical-align:middle;letter-spacing:0.03em;`;
  titleSub.textContent = CURRENT_BRANCH.name;
  const pageTitleEl = document.getElementById('page-title');
  if (pageTitleEl && !document.getElementById('branch-topbar-label')) {
    pageTitleEl.appendChild(titleSub);
  }
}

// ─────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────
const PAGE_TITLES = {
  dashboard: 'Dashboard',
  orders:    'Orders',
  customers: 'Customers',
  employees: 'Employee Management',
  services:  'Services & Pricing',
  payments:  'Payments',
  expenses:  'Expenses',
  reports:   'Reports',
};

function setupNav() {
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });
}

function navigate(page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  const titleEl = document.getElementById('page-title');
  if (titleEl) {
    titleEl.textContent = PAGE_TITLES[page] || page;
    if (CURRENT_BRANCH) {
      const lbl = document.createElement('span');
      lbl.id = 'branch-topbar-label';
      lbl.style.cssText = `display:inline-block;margin-left:8px;padding:2px 8px;border-radius:12px;font-size:13px;font-weight:700;background:${CURRENT_BRANCH.color}18;color:${CURRENT_BRANCH.color};vertical-align:middle;letter-spacing:0.03em;`;
      lbl.textContent = CURRENT_BRANCH.name;
      titleEl.appendChild(lbl);
    }
  }

  document.querySelectorAll('.page-view').forEach(v => v.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  if (page === 'reports')  renderReports();
  if (page === 'expenses') renderExpenses();
  closeSidebar();
}

function isMobile() { return window.innerWidth <= 768; }

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const btn     = document.getElementById('hamburger-btn');
  if (sidebar.classList.contains('mobile-open')) { closeSidebar(); }
  else {
    sidebar.classList.add('mobile-open');
    if (overlay) overlay.classList.add('show');
    if (btn) btn.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function closeSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const btn     = document.getElementById('hamburger-btn');
  if (!sidebar) return;
  sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.remove('show');
  if (btn) btn.classList.remove('open');
  document.body.style.overflow = '';
}

let _resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    renderOrders(); renderCustomers(); renderPayments(); renderDashboard();
  }, 150);
});

// ─────────────────────────────────────────
//  REAL-TIME LISTENERS
// ─────────────────────────────────────────
function startListeners() {
  unsubs.orders = bCol('orders').orderBy('createdAt','desc')
    .onSnapshot(snap => {
      allOrders = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      renderOrders(); renderDashboard(); renderPayments(); updateOrderBadge();
    }, err => console.error('Orders:', err));

  unsubs.customers = bCol('customers').orderBy('name')
    .onSnapshot(snap => {
      allCustomers = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      renderCustomers();
    }, err => console.error('Customers:', err));

  unsubs.services = bCol('services').orderBy('order')
    .onSnapshot(snap => {
      allServices = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      renderServicesList(); populateServiceDropdown();
    }, err => console.error('Services:', err));

  unsubs.addons = bCol('addons').orderBy('order')
    .onSnapshot(snap => {
      allAddons = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      renderAddonsList(); populateAddonsChecks();
    }, err => console.error('Addons:', err));

  unsubs.employees = bCol('employees').orderBy('name')
    .onSnapshot(snap => {
      allEmployees = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      renderEmployees(); updateDashboardEmployeeCount();
    }, err => console.error('Employees:', err));

  unsubs.expenses = bCol('expenses').orderBy('date','desc')
    .onSnapshot(snap => {
      allExpenses = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      renderExpensesSummary(); renderDashboard();
    }, err => console.error('Expenses:', err));
}

function updateOrderBadge() {
  const active = allOrders.filter(o => ['pending','washing','ready'].includes(o.status)).length;
  const badge = document.getElementById('nav-orders-badge');
  if (badge) badge.textContent = active;
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
const AVATAR_COLORS = [
  'linear-gradient(135deg,#C0311A,#7C3AED)',
  'linear-gradient(135deg,#0891b2,#1D4ED8)',
  'linear-gradient(135deg,#7C3AED,#0B1F5C)',
  'linear-gradient(135deg,#BE185D,#7C3AED)',
  'linear-gradient(135deg,#C0311A,#D97706)',
  'linear-gradient(135deg,#15803D,#0891b2)',
  'linear-gradient(135deg,#D97706,#C0311A)',
];

function avatarColor(name='') { let s=0; for(let c of name)s+=c.charCodeAt(0); return AVATAR_COLORS[s%AVATAR_COLORS.length]; }
function initials(name='') { return name.trim().split(/\s+/).map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function avatarHtml(name='',photoURL=null,size=36) {
  const r=Math.round(size*.27)+'px';
  if(photoURL) return `<img class="avatar-img" src="${photoURL}" alt="${escHtml(name)}" style="width:${size}px;height:${size}px;border-radius:${r};">`;
  const bg=avatarColor(name),fs=Math.round(size*.39),init=initials(name)||'?';
  return `<div class="avatar-square" style="width:${size}px;height:${size}px;background:${bg};font-size:${fs}px;border-radius:${r};">${init}</div>`;
}
function peso(n) { return '₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2}); }
function fmtDate(ts) {
  if(!ts) return '—';
  const d=ts.toDate?ts.toDate():new Date(ts);
  return d.toLocaleDateString('en-PH',{year:'numeric',month:'2-digit',day:'2-digit'});
}
function toDateStr(ts) {
  if(!ts) return '';
  const d=ts.toDate?ts.toDate():new Date(ts);
  return d.toISOString().split('T')[0];
}
function todayStr() { return new Date().toISOString().split('T')[0]; }
function monthStr(dt=new Date()) { return dt.toISOString().slice(0,7); }

function statusBadge(s) {
  const map={pending:'badge-pending',washing:'badge-washing',ready:'badge-ready',done:'badge-done'};
  return `<span class="badge ${map[s]||'badge-pending'}">${cap(s)}</span>`;
}
function payBadge(s) {
  return s==='paid'
    ? `<span class="badge badge-paid">Paid</span>`
    : `<span class="badge badge-pending">Pending</span>`;
}
function payMethodBadge(m='cash') {
  const cls={gcash:'payment-gcash',maya:'payment-maya',cash:'payment-cash'};
  return `<span class="payment-badge ${cls[m]||'payment-cash'}">${cap(m)}</span>`;
}
function expBadge(type) {
  const icons={salary:'👷',utilities:'💡',supplies:'🧴',rent:'🏢',maintenance:'🔧',other:'📌'};
  return `<span class="exp-badge exp-${type||'other'}">${icons[type]||'📌'} ${cap(type||'other')}</span>`;
}
function cap(s){ return s?s.charAt(0).toUpperCase()+s.slice(1):''; }
function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function setText(id,val){ const el=document.getElementById(id); if(el) el.textContent=val; }

function getNextOrderId() {
  if(!allOrders.length) return 'LW0001';
  const nums=allOrders.map(o=>parseInt((o.orderId||'LW0000').replace(/^LW/,''))||0);
  return 'LW'+String(Math.max(...nums)+1).padStart(4,'0');
}

function resizeImage(file,maxSize=220) {
  return new Promise(resolve=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const canvas=document.createElement('canvas');
        let w=img.width,h=img.height;
        if(w>h){if(w>maxSize){h=Math.round(h*maxSize/w);w=maxSize;}}
        else{if(h>maxSize){w=Math.round(w*maxSize/h);h=maxSize;}}
        canvas.width=w;canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL('image/jpeg',.75));
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ─────────────────────────────────────────
//  DASHBOARD
// ─────────────────────────────────────────
function renderDashboard() {
  const active  = allOrders.filter(o=>['pending','washing','ready'].includes(o.status));
  const ready   = allOrders.filter(o=>o.status==='ready');
  const today   = todayStr();
  const todayPaid = allOrders.filter(o=>o.paymentStatus==='paid' && toDateStr(o.createdAt)===today);
  const todayRev = todayPaid.reduce((a,o)=>a+(o.amount||0),0);
  const todayExp = allExpenses.filter(e=>e.date===today).reduce((a,e)=>a+(e.amount||0),0);
  const netToday = todayRev - todayExp;

  setText('dash-total-orders', allOrders.length);
  setText('dash-active-orders', active.length);
  setText('dash-active-sub', `${active.filter(o=>o.status==='pending').length} pending, ${active.filter(o=>o.status==='washing').length} washing`);
  setText('dash-ready', ready.length);
  setText('dash-revenue', peso(todayRev));
  setText('dash-revenue-sub', `${todayPaid.length} paid orders today`);
  setText('sum-customers', allCustomers.length);
  setText('sum-active', active.length);
  setText('sum-ready', ready.length);
  setText('sum-done', allOrders.filter(o=>o.status==='done').length);
  setText('sum-pending-rev', peso(allOrders.filter(o=>o.paymentStatus!=='paid').reduce((a,o)=>a+(o.amount||0),0)));

  const netEl = document.getElementById('sum-net-today');
  if(netEl) {
    netEl.textContent = peso(netToday);
    netEl.style.color = netToday >= 0 ? 'var(--success,#15803D)' : 'var(--danger,#C0311A)';
  }

  // Recent orders table
  const tbody=document.getElementById('dash-recent-body');
  const recent=allOrders.slice(0,8);
  if(!recent.length){tbody.innerHTML=`<tr><td colspan="4"><div class="empty-state"><div class="empty-icon">📋</div><h3>No orders yet</h3></div></td></tr>`;return;}
  tbody.innerHTML=recent.map(o=>{
    const cust=allCustomers.find(c=>c.id===o.customerId);
    const cn=cust?cust.name:(o.customerName||'—');
    return `<tr>
      <td><div class="customer-cell">${avatarHtml(cn,cust?.photoURL,28)}<span style="font-size:15px;font-weight:500">${escHtml(cn)}</span></div></td>
      <td style="font-size:14px;color:var(--text-muted)">${escHtml(o.service||'—')}</td>
      <td>${statusBadge(o.status)}</td>
      <td><span class="amount">${peso(o.amount)}</span></td>
    </tr>`;
  }).join('');

  // Services popularity
  const popEl=document.getElementById('dash-popularity');
  if(popEl){
    const counts={};
    allOrders.forEach(o=>{if(o.service)counts[o.service]=(counts[o.service]||0)+1;});
    const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,4);
    const max=sorted[0]?.[1]||1;
    popEl.innerHTML=sorted.length?sorted.map(([svc,cnt])=>`
      <div style="padding:10px 20px 0;">
        <div style="display:flex;justify-content:space-between;font-size:14.5px;margin-bottom:4px;">
          <span>${escHtml(svc)}</span><span style="font-weight:700;color:var(--primary)">${cnt}</span>
        </div>
        <div style="height:6px;background:var(--border);border-radius:99px;overflow:hidden;">
          <div style="width:${(cnt/max*100).toFixed(0)}%;height:100%;background:${CURRENT_BRANCH?.color||'var(--primary)'};border-radius:99px;"></div>
        </div>
      </div>`).join(''):'<p style="padding:16px;font-size:15px;color:var(--text-muted)">No data yet</p>';
  }
}

function updateDashboardEmployeeCount() {
  const active=allEmployees.filter(e=>e.active!==false).length;
  setText('sum-employees', active);
}

// ─────────────────────────────────────────
//  ORDER TABS
// ─────────────────────────────────────────
function setupOrderTabs() {
  document.querySelectorAll('#orders-tabs .tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('#orders-tabs .tab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      currentOrderFilter=btn.dataset.filter;
      renderOrders();
    });
  });
}

// ─────────────────────────────────────────
//  ORDERS
// ─────────────────────────────────────────
function renderOrders() {
  if(!isMobile()){
    const card=document.querySelector('#page-orders .card');
    if(card){const tbl=card.querySelector('table');if(tbl)tbl.style.display='';const ml=card.querySelector('.m-list');if(ml)ml.remove();}
  }
  const search=(document.getElementById('orders-search')?.value||'').toLowerCase();
  let list=allOrders;
  if(currentOrderFilter!=='all') list=list.filter(o=>o.status===currentOrderFilter);
  if(search) list=list.filter(o=>{
    const cust=allCustomers.find(c=>c.id===o.customerId);
    const name=(cust?.name||o.customerName||'').toLowerCase();
    return name.includes(search)||(o.orderId||'').toLowerCase().includes(search);
  });
  setText('orders-count-label',`${list.length} Order${list.length!==1?'s':''}`);

  if(isMobile()){renderOrdersMobile(list);return;}
  const tbody=document.getElementById('orders-body');
  if(!list.length){tbody.innerHTML=`<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📋</div><h3>No orders found</h3></div></td></tr>`;return;}
  tbody.innerHTML=list.map(o=>{
    const cust=allCustomers.find(c=>c.id===o.customerId);
    const custName=cust?cust.name:(o.customerName||'—');
    const garmentTotal=(o.garmentItems||[]).reduce((a,i)=>a+(i.qty||0),0);
    const garmentTip=(o.garmentItems||[]).map(i=>i.qty+'x '+i.type).join(', ');
    const garmentBadge=garmentTotal>0
      ?'<span title="'+escHtml(garmentTip)+'" style="display:inline-flex;align-items:center;gap:3px;background:#7C3AED18;color:#7C3AED;border-radius:10px;padding:1px 7px;font-size:13.5px;font-weight:700;cursor:default">👕 '+garmentTotal+' pc'+(garmentTotal>1?'s':'')+'</span>'
      :'<span style="color:var(--text-muted);font-size:14px">—</span>';
    const photoThumb=o.photoURL
      ?'<img src="'+o.photoURL+'" style="width:32px;height:32px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;margin-left:4px;cursor:pointer;vertical-align:middle" onclick="showOrderPhoto(\''+o.id+'\')" title="View photo">'
      :'';
    return `<tr>
      <td><span class="order-id">${escHtml(o.orderId||'—')}</span>${photoThumb}</td>
      <td><div class="customer-cell">${avatarHtml(custName,cust?.photoURL,30)}<div><div class="customer-name">${escHtml(custName)}</div><div class="customer-phone">${escHtml(cust?.phone||'')}</div></div></div></td>
      <td style="font-size:15px">${escHtml(o.service||'—')}</td>
      <td style="font-size:15px;font-weight:600">${o.loadSize||'—'}</td>
      <td>${garmentBadge}</td>
      <td>${statusBadge(o.status)}</td>
      <td style="font-size:14.5px;color:var(--text-muted)">${fmtDate(o.dueDate)}</td>
      <td><span class="amount">${peso(o.amount)}</span> ${payBadge(o.paymentStatus)}</td>
      <td><div style="display:flex;gap:5px;">
        <button class="btn-icon edit" title="Update Status" onclick="openStatusModal('${o.id}','${o.orderId}','${o.status}','${o.paymentStatus||'pending'}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button>
        <button class="btn-icon del" title="Delete" onclick="confirmDelete('orders','${o.id}','Order ${escHtml(o.orderId)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>
      </div></td>
    </tr>`;
  }).join('');
}
function filterOrders(){ renderOrders(); }

function showOrderPhoto(orderId) {
  const o=allOrders.find(x=>x.id===orderId); if(!o||!o.photoURL) return;
  const overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:pointer;';
  overlay.onclick=()=>overlay.remove();
  overlay.innerHTML=`<div style="position:relative;max-width:90vw;max-height:90vh;">
    <img src="${o.photoURL}" style="max-width:90vw;max-height:85vh;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.6);">
    <div style="text-align:center;color:#fff;margin-top:10px;font-size:15px;opacity:0.7">${escHtml(o.orderId||'')} · Tap to close</div>
  </div>`;
  document.body.appendChild(overlay);
}

// ─────────────────────────────────────────
//  CUSTOMERS
// ─────────────────────────────────────────
function renderCustomers() {
  if(!isMobile()){
    const card=document.querySelector('#page-customers .card');
    if(card){const tbl=card.querySelector('table');if(tbl)tbl.style.display='';const ml=card.querySelector('.m-list');if(ml)ml.remove();}
  }
  const search=(document.getElementById('customers-search')?.value||'').toLowerCase();
  let list=allCustomers;
  if(search) list=list.filter(c=>c.name.toLowerCase().includes(search)||(c.phone||'').includes(search));
  if(isMobile()){renderCustomersMobile(list);return;}
  const tbody=document.getElementById('customers-body');
  if(!list.length){tbody.innerHTML=`<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">👥</div><h3>No customers found</h3></div></td></tr>`;return;}
  tbody.innerHTML=list.map(c=>`<tr>
    <td><div class="customer-cell">${avatarHtml(c.name,c.photoURL,38)}<div><div class="customer-name">${escHtml(c.name)}</div><div class="customer-phone">${escHtml(c.email||'')}</div></div></div></td>
    <td style="font-size:15.5px">${escHtml(c.phone||'—')}</td>
    <td style="font-size:15px;color:var(--text-muted)">${escHtml(c.address||'—')}</td>
    <td style="font-weight:700;font-size:15.5px">${c.totalOrders||0}</td>
    <td><span class="amount">${peso(c.totalSpent)}</span></td>
    <td style="font-size:14.5px;color:var(--text-muted)">${fmtDate(c.lastVisit)}</td>
    <td><div style="display:flex;gap:5px;">
      <button class="btn-icon edit" onclick="openEditCustomerModal('${c.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
      <button class="btn-icon del" onclick="confirmDelete('customers','${c.id}','${escHtml(c.name)}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
    </div></td>
  </tr>`).join('');
}
function filterCustomers(){ renderCustomers(); }

// ─────────────────────────────────────────
//  EMPLOYEES
// ─────────────────────────────────────────
function renderEmployees() {
  const grid=document.getElementById('employees-grid');
  if(!grid) return;
  if(!allEmployees.length){
    grid.innerHTML=`<div class="card" style="grid-column:1/-1;"><div class="empty-state"><div class="empty-icon">👷</div><h3>No employees yet</h3></div></div>`;
    return;
  }
  grid.innerHTML=allEmployees.map(emp=>{
    const isActive=emp.active!==false;
    const schedPills=(emp.schedule||[]).length
      ?emp.schedule.map(s=>`<span class="schedule-pill">${s.day.slice(0,3)} ${s.start}–${s.end}</span>`).join('')
      :'<span style="font-size:14px;color:var(--text-muted)">No shifts set</span>';
    return `<div class="employee-card">
      <div class="employee-photo-wrap">
        ${avatarHtml(emp.name,emp.photoURL,52)}
        <div class="employee-info">
          <div class="employee-name">${escHtml(emp.name)}</div>
          <div class="employee-role"><span class="status-dot ${isActive?'active':'inactive'}"></span>${escHtml(emp.role||'Staff')}</div>
        </div>
      </div>
      ${emp.phone?`<div class="employee-detail">📞 ${escHtml(emp.phone)}</div>`:''}
      ${emp.dailyRate?`<div class="employee-detail" style="font-size:14px;color:var(--text-muted);">💰 Daily Rate: <strong style="color:var(--text)">${peso(emp.dailyRate)}</strong></div>`:''}
      <div class="employee-schedule-preview">${schedPills}</div>
      <div class="employee-actions">
        <button class="btn btn-outline btn-sm" style="flex:1" onclick="openScheduleModal('${emp.id}')">📅 Schedule</button>
        <button class="btn-icon edit" onclick="openEditEmployeeModal('${emp.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
        <button class="btn-icon del" onclick="confirmDelete('employees','${emp.id}','${escHtml(emp.name)}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
      </div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────
//  SERVICES & ADDONS (with edit buttons)
// ─────────────────────────────────────────
function renderServicesList() {
  const el=document.getElementById('services-list');
  if(!allServices.length){el.innerHTML=`<div class="empty-state"><div class="empty-icon">⭐</div><h3>No services</h3></div>`;return;}
  el.innerHTML=allServices.map(s=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border);">
      <div><div class="service-name">${escHtml(s.name)}</div><div class="service-meta">⏱ ${escHtml(s.duration||'—')}</div></div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span class="service-price">₱${s.price} / load</span>
        <button class="btn-icon edit" title="Edit" onclick="openEditServiceModal('${s.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button>
        <button class="btn-icon del" onclick="confirmDelete('services','${s.id}','${escHtml(s.name)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </button>
      </div>
    </div>`).join('');
}

function renderAddonsList() {
  const el=document.getElementById('addons-list');
  if(!allAddons.length){el.innerHTML=`<div class="empty-state"><div class="empty-icon">✨</div><h3>No add-ons</h3></div>`;return;}
  el.innerHTML=allAddons.map(a=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);">
      <div class="service-name">${escHtml(a.name)}</div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span class="service-price">+₱${a.price}</span>
        <button class="btn-icon edit" title="Edit" onclick="openEditAddonModal('${a.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button>
        <button class="btn-icon del" onclick="confirmDelete('addons','${a.id}','${escHtml(a.name)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </button>
      </div>
    </div>`).join('');
}

// ─────────────────────────────────────────
//  PAYMENTS
// ─────────────────────────────────────────
function renderPayments() {
  const paid    = allOrders.filter(o=>o.paymentStatus==='paid');
  const unpaid  = allOrders.filter(o=>o.paymentStatus!=='paid');
  const digital = allOrders.filter(o=>['gcash','maya'].includes(o.paymentMethod)&&o.paymentStatus==='paid');
  setText('pay-collected',  peso(paid.reduce((a,o)=>a+(o.amount||0),0)));
  setText('pay-collected-sub', `${paid.length} paid orders`);
  setText('pay-pending',    peso(unpaid.reduce((a,o)=>a+(o.amount||0),0)));
  setText('pay-pending-sub',`${unpaid.length} unpaid orders`);
  setText('pay-total',      peso(allOrders.reduce((a,o)=>a+(o.amount||0),0)));
  setText('pay-digital',    peso(digital.reduce((a,o)=>a+(o.amount||0),0)));

  const search=(document.getElementById('payments-search')?.value||'').toLowerCase();
  let list=allOrders;
  if(search) list=list.filter(o=>{
    const cust=allCustomers.find(c=>c.id===o.customerId);
    return(cust?.name||'').toLowerCase().includes(search)||(o.orderId||'').toLowerCase().includes(search);
  });

  if(isMobile()){renderPaymentsMobile(list);return;}
  const tbody=document.getElementById('payments-body');
  if(!list.length){tbody.innerHTML=`<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">💳</div><h3>No payments</h3></div></td></tr>`;return;}
  tbody.innerHTML=list.map(o=>{
    const cust=allCustomers.find(c=>c.id===o.customerId);
    const custName=cust?cust.name:(o.customerName||'—');
    return `<tr>
      <td><span class="order-id">${escHtml(o.orderId||'—')}</span></td>
      <td><div class="customer-cell">${avatarHtml(custName,cust?.photoURL,28)}<span style="font-size:15.5px;font-weight:500">${escHtml(custName)}</span></div></td>
      <td style="font-size:15px;color:var(--text-muted)">${escHtml(o.service||'—')}</td>
      <td><span class="amount">${peso(o.amount)}</span></td>
      <td>${payMethodBadge(o.paymentMethod)}</td>
      <td>${payBadge(o.paymentStatus)}</td>
      <td style="font-size:14.5px;color:var(--text-muted)">${fmtDate(o.createdAt)}</td>
      <td><button class="btn-icon edit" onclick="openStatusModal('${o.id}','${o.orderId}','${o.status}','${o.paymentStatus||'pending'}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button></td>
    </tr>`;
  }).join('');
}
function filterPayments(){ renderPayments(); }

// ─────────────────────────────────────────
//  EXPENSES — Render & CRUD
// ─────────────────────────────────────────
function renderExpensesSummary() {
  const now=new Date();
  const thisMonth=monthStr(now);
  const today=todayStr();
  const monthExp=allExpenses.filter(e=>(e.date||'').startsWith(thisMonth));
  const monthTotal=monthExp.reduce((a,e)=>a+(e.amount||0),0);
  const salaryTotal=monthExp.filter(e=>e.type==='salary').reduce((a,e)=>a+(e.amount||0),0);
  const otherTotal=monthExp.filter(e=>e.type!=='salary').reduce((a,e)=>a+(e.amount||0),0);
  const todayTotal=allExpenses.filter(e=>e.date===today).reduce((a,e)=>a+(e.amount||0),0);
  setText('exp-month-total', peso(monthTotal));
  setText('exp-month-sub', `${monthExp.length} entries`);
  setText('exp-salary-total', peso(salaryTotal));
  setText('exp-other-total', peso(otherTotal));
  setText('exp-today-total', peso(todayTotal));
}

function renderExpenses() {
  renderExpensesSummary();
  const search=(document.getElementById('expenses-search')?.value||'').toLowerCase();
  const catFilter=(document.getElementById('expenses-cat-filter')?.value||'');
  let list=[...allExpenses];
  if(catFilter) list=list.filter(e=>e.type===catFilter);
  if(search) list=list.filter(e=>(e.description||'').toLowerCase().includes(search)||(e.employeeName||'').toLowerCase().includes(search));

  const tbody=document.getElementById('expenses-body');
  if(!tbody) return;
  if(!list.length){
    tbody.innerHTML=`<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">💸</div><h3>No expenses recorded</h3><p>Track your daily expenses here.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML=list.map(e=>`<tr>
    <td style="font-size:15px;color:var(--text-muted);white-space:nowrap">${e.date||'—'}</td>
    <td>${expBadge(e.type)}</td>
    <td style="font-size:15px">${escHtml(e.description||'—')}</td>
    <td style="font-size:15px;color:var(--text-muted)">${escHtml(e.employeeName||'—')}</td>
    <td><span class="amount" style="color:var(--danger,#C0311A)">${peso(e.amount)}</span></td>
    <td><div style="display:flex;gap:5px;">
      <button class="btn-icon edit" onclick="openEditExpenseModal('${e.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
      <button class="btn-icon del" onclick="confirmDelete('expenses','${e.id}','${escHtml(e.description||'Expense')}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
    </div></td>
  </tr>`).join('');
}
function filterExpenses(){ renderExpenses(); }

function openAddExpenseModal() {
  document.getElementById('expense-edit-id').value='';
  document.getElementById('expense-modal-title').textContent='Add Expense';
  document.getElementById('expense-type').value='salary';
  document.getElementById('expense-date').value=todayStr();
  document.getElementById('expense-description').value='';
  document.getElementById('expense-amount').value='';
  document.getElementById('expense-employee-id').value='';
  onExpenseCatChange();
  populateExpenseEmployeeSelect();
  openModal('expense-modal');
}

function openEditExpenseModal(id) {
  const e=allExpenses.find(x=>x.id===id); if(!e) return;
  document.getElementById('expense-edit-id').value=id;
  document.getElementById('expense-modal-title').textContent='Edit Expense';
  document.getElementById('expense-type').value=e.type||'other';
  document.getElementById('expense-date').value=e.date||todayStr();
  document.getElementById('expense-description').value=e.description||'';
  document.getElementById('expense-amount').value=e.amount||'';
  populateExpenseEmployeeSelect();
  document.getElementById('expense-employee-id').value=e.employeeId||'';
  onExpenseCatChange();
  openModal('expense-modal');
}

function onExpenseCatChange() {
  const type=document.getElementById('expense-type')?.value;
  const grp=document.getElementById('expense-emp-group');
  if(grp) grp.style.display=(type==='salary')?'block':'none';
}

function populateExpenseEmployeeSelect() {
  const sel=document.getElementById('expense-employee-id');
  if(!sel) return;
  sel.innerHTML='<option value="">— Select employee —</option>'+
    allEmployees.map(e=>`<option value="${e.id}">${escHtml(e.name)}${e.dailyRate?` (₱${e.dailyRate}/day)`:''}</option>`).join('');
}

async function saveExpense() {
  const editId=document.getElementById('expense-edit-id').value;
  const type=document.getElementById('expense-type').value;
  const date=document.getElementById('expense-date').value;
  const description=document.getElementById('expense-description').value.trim();
  const amount=parseFloat(document.getElementById('expense-amount').value)||0;
  const employeeId=document.getElementById('expense-employee-id').value;

  if(!date)        return toast('Please select a date','error');
  if(!description) return toast('Please enter a description','error');
  if(!amount)      return toast('Please enter an amount','error');

  const emp=allEmployees.find(e=>e.id===employeeId);
  const data={type,date,description,amount,employeeId:employeeId||'',employeeName:emp?.name||'',updatedAt:firebase.firestore.FieldValue.serverTimestamp()};

  try {
    if(editId){
      await bCol('expenses').doc(editId).update(data);
      toast('Expense updated ✅','success');
    } else {
      await bCol('expenses').add({...data,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      toast('Expense saved ✅','success');
    }
    closeModal('expense-modal');
    renderExpenses();
  } catch(e){ toast('Error: '+e.message,'error'); }
}

// ─────────────────────────────────────────
//  REPORTS — with daily/monthly breakdown
// ─────────────────────────────────────────
function setReportPeriod(period, btn) {
  currentReportPeriod=period;
  document.querySelectorAll('.rpt-tab').forEach(t=>t.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderReports();
}

function getDateRange(period) {
  const now=new Date();
  const end=new Date(now.getFullYear(),now.getMonth(),now.getDate(),23,59,59);
  let start;
  switch(period){
    case 'today':
      start=new Date(now.getFullYear(),now.getMonth(),now.getDate()); break;
    case 'yesterday':
      start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-1);
      end.setDate(end.getDate()-1); break;
    case '7days':
      start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-6); break;
    case 'month':
      start=new Date(now.getFullYear(),now.getMonth(),1); break;
    default:
      return null; // alltime
  }
  return {start,end};
}

function filterOrdersByPeriod(period) {
  const range=getDateRange(period);
  if(!range) return allOrders;
  return allOrders.filter(o=>{
    if(!o.createdAt) return false;
    const d=o.createdAt.toDate?o.createdAt.toDate():new Date(o.createdAt);
    return d>=range.start && d<=range.end;
  });
}

function filterExpensesByPeriod(period) {
  const range=getDateRange(period);
  if(!range) return allExpenses;
  return allExpenses.filter(e=>{
    if(!e.date) return false;
    const d=new Date(e.date+'T00:00:00');
    return d>=range.start && d<=range.end;
  });
}

function renderReports() {
  const period=currentReportPeriod;
  const periodOrders=filterOrdersByPeriod(period);
  const periodExpenses=filterExpensesByPeriod(period);

  const paid    =periodOrders.filter(o=>o.paymentStatus==='paid');
  const active  =periodOrders.filter(o=>['pending','washing','ready'].includes(o.status));
  const done    =periodOrders.filter(o=>o.status==='done');
  const revenue =paid.reduce((a,o)=>a+(o.amount||0),0);
  const totalExp=periodExpenses.reduce((a,e)=>a+(e.amount||0),0);
  const netIncome=revenue - totalExp;
  const avg=done.length?done.reduce((a,o)=>a+(o.amount||0),0)/done.length:0;

  // ── Summary cards ──
  const statsEl=document.getElementById('reports-stats');
  if(statsEl){
    statsEl.innerHTML=[
      ['📦','Total Orders',periodOrders.length,''],
      ['💰','Gross Revenue',peso(revenue),'green'],
      ['💸','Total Expenses',peso(totalExp),'red'],
      ['📊','Avg Order Value',peso(avg),'blue'],
    ].map(([icon,label,val,cls])=>`<div class="stat-card"><div class="stat-icon blue">${icon}</div><div class="stat-label">${label}</div><div class="stat-value ${cls}">${val}</div></div>`).join('');
  }

  // ── Net income banner ──
  const netWrap=document.getElementById('reports-net-wrap');
  if(netWrap){
    const cls=netIncome>0?'positive':netIncome<0?'negative':'zero';
    const icon=netIncome>0?'📈':netIncome<0?'📉':'➖';
    netWrap.innerHTML=`
      <div class="net-block ${cls}">
        <div class="net-block-icon">${icon}</div>
        <div>
          <div class="net-block-label">Net Income (${cap(period.replace('7days','7 Days').replace('alltime','All Time'))})</div>
          <div class="net-block-value">${peso(netIncome)}</div>
          <div class="net-block-sub">${peso(revenue)} revenue − ${peso(totalExp)} expenses</div>
        </div>
      </div>`;
  }

  // ── Daily Revenue — last 14 days ──
  const dailyEl=document.getElementById('reports-daily');
  if(dailyEl){
    const days=[];
    for(let i=13;i>=0;i--){
      const dt=new Date(); dt.setDate(dt.getDate()-i);
      days.push(dt.toISOString().split('T')[0]);
    }
    const dayMap={};
    allOrders.filter(o=>o.paymentStatus==='paid').forEach(o=>{
      const ds=toDateStr(o.createdAt);
      if(ds) dayMap[ds]=(dayMap[ds]||{rev:0,cnt:0});
      if(ds){dayMap[ds].rev+=(o.amount||0);dayMap[ds].cnt+=1;}
    });
    const dayData=days.map(d=>({date:d,rev:dayMap[d]?.rev||0,cnt:dayMap[d]?.cnt||0}));
    const maxRev=Math.max(...dayData.map(d=>d.rev),1);
    dailyEl.innerHTML=dayData.map(d=>{
      const label=new Date(d.date+'T12:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric'});
      const pct=(d.rev/maxRev*100).toFixed(0);
      return `<div class="daily-bar-row">
        <span class="daily-bar-date">${label}</span>
        <div class="daily-bar-track"><div class="daily-bar-fill daily-bar-rev" style="width:${pct}%"></div></div>
        <span class="daily-bar-amt" style="color:${d.rev>0?'#15803D':'var(--text-muted)'}">${d.rev>0?peso(d.rev):'—'}</span>
        <span class="daily-bar-cnt">${d.cnt>0?d.cnt+'x':''}</span>
      </div>`;
    }).join('');
  }

  // ── Monthly Revenue — last 6 months ──
  const monthlyEl=document.getElementById('reports-monthly');
  if(monthlyEl){
    const months=[];
    for(let i=5;i>=0;i--){
      const dt=new Date(); dt.setDate(1); dt.setMonth(dt.getMonth()-i);
      months.push(monthStr(dt));
    }
    const mMap={};
    allOrders.filter(o=>o.paymentStatus==='paid').forEach(o=>{
      const ms=toDateStr(o.createdAt)?.slice(0,7);
      if(ms){mMap[ms]=(mMap[ms]||{rev:0,cnt:0});mMap[ms].rev+=(o.amount||0);mMap[ms].cnt+=1;}
    });
    const mData=months.map(m=>({month:m,rev:mMap[m]?.rev||0,cnt:mMap[m]?.cnt||0}));
    const maxM=Math.max(...mData.map(d=>d.rev),1);
    monthlyEl.innerHTML=mData.map(d=>{
      const label=new Date(d.month+'-15').toLocaleDateString('en-PH',{year:'2-digit',month:'short'});
      const pct=(d.rev/maxM*100).toFixed(0);
      return `<div class="daily-bar-row">
        <span class="daily-bar-date">${label}</span>
        <div class="daily-bar-track"><div class="daily-bar-fill daily-bar-rev" style="width:${pct}%"></div></div>
        <span class="daily-bar-amt" style="color:${d.rev>0?'#15803D':'var(--text-muted)'}">${d.rev>0?peso(d.rev):'—'}</span>
        <span class="daily-bar-cnt">${d.cnt>0?d.cnt+'x':''}</span>
      </div>`;
    }).join('');
  }

  // ── Revenue by service ──
  const svcRevenue={};
  periodOrders.filter(o=>o.paymentStatus==='paid').forEach(o=>{if(o.service)svcRevenue[o.service]=(svcRevenue[o.service]||0)+(o.amount||0);});
  const sortedSvc=Object.entries(svcRevenue).sort((a,b)=>b[1]-a[1]);
  const maxSvc=sortedSvc[0]?.[1]||1;
  const svcEl=document.getElementById('reports-by-service');
  if(svcEl) svcEl.innerHTML=sortedSvc.length
    ?sortedSvc.map(([svc,amt])=>`<div class="bar-row"><span class="bar-label">${escHtml(svc)}</span><div class="bar-track"><div class="bar-fill" style="width:${(amt/maxSvc*100).toFixed(0)}%"></div></div><span class="bar-amount">${peso(amt)}</span></div>`).join('')
    :'<p style="padding:20px;font-size:15px;color:var(--text-muted)">No data yet</p>';

  // ── Revenue by payment method ──
  const methods={cash:0,gcash:0,maya:0};
  periodOrders.filter(o=>o.paymentStatus==='paid').forEach(o=>{const m=o.paymentMethod||'cash';methods[m]=(methods[m]||0)+(o.amount||0);});
  const sortedM=Object.entries(methods).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const maxM=sortedM[0]?.[1]||1;
  const pmEl=document.getElementById('reports-by-payment');
  if(pmEl) pmEl.innerHTML=sortedM.length
    ?sortedM.map(([m,amt])=>`<div class="bar-row"><span class="bar-label">${cap(m)}</span><div class="bar-track"><div class="bar-fill" style="width:${(amt/maxM*100).toFixed(0)}%"></div></div><span class="bar-amount">${peso(amt)}</span></div>`).join('')
    :'<p style="padding:20px;font-size:15px;color:var(--text-muted)">No data yet</p>';

  // ── Expenses by category (this month) ──
  const expCatEl=document.getElementById('reports-exp-cat');
  if(expCatEl){
    const thisMonth=monthStr();
    const monthExpenses=allExpenses.filter(e=>(e.date||'').startsWith(thisMonth));
    const catMap={};
    monthExpenses.forEach(e=>{const t=e.type||'other';catMap[t]=(catMap[t]||0)+(e.amount||0);});
    const sortedCat=Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
    const maxCat=sortedCat[0]?.[1]||1;
    expCatEl.innerHTML=sortedCat.length
      ?sortedCat.map(([cat,amt])=>`<div class="bar-row"><span class="bar-label">${expBadge(cat)}</span><div class="bar-track"><div class="bar-fill" style="width:${(amt/maxCat*100).toFixed(0)}%;background:linear-gradient(90deg,#C0311A,#ef4444)"></div></div><span class="bar-amount" style="color:var(--danger,#C0311A)">${peso(amt)}</span></div>`).join('')
      :'<p style="padding:20px;font-size:15px;color:var(--text-muted)">No expenses this month</p>';
  }

  // ── Daily expenses — last 14 days ──
  const dailyExpEl=document.getElementById('reports-daily-exp');
  if(dailyExpEl){
    const days=[];
    for(let i=13;i>=0;i--){const dt=new Date();dt.setDate(dt.getDate()-i);days.push(dt.toISOString().split('T')[0]);}
    const eMap={};
    allExpenses.forEach(e=>{if(e.date){eMap[e.date]=(eMap[e.date]||0)+(e.amount||0);}});
    const eData=days.map(d=>({date:d,exp:eMap[d]||0}));
    const maxE=Math.max(...eData.map(d=>d.exp),1);
    dailyExpEl.innerHTML=eData.map(d=>{
      const label=new Date(d.date+'T12:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric'});
      const pct=(d.exp/maxE*100).toFixed(0);
      return `<div class="daily-bar-row">
        <span class="daily-bar-date">${label}</span>
        <div class="daily-bar-track"><div class="daily-bar-fill daily-bar-exp" style="width:${pct}%"></div></div>
        <span class="daily-bar-amt" style="color:${d.exp>0?'#C0311A':'var(--text-muted)'}">${d.exp>0?peso(d.exp):'—'}</span>
      </div>`;
    }).join('');
  }
}

// ─────────────────────────────────────────
//  CUSTOMER SEARCH (Order Modal)
// ─────────────────────────────────────────
function filterCustomerSearch() {
  const q=(document.getElementById('order-customer-search')?.value||'').toLowerCase().trim();
  const dd=document.getElementById('order-cust-dd');
  if(!dd) return;

  // If a customer is already selected via chip, never show dropdown
  if(document.getElementById('order-customer-id')?.value){
    dd.style.display='none'; return;
  }

  if(!q){
    // Show recent customers (last 6) when field is focused with no query
    const recent=allCustomers.slice(0,6);
    if(!recent.length){dd.style.display='none';return;}
    let html='<div class="cust-dd-section-label">Recent customers</div>';
    html+=recent.map(c=>`
      <div class="cust-dd-item" onclick="selectOrderCustomer('${c.id}')">
        ${avatarHtml(c.name,c.photoURL,32)}
        <div>
          <div style="font-weight:600;font-size:15px;">${escHtml(c.name)}</div>
          <div style="font-size:13px;color:var(--text-muted)">${escHtml(c.phone||'No phone')}</div>
        </div>
      </div>`).join('');
    html+=`<div class="cust-dd-new" onclick="openNewCustomerFromOrder('')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add new customer…
    </div>`;
    dd.innerHTML=html;
    dd.style.display='block';
    return;
  }

  const matches=allCustomers.filter(c=>
    c.name.toLowerCase().includes(q)||(c.phone||'').toLowerCase().includes(q)
  ).slice(0,8);

  let html='';
  if(matches.length){
    html=matches.map(c=>`
      <div class="cust-dd-item" onclick="selectOrderCustomer('${c.id}')">
        ${avatarHtml(c.name,c.photoURL,32)}
        <div>
          <div style="font-weight:600;font-size:15px;">${escHtml(c.name)}</div>
          <div style="font-size:13px;color:var(--text-muted)">${escHtml(c.phone||'No phone')}</div>
        </div>
      </div>`).join('');
  } else {
    html=`<div class="cust-dd-empty">No customers found for "<strong>${escHtml(q)}</strong>"</div>`;
  }
  // Prominent "+ Add new customer" button with the typed name pre-filled
  html+=`<div class="cust-dd-new cust-dd-new-prominent" onclick="openNewCustomerFromOrder(document.getElementById('order-customer-search').value)">
    <span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--primary);color:#fff;font-size:15px;font-weight:800;flex-shrink:0;margin-right:2px;">+</span>
    <span>Add <strong>${escHtml(q)}</strong> as new customer</span>
  </div>`;

  dd.innerHTML=html;
  dd.style.display='block';
}

function openNewCustomerFromOrder(prefillName) {
  openAddCustomerModal();
  setTimeout(()=>{
    const nameEl=document.getElementById('customer-name');
    if(nameEl && prefillName) nameEl.value=prefillName;
  },50);
}

function selectOrderCustomer(id) {
  const cust=allCustomers.find(c=>c.id===id);
  if(!cust) return;
  document.getElementById('order-customer-id').value=id;
  document.getElementById('order-customer-search').value='';
  document.getElementById('order-cust-dd').style.display='none';
  // Show chip
  const chip=document.getElementById('order-cust-chip');
  if(chip){
    chip.style.display='flex';
    chip.innerHTML=`
      ${avatarHtml(cust.name,cust.photoURL,28)}
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:15px;">${escHtml(cust.name)}</div>
        <div style="font-size:13px;color:var(--text-muted)">${escHtml(cust.phone||'')}</div>
      </div>
      <button class="cust-chip-clear" onclick="clearOrderCustomer()" title="Change customer">✕</button>`;
  }
}

function clearOrderCustomer() {
  document.getElementById('order-customer-id').value='';
  document.getElementById('order-customer-search').value='';
  const chip=document.getElementById('order-cust-chip');
  if(chip){chip.style.display='none';chip.innerHTML='';}
  document.getElementById('order-customer-search').focus();
}

// ─────────────────────────────────────────
//  MODAL — ORDER
// ─────────────────────────────────────────
function openNewOrderModal() {
  document.getElementById('order-edit-id').value='';
  document.getElementById('order-modal-title').textContent='New Order';
  clearOrderCustomer();
  document.getElementById('order-service').value='';
  document.getElementById('order-load-size').value='8kg';
  document.getElementById('order-notes').value='';
  document.getElementById('order-status').value='pending';
  document.getElementById('order-payment-method').value='cash';
  const today=new Date(); today.setDate(today.getDate()+1);
  document.getElementById('order-due-date').value=today.toISOString().split('T')[0];
  document.querySelectorAll('#order-addons-checks input').forEach(cb=>cb.checked=false);
  // Reset fee toggles
  const puCb=document.getElementById('order-pickup-toggle'); if(puCb){puCb.checked=false;}
  const dlCb=document.getElementById('order-delivery-toggle'); if(dlCb){dlCb.checked=false;}
  const pu=document.getElementById('order-pickup-charge'); if(pu) pu.value='15';
  const dl=document.getElementById('order-delivery-charge'); if(dl) dl.value='15';
  onFeeToggleChange();
  resetGarmentRows();
  recalcAmount();
  openModal('order-modal');
  setTimeout(()=>document.getElementById('order-customer-search')?.focus(),100);
}

async function saveOrder() {
  const editId     =document.getElementById('order-edit-id').value;
  const customerId =document.getElementById('order-customer-id').value;
  const service    =document.getElementById('order-service').value;
  const loadSize   =document.getElementById('order-load-size').value;
  const dueDate    =document.getElementById('order-due-date').value;
  const notes      =document.getElementById('order-notes').value.trim();
  const status     =document.getElementById('order-status').value;
  const payMethod  =document.getElementById('order-payment-method').value;
  const puOn=document.getElementById('order-pickup-toggle')?.checked;
  const dlOn=document.getElementById('order-delivery-toggle')?.checked;
  const pickupCharge =puOn?Math.max(0,parseFloat(document.getElementById('order-pickup-charge')?.value)||15):0;
  const deliveryCharge=dlOn?Math.max(0,parseFloat(document.getElementById('order-delivery-charge')?.value)||15):0;

  if(!customerId) return toast('Please select a customer','error');
  if(!service)    return toast('Please select a service','error');
  if(!loadSize)   return toast('Please select a load size','error');
  if(!dueDate)    return toast('Please select a due date','error');

  const svcObj=allServices.find(s=>s.name===service);
  const checkedAddons=[...document.querySelectorAll('#order-addons-checks input:checked')].map(cb=>cb.value);
  const addonTotal=checkedAddons.reduce((a,name)=>{const ao=allAddons.find(x=>x.name===name);return a+(ao?ao.price:0);},0);
  const garmentItems=collectGarmentRows();
  const amount=getSvcPrice(svcObj)+addonTotal+pickupCharge+deliveryCharge;
  const cust=allCustomers.find(c=>c.id===customerId);

  try {
    const payload={customerId,customerName:cust?.name||'',service,loadSize,dueDate,notes,status,
      paymentMethod:payMethod,amount,addons:checkedAddons,garmentItems,
      pickupCharge,deliveryCharge};
    if(editId){
      await bCol('orders').doc(editId).update(payload);
      toast('Order updated ✅','success');
    } else {
      const orderId=getNextOrderId();
      await bCol('orders').add({...payload,orderId,paymentStatus:'pending',createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      if(cust) await bCol('customers').doc(customerId).update({totalOrders:firebase.firestore.FieldValue.increment(1),totalSpent:firebase.firestore.FieldValue.increment(amount),lastVisit:firebase.firestore.FieldValue.serverTimestamp()});
      toast(`Order ${orderId} created ✅`,'success');
    }
    closeModal('order-modal');
  } catch(e){ toast('Error: '+e.message,'error'); }
}

function recalcAmount() {
  const service=document.getElementById('order-service')?.value;
  const svcObj=allServices.find(s=>s.name===service);
  const checkedAddons=[...document.querySelectorAll('#order-addons-checks input:checked')].map(cb=>cb.value);
  const addonTotal=checkedAddons.reduce((a,name)=>{const ao=allAddons.find(x=>x.name===name);return a+(ao?ao.price:0);},0);
  const puOn=document.getElementById('order-pickup-toggle')?.checked;
  const dlOn=document.getElementById('order-delivery-toggle')?.checked;
  const pickupCharge=puOn?Math.max(0,parseFloat(document.getElementById('order-pickup-charge')?.value)||15):0;
  const deliveryCharge=dlOn?Math.max(0,parseFloat(document.getElementById('order-delivery-charge')?.value)||15):0;
  const svcPrice=getSvcPrice(svcObj);
  const total=svcPrice+addonTotal+pickupCharge+deliveryCharge;

  const el=document.getElementById('amount-preview-value');
  if(el) el.textContent=peso(total);

  // Breakdown
  const bdEl=document.getElementById('amount-breakdown');
  if(bdEl){
    const parts=[];
    if(svcPrice>0) parts.push(`Service: ${peso(svcPrice)}`);
    if(addonTotal>0) parts.push(`Add-ons: +${peso(addonTotal)}`);
    if(pickupCharge>0) parts.push(`Pickup: +${peso(pickupCharge)}`);
    if(deliveryCharge>0) parts.push(`Delivery: +${peso(deliveryCharge)}`);
    if(parts.length>1){bdEl.style.display='block';bdEl.textContent=parts.join(' · ');}
    else{bdEl.style.display='none';}
  }

  // Update garment total count badge
  updateGarmentCountBadge();
}

function onFeeToggleChange() {
  const puOn=document.getElementById('order-pickup-toggle')?.checked;
  const dlOn=document.getElementById('order-delivery-toggle')?.checked;
  const puInput=document.getElementById('order-pickup-charge');
  const dlInput=document.getElementById('order-delivery-charge');
  if(puInput) puInput.disabled=!puOn;
  if(dlInput) dlInput.disabled=!dlOn;
  recalcAmount();
}

// ─────────────────────────────────────────
//  GARMENT ITEMS
// ─────────────────────────────────────────
const GARMENT_MAP=[
  {type:'T-shirt / Polo',    emoji:'👕', bg:'#EDE9FE'},
  {type:'Shorts / Pants',    emoji:'🩳', bg:'#DBEAFE'},
  {type:'Underwear / Socks', emoji:'🧦', bg:'#FCE7F3'},
  {type:'Dress / Gown',      emoji:'👗', bg:'#FEE2E2'},
  {type:'Blazer / Jacket',   emoji:'🧥', bg:'#E0F2FE'},
  {type:'Suit (2-pc)',        emoji:'🤵', bg:'#1F2937',textColor:'#fff'},
  {type:'Skirt',             emoji:'🩱', bg:'#FEF9C3'},
  {type:'Jeans',             emoji:'👖', bg:'#DBEAFE'},
  {type:'Blanket',           emoji:'🛏️', bg:'#D1FAE5'},
  {type:'Towel',             emoji:'🧻', bg:'#FEF3C7'},
  {type:'Bed Sheet',         emoji:'🛌', bg:'#E0F2FE'},
  {type:'Comforter',         emoji:'☁️', bg:'#F0F9FF'},
  {type:'Pillow Case',       emoji:'💤', bg:'#EDE9FE'},
  {type:'Others',            emoji:'📦', bg:'#F3F4F6'},
];
const GARMENT_TYPES=GARMENT_MAP.map(g=>g.type);

function getGarmentIcon(type) {
  const g=GARMENT_MAP.find(x=>x.type===type);
  if(!g) return {emoji:'📦',bg:'#F3F4F6',textColor:'#374151'};
  return {emoji:g.emoji,bg:g.bg,textColor:g.textColor||'#374151'};
}

function garmentIconHtml(type,size=32) {
  const {emoji,bg}=getGarmentIcon(type);
  return `<div style="width:${size}px;height:${size}px;border-radius:8px;background:${bg};display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(size*.55)}px;flex-shrink:0;">${emoji}</div>`;
}

function resetGarmentRows() {
  const tbody=document.getElementById('garment-rows');
  if(!tbody) return;
  tbody.innerHTML='';
  addGarmentRow();
}

function addGarmentRow(type='',qty=1) {
  const tbody=document.getElementById('garment-rows');
  if(!tbody) return;
  const idx=Date.now()+Math.random();
  const opts=GARMENT_MAP.map(g=>`<option value="${g.type}"${g.type===type?'selected':''}>${g.emoji} ${g.type}</option>`).join('');
  const iconHtml=type?garmentIconHtml(type,30):garmentIconHtml('',30).replace('📦','').replace('background:#F3F4F6','background:#E5E7EB');
  const tr=document.createElement('tr');
  tr.dataset.rid=idx;
  tr.innerHTML=`
    <td style="width:36px;text-align:center;padding:6px 4px;">
      <div class="garment-icon-cell" style="width:30px;height:30px;border-radius:8px;background:${type?getGarmentIcon(type).bg:'#E5E7EB'};display:inline-flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;transition:all .15s;">${type?getGarmentIcon(type).emoji:''}</div>
    </td>
    <td>
      <select class="form-control form-control-sm garment-type" style="min-width:150px" onchange="onGarmentTypeChange(this,'${idx}')">
        <option value="">— Item type —</option>${opts}
      </select>
    </td>
    <td>
      <input type="number" class="form-control form-control-sm garment-qty" value="${qty}" min="1" max="999" style="width:65px;text-align:center" oninput="updateGarmentCountBadge()">
    </td>
    <td>
      <button type="button" class="btn-icon del" style="padding:4px 6px" onclick="removeGarmentRow('${idx}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </td>`;
  tbody.appendChild(tr);
  updateGarmentCountBadge();
}

function onGarmentTypeChange(selectEl, idx) {
  const type=selectEl.value;
  const tr=selectEl.closest('tr');
  if(!tr) return;
  const iconCell=tr.querySelector('.garment-icon-cell');
  if(iconCell && type){
    const {emoji,bg}=getGarmentIcon(type);
    iconCell.style.background=bg;
    iconCell.textContent=emoji;
  } else if(iconCell){
    iconCell.style.background='#E5E7EB';
    iconCell.textContent='';
  }
  updateGarmentCountBadge();
}

function removeGarmentRow(idx) {
  const tbody=document.getElementById('garment-rows');
  if(!tbody) return;
  const rows=tbody.querySelectorAll('tr');
  if(rows.length<=1) return;
  const row=tbody.querySelector(`tr[data-rid="${idx}"]`);
  if(row) row.remove();
  updateGarmentCountBadge();
}

function collectGarmentRows() {
  const items=[];
  document.querySelectorAll('#garment-rows tr').forEach(tr=>{
    const type=(tr.querySelector('.garment-type')?.value||'').trim();
    const qty=parseInt(tr.querySelector('.garment-qty')?.value)||0;
    if(type && qty>0) items.push({type,qty});
  });
  return items;
}

function updateGarmentCountBadge() {
  const items=collectGarmentRows();
  const total=items.reduce((a,i)=>a+i.qty,0);
  const badge=document.getElementById('garment-count-badge');
  if(badge) badge.textContent=total>0?`${total} pc${total>1?'s':''}  total`:'';
}

async function previewOrderPhoto(input) {
  if(!input.files[0]) return;
  try{
    const b64=await resizeImage(input.files[0],600);
    document.getElementById('order-photo-url').value=b64;
    const prev=document.getElementById('order-photo-preview');
    if(prev){prev.src=b64;prev.style.display='block';}
  } catch(e){toast('Failed to process photo','error');}
}

function populateServiceDropdown() {
  const sel=document.getElementById('order-service');
  const prev=sel.value;
  sel.innerHTML='<option value="">— Select service —</option>'+
    allServices.map(s=>`<option value="${escHtml(s.name)}">${escHtml(s.name)} — ₱${s.price}</option>`).join('');
  if(prev) sel.value=prev;
  recalcAmount();
}

function populateAddonsChecks() {
  const container=document.getElementById('order-addons-checks');
  if(!container) return;
  container.innerHTML=allAddons.map(a=>
    `<label class="addon-check"><input type="checkbox" value="${escHtml(a.name)}" onchange="recalcAmount()"><span>${escHtml(a.name)} <em style="color:var(--text-muted);font-style:normal">+₱${a.price}</em></span></label>`
  ).join('');
}

// ─────────────────────────────────────────
//  MODAL — CUSTOMER
// ─────────────────────────────────────────
function openAddCustomerModal() {
  document.getElementById('customer-edit-id').value='';
  document.getElementById('customer-modal-title').textContent='Add Customer';
  document.getElementById('customer-name').value='';
  document.getElementById('customer-phone').value='';
  document.getElementById('customer-address').value='';
  document.getElementById('customer-photo-url').value='';
  updateCustomerPhotoPreview();
  openModal('customer-modal');
}

function openEditCustomerModal(docId) {
  const c=allCustomers.find(x=>x.id===docId); if(!c) return;
  document.getElementById('customer-edit-id').value=docId;
  document.getElementById('customer-modal-title').textContent='Edit Customer';
  document.getElementById('customer-name').value=c.name||'';
  document.getElementById('customer-phone').value=c.phone||'';
  document.getElementById('customer-address').value=c.address||'';
  document.getElementById('customer-photo-url').value=c.photoURL||'';
  updateCustomerPhotoPreview(c.photoURL);
  openModal('customer-modal');
}

function updateCustomerPhotoPreview(photoURL) {
  const prev=document.getElementById('customer-photo-preview');
  const url=photoURL||document.getElementById('customer-photo-url')?.value;
  const name=document.getElementById('customer-name')?.value||'';
  if(!prev) return;
  if(url){prev.innerHTML=`<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`;}
  else{prev.style.background=avatarColor(name);prev.innerHTML=`<span style="font-size:21.5px;font-weight:800;color:#fff;">${initials(name)||'DS'}</span>`;}
}

async function previewCustomerPhoto(input) {
  if(!input.files[0]) return;
  try{const b64=await resizeImage(input.files[0]);document.getElementById('customer-photo-url').value=b64;updateCustomerPhotoPreview(b64);}
  catch(e){toast('Failed to process image','error');}
}

async function saveCustomer() {
  const editId =document.getElementById('customer-edit-id').value;
  const name   =document.getElementById('customer-name').value.trim();
  const phone  =document.getElementById('customer-phone').value.trim();
  const address=document.getElementById('customer-address').value.trim();
  const photoURL=document.getElementById('customer-photo-url').value;
  if(!name)  return toast('Please enter customer name','error');
  if(!phone) return toast('Please enter phone number','error');
  try {
    if(editId){
      await bCol('customers').doc(editId).update({name,phone,address,photoURL:photoURL||null});
      toast('Customer updated ✅','success');
    } else {
      const doc=await bCol('customers').add({name,phone,address,photoURL:photoURL||null,totalOrders:0,totalSpent:0,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      toast(`${name} added ✅`,'success');
      // Auto-select new customer in order modal if it's open
      if(document.getElementById('order-modal')?.classList.contains('open')){
        selectOrderCustomer(doc.id);
      }
    }
    closeModal('customer-modal');
  } catch(e){toast('Error: '+e.message,'error');}
}

// ─────────────────────────────────────────
//  MODAL — SERVICES & ADDONS (with edit)
// ─────────────────────────────────────────
function openAddServiceModal() {
  document.getElementById('service-edit-id').value='';
  document.getElementById('service-modal-title').textContent='Add Service';
  document.getElementById('service-name').value='';
  document.getElementById('service-price').value='';
  document.getElementById('service-duration').value='';
  openModal('service-modal');
}

function openEditServiceModal(id) {
  const s=allServices.find(x=>x.id===id); if(!s) return;
  document.getElementById('service-edit-id').value=id;
  document.getElementById('service-modal-title').textContent='Edit Service';
  document.getElementById('service-name').value=s.name||'';
  document.getElementById('service-price').value=s.price||'';
  document.getElementById('service-duration').value=s.duration||'';
  openModal('service-modal');
}

async function saveService() {
  const editId  =document.getElementById('service-edit-id').value;
  const name    =document.getElementById('service-name').value.trim();
  const price   =parseFloat(document.getElementById('service-price').value)||0;
  const duration=document.getElementById('service-duration').value.trim();
  if(!name)  return toast('Please enter service name','error');
  if(!price) return toast('Please enter price','error');
  try {
    if(editId){await bCol('services').doc(editId).update({name,price,duration});toast('Service updated ✅','success');}
    else{await bCol('services').add({name,price,duration,order:allServices.length+1});toast('Service added ✅','success');}
    closeModal('service-modal');
  } catch(e){toast('Error: '+e.message,'error');}
}

function openAddAddonModal() {
  document.getElementById('addon-edit-id').value='';
  document.getElementById('addon-modal-title').textContent='Add Add-on';
  document.getElementById('addon-name').value='';
  document.getElementById('addon-price').value='';
  openModal('addon-modal');
}

function openEditAddonModal(id) {
  const a=allAddons.find(x=>x.id===id); if(!a) return;
  document.getElementById('addon-edit-id').value=id;
  document.getElementById('addon-modal-title').textContent='Edit Add-on';
  document.getElementById('addon-name').value=a.name||'';
  document.getElementById('addon-price').value=a.price||'';
  openModal('addon-modal');
}

async function saveAddon() {
  const editId=document.getElementById('addon-edit-id').value;
  const name  =document.getElementById('addon-name').value.trim();
  const price =parseFloat(document.getElementById('addon-price').value)||0;
  if(!name)  return toast('Please enter add-on name','error');
  if(!price) return toast('Please enter price','error');
  try {
    if(editId){await bCol('addons').doc(editId).update({name,price});toast('Add-on updated ✅','success');}
    else{await bCol('addons').add({name,price,order:allAddons.length+1});toast('Add-on added ✅','success');}
    closeModal('addon-modal');
  } catch(e){toast('Error: '+e.message,'error');}
}

// ─────────────────────────────────────────
//  MODAL — STATUS UPDATE
// ─────────────────────────────────────────
function openStatusModal(docId,orderId,currentStatus,currentPay) {
  document.getElementById('status-modal-doc-id').value=docId;
  document.getElementById('status-modal-order-id').textContent=orderId;
  document.getElementById('status-select').value=currentStatus;
  document.getElementById('payment-status-select').value=currentPay;
  openModal('status-modal');
}

async function saveStatus() {
  const docId    =document.getElementById('status-modal-doc-id').value;
  const status   =document.getElementById('status-select').value;
  const payStatus=document.getElementById('payment-status-select').value;
  try {
    await bCol('orders').doc(docId).update({status,paymentStatus:payStatus});
    toast('Status updated ✅','success');
    closeModal('status-modal');
  } catch(e){toast('Error: '+e.message,'error');}
}

// ─────────────────────────────────────────
//  MODAL — EMPLOYEE
// ─────────────────────────────────────────
function openAddEmployeeModal() {
  document.getElementById('employee-edit-id').value='';
  document.getElementById('employee-modal-title').textContent='Add Employee';
  document.getElementById('employee-name').value='';
  document.getElementById('employee-phone').value='';
  document.getElementById('employee-role').value='Laundry Attendant';
  document.getElementById('employee-active').value='true';
  document.getElementById('employee-photo-url').value='';
  document.getElementById('employee-daily-rate').value='';
  updateEmployeePhotoPreview();
  openModal('employee-modal');
}

function openEditEmployeeModal(docId) {
  const emp=allEmployees.find(e=>e.id===docId); if(!emp) return;
  document.getElementById('employee-edit-id').value=docId;
  document.getElementById('employee-modal-title').textContent='Edit Employee';
  document.getElementById('employee-name').value=emp.name||'';
  document.getElementById('employee-phone').value=emp.phone||'';
  document.getElementById('employee-role').value=emp.role||'Laundry Attendant';
  document.getElementById('employee-active').value=String(emp.active!==false);
  document.getElementById('employee-photo-url').value=emp.photoURL||'';
  document.getElementById('employee-daily-rate').value=emp.dailyRate||'';
  updateEmployeePhotoPreview(emp.photoURL);
  openModal('employee-modal');
}

function updateEmployeePhotoPreview(photoURL) {
  const prev=document.getElementById('employee-photo-preview');
  const url=photoURL||document.getElementById('employee-photo-url')?.value;
  const name=document.getElementById('employee-name')?.value||'';
  if(!prev) return;
  if(url){prev.innerHTML=`<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`;}
  else{prev.style.background=avatarColor(name);prev.innerHTML=`<span style="font-size:21.5px;font-weight:800;color:#fff;">${initials(name)||'?'}</span>`;}
}

async function previewEmployeePhoto(input) {
  if(!input.files[0]) return;
  try{const b64=await resizeImage(input.files[0]);document.getElementById('employee-photo-url').value=b64;updateEmployeePhotoPreview(b64);}
  catch(e){toast('Failed to process image','error');}
}

async function saveEmployee() {
  const editId   =document.getElementById('employee-edit-id').value;
  const name     =document.getElementById('employee-name').value.trim();
  const phone    =document.getElementById('employee-phone').value.trim();
  const role     =document.getElementById('employee-role').value;
  const active   =document.getElementById('employee-active').value==='true';
  const photoURL =document.getElementById('employee-photo-url').value;
  const dailyRate=parseFloat(document.getElementById('employee-daily-rate').value)||0;
  if(!name) return toast('Please enter employee name','error');
  try {
    if(editId){await bCol('employees').doc(editId).update({name,phone,role,active,photoURL:photoURL||null,dailyRate:dailyRate||null});toast('Employee updated ✅','success');}
    else{await bCol('employees').add({name,phone,role,active,photoURL:photoURL||null,dailyRate:dailyRate||null,schedule:[],hireDate:firebase.firestore.FieldValue.serverTimestamp()});toast(`${name} added ✅`,'success');}
    closeModal('employee-modal');
  } catch(e){toast('Error: '+e.message,'error');}
}

// ─────────────────────────────────────────
//  MODAL — SCHEDULE
// ─────────────────────────────────────────
const DAYS_OF_WEEK=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

function openScheduleModal(empId) {
  const emp=allEmployees.find(e=>e.id===empId); if(!emp) return;
  document.getElementById('schedule-emp-id').value=empId;
  document.getElementById('schedule-emp-name').textContent=emp.name;
  pendingSchedule={};
  (emp.schedule||[]).forEach(s=>{pendingSchedule[s.day]={start:s.start,end:s.end};});
  renderScheduleGrid();
  openModal('schedule-modal');
}

function renderScheduleGrid() {
  const grid=document.getElementById('schedule-grid');
  grid.innerHTML=DAYS_OF_WEEK.map(day=>{
    const shift=pendingSchedule[day];
    return `<div class="schedule-day"><div class="schedule-day-label">${day.slice(0,3)}</div>
      <div class="schedule-day-box ${shift?'has-shift':''}" onclick="toggleScheduleDay('${day}')">
        ${shift?`<div class="shift-block">${shift.start}</div><div class="shift-block">${shift.end}</div>`:'<span style="font-size:19.5px;opacity:0.25;">+</span>'}
      </div></div>`;
  }).join('');
}

function toggleScheduleDay(day) {
  if(pendingSchedule[day]){delete pendingSchedule[day];}
  else{pendingSchedule[day]={start:document.getElementById('sched-start').value||'08:00',end:document.getElementById('sched-end').value||'17:00'};}
  renderScheduleGrid();
}

async function saveSchedule() {
  const empId=document.getElementById('schedule-emp-id').value;
  const schedule=Object.entries(pendingSchedule).map(([day,times])=>({day,start:times.start,end:times.end}));
  try{await bCol('employees').doc(empId).update({schedule});toast('Schedule saved ✅','success');closeModal('schedule-modal');}
  catch(e){toast('Error: '+e.message,'error');}
}

// ─────────────────────────────────────────
//  CONFIRM DELETE
// ─────────────────────────────────────────
function confirmDelete(collection,docId,label) {
  document.getElementById('confirm-msg').textContent=`Delete "${label}"? This cannot be undone.`;
  document.getElementById('confirm-yes-btn').onclick=async()=>{
    try{await bCol(collection).doc(docId).delete();toast('Deleted','success');closeModal('confirm-modal');}
    catch(e){toast('Error: '+e.message,'error');}
  };
  openModal('confirm-modal');
}

// ─────────────────────────────────────────
//  MODAL HELPERS
// ─────────────────────────────────────────
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.addEventListener('click',e=>{if(e.target.classList.contains('modal-overlay'))e.target.classList.remove('open');});

// ─────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────
function toast(msg,type='info'){
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  const icons={success:'✅',error:'❌',info:'ℹ️'};
  el.innerHTML=`<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(()=>el.remove(),3000);
}

// ═══════════════════════════════════════════
//  MOBILE CARD RENDERERS
// ═══════════════════════════════════════════
function renderOrdersMobile(list){
  const card=document.querySelector('#page-orders .card'); if(!card) return;
  const tbl=card.querySelector('table'); if(tbl) tbl.style.display='none';
  let ml=card.querySelector('.m-list');
  if(!ml){ml=document.createElement('div');ml.className='m-list';card.appendChild(ml);}
  if(!list.length){ml.innerHTML=`<div class="empty-state"><div class="empty-icon">📋</div><h3>No orders found</h3></div>`;return;}
  ml.innerHTML=list.map(o=>{
    const cust=allCustomers.find(c=>c.id===o.customerId);
    const custName=cust?cust.name:(o.customerName||'—');
    return `<div class="m-card">
      <div class="m-card-top">
        <div class="m-card-left">${avatarHtml(custName,cust?.photoURL,42)}<div class="m-card-info"><div class="m-card-name">${escHtml(custName)}</div><div class="m-card-meta">${escHtml(o.service||'—')} · ${o.loadSize||'?'}</div></div></div>
        <div class="m-card-right">${statusBadge(o.status)}</div>
      </div>
      <div class="m-card-body">
        <div class="m-row"><span class="m-label">Order #</span><span class="order-id">${escHtml(o.orderId||'—')}</span></div>
        <div class="m-row"><span class="m-label">Due Date</span><span class="m-val">${fmtDate(o.dueDate)}</span></div>
        <div class="m-row"><span class="m-label">Amount</span><div class="m-amount">${peso(o.amount)} ${payBadge(o.paymentStatus)}</div></div>
      </div>
      <div class="m-card-footer">
        <button class="btn btn-outline btn-sm" onclick="openStatusModal('${o.id}','${o.orderId}','${o.status}','${o.paymentStatus||'pending'}')">✏️ Update Status</button>
        <button class="btn-icon del" onclick="confirmDelete('orders','${o.id}','Order ${escHtml(o.orderId)}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
      </div>
    </div>`;
  }).join('');
}

function renderCustomersMobile(list){
  const card=document.querySelector('#page-customers .card'); if(!card) return;
  const tbl=card.querySelector('table'); if(tbl) tbl.style.display='none';
  let ml=card.querySelector('.m-list');
  if(!ml){ml=document.createElement('div');ml.className='m-list';card.appendChild(ml);}
  if(!list.length){ml.innerHTML=`<div class="empty-state"><div class="empty-icon">👥</div><h3>No customers found</h3></div>`;return;}
  ml.innerHTML=list.map(c=>`<div class="m-card">
    <div class="m-card-top">
      <div class="m-card-left">${avatarHtml(c.name,c.photoURL,44)}<div class="m-card-info"><div class="m-card-name">${escHtml(c.name)}</div><div class="m-card-meta">📞 ${escHtml(c.phone||'—')}</div></div></div>
      <div class="m-card-right">
        <button class="btn-icon edit" onclick="openEditCustomerModal('${c.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
        <button class="btn-icon del" onclick="confirmDelete('customers','${c.id}','${escHtml(c.name)}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
      </div>
    </div>
    <div class="m-card-body">
      ${c.address?`<div class="m-row"><span class="m-label">Address</span><span class="m-val">${escHtml(c.address)}</span></div>`:''}
      <div class="m-row"><span class="m-label">Total Orders</span><span class="m-val" style="font-weight:700">${c.totalOrders||0}</span></div>
      <div class="m-row"><span class="m-label">Total Spent</span><div class="m-amount">${peso(c.totalSpent)}</div></div>
      <div class="m-row"><span class="m-label">Last Visit</span><span class="m-val">${fmtDate(c.lastVisit)}</span></div>
    </div>
  </div>`).join('');
}

function renderPaymentsMobile(list){
  const card=document.querySelector('#page-payments > .card'); if(!card) return;
  const tbl=card.querySelector('table'); if(tbl) tbl.style.display='none';
  let ml=card.querySelector('.m-list');
  if(!ml){ml=document.createElement('div');ml.className='m-list';card.appendChild(ml);}
  if(!list.length){ml.innerHTML=`<div class="empty-state"><div class="empty-icon">💳</div><h3>No payments</h3></div>`;return;}
  ml.innerHTML=list.map(o=>{
    const cust=allCustomers.find(c=>c.id===o.customerId);
    const custName=cust?cust.name:(o.customerName||'—');
    return `<div class="m-card">
      <div class="m-card-top">
        <div class="m-card-left">${avatarHtml(custName,cust?.photoURL,40)}<div class="m-card-info"><div class="m-card-name">${escHtml(custName)}</div><div class="m-card-meta">${escHtml(o.service||'—')}</div></div></div>
        <div class="m-card-right"><div class="m-amount" style="font-size:17px">${peso(o.amount)}</div></div>
      </div>
      <div class="m-card-body">
        <div class="m-row"><span class="m-label">Order #</span><span class="order-id">${escHtml(o.orderId||'—')}</span></div>
        <div class="m-row"><span class="m-label">Method</span>${payMethodBadge(o.paymentMethod)}</div>
        <div class="m-row"><span class="m-label">Status</span>${payBadge(o.paymentStatus)}</div>
        <div class="m-row"><span class="m-label">Date</span><span class="m-val">${fmtDate(o.createdAt)}</span></div>
      </div>
      <div class="m-card-footer">
        <button class="btn btn-outline btn-sm" onclick="openStatusModal('${o.id}','${o.orderId}','${o.status}','${o.paymentStatus||'pending'}')">✏️ Update</button>
      </div>
    </div>`;
  }).join('');
}

// Stub kept for compatibility (customer dropdown no longer used for orders)
function populateCustomerDropdown() {}
function onCustomerSelect() {}