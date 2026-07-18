const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { Resend } = require("resend");
const twilio = require("twilio");

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

const ORDERS_DB = path.join(__dirname, "pedidos.json");
const APPOINTMENTS_DB = path.join(__dirname, "citas.json");

function ensureJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "[]", "utf8");
  }
}

ensureJsonFile(ORDERS_DB);
ensureJsonFile(APPOINTMENTS_DB);

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8") || "[]");
  } catch (error) {
    console.error(`No se pudo leer ${path.basename(filePath)}:`, error);
    return [];
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function money(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(Number(value || 0));
}

function makeFolio(prefix) {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${date}-${random}`;
}

function orderText(order) {
  const c = order.cliente || {};
  const products = Array.isArray(order.productos) ? order.productos : [];

  return `NUEVO PEDIDO — FARMACIA PANDA

Folio: ${order.folio}
Fecha: ${new Date(order.fecha).toLocaleString("es-MX")}
Cliente: ${c.nombre || "No indicado"}
Teléfono: ${c.telefono || "No indicado"}
Domicilio: ${c.domicilio || ""}, ${c.colonia || ""}, ${c.ciudad || ""}, ${c.estado || ""}
Zona: ${c.zona || "No indicada"}
Horario: ${c.horario || "No indicado"}

PRODUCTOS
${products.map((p) => {
  const importe = p.importe ?? Number(p.precio || 0) * Number(p.cantidad || 1);
  return `${p.cantidad || 1} x ${p.nombre || "Producto"} — ${money(importe)}`;
}).join("\n")}

SUBTOTAL: ${money(order.subtotal ?? order.total)}
ENVÍO: ${money(order.envio || 0)}
TOTAL: ${money(order.total)}
Observaciones: ${c.observaciones || "Ninguna"}`;
}

function appointmentText(appointment) {
  const c = appointment.cliente || {};

  return `NUEVA CITA — FARMACIA PANDA

Folio: ${appointment.folio}
Fecha de solicitud: ${new Date(appointment.fecha).toLocaleString("es-MX")}
Nombre: ${c.nombre || "No indicado"}
Teléfono: ${c.telefono || "No indicado"}
Edad: ${c.edad || "No indicada"}
Servicio: ${c.servicio || "No indicado"}
Tratamiento solicitado: ${c.tratamiento || "No indicado"}
Horario preferente: ${c.preferencia || "No indicado"}
Fecha preferida: ${c.fechaPreferida || "Sin fecha indicada"}
Observaciones: ${c.observaciones || "Ninguna"}`;
}

function recipients() {
  return (process.env.ORDER_EMAILS || "elsyalaniz26@gmail.com,prosecogdl@gmail.com")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

async function sendEmail(subject, text) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("Correo omitido: falta RESEND_API_KEY.");
    return { sent: false, reason: "missing_api_key" };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.FROM_EMAIL || "Farmacia Panda <onboarding@resend.dev>";
  const to = recipients();

  console.log("Intentando enviar correo a:", to.join(", "));

  const result = await resend.emails.send({ from, to, subject, text });

  if (result.error) {
    console.error("Resend rechazó el correo:", result.error);
    return { sent: false, reason: "resend_error", error: result.error };
  }

  console.log("Correo enviado correctamente. ID:", result.data?.id || "sin ID");
  return { sent: true, id: result.data?.id };
}

async function sendWhatsApp(text) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const to = process.env.TWILIO_WHATSAPP_TO;

  if (!sid || !token || !to) {
    return { sent: false, reason: "twilio_not_configured" };
  }

  const client = twilio(sid, token);
  const result = await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886",
    to,
    body: text.slice(0, 1500),
  });

  console.log("WhatsApp enviado. SID:", result.sid);
  return { sent: true, sid: result.sid };
}

async function notify(subject, text) {
  const [email, whatsapp] = await Promise.allSettled([
    sendEmail(subject, text),
    sendWhatsApp(text),
  ]);

  if (email.status === "rejected") {
    console.error("Error enviando correo:", email.reason);
  }
  if (whatsapp.status === "rejected") {
    console.error("Error enviando WhatsApp:", whatsapp.reason);
  }

  return {
    email: email.status === "fulfilled" ? email.value : { sent: false },
    whatsapp: whatsapp.status === "fulfilled" ? whatsapp.value : { sent: false },
  };
}

app.get("/api/salud", (_req, res) => {
  res.json({ bien: true });
});

app.post("/api/pedidos", async (req, res) => {
  try {
    const order = {
      ...req.body,
      folio: makeFolio("FP"),
      fecha: new Date().toISOString(),
      estado: "Nuevo",
    };

    if (
      !order.cliente ||
      !order.cliente.nombre ||
      !Array.isArray(order.productos) ||
      order.productos.length === 0
    ) {
      return res.status(400).json({ error: "Pedido inválido" });
    }

    const orders = readJson(ORDERS_DB);
    orders.unshift(order);
    writeJson(ORDERS_DB, orders);

    console.log(`Pedido recibido y guardado: ${order.folio}`);

    const notifications = await notify(
      `Nuevo pedido — Farmacia Panda — ${order.folio}`,
      orderText(order)
    );

    return res.json({
      ok: true,
      folio: order.folio,
      mensaje: "Pedido enviado correctamente",
      notificaciones: notifications,
    });
  } catch (error) {
    console.error("Error al guardar el pedido:", error);
    return res.status(500).json({ error: "No se pudo guardar el pedido" });
  }
});

app.post("/api/citas", async (req, res) => {
  try {
    const appointment = {
      ...req.body,
      folio: makeFolio("CITA"),
      fecha: new Date().toISOString(),
      estado: "Pendiente de confirmar",
    };

    if (
      !appointment.cliente ||
      !appointment.cliente.nombre ||
      !appointment.cliente.telefono
    ) {
      return res.status(400).json({ error: "Solicitud inválida" });
    }

    const appointments = readJson(APPOINTMENTS_DB);
    appointments.unshift(appointment);
    writeJson(APPOINTMENTS_DB, appointments);

    console.log(`Cita recibida y guardada: ${appointment.folio}`);

    const notifications = await notify(
      `Nueva cita — Farmacia Panda — ${appointment.folio}`,
      appointmentText(appointment)
    );

    return res.json({
      ok: true,
      folio: appointment.folio,
      mensaje: "Solicitud de cita enviada correctamente",
      notificaciones: notifications,
    });
  } catch (error) {
    console.error("Error al guardar la cita:", error);
    return res.status(500).json({ error: "No se pudo guardar la cita" });
  }
});

function admin(req, res, next) {
  const pin = process.env.ADMIN_PIN || "2222";
  if (req.headers["x-admin-pin"] !== pin) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

app.get("/api/pedidos", admin, (_req, res) => {
  res.json(readJson(ORDERS_DB));
});

app.patch("/api/pedidos/:folio", admin, (req, res) => {
  const orders = readJson(ORDERS_DB);
  const order = orders.find((item) => item.folio === req.params.folio);

  if (!order) {
    return res.status(404).json({ error: "Pedido no encontrado" });
  }

  order.estado = req.body.estado || order.estado;
  writeJson(ORDERS_DB, orders);
  res.json(order);
});

app.get("/api/citas", admin, (_req, res) => {
  res.json(readJson(APPOINTMENTS_DB));
});

app.patch("/api/citas/:folio", admin, (req, res) => {
  const appointments = readJson(APPOINTMENTS_DB);
  const appointment = appointments.find((item) => item.folio === req.params.folio);

  if (!appointment) {
    return res.status(404).json({ error: "Cita no encontrada" });
  }

  appointment.estado = req.body.estado || appointment.estado;
  writeJson(APPOINTMENTS_DB, appointments);
  res.json(appointment);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Farmacia Panda API lista en el puerto ${port}`);
});
