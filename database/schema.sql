-- Esquema del sistema de Proceso de Compras (idempotente: se aplica al iniciar la app)

-- ===================== Seguridad =====================
CREATE TABLE IF NOT EXISTS roles (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo VARCHAR(40) NOT NULL UNIQUE,
    nombre VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS permisos (
    codigo VARCHAR(60) PRIMARY KEY,
    descripcion VARCHAR(200) NOT NULL,
    grupo VARCHAR(60) NOT NULL,
    orden INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rol_permisos (
    rol_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permiso_codigo VARCHAR(60) NOT NULL REFERENCES permisos(codigo) ON DELETE CASCADE,
    PRIMARY KEY (rol_id, permiso_codigo)
);

CREATE TABLE IF NOT EXISTS usuarios (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario VARCHAR(60) NOT NULL UNIQUE,
    nombre VARCHAR(150) NOT NULL,
    cargo VARCHAR(120) NOT NULL DEFAULT '',
    email VARCHAR(150) NOT NULL DEFAULT '',
    password_hash VARCHAR(100) NOT NULL,
    rol_id INT NOT NULL REFERENCES roles(id),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    ultimo_acceso TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===================== Unidades de negocio =====================
CREATE TABLE IF NOT EXISTS unidades_negocio (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sigla VARCHAR(10) NOT NULL UNIQUE,           -- RV, ZB, CSR, RA, A, LS360
    nombre VARCHAR(120) NOT NULL,
    razon_social VARCHAR(200) NOT NULL DEFAULT '',
    nit VARCHAR(40) NOT NULL DEFAULT '',
    direccion VARCHAR(250) NOT NULL DEFAULT '',
    telefono VARCHAR(60) NOT NULL DEFAULT '',
    logo VARCHAR(200) NOT NULL DEFAULT '',
    codigo_revision VARCHAR(40) NOT NULL DEFAULT '',   -- RV.26.001 (cambia solo cuando se revisa el documento)
    lugar_entrega VARCHAR(250) NOT NULL DEFAULT '',
    lugar_cobranza VARCHAR(250) NOT NULL DEFAULT '',
    datos_factura TEXT NOT NULL DEFAULT '',
    notas_oc TEXT NOT NULL DEFAULT '',
    color VARCHAR(10) NOT NULL DEFAULT '#183c32',
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS usuario_unidades (
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    unidad_id INT NOT NULL REFERENCES unidades_negocio(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, unidad_id)
);

-- Los códigos de formularios por unidad viven en la tabla "formularios" (módulo de formularios electrónicos, al final).
-- La tabla antigua formularios_unidad se migra y elimina en database/migrate.js.

CREATE TABLE IF NOT EXISTS departamentos (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    unidad_id INT NOT NULL REFERENCES unidades_negocio(id) ON DELETE CASCADE,
    nombre VARCHAR(120) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (unidad_id, nombre)
);

-- Correlativos por unidad, tipo y gestión (se reinician cada año)
CREATE TABLE IF NOT EXISTS correlativos (
    unidad_id INT NOT NULL REFERENCES unidades_negocio(id) ON DELETE CASCADE,
    tipo VARCHAR(30) NOT NULL,
    gestion INT NOT NULL,
    ultimo INT NOT NULL DEFAULT 0,
    PRIMARY KEY (unidad_id, tipo, gestion)
);

-- ===================== Proceso de compra =====================
CREATE TABLE IF NOT EXISTS procesos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    unidad_id INT NOT NULL REFERENCES unidades_negocio(id),
    gestion INT NOT NULL,
    nro_requerimiento INT NOT NULL,
    estado VARCHAR(40) NOT NULL,
    -- Solicitud
    tipo_solicitud VARCHAR(30) NOT NULL,          -- COMPRA | SERVICIO | EQUIPO_TECNOLOGICO
    solicitante_id BIGINT NOT NULL REFERENCES usuarios(id),
    departamento_id INT REFERENCES departamentos(id),
    fecha_solicitud DATE NOT NULL DEFAULT CURRENT_DATE,
    prioridad VARCHAR(10) NOT NULL DEFAULT 'MEDIA',
    requiere_oc BOOLEAN NOT NULL DEFAULT FALSE,    -- producto crítico / activo fijo
    existe_stock BOOLEAN NOT NULL DEFAULT FALSE,
    monto_estimado NUMERIC(14,2),
    motivo TEXT NOT NULL DEFAULT '',               -- Acta de equipo tecnológico
    area_receptora VARCHAR(150) NOT NULL DEFAULT '',
    comentarios TEXT NOT NULL DEFAULT '',
    motivo_rechazo TEXT NOT NULL DEFAULT '',
    -- Cuadro comparativo
    fecha_evaluacion DATE,
    moneda VARCHAR(5) NOT NULL DEFAULT 'BS',
    tipo_cambio NUMERIC(10,4) NOT NULL DEFAULT 6.96,
    justificacion TEXT NOT NULL DEFAULT '',
    excepcion_cotizaciones BOOLEAN NOT NULL DEFAULT FALSE,
    excepcion_motivo TEXT NOT NULL DEFAULT '',
    excepcion_usuario_id BIGINT REFERENCES usuarios(id),
    excepcion_fecha TIMESTAMPTZ,
    -- Orden de compra
    oc_numero INT,
    oc_gestion INT,
    oc_fecha_emision DATE,
    oc_plazo_entrega VARCHAR(200) NOT NULL DEFAULT '',
    oc_condicion_pago VARCHAR(200) NOT NULL DEFAULT '',
    oc_lugar_entrega VARCHAR(250) NOT NULL DEFAULT '',
    oc_lugar_cobranza VARCHAR(250) NOT NULL DEFAULT '',
    oc_certificado VARCHAR(250) NOT NULL DEFAULT '',
    oc_datos_factura TEXT NOT NULL DEFAULT '',
    oc_descuento NUMERIC(14,2) NOT NULL DEFAULT 0,
    oc_comentarios TEXT NOT NULL DEFAULT '',
    -- Recepción e inspección
    rec_fecha DATE,
    rec_nro_factura VARCHAR(80) NOT NULL DEFAULT '',
    rec_tipo_bien VARCHAR(30) NOT NULL DEFAULT '',
    rec_cantidad_ok BOOLEAN NOT NULL DEFAULT FALSE,
    rec_estado_ok BOOLEAN NOT NULL DEFAULT FALSE,
    rec_documentacion_ok BOOLEAN NOT NULL DEFAULT FALSE,
    rec_accesorios_ok BOOLEAN NOT NULL DEFAULT FALSE,
    rec_especificaciones_ok BOOLEAN NOT NULL DEFAULT FALSE,
    rec_comentarios TEXT NOT NULL DEFAULT '',
    -- Ingreso / almacén / entrega / egreso
    ingreso_comprobante VARCHAR(80) NOT NULL DEFAULT '',
    ingreso_fecha DATE,
    almacen_observaciones TEXT NOT NULL DEFAULT '',
    almacen_fecha DATE,
    ne_numero INT,
    ne_gestion INT,
    ne_fecha DATE,
    ne_entregado_a VARCHAR(150) NOT NULL DEFAULT '',
    egreso_registro VARCHAR(80) NOT NULL DEFAULT '',
    egreso_fecha DATE,
    cierre_comentario TEXT NOT NULL DEFAULT '',
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (unidad_id, gestion, nro_requerimiento)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_procesos_oc ON procesos (unidad_id, oc_gestion, oc_numero) WHERE oc_numero IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_procesos_ne ON procesos (unidad_id, ne_gestion, ne_numero) WHERE ne_numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_procesos_estado ON procesos (estado);
CREATE INDEX IF NOT EXISTS ix_procesos_solicitante ON procesos (solicitante_id);

CREATE TABLE IF NOT EXISTS proceso_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proceso_id BIGINT NOT NULL REFERENCES procesos(id) ON DELETE CASCADE,
    nro INT NOT NULL,
    descripcion TEXT NOT NULL,
    nro_parte VARCHAR(80) NOT NULL DEFAULT '',
    cantidad NUMERIC(12,2) NOT NULL CHECK (cantidad > 0),
    unidad VARCHAR(30) NOT NULL DEFAULT '',
    destino VARCHAR(150) NOT NULL DEFAULT '',
    observaciones TEXT NOT NULL DEFAULT '',
    especificaciones TEXT NOT NULL DEFAULT '',
    proveedor_sugerido VARCHAR(150) NOT NULL DEFAULT '',
    contacto VARCHAR(150) NOT NULL DEFAULT '',
    -- Recepción
    rec_codigo_serie VARCHAR(120) NOT NULL DEFAULT '',
    rec_modelo VARCHAR(120) NOT NULL DEFAULT '',
    rec_cantidad NUMERIC(12,2),
    rec_estado VARCHAR(40) NOT NULL DEFAULT '',
    rec_observaciones TEXT NOT NULL DEFAULT '',
    -- Nota de entrega
    ne_cantidad NUMERIC(12,2)
);

CREATE TABLE IF NOT EXISTS cotizaciones (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proceso_id BIGINT NOT NULL REFERENCES procesos(id) ON DELETE CASCADE,
    orden INT NOT NULL CHECK (orden BETWEEN 1 AND 3),
    proveedor VARCHAR(200) NOT NULL,
    nit VARCHAR(40) NOT NULL DEFAULT '',
    telefono VARCHAR(60) NOT NULL DEFAULT '',
    contacto VARCHAR(150) NOT NULL DEFAULT '',
    email VARCHAR(150) NOT NULL DEFAULT '',
    cuenta_bancaria VARCHAR(60) NOT NULL DEFAULT '',
    banco VARCHAR(100) NOT NULL DEFAULT '',
    seleccionada BOOLEAN NOT NULL DEFAULT FALSE,
    criterios JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"1": 8, "2": 9, ...}
    UNIQUE (proceso_id, orden)
);

CREATE TABLE IF NOT EXISTS cotizacion_precios (
    cotizacion_id BIGINT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
    item_id BIGINT NOT NULL REFERENCES proceso_items(id) ON DELETE CASCADE,
    precio_unitario NUMERIC(14,2) NOT NULL CHECK (precio_unitario >= 0),
    PRIMARY KEY (cotizacion_id, item_id)
);

-- Firmas digitales (aprobación con un clic)
CREATE TABLE IF NOT EXISTS firmas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proceso_id BIGINT NOT NULL REFERENCES procesos(id) ON DELETE CASCADE,
    documento VARCHAR(30) NOT NULL,
    tipo VARCHAR(30) NOT NULL,
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    nombre VARCHAR(150) NOT NULL,
    cargo VARCHAR(120) NOT NULL DEFAULT '',
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (proceso_id, documento, tipo)
);

CREATE TABLE IF NOT EXISTS proceso_eventos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proceso_id BIGINT NOT NULL REFERENCES procesos(id) ON DELETE CASCADE,
    usuario_id BIGINT REFERENCES usuarios(id),
    accion VARCHAR(120) NOT NULL,
    comentario TEXT NOT NULL DEFAULT '',
    estado_nuevo VARCHAR(40),
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_eventos_proceso ON proceso_eventos (proceso_id);

CREATE TABLE IF NOT EXISTS adjuntos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proceso_id BIGINT NOT NULL REFERENCES procesos(id) ON DELETE CASCADE,
    etapa VARCHAR(30) NOT NULL,
    nombre_original VARCHAR(255) NOT NULL,
    archivo VARCHAR(255) NOT NULL,
    mime VARCHAR(120) NOT NULL DEFAULT '',
    tamano INT NOT NULL DEFAULT 0,
    usuario_id BIGINT REFERENCES usuarios(id),
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sesiones (connect-pg-simple)
CREATE TABLE IF NOT EXISTS "session" (
    "sid" VARCHAR NOT NULL PRIMARY KEY,
    "sess" JSON NOT NULL,
    "expire" TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- Tabla de ejemplo anterior
DROP TABLE IF EXISTS productos;

-- ===================== Soporte para la app móvil (docs/APP_MOVIL.md §6) =====================

-- Identificadores globales: la app crea registros sin conexión y no conoce el id del servidor
ALTER TABLE procesos      ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE proceso_items ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE cotizaciones  ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE adjuntos      ADD COLUMN IF NOT EXISTS uuid UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS ux_procesos_uuid     ON procesos (uuid);
CREATE UNIQUE INDEX IF NOT EXISTS ux_items_uuid        ON proceso_items (uuid);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cotizaciones_uuid ON cotizaciones (uuid);
CREATE UNIQUE INDEX IF NOT EXISTS ux_adjuntos_uuid     ON adjuntos (uuid);

-- Versión de cambios: cualquier cambio en un proceso o en sus tablas hijas le asigna una versión nueva.
-- La app descarga solo los procesos con sync_version mayor a la última que recibió.
CREATE SEQUENCE IF NOT EXISTS sync_version_seq;
ALTER TABLE procesos ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT nextval('sync_version_seq');
CREATE INDEX IF NOT EXISTS ix_procesos_sync_version ON procesos (sync_version);

CREATE OR REPLACE FUNCTION sync_tocar_proceso() RETURNS trigger AS $$
BEGIN
  NEW.sync_version := nextval('sync_version_seq');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_tocar_desde_hijo() RETURNS trigger AS $$
DECLARE pid BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN pid := OLD.proceso_id; ELSE pid := NEW.proceso_id; END IF;
  UPDATE procesos SET sync_version = nextval('sync_version_seq') WHERE id = pid;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_tocar_desde_precio() RETURNS trigger AS $$
DECLARE cid BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN cid := OLD.cotizacion_id; ELSE cid := NEW.cotizacion_id; END IF;
  UPDATE procesos SET sync_version = nextval('sync_version_seq')
   WHERE id = (SELECT proceso_id FROM cotizaciones WHERE id = cid);
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER tr_sync_procesos BEFORE UPDATE ON procesos
  FOR EACH ROW EXECUTE FUNCTION sync_tocar_proceso();
CREATE OR REPLACE TRIGGER tr_sync_items AFTER INSERT OR UPDATE OR DELETE ON proceso_items
  FOR EACH ROW EXECUTE FUNCTION sync_tocar_desde_hijo();
CREATE OR REPLACE TRIGGER tr_sync_cotizaciones AFTER INSERT OR UPDATE OR DELETE ON cotizaciones
  FOR EACH ROW EXECUTE FUNCTION sync_tocar_desde_hijo();
CREATE OR REPLACE TRIGGER tr_sync_firmas AFTER INSERT OR UPDATE OR DELETE ON firmas
  FOR EACH ROW EXECUTE FUNCTION sync_tocar_desde_hijo();
CREATE OR REPLACE TRIGGER tr_sync_eventos AFTER INSERT OR UPDATE OR DELETE ON proceso_eventos
  FOR EACH ROW EXECUTE FUNCTION sync_tocar_desde_hijo();
CREATE OR REPLACE TRIGGER tr_sync_adjuntos AFTER INSERT OR UPDATE OR DELETE ON adjuntos
  FOR EACH ROW EXECUTE FUNCTION sync_tocar_desde_hijo();
CREATE OR REPLACE TRIGGER tr_sync_precios AFTER INSERT OR UPDATE OR DELETE ON cotizacion_precios
  FOR EACH ROW EXECUTE FUNCTION sync_tocar_desde_precio();

-- Origen y hora del teléfono (informativa; la fecha válida sigue siendo la del servidor)
ALTER TABLE firmas          ADD COLUMN IF NOT EXISTS origen VARCHAR(10) NOT NULL DEFAULT 'WEB';  -- WEB | MOVIL
ALTER TABLE firmas          ADD COLUMN IF NOT EXISTS fecha_cliente TIMESTAMPTZ;
ALTER TABLE proceso_eventos ADD COLUMN IF NOT EXISTS origen VARCHAR(10) NOT NULL DEFAULT 'WEB';
ALTER TABLE proceso_eventos ADD COLUMN IF NOT EXISTS fecha_cliente TIMESTAMPTZ;

-- Dispositivos móviles con sesión (refresh token hasheado, revocable)
CREATE TABLE IF NOT EXISTS dispositivos (
    id UUID PRIMARY KEY,
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL DEFAULT '',
    refresh_hash VARCHAR(100) NOT NULL,
    expira_en TIMESTAMPTZ NOT NULL,
    revocado BOOLEAN NOT NULL DEFAULT FALSE,
    ultimo_uso TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_dispositivos_usuario ON dispositivos (usuario_id);
-- Hash anterior: se acepta unos minutos tras rotar, por si la respuesta del refresh no llegó al teléfono
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS refresh_anterior VARCHAR(100);
ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS rotado_en TIMESTAMPTZ;

-- Operaciones recibidas desde la app (idempotencia: una operación reenviada no se ejecuta dos veces)
CREATE TABLE IF NOT EXISTS sync_operaciones (
    op_id UUID PRIMARY KEY,
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id),
    dispositivo_id UUID,
    tipo VARCHAR(40) NOT NULL,
    proceso_uuid UUID,
    estado VARCHAR(20) NOT NULL,          -- APLICADA | RECHAZADA | CONFLICTO
    respuesta JSONB NOT NULL DEFAULT '{}'::jsonb,
    creada_cliente TIMESTAMPTZ,
    recibida_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_sync_operaciones_proceso ON sync_operaciones (proceso_uuid);

-- =====================================================================
-- Formularios electrónicos (encabezados de todos los documentos)
-- Documento: "Formatos de encabezados de formularios electrónicos - Sistema"
-- =====================================================================
CREATE TABLE IF NOT EXISTS tipos_documento (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre VARCHAR(60) NOT NULL UNIQUE,
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS formularios (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    unidad_id INT NOT NULL REFERENCES unidades_negocio(id) ON DELETE CASCADE,
    clave VARCHAR(30),                              -- documento que usa el sistema (SOLICITUD, CUADRO...); NULL = solo registro
    tipo_documento_id INT REFERENCES tipos_documento(id),
    proceso_area VARCHAR(120) NOT NULL DEFAULT '',
    codigo VARCHAR(40) NOT NULL,
    version VARCHAR(10) NOT NULL DEFAULT '0',
    titulo VARCHAR(200) NOT NULL,                   -- en MAYÚSCULAS
    fecha DATE,
    estado VARCHAR(15) NOT NULL DEFAULT 'APROBADO' CHECK (estado IN ('EN_REVISION', 'APROBADO')),
    actualizado_por BIGINT REFERENCES usuarios(id),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_formularios_clave ON formularios (unidad_id, clave) WHERE clave IS NOT NULL;

CREATE TABLE IF NOT EXISTS formularios_historial (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    formulario_id BIGINT NOT NULL REFERENCES formularios(id) ON DELETE CASCADE,
    usuario_id BIGINT REFERENCES usuarios(id),
    usuario_nombre VARCHAR(150) NOT NULL DEFAULT 'Sistema',
    accion VARCHAR(20) NOT NULL,                    -- CREADO | MODIFICADO
    cambios JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { campo: [antes, después] }
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_formularios_historial ON formularios_historial (formulario_id, fecha DESC);

-- =====================================================================
-- Proveedores (RV.PCOM.02 Evaluación de Proveedores)
-- Registro común para todas las unidades de negocio.
-- =====================================================================
CREATE TABLE IF NOT EXISTS proveedores (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    razon_social VARCHAR(200) NOT NULL,
    nombre_comercial VARCHAR(200) NOT NULL DEFAULT '',
    nit VARCHAR(40) NOT NULL DEFAULT '',
    direccion VARCHAR(250) NOT NULL DEFAULT '',
    ciudad VARCHAR(100) NOT NULL DEFAULT '',
    telefono VARCHAR(60) NOT NULL DEFAULT '',
    email VARCHAR(150) NOT NULL DEFAULT '',
    contacto VARCHAR(150) NOT NULL DEFAULT '',
    cuenta_bancaria VARCHAR(60) NOT NULL DEFAULT '',
    banco VARCHAR(100) NOT NULL DEFAULT '',
    tipo_suministro TEXT NOT NULL DEFAULT '',       -- producto(s) o servicio(s) suministrados
    clasificacion VARCHAR(12) NOT NULL DEFAULT 'NO_CRITICO' CHECK (clasificacion IN ('CRITICO', 'NO_CRITICO')),
    estado VARCHAR(15) NOT NULL DEFAULT 'NUEVO'
        CHECK (estado IN ('NUEVO', 'APROBADO', 'APROBADO_OBS', 'NO_APROBADO', 'SUSPENDIDO', 'RETIRADO')),
    ocasional BOOLEAN NOT NULL DEFAULT FALSE,        -- creado en una compra de emergencia (4.2.6)
    fecha_evaluacion DATE,                           -- última evaluación aprobada
    promedio NUMERIC(4,2),
    proxima_reevaluacion DATE,
    creado_por BIGINT REFERENCES usuarios(id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proveedores_nit ON proveedores (lower(nit)) WHERE nit <> '';
CREATE INDEX IF NOT EXISTS ix_proveedores_nombre ON proveedores (lower(razon_social));

-- Evaluación y re-evaluación (RV.FCOM.02.1)
CREATE TABLE IF NOT EXISTS proveedor_evaluaciones (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proveedor_id BIGINT NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
    unidad_id INT NOT NULL REFERENCES unidades_negocio(id),
    tipo VARCHAR(15) NOT NULL CHECK (tipo IN ('INICIAL', 'REEVALUACION')),
    fecha_evaluacion DATE NOT NULL,
    criterios JSONB NOT NULL DEFAULT '{}'::jsonb,    -- { "1": { "nota": 8 | null (N/A), "comentario": "" } }
    promedio NUMERIC(4,2),
    resultado VARCHAR(15),                           -- APROBADO | APROBADO_OBS | NO_APROBADO
    acciones JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { mantener, seguimiento, reevaluar, correctivas, suspender, retirar }
    observaciones TEXT NOT NULL DEFAULT '',
    estado VARCHAR(15) NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR', 'POR_APROBAR', 'APROBADA')),
    observacion_aprobador TEXT NOT NULL DEFAULT '',
    meses_reevaluacion INT,                          -- lo fija quien aprueba (Gerencia o Administración)
    proxima_reevaluacion DATE,
    estado_resultante VARCHAR(15),
    evaluador_id BIGINT NOT NULL REFERENCES usuarios(id),
    evaluador_nombre VARCHAR(150) NOT NULL,
    evaluador_cargo VARCHAR(120) NOT NULL DEFAULT '',
    enviado_en TIMESTAMPTZ,
    aprobador_id BIGINT REFERENCES usuarios(id),
    aprobador_nombre VARCHAR(150),
    aprobador_cargo VARCHAR(120),
    aprobado_en TIMESTAMPTZ,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_prov_eval_proveedor ON proveedor_evaluaciones (proveedor_id, fecha_evaluacion DESC);
CREATE INDEX IF NOT EXISTS ix_prov_eval_estado ON proveedor_evaluaciones (estado);

-- Seguimiento del desempeño (4.6): incidencias de recepción y registros manuales
CREATE TABLE IF NOT EXISTS proveedor_incidencias (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proveedor_id BIGINT NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
    proceso_id BIGINT REFERENCES procesos(id) ON DELETE SET NULL,
    tipo VARCHAR(20) NOT NULL,                       -- RECHAZADO | OBSERVACIONES | MANUAL
    descripcion TEXT NOT NULL,
    usuario_id BIGINT REFERENCES usuarios(id),
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_prov_incidencias ON proveedor_incidencias (proveedor_id, fecha DESC);

-- Documentación de respaldo (4.2.3)
CREATE TABLE IF NOT EXISTS proveedor_adjuntos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proveedor_id BIGINT NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
    tipo_doc VARCHAR(60) NOT NULL DEFAULT 'Otro',
    nombre_original VARCHAR(255) NOT NULL,
    archivo VARCHAR(255) NOT NULL,
    mime VARCHAR(120) NOT NULL DEFAULT '',
    tamano INT NOT NULL DEFAULT 0,
    usuario_id BIGINT REFERENCES usuarios(id),
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Historial del proveedor (alta, edición, cambios de estado)
CREATE TABLE IF NOT EXISTS proveedor_eventos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proveedor_id BIGINT NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
    usuario_id BIGINT REFERENCES usuarios(id),
    accion VARCHAR(150) NOT NULL,
    comentario TEXT NOT NULL DEFAULT '',
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_prov_eventos ON proveedor_eventos (proveedor_id, fecha DESC);

-- Cada cotización del cuadro comparativo apunta a un proveedor del registro
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS proveedor_id BIGINT REFERENCES proveedores(id);
CREATE INDEX IF NOT EXISTS ix_cotizaciones_proveedor ON cotizaciones (proveedor_id);
