const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ||
  process.env.ADMIN_PIN ||
  "2222";
const JWT_SECRET =
  process.env.JWT_SECRET ||
  "CAMBIA_ESTA_CLAVE_EN_RENDER";

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  process.env.ALLOWED_ORIGIN ||
  "https://farmaciapanda.com,https://www.farmaciapanda.com"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL. Conecta PostgreSQL en Render.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Origen no permitido"));
  },
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.static(path.join(__dirname, "public")));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT NOT NULL,
      neighborhood TEXT DEFAULT '',
      city TEXT DEFAULT '',
      state TEXT DEFAULT '',
      business_hours TEXT DEFAULT '',
      closes_midday BOOLEAN DEFAULT FALSE,
      payment_method TEXT DEFAULT 'Pagar al recibir',
      items JSONB NOT NULL,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pendiente',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      attended_at TIMESTAMPTZ
    );
  `);
}

function createOrderNumber() {
  const now = new Date();
  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("");
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  return `EBD-${datePart}-${randomPart}`;
}

function requireAdmin(req, res, next) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ ok: false, error: "Acceso no autorizado" });
  }
}


function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN"
  }).format(Number(value || 0));
}

function getItemData(item) {
  const name =
    item?.name ||
    item?.nombre ||
    item?.product ||
    item?.producto ||
    "Producto";

  const quantity = Number(item?.quantity || item?.cantidad || 1);
  const price = Number(item?.price || item?.precio || 0);
  const subtotal = Number(
    item?.subtotal ||
    item?.total ||
    quantity * price
  );

  return { name, quantity, price, subtotal };
}

async function sendOrderEmailWithResend(order) {
  const apiKey = process.env.RESEND_API_KEY;
  const emailTo =
    process.env.ORDER_EMAIL_TO ||
    process.env.EMAIL_TO ||
    "elsyalaniz26@gmail.com";

  if (!apiKey) {
    console.error(
      `No se envió el correo del pedido ${order.order_number}: ` +
      "falta RESEND_API_KEY en Render."
    );
    return;
  }

  const items = Array.isArray(order.items) ? order.items : [];

  const itemRows = items.length
    ? items
        .map((item) => {
          const data = getItemData(item);
          return `
            <tr>
              <td style="padding:9px;border:1px solid #d9d9d9;">
                ${escapeHtml(data.name)}
              </td>
              <td style="padding:9px;border:1px solid #d9d9d9;text-align:center;">
                ${data.quantity}
              </td>
              <td style="padding:9px;border:1px solid #d9d9d9;text-align:right;">
                ${formatMoney(data.price)}
              </td>
              <td style="padding:9px;border:1px solid #d9d9d9;text-align:right;">
                ${formatMoney(data.subtotal)}
              </td>
            </tr>
          `;
        })
        .join("")
    : `
      <tr>
        <td colspan="4" style="padding:9px;border:1px solid #d9d9d9;">
          Sin productos
        </td>
      </tr>
    `;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;color:#172033;">
      <div style="background:#0755b5;color:white;padding:20px;border-radius:12px 12px 0 0;">
        <h1 style="margin:0;font-size:25px;">Nuevo pedido recibido</h1>
        <p style="margin:8px 0 0;font-size:18px;">
          Folio: <strong>${escapeHtml(order.order_number)}</strong>
        </p>
      </div>

      <div style="padding:22px;border:1px solid #d9e2ef;border-top:0;">
        <h2 style="color:#0755b5;">Datos del cliente</h2>
        <p><strong>Nombre:</strong> ${escapeHtml(order.customer_name)}</p>
        <p><strong>Teléfono:</strong> ${escapeHtml(order.phone || "No indicado")}</p>
        <p><strong>Domicilio:</strong> ${escapeHtml(order.address)}</p>
        <p><strong>Colonia:</strong> ${escapeHtml(order.neighborhood || "No indicada")}</p>
        <p><strong>Ciudad:</strong> ${escapeHtml(order.city || "No indicada")}</p>
        <p><strong>Estado:</strong> ${escapeHtml(order.state || "No indicado")}</p>
        <p><strong>Horario:</strong> ${escapeHtml(order.business_hours || "No indicado")}</p>
        <p><strong>Cierra al mediodía:</strong> ${order.closes_midday ? "Sí" : "No"}</p>
        <p><strong>Forma de pago:</strong> ${escapeHtml(order.payment_method || "Pagar al recibir")}</p>

        <h2 style="color:#0755b5;margin-top:28px;">Productos</h2>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          <thead>
            <tr style="background:#eef5ff;">
              <th style="padding:9px;border:1px solid #d9d9d9;text-align:left;">Producto</th>
              <th style="padding:9px;border:1px solid #d9d9d9;">Cantidad</th>
              <th style="padding:9px;border:1px solid #d9d9d9;text-align:right;">Precio</th>
              <th style="padding:9px;border:1px solid #d9d9d9;text-align:right;">Subtotal</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
        </table>

        <h2 style="text-align:right;color:#cc1736;margin-top:22px;">
          Total estimado: ${formatMoney(order.total)}
        </h2>

        <p>
          <strong>Observaciones:</strong>
          ${escapeHtml(order.notes || "Sin observaciones")}
        </p>

        <p style="margin-top:28px;padding:14px;background:#fff5dc;border-radius:8px;">
          Revise el pedido en el panel privado de <strong>farmaciapanda.com</strong>.
        </p>
      </div>
    </div>
  `;

  const textItems = items.length
    ? items
        .map((item, index) => {
          const data = getItemData(item);
          return (
            `${index + 1}. ${data.name} | Cantidad: ${data.quantity} | ` +
            `Precio: ${formatMoney(data.price)} | Subtotal: ${formatMoney(data.subtotal)}`
          );
        })
        .join("\n")
    : "Sin productos";

  const text = [
    `NUEVO PEDIDO ${order.order_number}`,
    "",
    `Cliente: ${order.customer_name}`,
    `Teléfono: ${order.phone || "No indicado"}`,
    `Domicilio: ${order.address}`,
    `Colonia: ${order.neighborhood || "No indicada"}`,
    `Ciudad: ${order.city || "No indicada"}`,
    `Estado: ${order.state || "No indicado"}`,
    `Horario: ${order.business_hours || "No indicado"}`,
    `Cierra al mediodía: ${order.closes_midday ? "Sí" : "No"}`,
    `Forma de pago: ${order.payment_method || "Pagar al recibir"}`,
    "",
    "PRODUCTOS",
    textItems,
    "",
    `TOTAL ESTIMADO: ${formatMoney(order.total)}`,
    "",
    `Observaciones: ${order.notes || "Sin observaciones"}`
  ].join("\n");

  console.log(
    `Intentando enviar correo Resend del pedido ${order.order_number} a ${emailTo}...`
  );

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Farmacia Panda <onboarding@resend.dev>",
      to: [emailTo],
      subject: `Nuevo pedido ${order.order_number}`,
      html,
      text
    })
  });

  const detail = await response.text();

  if (!response.ok) {
    console.error(
      `No se pudo enviar el correo Resend para ${order.order_number}. ` +
      `HTTP ${response.status}: ${detail}`
    );
    return;
  }

  console.log(
    `Correo Resend enviado correctamente para ${order.order_number}: ${detail}`
  );
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "elbambinodaniel-pedidos" });
});

