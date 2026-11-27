
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const C = require('../utils/constantes');

const PERMISOS = [
  ['procesos.crear', 'Crear solicitudes de compra/servicio', 'Procesos', 1],
  ['procesos.ver_unidades', 'Ver todos los procesos de sus unidades de negocio', 'Procesos', 2],
  ['procesos.ver_todos', 'Ver los procesos de todas las unidades de negocio', 'Procesos', 3],
  ['solicitud.aprobar', 'Revisión presupuestaria: aprobar o rechazar solicitudes', 'Fase 1', 10],
  ['cotizacion.gestionar', 'Registrar cotizaciones y cuadro comparativo', 'Fase 1', 11],
  ['cotizacion.aprobar', 'Aprobar cuadro comparativo', 'Fase 1', 12],
  ['cotizacion.desbloquear', 'Autorizar excepción por falta de cotizaciones', 'Fase 1', 13],
  ['oc.emitir', 'Emitir orden de compra', 'Fase 1', 14],
  ['oc.autorizar', 'Autorizar orden de compra', 'Fase 1', 15],
  ['seguimiento.registrar', 'Registrar seguimiento y cerrar servicios', 'Fase 1', 16],
  ['recepcion.registrar', 'Registrar inspección y recepción', 'Fase 2', 20],
  ['entrega.registrar', 'Emitir la nota de entrega (cierra el proceso)', 'Fase 2', 24],
  ['admin.usuarios', 'Administrar usuarios', 'Administración', 30],
  ['admin.unidades', 'Administrar unidades de negocio y departamentos', 'Administración', 31],
  ['admin.roles', 'Administrar roles y permisos', 'Administración', 32],
  ['admin.formularios', 'Administrar formularios electrónicos (códigos, versiones y encabezados)', 'Administración', 33],
  ['proveedores.ver', 'Ver proveedores y el Listado de Proveedores Aprobados', 'Proveedores', 40],
  ['proveedores.gestionar', 'Registrar y evaluar proveedores, incidencias y documentos', 'Proveedores', 41],
  ['proveedores.aprobar', 'Aprobar evaluaciones, fijar la reevaluación y cambiar el estado de proveedores', 'Proveedores', 42],
];

const ROLES = {
  ADMIN: ['Administrador', PERMISOS.map((p) => p[0])],
  GERENCIA: ['Gerencia General / Financiera', [
    'procesos.crear', 'procesos.ver_todos', 'solicitud.aprobar', 'cotizacion.aprobar',
    'cotizacion.desbloquear', 'oc.autorizar', 'proveedores.ver', 'proveedores.aprobar',
  ]],
  COORDINADOR_AREA: ['Coordinador de Área', ['procesos.crear', 'proveedores.ver']],
  RESPONSABLE_COMPRAS: ['Responsable de Compras', [
    'procesos.crear', 'procesos.ver_unidades', 'cotizacion.gestionar', 'oc.emitir',
    'seguimiento.registrar', 'recepcion.registrar', 'proveedores.ver', 'proveedores.gestionar',
  ]],
  CONTADOR: ['Contador', ['procesos.crear', 'procesos.ver_unidades', 'proveedores.ver']],
  COORD_ADM: ['Coordinador Adm. y RRHH', [
    'procesos.crear', 'procesos.ver_unidades', 'entrega.registrar',
    'proveedores.ver', 'proveedores.gestionar', 'proveedores.aprobar',
  ]],
};

const UNIDADES = [
  ['RV', 'Río Verde', 'RÍO VERDE Productora de Granos y Semillas', 'Logo_Rio_Verde.png', 'RV.26.001', '#2f6b2f'],
  ['ZB', 'Zentta Bio', 'Zentta Bio', 'Logo_Zentta.png', 'ZB.26.001', '#1f6f78'],
  ['CSR', 'Cabaña Santa Rosa', 'Cabaña Santa Rosa', 'LOGO_SANTA_ROSA.png', 'CSR.26.001', '#7a4b23'],
  ['RA', 'RevoAgro', 'RevoAgro', 'Logo_Revoagro.png', 'RA.26.001', '#3c7a2a'],
  ['A', 'Agroptima', 'Agroptima', 'Logo_Agroptima.png', 'A.26.001', '#183c32'],
  ['LS360', 'LaSierra360', 'LaSierra360', 'LOGO_LASIERRA360.png', 'LS360.26.001', '#25456b'],
];

const DEPARTAMENTOS = ['Administración', 'Operaciones', 'Comercial', 'Mantenimiento', 'Tecnología'];

