const cfg=window.FARMACIA_PANDA_CONFIG||{};
const products=window.PRODUCTS||[];
let cart=JSON.parse(localStorage.getItem('panda-cart')||'{}');
const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(Number(n||0));

function matches(p,q){return `${p.name||''} ${p.detail||''} ${p.category||''}`.toLowerCase().includes(q)}
function listRow(p){return `<div class="product-row"><div class="product-info"><b>${p.name}</b>${p.detail?`<small>${p.detail}</small>`:''}</div><strong>${money(p.price)}</strong><button data-add="${p.id}">Agregar</button></div>`}
function renderCatalog(){
  const q=($('#searchCatalog')?.value||$('#search')?.value||'').toLowerCase().trim();
  const groups={
    basicList:'Medicamento básico',
    specialList:'Medicamento especial',
    oximeterList:'Oxímetros',
    testList:'Pruebas rápidas',
    equipmentList:'Equipo y material médico',
    diabetesList:'Diabetes'
  };
  Object.entries(groups).forEach(([id,cat])=>{
    const node=document.getElementById(id);
    if(!node)return;
    const list=products.filter(p=>p.category===cat&&matches(p,q));
    node.innerHTML=list.map(listRow).join('')||'<p class="empty">No hay productos que coincidan con la búsqueda.</p>';
  });
  document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>add(b.dataset.add));
}
function add(id){cart[id]=(cart[id]||0)+1;save();openCart()}
function save(){localStorage.setItem('panda-cart',JSON.stringify(cart));renderCart()}
function renderCart(){
  const rows=Object.entries(cart).map(([id,q])=>[products.find(p=>p.id===id),q]).filter(x=>x[0]);
  $('#cartCount').textContent=rows.reduce((a,x)=>a+x[1],0);
  $('#cartItems').innerHTML=rows.map(([p,q])=>`<div class="cart-row"><div><b>${p.name}</b><br><small>${money(p.price)} × ${q}</small></div><div class="qty"><button data-minus="${p.id}">−</button> ${q} <button data-plus="${p.id}">+</button></div></div>`).join('')||'<p>Tu carrito está vacío.</p>';
  $('#subtotal').textContent=money(rows.reduce((a,[p,q])=>a+p.price*q,0));
  document.querySelectorAll('[data-minus]').forEach(b=>b.onclick=()=>{cart[b.dataset.minus]--;if(cart[b.dataset.minus]<=0)delete cart[b.dataset.minus];save()});
  document.querySelectorAll('[data-plus]').forEach(b=>b.onclick=()=>{cart[b.dataset.plus]++;save()});
}
function openCart(){$('#drawer').classList.add('open');$('#drawer').setAttribute('aria-hidden','false');$('#overlay').hidden=false}
function closeCart(){$('#drawer').classList.remove('open');$('#drawer').setAttribute('aria-hidden','true');$('#overlay').hidden=true}
$('#cartBtn').onclick=openCart;$('#closeCart').onclick=closeCart;$('#overlay').onclick=closeCart;
$('#search').oninput=e=>{if($('#searchCatalog'))$('#searchCatalog').value=e.target.value;renderCatalog()};
$('#searchBtn').onclick=renderCatalog;
if($('#searchCatalog'))$('#searchCatalog').oninput=e=>{if($('#search'))$('#search').value=e.target.value;renderCatalog()};
$('#orderBtn').onclick=()=>{if(!Object.keys(cart).length)return alert('Agrega productos al carrito.');closeCart();$('#checkout').hidden=false};
$('#closeCheckout').onclick=()=>$('#checkout').hidden=true;

$('#orderForm').onsubmit=async e=>{
  e.preventDefault();
  const fd=Object.fromEntries(new FormData(e.currentTarget));
  const items=Object.entries(cart).map(([id,cantidad])=>{const p=products.find(x=>x.id===id);return {id,nombre:p.name,precio:p.price,cantidad}});
  const pedido={cliente:fd,productos:items,totalEstimado:items.reduce((a,p)=>a+p.precio*p.cantidad,0),origen:'farmaciapanda.com'};
  const status=$('#orderStatus');
  const submit=e.currentTarget.querySelector('button[type="submit"]');
  submit.disabled=true; submit.textContent='Enviando pedido...'; status.textContent='';
  try{
    if(!cfg.apiUrl||cfg.apiUrl.includes('TU-SERVIDOR'))throw new Error('El sistema de pedidos aún no está conectado al servidor.');
    const r=await fetch(cfg.apiUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pedido)});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||'No fue posible enviar el pedido.');
    cart={};save();e.currentTarget.reset();
    status.innerHTML=`<div class="success-message">Pedido enviado correctamente.<br>Folio: <b>${data.folio||'registrado'}</b><br>En breve será revisado por Farmacia Panda.</div>`;
  }catch(err){
    status.innerHTML=`<div class="error-message">${err.message}<br>No se abrió WhatsApp y no se mostraron los datos del cliente.</div>`;
  }finally{
    submit.disabled=false;submit.textContent='Confirmar pedido';
  }
};
renderCatalog();renderCart();