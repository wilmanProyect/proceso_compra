# Proceso de Compras

Sistema web para el **Proceso Integral de Gestión de Compras y Adquisición de Servicios** (ISO 9001), según `docs/procesos/PROCESOS DE COMPRAS Rev.1.pdf`. Atiende a todas las unidades de negocio: Río Verde, Zentta Bio, Cabaña Santa Rosa, RevoAgro, Agroptima y LaSierra360.

Stack: Node.js 20+, Express, EJS y PostgreSQL. Arquitectura monolítica MVC.

## Ejecutar con Docker

```sh
docker compose up -d --build
```

Abra <http://localhost:3000> (o el `APP_PORT` definido en `.env`). Al iniciar, la app aplica el esquema (`database/schema.sql`) y carga los roles, permisos, unidades y formularios.

**Primer ingreso:** usuario `admin` / contraseña `admin123`, o los valores de `ADMIN_USER` y `ADMIN_PASSWORD`. Cambie la contraseña en **Cuenta** apenas ingrese.

Variables importantes en `.env`: `SESSION_SECRET` (obligatoria en producción), `JWT_SECRET` (tokens de la app móvil; si falta usa `SESSION_SECRET`), `DB_*`, `APP_PORT`, `ADMIN_USER`, `ADMIN_PASSWORD`. Los adjuntos y los logos subidos se guardan en los volúmenes `uploads_data` y `logos_data`.

## Cómo se usa: 5 pasos, uno por documento

| Paso | Documento | Quién |
|---|---|---|
| 1 | Solicitud de Compras y Servicios (o Acta de Equipo Tecnológico) | Solicitante → Gerencia aprueba |
| 2 | Cuadro Comparativo de Cotizaciones | Compras → Gerencia aprueba |
| 3 | Orden de Compra (solo críticos / activos fijos) | Compras → Gerencia autoriza |
| 4 | Registro de Inspección y Recepción | Compras (sin revisión ni aprobación) |
| 5 | Nota de Entrega | Coord. Adm. la emite y el proceso se cierra; el solicitante puede confirmar (opcional) |

- **Mis tareas** (inicio) muestra solo lo que le toca hacer a cada usuario. Las aprobaciones se pueden hacer ahí mismo, con un clic.
- La pantalla de cada proceso tiene una línea con los 5 pasos y una tarjeta que dice **qué sigue y quién lo hace**. Debajo se ve el documento del paso seleccionado.
- **Nueva solicitud** es un asistente de 4 partes: unidad → qué necesitas → detalle → revisar y enviar.
- En el paso 2, cada proveedor se carga en su propia tarjeta. El sistema marca cuál es el más barato y cuál tiene el mejor puntaje.

## Proveedores (RV.PCOM.02)

El registro es **común para las 6 unidades de negocio**.

- **Ficha del proveedor:** datos generales, clasificación (crítico o no crítico), documentos de respaldo, incidencias, compras en las que participó e historial.
- **Evaluación y re-evaluación (RV.FCOM.02.1):**
  - Califica 6 criterios de 1 a 10 o N/A. El N/A exige justificación.
  - Resultado según el promedio: 8 a 10 Aprobado · 6 a 7,9 Aprobado con observaciones · menos de 6 No aprobado.
  - Evalúan Compras y Coord. Adm. y RRHH. Aprueban Gerencia o Administración con un clic, y nadie aprueba su propia evaluación.
  - Quien aprueba fija en cuántos meses se reevalúa (sugerido: 12 para críticos y 24 para no críticos).
- **Estados del proveedor:** Nuevo (sin evaluar) · Aprobado · Aprobado con observaciones · No aprobado · Suspendido · Retirado. Gerencia y Administración pueden suspender, retirar o reactivar a un proveedor, y cambiar la fecha de su próxima reevaluación.
- **Uso en el proceso de compra:**
  - En el cuadro comparativo, el proveedor se elige del registro. Los No aprobados, Suspendidos y Retirados no se pueden elegir.
  - Se permite un **proveedor ocasional / de emergencia** (4.2.6), que queda registrado como "Nuevo" y marcado.
  - Si en la recepción un ítem queda "Rechazado" o "Aceptado con observaciones", se anota una incidencia en la ficha del proveedor.
- **Listado de Proveedores Aprobados (RV.FCOM.02.2):** imprimible y exportable a Excel.
- **Mis tareas** muestra:
  - las evaluaciones por aprobar;
  - las evaluaciones devueltas;
  - las reevaluaciones vencidas.

## Formularios electrónicos

Registra todos los formularios por unidad: tipo de documento, proceso/área, código, versión, título (en mayúsculas), fecha y estado (En revisión / Aprobado). Cada cambio queda en el historial con usuario, fecha y hora.

El encabezado de todos los documentos impresos (título · Código · Versión · Fecha) sale de este registro. Los tipos de documento se pueden editar. Este módulo lo gestiona el Administrador.

