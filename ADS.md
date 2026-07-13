# Campañas de ads con Meta (Facebook / Instagram)

El bot puede **proponer, crear y optimizar** campañas de anuncios en Meta:

1. Eliges 1+ piezas ya generadas (con imagen) en **Ajustes → Campañas de ads**.
2. La IA propone la campaña (objetivo, público, presupuesto y los copies de cada anuncio) usando el
   contexto de tu marca.
3. Revisas/editas presupuesto y decides: crear **en pausa** (recomendado) o **activar** (empieza a gastar).
4. El bot la crea en Meta (Campaña → Conjunto → Creativos → Anuncios).
5. Con **Optimizar**, lee las métricas (CTR, gasto) y sugiere/aplica cambios (pausar lo que rinde mal,
   subir presupuesto a lo que rinde bien, respetando el tope).

> **Seguridad:** nada se activa sin tu confirmación. Todo se crea **PAUSED** por defecto, y el bot
> **nunca** crea/optimiza un conjunto con presupuesto diario mayor a `ADS_MAX_DAILY_BUDGET`.

---

## 1. Qué necesitas (una sola vez)

| Cosa | Dónde |
|---|---|
| **Business Manager** | [business.facebook.com](https://business.facebook.com) → crea tu empresa |
| **Página de Facebook** | ligada al Business (ya la usas para publicar) |
| **Cuenta de Instagram Business** | ligada a la Página (opcional pero recomendado) |
| **Cuenta publicitaria** (Ad Account) | Business Manager → Configuración → Cuentas publicitarias → Crear. Anota su **ID** (número, sin `act_`) |
| **Método de pago** | en la cuenta publicitaria (tarjeta) — Meta cobra el gasto de las ads |
| **App de Meta for Developers** | [developers.facebook.com](https://developers.facebook.com) → crea una app tipo *Business* |
| **Token con `ads_management`** | ver abajo |
| **Píxel** (solo para ventas) | Events Manager → crea un píxel, anota su ID (opcional) |

### Token con permiso `ads_management`

- Rápido (caduca): [Graph API Explorer](https://developers.facebook.com/tools/explorer) → tu app →
  *Get Token* → *User Token* → marca `ads_management`, `pages_read_engagement`, `pages_manage_posts`,
  `business_management` → **Generate**. Sirve para probar (dura ~1-2 h).
- **Producción (larga duración):** genera un **System User** en Business Manager → Configuración →
  Usuarios del sistema → crea uno *Admin* → asígnale la cuenta publicitaria y la Página → **Generar token**
  con los mismos permisos → ese token dura mucho (ideal para el servidor). Guárdalo bien.
- La app debe pasar **App Review** para usar `ads_management` con usuarios que no sean admins de la app;
  para tu propia cuenta (siendo admin/rol asignado) funciona en modo desarrollo.

---

## 2. Configurarlo en el panel

**Ajustes → Conexiones** (sección *Meta Ads*):

- **Token de Meta Ads** (`META_ADS_TOKEN`) → el token con `ads_management`. Se guarda cifrado.
  (Si no lo pones, el bot intenta con `INSTAGRAM_ACCESS_TOKEN`, que suele NO tener permiso de ads.)
- **Cuenta publicitaria** (`META_AD_ACCOUNT_ID`) → el ID numérico (sin `act_`).
- **Píxel** (`META_PIXEL_ID`) → opcional, solo para campañas de ventas.
- **Tope de gasto diario** (`ADS_MAX_DAILY_BUDGET`) → **pon un número** (en la moneda de tu cuenta).
  Es tu red de seguridad; el bot nunca lo supera.

También necesitas `FACEBOOK_PAGE_ID` (ya lo usas para publicar) e `INSTAGRAM_BUSINESS_ACCOUNT_ID`
(opcional, para que los anuncios salgan también en IG).

> En el VPS puedes ponerlos en el `.env` en vez del panel; el `.env` tiene prioridad.

---

## 3. Notas y límites de esta versión

- Solo **anuncios de imagen** por ahora (usa la imagen de la pieza). Los videos aún no se promocionan.
- Los **intereses** de segmentación que propone la IA se resuelven a IDs reales de Meta (búsqueda);
  si alguno no se encuentra, se omite y queda el público amplio (geo + edad).
- Objetivos soportados (ODAX): reconocimiento, tráfico, interacción, clientes potenciales, ventas.
- La optimización mira los **últimos 7 días**; deja correr 2-3 días antes de optimizar para tener datos.
- El copy (texto principal, titular, CTA) lo escribe tu agente de IA con el contexto de marca; puedes
  ajustar presupuesto/duración antes de crear.
