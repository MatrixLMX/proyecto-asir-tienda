# La tienda en Cloudflare (Workers + D1)

Versión en internet de la tienda, sin servidor propio y en el plan gratuito de
Cloudflare. El frontend es el mismo (`app/frontend`), y la API responde con las
mismas rutas que la versión FastAPI. La versión Debian + MariaDB de la rama `main`
sigue siendo la del proyecto ASIR.

| Tarea | Comando (desde `cloudflare/`) |
| --- | --- |
| Pruebas | `npm test` y `npm run tipos` |
| Probar en local | `npm run migrar:local` y `npm run dev` |
| Publicar | `cd ../app/frontend && npm run build`, luego `npm run migrar:remoto` y `npm run desplegar` |
| Crear usuario o cambiar su clave | `node scripts/crear_usuario.mjs <usuario> <nombre> <admin\|dependiente> --remote` |
| Copia de seguridad al PC | `npm run copia` |
| Copia diaria automática | `powershell -ExecutionPolicy Bypass -File scripts/programar_copia.ps1` (una vez) |
| Activar el asistente | `npm run activar-asistente` |
| Activar los avisos al móvil | `npm run activar-avisos` (una vez: con otra clave, cada móvil debe volver a activarlos) |

## Copias de seguridad

- **Cloudflare (Time Travel):** siempre activo. En el plan gratuito permite volver a
  cualquier minuto de los últimos 7 días, con `wrangler d1 time-travel restore`.
- **En el PC:** `npm run copia` guarda las 30 últimas en `backups/`, que no se sube a
  GitHub porque contiene los datos de la tienda. La copia programada solo se hace con el
  PC encendido; si estaba apagado a su hora, se hace al encenderlo.

## Avisos al móvil

Cada mañana (cron `0 7 * * *`, en UTC) el Worker manda por Web Push qué retirar, qué
caduca pronto y qué hay que pedir. Solo se envía si hay algo que revisar. Se activa en
Caducidades, en cada móvil. En Android basta el navegador; en iPhone hay que instalar
antes la web en la pantalla de inicio.

## Diferencias con MariaDB

- **Dinero y cantidades en enteros.** SQLite no tiene decimales exactos: `_cent`
  (céntimos), `_milli` (milésimas), `_dm` (diezmilésimas de euro) y `_cp` (centésimas
  de porcentaje). Las vistas devuelven euros y kilos.
- **Permisos.** D1 no tiene usuarios ni `GRANT`: los permisos de perfil solo los
  aplica la API (`soloAdmin`). MariaDB tenía esa segunda barrera; aquí no existe.
- **Auditoría.** `@usuario_app` pasa a ser la tabla `contexto_app`, que `escribir()`
  rellena y vacía dentro de cada transacción.
- **Transacciones.** Solo por lotes (`escribir()`): un `RAISE` o un `CHECK` deshacen
  todo el lote. Los códigos de error se traducen en `src/comun.ts`.
- **Hora.** D1 solo conoce UTC: `v_ahora` calcula la hora española y los triggers
  `trg_*_fecha` la guardan.
- **Migraciones.** Lo ya aplicado no se edita: cada cambio va en un fichero nuevo.

## Límites del plan gratuito

Al pasarse de un límite, las peticiones fallan hasta las 00:00 UTC del día siguiente.

| Recurso | Límite | Qué lo gasta |
| --- | --- | --- |
| Peticiones | 100 000 al día | Cada pantalla, varias |
| Filas leídas | 5 millones al día | Sobre todo los informes de beneficios |
| Filas escritas | 100 000 al día | Cada venta, varias por línea |
| Tamaño | 500 MB por base de datos | Todo el historial |
| CPU | 10 ms por petición | Sobre todo el login y los cambios de contraseña |

Los informes recorren todo el historial. Si con los años gastan demasiadas lecturas,
habrá que guardar resúmenes por mes.