app.get("/api/salud", (_req, res) => {
  res.json({ ok: true, servicio: "elbambinodaniel-pedidos" });
});

app.post("/api/admin/login", (req, res) => {
  const password = String(
    req.body?.password ??
    req.body?.pin ??
    req.body?.clave ??
    ""
  );

  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: "Clave incorrecta" });
  }

  const token = jwt.sign({ role: "admin" }, JWT_SECRET, {
    expiresIn: "12h"
  });

  res.json({ ok: true, token });
});

app.post("/api/orders", async (req, res) => {
  try {
    const body = req.body || {};
    const customerName = String(body.customerName || body.nombre || "").trim();
    const address = String(
      body.address || body.domicilio || body.ubicacion || ""
    ).trim();
    const items = Array.isArray(body.items || body.productos)
      ? (body.items || body.productos)
      : [];

    if (!customerName || !address || items.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Faltan nombre, domicilio o productos."
      });
    }

    const orderNumber = createOrderNumber();
    const total = Number(body.total || 0);

    const values = [
      orderNumber,
      customerName,
      String(body.phone || body.telefono || ""),
      address,
      String(body.neighborhood || body.colonia || ""),
      String(body.city || body.ciudad || ""),
      String(body.state || body.estado || ""),
      String(body.businessHours || body.horario || ""),
      Boolean(body.closesMidday || body.cierraMediodia),
      String(body.paymentMethod || body.formaPago || "Pagar al recibir"),
      JSON.stringify(items),
      Number.isFinite(total) ? total : 0,
      String(body.notes || body.notas || "")
    ];

    const result = await pool.query(
      `INSERT INTO orders (
        order_number, customer_name, phone, address, neighborhood,
        city, state, business_hours, closes_midday, payment_method,
        items, total, notes
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13
      ) RETURNING *`,
      values
    );

    const order = result.rows[0];
    console.log(`Pedido registrado correctamente: ${order.order_number}`);

    sendOrderEmailWithResend(order).catch((error) => {
      console.error(
        `Error inesperado al enviar el correo del pedido ${order.order_number}:`,
        error
      );
    });

    res.status(201).json({
      ok: true,
      orderNumber: order.order_number,
      message: `Pedido ${order.order_number} recibido correctamente.`
    });
  } catch (error) {
    console.error("Error al guardar pedido:", error);
    res.status(500).json({
      ok: false,
      error: "No fue posible guardar el pedido."
    });
  }
});

