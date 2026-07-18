FARMACIA PANDA — BACKEND FINAL

ESTE ARCHIVO DEJA FUNCIONANDO DE INMEDIATO:
- Recepción y almacenamiento de pedidos.
- Recepción y almacenamiento de citas.
- Panel administrativo con clave 2222.
- Cambio de estado e historial.
- El pedido se confirma al cliente aunque el correo todavía no esté configurado.
- Los correos son opcionales y no bloquean los pedidos.

PARA SUBIR A RENDER
1. Descomprime este ZIP.
2. En el repositorio del backend elimina los archivos anteriores.
3. Sube estos 6 archivos:
   servidor.js
   package.json
   render.yaml
   pedidos.json
   citas.json
   README_SUBIR.txt
4. En Render abre el servicio farmacia-panda-api.
5. Presiona Manual Deploy / Deploy latest commit.
6. Espera a que diga Live.
7. Prueba esta dirección:
   https://farmacia-panda-api.onrender.com/api/salud

PANEL
- La clave continúa siendo 2222.
- Los pedidos y citas se conservan en /var/data cuando Render permite el disco configurado.

CORREO (OPCIONAL, PARA DESPUÉS)
El sistema ya queda operando sin correo. Cuando tengas la contraseña de aplicación de Google, agrega en Render:
GMAIL_USER = prosecogdl@gmail.com
GMAIL_APP_PASSWORD = la contraseña de aplicación de 16 caracteres
ORDER_EMAILS = prosecogdl@gmail.com,elsyalaniz26@gmail.com

No uses la contraseña normal de Gmail.
No publiques ninguna contraseña en GitHub.
