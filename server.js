const express=require('express');const cors=require('cors');const fs=require('fs');const path=require('path');const {Resend}=require('resend');const twilio=require('twilio');const app=express();app.use(cors({origin:true}));app.use(express.json({limit:'1mb'}));const DB=path.join(__dirname,'pedidos.json');if(!fs.existsSync(DB))fs.writeFileSync(DB,'[]');const read=()=>JSON.parse(fs.readFileSync(DB));const write=x=>fs.writeFileSync(DB,JSON.stringify(x,null,2));const money=n=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(n);
function folio(){return 'FP-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+Math.random().toString(36).slice(2,6).toUpperCase()}
function texto(o){return `NUEVO PEDIDO — FARMACIA PANDA
Folio: ${o.folio}
Cliente: ${o.cliente.nombre}
Teléfono: ${o.cliente.telefono}
Domicilio: ${o.cliente.domicilio}, ${o.cliente.colonia}, ${o.cliente.ciudad}, ${o.cliente.estado}
Zona: ${o.cliente.zona}
Horario: ${o.cliente.horario||'No indicado'}

PRODUCTOS
${o.productos.map(p=>`${p.cantidad} x ${p.nombre} — ${money(p.importe)}`).join('\n')}

SUBTOTAL: ${money(o.subtotal ?? o.total)}
ENVÍO: ${money(o.envio || 0)}
TOTAL: ${money(o.total)}
Observaciones: ${o.cliente.observaciones||'Ninguna'}`}

function folioCita(){return 'CITA-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+Math.random().toString(36).slice(2,6).toUpperCase()}
function textoCita(o){return `NUEVA CITA — FARMACIA PANDA
Folio: ${o.folio}
Nombre: ${o.cliente.nombre}
Teléfono: ${o.cliente.telefono}
Edad: ${o.cliente.edad}
Servicio: ${o.cliente.servicio}
Tratamiento solicitado: ${o.cliente.tratamiento}
Horario preferente: ${o.cliente.preferencia}
Fecha preferida: ${o.cliente.fechaPreferida||'Sin fecha indicada'}
Observaciones: ${o.cliente.observaciones||'Ninguna'}`}
app.post('/api/citas',async(req,res)=>{try{let o={...req.body,folio:folioCita(),fecha:new Date().toISOString(),estado:'Pendiente de confirmar'};if(!o.cliente||!o.cliente.nombre||!o.cliente.telefono)return res.status(400).json({error:'Solicitud inválida'});let msg=textoCita(o),tasks=[];if(process.env.RESEND_API_KEY){let resend=new Resend(process.env.RESEND_API_KEY);let tos=(process.env.ORDER_EMAILS||'elsyalaniz26@gmail.com,prosecogdl@gmail.com').split(',').map(x=>x.trim());tasks.push(resend.emails.send({from:process.env.FROM_EMAIL||'Farmacia Panda <pedidos@resend.dev>',to:tos,subject:`Nueva cita — Farmacia Panda — ${o.folio}`,text:msg}))}if(process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN&&process.env.TWILIO_WHATSAPP_TO){let c=twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN);tasks.push(c.messages.create({from:process.env.TWILIO_WHATSAPP_FROM||'whatsapp:+14155238886',to:process.env.TWILIO_WHATSAPP_TO,body:msg.slice(0,1500)}))}await Promise.allSettled(tasks);res.json({ok:true,folio:o.folio})}catch(e){console.error(e);res.status(500).json({error:'No se pudo enviar la cita'})}});
app.get('/api/salud',(q,s)=>s.json({ok:true}));app.post('/api/pedidos',async(req,res)=>{try{let o={...req.body,folio:folio(),fecha:new Date().toISOString(),estado:'Nuevo'};if(!o.cliente||!Array.isArray(o.productos)||!o.productos.length)return res.status(400).json({error:'Pedido inválido'});let db=read();db.unshift(o);write(db);let msg=texto(o),tasks=[];if(process.env.RESEND_API_KEY){let resend=new Resend(process.env.RESEND_API_KEY);let tos=(process.env.ORDER_EMAILS||'elsyalaniz26@gmail.com,prosecogdl@gmail.com').split(',').map(x=>x.trim());tasks.push(resend.emails.send({from:process.env.FROM_EMAIL||'Farmacia Panda <pedidos@resend.dev>',to:tos,subject:`Nuevo pedido — Farmacia Panda — ${o.folio}`,text:msg}))}if(process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN&&process.env.TWILIO_WHATSAPP_TO){let c=twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN);tasks.push(c.messages.create({from:process.env.TWILIO_WHATSAPP_FROM||'whatsapp:+14155238886',to:process.env.TWILIO_WHATSAPP_TO,body:msg.slice(0,1500)}))}await Promise.allSettled(tasks);res.json({ok:true,folio:o.folio})}catch(e){console.error(e);res.status(500).json({error:'No se pudo guardar'})}});function admin(req,res,next){if(req.headers['x-admin-pin']!==(process.env.ADMIN_PIN||'2222'))return res.status(401).end();next()}app.get('/api/pedidos',admin,(q,s)=>s.json(read()));app.patch('/api/pedidos/:folio',admin,(req,res)=>{let db=read(),o=db.find(x=>x.folio===req.params.folio);if(!o)return res.status(404).end();o.estado=req.body.estado||o.estado;write(db);res.json(o)});app.listen(process.env.PORT||3000,()=>console.log('Farmacia Panda API lista'));