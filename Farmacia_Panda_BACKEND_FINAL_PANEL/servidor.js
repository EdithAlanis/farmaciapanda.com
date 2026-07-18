const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });

const ORDERS_DB = path.join(DATA_DIR, 'pedidos.json');
const APPOINTMENTS_DB = path.join(DATA_DIR, 'citas.json');

function ensureJsonFile(filePath) {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]', 'utf8');
}
ensureJsonFile(ORDERS_DB);
ensureJsonFile(APPOINTMENTS_DB);

function readJson(filePath) {
  try {
    const value = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Error leyendo', path.basename(filePath), error);
    return [];
  }
}

function writeJson(filePath, data) {
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, filePath);
}

function money(value) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN'
  }).format(Number(value || 0));
}

function makeFolio(prefix) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${date}-${random}`;
}

function recipients() {
  return (process.env.ORDER_EMAILS || 'prosecogdl@gmail.com,elsyalaniz26@gmail.com')
    .split(',').map(v => v.trim()).filter(Boolean);
}

function orderText(order) {
  const c = order.cliente || {};
  const products = Array.isArray(order.productos) ? order.productos : [];
  return `NUEVO PEDIDO — FARMACIA PANDA\n\nFolio: ${order.folio}\nFecha: ${new Date(order.fecha).toLocaleString('es-MX')}\nCliente: ${c.nombre || 'No indicado'}\nTeléfono: ${c.telefono || 'No indicado'}\nDomicilio: ${[c.domicilio,c.colonia,c.ciudad,c.estado].filter(Boolean).join(', ')}\nZona: ${c.zona || 'No indicada'}\nHorario: ${c.horario || 'No indicado'}\n\nPRODUCTOS\n${products.map(p => `${p.cantidad || 1} x ${p.nombre || 'Producto'} — ${money(p.importe ?? Number(p.precio || 0) * Number(p.cantidad || 1))}`).join('\n')}\n\nSUBTOTAL: ${money(order.subtotal ?? order.total)}\nENVÍO: ${money(order.envio || 0)}\nTOTAL: ${money(order.total)}\nObservaciones: ${c.observaciones || 'Ninguna'}`;
}

function appointmentText(item) {
  const c = item.cliente || {};
  return `NUEVA SOLICITUD DE CITA — FARMACIA PANDA\n\nFolio: ${item.folio}\nFecha: ${new Date(item.fecha).toLocaleString('es-MX')}\nNombre: ${c.nombre || 'No indicado'}\nTeléfono: ${c.telefono || 'No indicado'}\nEdad: ${c.edad || 'No indicada'}\nServicio: ${c.servicio || c.tratamiento || 'No indicado'}\nHorario preferente: ${c.preferencia || 'No indicado'}\nFecha preferida: ${c.fechaPreferida || 'No indicada'}\nObservaciones: ${c.observaciones || 'Ninguna'}`;
}

async function sendWithGmail(subject, text) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return { sent: false, provider: 'gmail', reason: 'not_configured' };

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass: pass.replace(/\s/g, '') }
  });
  const info = await transporter.sendMail({
    from: `Farmacia Panda <${user}>`,
    to: recipients().join(','),
    subject,
    text
  });
  return { sent: true, provider: 'gmail', id: info.messageId };
}

async function sendWithResend(subject, text) {
  if (!process.env.RESEND_API_KEY) return { sent: false, provider: 'resend', reason: 'not_configured' };
  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: process.env.FROM_EMAIL || 'Farmacia Panda <onboarding@resend.dev>',
    to: recipients(), subject, text
  });
  if (result.error) throw new Error(result.error.message || 'Resend rechazó el correo');
  return { sent: true, provider: 'resend', id: result.data?.id };
}

async function notify(subject, text) {
  try {
    const gmail = await sendWithGmail(subject, text);
    if (gmail.sent) return gmail;
  } catch (error) {
    console.error('Gmail no pudo enviar:', error.message);
  }
  try {
    return await sendWithResend(subject, text);
  } catch (error) {
    console.error('Resend no pudo enviar:', error.message);
    return { sent: false, reason: 'email_failed' };
  }
}

function admin(req, res, next) {
  const pin = process.env.ADMIN_PIN || '2222';
  if (String(req.headers['x-admin-pin'] || '') !== String(pin)) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

app.get('/', (_req, res) => res.json({ servicio: 'Farmacia Panda API', bien: true }));
app.get('/api/salud', (_req, res) => res.json({ bien: true, fecha: new Date().toISOString() }));

app.post('/api/pedidos', (req, res) => {
  try {
    const body = req.body || {};
    if (!body.cliente?.nombre || !Array.isArray(body.productos) || body.productos.length === 0) {
      return res.status(400).json({ error: 'Pedido inválido' });
    }

    const order = { ...body, folio: makeFolio('FP'), fecha: new Date().toISOString(), estado: 'Nuevo' };
    const orders = readJson(ORDERS_DB);
    orders.unshift(order);
    writeJson(ORDERS_DB, orders);

    res.json({ ok: true, folio: order.folio, mensaje: 'Pedido recibido correctamente' });

    notify(`Nuevo pedido — Farmacia Panda — ${order.folio}`, orderText(order))
      .then(r => console.log('Notificación pedido:', r))
      .catch(e => console.error('Notificación pedido:', e));
  } catch (error) {
    console.error('Error guardando pedido:', error);
    res.status(500).json({ error: 'No se pudo guardar el pedido' });
  }
});

app.post('/api/citas', (req, res) => {
  try {
    const body = req.body || {};
    if (!body.cliente?.nombre || !body.cliente?.telefono) {
      return res.status(400).json({ error: 'Solicitud inválida' });
    }

    const item = { ...body, folio: makeFolio('CITA'), fecha: new Date().toISOString(), estado: 'Pendiente de confirmar' };
    const items = readJson(APPOINTMENTS_DB);
    items.unshift(item);
    writeJson(APPOINTMENTS_DB, items);

    res.json({ ok: true, folio: item.folio, mensaje: 'Solicitud de cita recibida correctamente' });

    notify(`Nueva cita — Farmacia Panda — ${item.folio}`, appointmentText(item))
      .then(r => console.log('Notificación cita:', r))
      .catch(e => console.error('Notificación cita:', e));
  } catch (error) {
    console.error('Error guardando cita:', error);
    res.status(500).json({ error: 'No se pudo guardar la cita' });
  }
});

app.get('/api/pedidos', admin, (_req, res) => res.json(readJson(ORDERS_DB)));
app.get('/api/citas', admin, (_req, res) => res.json(readJson(APPOINTMENTS_DB)));

app.patch('/api/pedidos/:folio', admin, (req, res) => {
  const orders = readJson(ORDERS_DB);
  const item = orders.find(v => v.folio === req.params.folio);
  if (!item) return res.status(404).json({ error: 'Pedido no encontrado' });
  item.estado = req.body?.estado || item.estado;
  item.actualizado = new Date().toISOString();
  writeJson(ORDERS_DB, orders);
  res.json({ ok: true, pedido: item });
});

app.patch('/api/citas/:folio', admin, (req, res) => {
  const items = readJson(APPOINTMENTS_DB);
  const item = items.find(v => v.folio === req.params.folio);
  if (!item) return res.status(404).json({ error: 'Cita no encontrada' });
  item.estado = req.body?.estado || item.estado;
  item.actualizado = new Date().toISOString();
  writeJson(APPOINTMENTS_DB, items);
  res.json({ ok: true, cita: item });
});

app.delete('/api/pedidos/:folio', admin, (req, res) => {
  const orders = readJson(ORDERS_DB);
  const filtered = orders.filter(v => v.folio !== req.params.folio);
  if (filtered.length === orders.length) return res.status(404).json({ error: 'Pedido no encontrado' });
  writeJson(ORDERS_DB, filtered);
  res.json({ ok: true });
});

app.delete('/api/citas/:folio', admin, (req, res) => {
  const items = readJson(APPOINTMENTS_DB);
  const filtered = items.filter(v => v.folio !== req.params.folio);
  if (filtered.length === items.length) return res.status(404).json({ error: 'Cita no encontrada' });
  writeJson(APPOINTMENTS_DB, filtered);
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Farmacia Panda API lista en puerto ${port}. Datos: ${DATA_DIR}`));