function notasOc(razon) {
  return [
    '1) Enviar la factura junto con la entrega de los materiales hasta el 20 de cada mes.',
    '2) Nos reservamos el derecho de devolver las mercaderías en el caso en que no estén de acuerdo a la orden de compra, o que haya vencido el plazo estipulado para la entrega.',
    `3) El proveedor de los productos detallados en el item 4 del presente registro es responsable del cumplimiento de todas las leyes y normas vigentes en Bolivia y asume la responsabilidad de preservar y mantener indemne a ${razon} y hacer la entrega de acuerdo a los requerimientos expuestos por nuestra organización.`,
  ].join('\n');
}

// Módulo de formularios electrónicos: tipos de documento, traspaso de la tabla antigua formularios_unidad
// y alta de los formularios del sistema que falten en cada unidad (p. ej. los de proveedores).
async function migrarFormularios(client) {
  for (const nombre of C.TIPOS_DOCUMENTO) {
    await client.query('INSERT INTO tipos_documento (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [nombre]);
  }
  const { rows: [{ id: tipoFormulario }] } = await client.query("SELECT id FROM tipos_documento WHERE nombre = 'Formulario'");
  const titulos = Object.fromEntries(C.FORMULARIOS_SISTEMA.map((f) => [f[0], f[4]]));

  const { rows: [{ existe }] } = await client.query("SELECT to_regclass('public.formularios_unidad') IS NOT NULL AS existe");
  if (existe) {
    const { rows } = await client.query('SELECT * FROM formularios_unidad');
    for (const f of rows) {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(f.fecha || '').trim());
      const fecha = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
      const { rows: creado } = await client.query(
        `INSERT INTO formularios (unidad_id, clave, tipo_documento_id, proceso_area, codigo, version, titulo, fecha, estado)
         VALUES ($1,$2,$3,'Compras',$4,$5,$6,$7,'APROBADO') ON CONFLICT (unidad_id, clave) WHERE clave IS NOT NULL DO NOTHING RETURNING id`,
        [f.unidad_id, f.tipo, tipoFormulario, f.codigo, f.revision || '0', titulos[f.tipo] || (C.FORMULARIOS[f.tipo] || f.tipo).toUpperCase(), fecha],
      );
      if (creado.length) {
        await client.query(
          `INSERT INTO formularios_historial (formulario_id, accion, cambios)
           VALUES ($1, 'CREADO', '{"origen": ["", "Traspasado de los códigos de formularios por unidad"]}')`,
          [creado[0].id],
        );
      }
    }
    await client.query('DROP TABLE formularios_unidad');
  }

  const { rows: unidades } = await client.query('SELECT id, sigla FROM unidades_negocio');
  for (const u of unidades) {
    for (const [clave, sufijo, version, fecha, titulo] of C.FORMULARIOS_SISTEMA) {
      const { rows } = await client.query(
        `INSERT INTO formularios (unidad_id, clave, tipo_documento_id, proceso_area, codigo, version, titulo, fecha, estado)
         VALUES ($1,$2,$3,'Compras',$4,$5,$6,$7,'APROBADO') ON CONFLICT (unidad_id, clave) WHERE clave IS NOT NULL DO NOTHING RETURNING id`,
        [u.id, clave, tipoFormulario, `${u.sigla}.${sufijo}`, version, titulo, fecha],
      );
      if (rows.length) {
        await client.query("INSERT INTO formularios_historial (formulario_id, accion) VALUES ($1, 'CREADO')", [rows[0].id]);
      }
    }
  }
}

