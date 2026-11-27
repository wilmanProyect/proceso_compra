(function () {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const dinero = (n) => (Number(n) || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cotizacionesPara = (m) => (m <= 1000 ? 0 : m <= 3000 ? 1 : m <= 20000 ? 2 : 3);

  // ---------- Menú lateral en celular ----------
  const abrir = $('#abrir-menu');
  if (abrir) {
    const cambiar = (abierto) => {
      document.body.classList.toggle('menu-abierto', abierto);
      abrir.setAttribute('aria-expanded', String(abierto));
    };
    abrir.addEventListener('click', () => cambiar(!document.body.classList.contains('menu-abierto')));
    $('#velo').addEventListener('click', () => cambiar(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cambiar(false); });
  }

  // ---------- Filas de tabla clicables ----------
  $$('tr.fila-link').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a, button, input, select, textarea')) return;
      window.location.href = tr.dataset.href;
    });
  });

  // Muestra un error junto al campo (en vez de alert) y lo anuncia a lectores de pantalla
  function errorCampo(campo, mensaje) {
    let id = campo.getAttribute('aria-describedby');
    let caja = id && document.getElementById(id);
    if (!caja) {
      caja = document.createElement('div');
      caja.className = 'error-campo';
      caja.id = `err-${Math.random().toString(36).slice(2)}`;
      caja.setAttribute('role', 'alert');
      campo.insertAdjacentElement('afterend', caja);
      campo.setAttribute('aria-describedby', caja.id);
    }
    caja.textContent = mensaje;
    campo.setAttribute('aria-invalid', 'true');
    campo.focus();
    campo.addEventListener('input', () => { caja.textContent = ''; campo.removeAttribute('aria-invalid'); }, { once: true });
  }

  // ---------- Confirmaciones y comentarios obligatorios ----------
  document.addEventListener('submit', (e) => {
    const boton = e.submitter;
    if (boton && boton.dataset.requiereComentario) {
      const campo = e.target.querySelector('[name="comentario"]');
      if (campo && !campo.value.trim()) {
        e.preventDefault();
        errorCampo(campo, boton.dataset.requiereComentario);
        return;
      }
    }
    const msg = (boton && boton.dataset.confirm) || e.target.dataset.confirm;
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // ---------- Pestañas (Adjuntos / Historial) ----------
  $$('.pestanas').forEach((grupo) => {
    const botones = $$('button[data-tab]', grupo);
    const mostrar = (id) => {
      botones.forEach((b) => {
        const activo = b.dataset.tab === id;
        b.classList.toggle('activo', activo);
        b.setAttribute('aria-selected', String(activo));
        const panel = document.getElementById(b.dataset.tab);
        if (panel) panel.classList.toggle('hidden', !activo);
      });
    };
    botones.forEach((b) => b.addEventListener('click', () => mostrar(b.dataset.tab)));
    mostrar(location.hash === '#historial' ? 'tab-historial' : botones[0].dataset.tab);
  });

  // ---------- Asistente: nueva solicitud ----------
  const form = $('#form-solicitud');
  if (form) {
    const lista = $('#lista-items');
    const plantilla = $('#plantilla-item');
    const dep = $('#departamento_id');
    const secciones = $$('.paso-asistente', form);
    const nav = $$('#asistente-nav li');
    let indice = lista.children.length;
    let paso = 1;

    const tipo = () => ($('input[name="tipo_solicitud"]:checked', form) || {}).value;
    const renumerar = () => $$('.nro-item', lista).forEach((s, i) => { s.textContent = i + 1; });
    const aplicarTipo = () => {
      const tec = tipo() === 'EQUIPO_TECNOLOGICO';
      $$('.solo-tecnologico', form).forEach((el) => el.classList.toggle('hidden', !tec));
      $$('.no-tecnologico', form).forEach((el) => el.classList.toggle('hidden', tec));
      $('#campo-requiere-oc').classList.toggle('hidden', tipo() === 'SERVICIO');
    };
    const filtrarDepartamentos = () => {
      const sel = $('input[name="unidad_id"]:checked', form);
      const unidad = sel ? sel.value : null;
      let valido = false;
      $$('option[data-unidad]', dep).forEach((o) => {
        const mostrar = o.dataset.unidad === unidad;
        o.hidden = !mostrar;
        o.disabled = !mostrar;
        if (mostrar && o.selected) valido = true;
      });
      if (!valido) dep.value = '';
      dep.options[0].textContent = unidad ? 'Elige…' : 'Elige la unidad primero';
    };
    const avisoStock = () => $('#aviso-stock').classList.toggle('hidden', !$('#existe_stock').checked);
    const ayudaCotizaciones = () => {
      const m = Number($('#monto_estimado').value);
      $('#ayuda-cotizaciones').textContent = m
        ? `Con ese monto se necesitan ${cotizacionesPara(m)} cotización(es) formal(es).`
        : 'Sirve para saber cuántas cotizaciones se necesitan.';
    };

    // Devuelve [campo, mensaje] por cada error del paso actual
    const errores = () => {
      const e = [];
      if (paso === 1 && !$('input[name="unidad_id"]:checked', form)) e.push([$('input[name="unidad_id"]', form), 'Elige la unidad de negocio.']);
      if (paso === 2) {
        if (!tipo()) e.push([$('input[name="tipo_solicitud"]', form), 'Elige qué necesitas: compra, servicio o equipo tecnológico.']);
        if (!dep.value) e.push([dep, 'Elige tu departamento.']);
        if (tipo() === 'EQUIPO_TECNOLOGICO' && !$('#motivo').value.trim()) e.push([$('#motivo'), 'Explica por qué se necesita el equipo.']);
      }
      if (paso === 3) {
        $$('.item-card', lista).forEach((c, i) => {
          const desc = $('[data-item="descripcion"]', c);
          const cant = $('[data-item="cantidad"]', c);
          if (!desc.value.trim()) e.push([desc, `Ítem ${i + 1}: escribe la descripción.`]);
          if (!(Number(cant.value) > 0)) e.push([cant, `Ítem ${i + 1}: la cantidad debe ser mayor a cero.`]);
        });
      }
      return e;
    };
    const mostrarErrores = (lista) => {
      const caja = $('#errores-asistente');
      caja.innerHTML = '';
      if (!lista.length) { caja.classList.add('hidden'); return; }
      const titulo = document.createElement('strong');
      titulo.textContent = `Revisa ${lista.length === 1 ? 'este dato' : `estos ${lista.length} datos`} para continuar:`;
      const ul = document.createElement('ul');
      lista.forEach(([, msg]) => { const li = document.createElement('li'); li.textContent = msg; ul.append(li); });
      caja.append(titulo, ul);
      caja.classList.remove('hidden');
      lista.forEach(([campo]) => campo && campo.setAttribute('aria-invalid', 'true'));
      const primero = lista[0][0];
      if (primero) primero.focus();
    };
    form.addEventListener('input', (ev) => ev.target.removeAttribute('aria-invalid'));
    form.addEventListener('change', (ev) => ev.target.removeAttribute('aria-invalid'));

    const resumen = () => {
      const u = $('input[name="unidad_id"]:checked', form);
      const t = $('input[name="tipo_solicitud"]:checked', form);
      const filas = [
        ['Unidad', u && u.dataset.nombre],
        ['Tipo', t && t.dataset.nombre],
        ['Departamento', dep.selectedOptions[0] && dep.value ? dep.selectedOptions[0].textContent : ''],
        ['Urgencia', $('#prioridad').selectedOptions[0].textContent],
        ['Monto estimado', $('#monto_estimado').value ? `Bs ${dinero($('#monto_estimado').value)}` : 'No indicado'],
        ['Orden de compra', tipo() !== 'SERVICIO' && $('input[name="requiere_oc"]').checked ? 'Sí' : 'No'],
        ['En stock', $('#existe_stock').checked ? 'Sí (no se compra)' : 'No'],
      ];
      const dl = $('#resumen');
      dl.innerHTML = '';
      filas.forEach(([k, v]) => {
        const div = document.createElement('div');
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v || '—';
        div.append(dt, dd); dl.append(div);
      });
      const ul = document.createElement('ul');
      $$('.item-card', lista).forEach((c) => {
        const li = document.createElement('li');
        li.textContent = `${$('[data-item="cantidad"]', c).value} ${$('[data-item="unidad"]', c).value} · ${$('[data-item="descripcion"]', c).value}`;
        ul.append(li);
      });
      const cont = $('#resumen-items');
      cont.innerHTML = '<strong>Ítems:</strong>';
      cont.append(ul);
    };

    const irA = (n) => {
      paso = n;
      $('#errores-asistente').classList.add('hidden');
      secciones.forEach((s) => s.classList.toggle('visible', Number(s.dataset.paso) === n));
      nav.forEach((li) => {
        const k = Number(li.dataset.ir);
        li.classList.toggle('actual', k === n);
        li.classList.toggle('hecho', k < n);
      });
      $('#btn-atras').style.visibility = n === 1 ? 'hidden' : 'visible';
      $('#btn-siguiente').classList.toggle('hidden', n === 4);
      $('#btn-enviar').classList.toggle('hidden', n !== 4);
      if (n === 4) resumen();
      const reducido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reducido ? 'auto' : 'smooth' });
    };

    $('#btn-siguiente').addEventListener('click', () => {
      const e = errores();
      mostrarErrores(e);
      if (!e.length) irA(paso + 1);
    });
    $('#btn-atras').addEventListener('click', () => irA(Math.max(1, paso - 1)));
    nav.forEach((li) => li.addEventListener('click', () => {
      const n = Number(li.dataset.ir);
      if (n < paso) irA(n);
    }));
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && paso < 4) { e.preventDefault(); $('#btn-siguiente').click(); }
    });

    // Avance automático al elegir unidad
    $$('input[name="unidad_id"]', form).forEach((r) => r.addEventListener('change', () => {
      filtrarDepartamentos();
      if (paso === 1) irA(2);
    }));
    $$('input[name="tipo_solicitud"]', form).forEach((r) => r.addEventListener('change', aplicarTipo));

    $('#agregar-item').addEventListener('click', () => {
      lista.insertAdjacentHTML('beforeend', plantilla.innerHTML.replace(/__i__/g, String(indice++)));
      aplicarTipo(); renumerar();
      $('textarea', lista.lastElementChild).focus();
    });
    lista.addEventListener('click', (e) => {
      if (!e.target.classList.contains('quitar-item')) return;
      if (lista.children.length > 1) e.target.closest('.item-card').remove();
      renumerar();
    });
    $('#existe_stock').addEventListener('change', avisoStock);
    $('#monto_estimado').addEventListener('input', ayudaCotizaciones);

    aplicarTipo(); filtrarDepartamentos(); avisoStock(); renumerar(); ayudaCotizaciones();
    irA(1);
  }

  // ---------- Cuadro comparativo: tarjetas de proveedor ----------
  const cuadro = $('#form-cuadro');
  if (cuadro) {
    const claves = ['p1', 'p2', 'p3'];
    const recalcular = () => {
      const moneda = $('#moneda', cuadro).value;
      const tc = Number($('#tipo_cambio', cuadro).value) || 0;
      const sim = moneda === 'USD' ? '$us' : 'Bs';
      const datos = claves.map((k) => {
        const card = $(`[data-prov="${k}"]`, cuadro);
        const sel = card ? $(`select[name="cot[${k}][proveedor_id]"]`, card) : null;
        let nombre = sel ? sel.value : '';
        if (nombre === 'ocasional') nombre = $(`input[name="cot[${k}][ocasional_nombre]"]`, card).value.trim();
        let total = 0;
        let completo = true;
        $$(`input[data-precio="${k}"]`, cuadro).forEach((inp) => {
          if (inp.value === '') completo = false;
          total += (Number(inp.value) || 0) * Number(inp.dataset.cantidad);
        });
        let puntaje = 0;
        $$(`input[data-criterio="${k}"]`, cuadro).forEach((inp) => { puntaje += Number(inp.value) || 0; });
        const t = $(`[data-total="${k}"]`, cuadro);
        if (t) t.textContent = nombre ? `${dinero(total)} ${sim}` : '—';
        const pt = $(`[data-puntaje="${k}"]`, cuadro);
        if (pt) pt.textContent = puntaje;
        return { k, card, nombre, total, puntaje, completo };
      });
      const validos = datos.filter((x) => x.nombre && x.completo && x.total > 0);
      const min = validos.length > 1 ? Math.min(...validos.map((x) => x.total)) : null;
      const conPuntaje = datos.filter((x) => x.nombre && x.puntaje > 0);
      const max = conPuntaje.length > 1 ? Math.max(...conPuntaje.map((x) => x.puntaje)) : null;
      const sel = $('input[name="seleccionada"]:checked', cuadro);
      datos.forEach((x) => {
        if (!x.card) return;
        $('[data-badge-barato]', x.card).classList.toggle('hidden', !(min !== null && x.nombre && x.completo && x.total === min));
        $('[data-badge-puntaje]', x.card).classList.toggle('hidden', !(max !== null && x.nombre && x.puntaje === max));
        x.card.classList.toggle('adjudicado', !!sel && sel.value === x.k);
      });

      // Requisito de cotizaciones según el monto del proveedor elegido (o el mayor)
      const req = $('#requisito');
      const elegido = sel ? datos.find((x) => x.k === sel.value) : null;
      const total = elegido && elegido.nombre ? elegido.total : Math.max(0, ...datos.map((x) => x.total));
      const bs = moneda === 'USD' ? total * tc : total;
      const necesarias = cotizacionesPara(bs);
      const llevas = datos.filter((x) => x.nombre).length;
      const ok = llevas >= Math.max(1, necesarias) || req.dataset.excepcion === '1';
      req.classList.toggle('ok', ok);
      req.classList.toggle('falta', !ok);
      $('[data-icono-ok]', req).classList.toggle('hidden', !ok);
      $('[data-icono-falta]', req).classList.toggle('hidden', ok);
      $('#requisito-texto').textContent = bs > 0
        ? `Monto Bs ${dinero(bs)}: necesitas ${necesarias} cotización(es) formal(es). Llevas ${llevas}.`
        : `Registra al menos 1 cotización. Llevas ${llevas}.`;
    };
    $$('[data-mostrar]', cuadro).forEach((b) => b.addEventListener('click', () => {
      const card = $(`[data-prov="${b.dataset.mostrar}"]`, cuadro);
      card.classList.remove('hidden');
      b.remove();
      $('select, input', card).focus();
    }));
    // Proveedor del registro u ocasional: muestra los campos de emergencia y completa contacto/teléfono si están vacíos
    const aplicarProveedor = (sel) => {
      const k = sel.dataset.proveedor;
      const ocasional = $(`[data-ocasional="${k}"]`, cuadro);
      const esOcasional = sel.value === 'ocasional';
      ocasional.classList.toggle('hidden', !esOcasional);
      $(`input[name="cot[${k}][ocasional_nombre]"]`, cuadro).required = esOcasional;
      const opt = sel.selectedOptions[0];
      if (opt && opt.dataset.contacto !== undefined) {
        const contacto = $(`input[name="cot[${k}][contacto]"]`, cuadro);
        const telefono = $(`input[name="cot[${k}][telefono]"]`, cuadro);
        if (contacto && !contacto.value) contacto.value = opt.dataset.contacto;
        if (telefono && !telefono.value) telefono.value = opt.dataset.telefono;
      }
    };
    $$('select[data-proveedor]', cuadro).forEach((sel) => {
      sel.addEventListener('change', () => aplicarProveedor(sel));
      aplicarProveedor(sel);
    });
    cuadro.addEventListener('input', recalcular);
    cuadro.addEventListener('change', recalcular);
    recalcular();
  }

  // ---------- Evaluación de proveedor: promedio y resultado en vivo (4.4 y 4.5) ----------
  const formEval = $('#form-eval');
  if (formEval && $('select[data-nota]', formEval)) {
    const nombres = { APROBADO: 'APROBADO', APROBADO_OBS: 'APROBADO CON OBSERVACIONES', NO_APROBADO: 'NO APROBADO' };
    const clases = { APROBADO: 'cerrado', APROBADO_OBS: 'pendiente', NO_APROBADO: 'rechazado' };
    const recalcularEval = () => {
      const notas = $$('select[data-nota]', formEval).map((s) => s.value).filter((v) => v && v !== 'NA').map(Number);
      const prom = notas.length ? Math.round((notas.reduce((a, b) => a + b, 0) / notas.length) * 100) / 100 : null;
      $('#promedio').textContent = prom === null ? '—' : prom.toFixed(2).replace('.', ',');
      const res = prom === null ? null : prom >= 8 ? 'APROBADO' : prom >= 6 ? 'APROBADO_OBS' : 'NO_APROBADO';
      $$('[data-resultado]', formEval).forEach((b) => {
        const activo = b.dataset.resultado === res;
        b.className = `badge ${activo ? clases[res] : 'neutro'}`;
        b.textContent = `${activo ? '☑' : '☐'} ${nombres[b.dataset.resultado]}`;
      });
    };
    formEval.addEventListener('change', recalcularEval);
    recalcularEval();
  }

  // ---------- Orden de compra: total a pagar ----------
  const oc = $('#form-oc');
  if (oc) {
    const total = Number(oc.dataset.total) || 0;
    const actualizar = () => { $('#oc-total-pagar').textContent = dinero(total - (Number($('#oc_descuento', oc).value) || 0)); };
    $('#oc_descuento', oc).addEventListener('input', actualizar);
    actualizar();
  }
}());