## Prueba de punta a punta

`tests/e2e.js` recorre el flujo completo con un usuario de cada rol, `tests/api.js` prueba la API móvil y `tests/proveedores.js` prueba proveedores y formularios. **Crea usuarios y procesos de prueba**, así que úsela solo contra una base vacía de pruebas, nunca contra la base real:

```sh
BASE=http://localhost:3299 ADMIN_PASSWORD=admin123 node tests/e2e.js
BASE=http://localhost:3299 ADMIN_PASSWORD=admin123 node tests/api.js   # API de la app móvil
```

## API para la app móvil

La app móvil usa la API JSON en `/api/v1` (token Bearer, sin cookies). Funciona sin conexión con una cola de operaciones que se sincroniza sola; las aprobaciones requieren internet. Diseño completo y referencia de la API en [docs/APP_MOVIL.md](docs/APP_MOVIL.md).

## Detalle del flujo

**Fase 1: Gestión de compras**

1. **Solicitud.** El usuario elige la unidad de negocio y registra la Solicitud de Compras/Servicios. Para equipos tecnológicos se usa el Acta de Equipo Tecnológico. Si el material existe en stock, la solicitud se cierra como "atendida con stock".
2. **Revisión presupuestaria.** Gerencia aprueba o rechaza. El motivo de rechazo es obligatorio.
3. **Cuadro comparativo.** Responsable de Compras registra hasta 3 proveedores, precios y la calificación en los 8 criterios. El sistema **bloquea** el envío si faltan cotizaciones según el monto en Bs:

   | Monto | Cotizaciones requeridas |
   |---|---|
   | Hasta Bs 1.000 | 0 |
   | Bs 1.001 a Bs 3.000 | 1 |
   | Bs 3.001 a Bs 20.000 | 2 |
   | Más de Bs 20.000 | 3 |

   Si la compra es en dólares, se convierte con el tipo de cambio. En casos especiales, Gerencia puede **desbloquear** registrando el motivo.
4. **Aprobación del cuadro** por Gerencia. Puede devolverlo con observaciones.
5. **Orden de Compra.** Solo para productos críticos o activos fijos. Se numera al emitir y luego la autoriza Gerencia.
6. **Seguimiento**, con notas. Los servicios se cierran aquí.

**Fase 2: Control, almacenamiento y entrega** (solo bienes)

7. **Registro de Inspección y Recepción.** Lo registra Compras; no lleva revisión ni aprobación.
8. **Nota de Entrega**, por Coord. Adm. y RRHH. Al emitirla, el proceso queda cerrado. El solicitante puede confirmar la recepción (opcional).

Las aprobaciones se hacen con un clic y quedan registradas con usuario, cargo y fecha. Cada documento tiene una vista para imprimir o guardar en PDF, con el logo, el código de formulario y el código de revisión de la unidad.

## Numeración

Todos los correlativos van **sin ceros a la izquierda**, son por unidad y **se reinician cada año**:

- Requerimiento: `RV-REQ-1`
- Orden de compra: `RV-1`, `ZB-1`, `CSR-1`, `RA-1`, `A-1`, `LS360-1`
- Nota de entrega: `N° 1`

El código de revisión de documento (`RV.26.001`, `ZB.26.001`, …) es fijo y se cambia manualmente en **Unidades** cuando el documento se revisa.

## Roles y visibilidad

| Rol | Qué ve | Qué hace |
|---|---|---|
| Administrador | Todo | Usuarios, unidades, roles y permisos |
| Gerencia General / Financiera | Procesos de todas las unidades | Aprobaciones, autorizaciones y excepciones |
| Coordinador de Área | Solo sus solicitudes | Crear solicitudes |
| Responsable de Compras | Procesos de sus unidades | Cuadro comparativo, OC, seguimiento y recepción |
| Contador | Procesos de sus unidades | Crear solicitudes y consultar (ya no tiene pasos propios) |
| Coordinador Adm. y RRHH | Procesos de sus unidades | Emitir la nota de entrega |

Los permisos de cada rol se pueden modificar en **Roles**.

## Estructura

- `config/`: conexión a PostgreSQL.
- `database/`: esquema y datos iniciales (`migrate.js`).
- `models/`, `controllers/`, `routes/`, `middlewares/`: MVC, autenticación, CSRF y subida de archivos. La API móvil está en `routes/api.js`, `controllers/api/` y `middlewares/apiAuth.js`.
- `services/`: lógica de negocio del flujo y creación de solicitudes, compartida por la web y la futura API móvil (ver `docs/APP_MOVIL.md`).
- `utils/`: constantes del proceso, formatos, correlativos y errores.
- `views/`: pantallas (`procesos/`, `admin/`) e impresión (`imprimir/`).
- `public/`: CSS, JS y logos (`img/`).