async function migrar() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.query(sql);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 2026-11-27: se simplificaron los pasos 4 y 5. La recepción ya no lleva revisión ni aprobación, y la
    // nota de entrega ya no lleva comprobante de ingreso ni registro de egreso: al emitirla se cierra el proceso.
    // Los procesos que estaban en los estados eliminados se mueven a su equivalente nuevo.
    const MOVER = [
      ['RECEPCION_POR_APROBAR', 'EN_ALMACEN', 'Pasa a emitir la nota de entrega', 'Se eliminó la revisión y aprobación del registro de recepción.'],
      ['POR_INGRESAR', 'EN_ALMACEN', 'Pasa a emitir la nota de entrega', 'Se eliminó el comprobante de ingreso (Octopus) del proceso.'],
      ['ENTREGADO', 'CERRADO', 'Proceso cerrado', 'Se eliminó el registro de egreso: la nota de entrega ya emitida cierra el proceso.'],
    ];
    for (const [desde, hacia, accion, comentario] of MOVER) {
      const { rows } = await client.query(
        'UPDATE procesos SET estado = $2, actualizado_en = NOW() WHERE estado = $1 RETURNING id',
        [desde, hacia],
      );
      for (const { id } of rows) {
        await client.query(
          'INSERT INTO proceso_eventos (proceso_id, accion, comentario, estado_nuevo) VALUES ($1, $2, $3, $4)',
          [id, accion, comentario, hacia],
        );
      }
    }
    await client.query(
      "DELETE FROM permisos WHERE codigo IN ('recepcion.revisar', 'recepcion.aprobar', 'ingreso.registrar', 'egreso.registrar')",
    );

    // Permisos que aún no existen: al crearlos se asignan a los roles según los valores por defecto (ROLES),
    // para que los roles ya creados los reciban. Los permisos existentes respetan lo configurado en Roles.
    const { rows: existentes } = await client.query('SELECT codigo FROM permisos');
    const nuevos = PERMISOS.map((p) => p[0]).filter((c) => !existentes.some((e) => e.codigo === c));
    for (const [codigo, descripcion, grupo, orden] of PERMISOS) {
      await client.query(
        `INSERT INTO permisos (codigo, descripcion, grupo, orden) VALUES ($1,$2,$3,$4)
         ON CONFLICT (codigo) DO UPDATE SET descripcion = EXCLUDED.descripcion, grupo = EXCLUDED.grupo, orden = EXCLUDED.orden`,
        [codigo, descripcion, grupo, orden],
      );
    }

    // Los permisos de cada rol solo se cargan al crear el rol, para respetar cambios hechos desde la app.
    for (const [codigo, [nombre, permisos]] of Object.entries(ROLES)) {
      const { rows } = await client.query(
        'INSERT INTO roles (codigo, nombre) VALUES ($1,$2) ON CONFLICT (codigo) DO NOTHING RETURNING id',
        [codigo, nombre],
      );
      if (rows.length) {
        for (const permiso of permisos) {
          await client.query('INSERT INTO rol_permisos (rol_id, permiso_codigo) VALUES ($1,$2)', [rows[0].id, permiso]);
        }
      }
    }
    if (existentes.length) {
      for (const [codigoRol, [, permisos]] of Object.entries(ROLES)) {
        for (const permiso of permisos.filter((p) => nuevos.includes(p))) {
          await client.query(
            `INSERT INTO rol_permisos (rol_id, permiso_codigo) SELECT id, $2 FROM roles WHERE codigo = $1 ON CONFLICT DO NOTHING`,
            [codigoRol, permiso],
          );
        }
      }
    }
    // El administrador siempre conserva todos los permisos.
    await client.query(
      `INSERT INTO rol_permisos (rol_id, permiso_codigo)
       SELECT r.id, p.codigo FROM roles r CROSS JOIN permisos p WHERE r.codigo = 'ADMIN'
       ON CONFLICT DO NOTHING`,
    );

    for (const [sigla, nombre, razon, logo, revision, color] of UNIDADES) {
      const { rows } = await client.query(
        `INSERT INTO unidades_negocio (sigla, nombre, razon_social, logo, codigo_revision, color, notas_oc, datos_factura)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (sigla) DO NOTHING RETURNING id`,
        [sigla, nombre, razon, logo, revision, color, notasOc(razon), razon],
      );
      if (!rows.length) continue;
      const unidadId = rows[0].id;
      for (const dep of DEPARTAMENTOS) {
        await client.query('INSERT INTO departamentos (unidad_id, nombre) VALUES ($1,$2)', [unidadId, dep]);
      }
    }

    await migrarFormularios(client);

    const { rows: usuarios } = await client.query('SELECT 1 FROM usuarios LIMIT 1');
    if (!usuarios.length) {
      const usuario = process.env.ADMIN_USER || 'admin';
      const password = process.env.ADMIN_PASSWORD || 'admin123';
      const hash = await bcrypt.hash(password, 10);
      const { rows } = await client.query(
        `INSERT INTO usuarios (usuario, nombre, cargo, password_hash, rol_id)
         SELECT $1, 'Administrador del sistema', 'Administrador', $2, id FROM roles WHERE codigo = 'ADMIN'
         RETURNING id`,
        [usuario, hash],
      );
      await client.query(
        'INSERT INTO usuario_unidades (usuario_id, unidad_id) SELECT $1, id FROM unidades_negocio',
        [rows[0].id],
      );
      console.log(`Usuario administrador inicial creado: "${usuario}". Cambie la contraseña al ingresar.`);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { migrar };

if (require.main === module) {
  require('dotenv').config();
  migrar()
    .then(() => { console.log('Migración completada'); return db.end(); })
    .catch((error) => { console.error(error); process.exit(1); });
}