app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  try {
    const requestedStatus = String(req.query.status || "pendiente");
    const statusMap = {
      pending: "pendiente",
      attended: "atendido",
      all: "todos",
      pendiente: "pendiente",
      atendido: "atendido",
      todos: "todos"
    };
    const status = statusMap[requestedStatus];

    if (!status) {
      return res.status(400).json({ ok: false, error: "Estado inválido" });
    }

    const result = status === "todos"
      ? await pool.query("SELECT * FROM orders ORDER BY created_at DESC")
      : await pool.query(
          "SELECT * FROM orders WHERE status=$1 ORDER BY created_at DESC",
          [status]
        );

    res.json({ ok: true, orders: result.rows });
  } catch (error) {
    console.error("Error al consultar pedidos:", error);
    res.status(500).json({
      ok: false,
      error: "No fue posible consultar pedidos."
    });
  }
});

app.patch("/api/admin/orders/:id/attend", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE orders
       SET status='atendido', attended_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [req.params.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        ok: false,
        error: "Pedido no encontrado"
      });
    }

    res.json({ ok: true, order: result.rows[0] });
  } catch (error) {
    console.error("Error al atender pedido:", error);
    res.status(500).json({
      ok: false,
      error: "No fue posible actualizar el pedido."
    });
  }
});

app.patch("/api/admin/orders/:id/reopen", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE orders
       SET status='pendiente', attended_at=NULL
       WHERE id=$1
       RETURNING *`,
      [req.params.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        ok: false,
        error: "Pedido no encontrado"
      });
    }

    res.json({ ok: true, order: result.rows[0] });
  } catch (error) {
    console.error("Error al reabrir pedido:", error);
    res.status(500).json({
      ok: false,
      error: "No fue posible actualizar el pedido."
    });
  }
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Servidor activo en puerto ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Error al iniciar la base de datos:", error);
    process.exit(1);
  });
