# 4. Manual de usuario

Guía para quien usa la web en la tienda. No hace falta saber nada de informática.

## Entrar

1. Abre el navegador (o el icono de la tienda en el móvil) y entra en la dirección del servidor, por ejemplo `https://192.168.1.10`.
2. Escribe tu **usuario** y tu **contraseña**.
3. Para cambiar tu contraseña: abajo a la izquierda (en el móvil, en **Más**) pulsa el icono de la **llave**.

> Si te equivocas 5 veces seguidas con la contraseña, tendrás que esperar 15 minutos. Es una protección contra intrusos.

Hay dos perfiles:

| Perfil | Qué puede hacer |
|---|---|
| **Dependiente** | Vender, ver stock y caducidades, retirar productos, consultar tickets y cerrar la caja |
| **Administrador** | Todo lo anterior, y además: compras, catálogo, precios, beneficios, anular ventas y gestionar usuarios |

Arriba (o en **Más**, en el móvil) puedes elegir el tema **claro**, **oscuro** o **sistema** (el del ordenador).

---

## Vender

1. Entra en **Vender**.
2. Añade productos:
   - **Tocándolos** en la lista (puedes filtrar por categoría arriba).
   - **Escaneando el código de barras**: el lector escribe el código y pulsa Intro solo.
   - **Buscando** por nombre.
3. Los productos **a peso** (patatas, cebollas, ajos) se añaden con 0,5 kg. Cambia el peso escribiéndolo o con los botones rápidos (0,25 · 0,5 · 1 · 2 kg).
4. Pulsa **Cobrar** (o la tecla **F2**).
5. Elige **Efectivo**, **Tarjeta** o **Bizum**. Con efectivo, escribe lo que te da el cliente (o pulsa un billete) y la web calcula el **cambio**.
6. Pulsa **Confirmar venta** (o **Intro**). El stock se descuenta solo.
7. Si el cliente quiere el ticket: **Imprimir ticket nº …** debajo del botón Cobrar.

Atajos de teclado en el ordenador: **F4** buscar · **F2** cobrar · **Esc** cerrar ventanas.

> Si no hay suficiente stock de algo, la venta **no se guarda** y aparece un aviso. Revisa el ticket y vuelve a cobrar.

## Me he equivocado al cobrar

Ve a **Ventas y caja → Tickets**, abre el ticket y:

- **Dependiente**: avisa al administrador.
- **Administrador**: pulsa **Anular**. Los productos vuelven al stock y queda apuntado en el registro de cambios. Si había que devolver dinero, hazlo en caja y vuelve a cobrar bien.

## Caducidades (cada mañana)

1. Entra en **Caducidades**. Solo aparece lo que **ya ha caducado** o **caduca en los próximos días**: no hace falta mirar producto por producto.
2. Pestaña **Retirar ya**: quita esos productos de la estantería y pulsa **Retirar**. Quedan apuntados como pérdida.
3. Pestaña **Próximos días**: ponlos delante en la estantería o en oferta.

El número rojo del menú dice cuántos lotes hay que revisar.

## Algo se ha roto, se ha gastado en casa o ha desaparecido

En **Stock**, busca el producto y pulsa el botón de la derecha (caja con un "−"). Elige la cantidad y el motivo. Se descuenta del stock y cuenta como pérdida en los beneficios.

## Cerrar la caja (al final del día)

1. **Ventas y caja → Cierre de caja**.
2. Arriba ves lo vendido hoy en efectivo, tarjeta y Bizum.
3. Escribe el **fondo** con el que se abrió la caja (se recuerda para el día siguiente).
4. Cuenta el dinero y escríbelo en **Efectivo contado**. La web te dice si **cuadra**, si **sobra** o si **falta**.
5. Si hay algo que explicar (por ejemplo, se pagó al repartidor en efectivo), ponlo en **Notas**.
6. Pulsa **Cerrar caja**. Ese día ya no se puede volver a cerrar.

---

## Solo administrador

### Registrar lo que trae un proveedor

1. **Compras → Registrar compra**.
2. Elige el proveedor y, si quieres, el nº de factura o albarán.
3. Por cada producto: cantidad y **coste por unidad sin IVA** (el de la factura). Se propone el coste medio actual.
4. Si el producto caduca, pon la **fecha de caducidad**. Si tiene vida útil configurada (por ejemplo, sándwiches: 5 días) se puede dejar vacía y se calcula sola.
5. **Guardar compra**. Sube el stock, se recalcula el coste medio y se crean los lotes de caducidad.

Si metiste mal una compra: **Compras → Historial**, ábrela y pulsa **Borrar compra** (solo si no se ha vendido nada de ella todavía).

### Saber qué pedir

**Compras → Qué pedir** muestra lo que está por debajo del stock mínimo, **agrupado por proveedor** y con el coste aproximado. **Registrar esta compra** rellena la compra sola; solo hay que ajustar lo que haya traído de verdad.

### Productos, precios, categorías y proveedores

En **Catálogo**:

- **Productos**: el lápiz permite cambiar nombre, código de barras, categoría, proveedor, IVA, precio, stock mínimo y control de caducidad. Al cambiar el precio se ve el **margen** que quedaría. Un producto que ya no se vende se **desactiva** (no se borra, para no perder su historial).
- **Categorías** y **Proveedores**: añadir, renombrar u ocultar. En los proveedores se puede guardar el teléfono (en el móvil se puede llamar tocándolo).
- **CSV**: descarga la lista para abrirla en Excel.

### Beneficios

- **Beneficio real** de cada mes: precio sin IVA − lo que costó − lo que se ha tirado, comparado con el **15 %** que se calculaba antes.
- **¿Dónde se gana el dinero?**: por categoría o por producto.
- **Género parado**: productos que llevan más de 30 días sin venderse (dinero inmovilizado).
- **Mermas**: lo que se ha tirado o roto en los últimos 60 días.
- Todo se puede **exportar a CSV** para la gestoría.

### Usuarios y registro de cambios

- **Usuarios → Nuevo usuario**: nombre, usuario para entrar, contraseña inicial y perfil. Pídele que la cambie al entrar (icono de la llave).
- Para que alguien deje de entrar, edítalo y desmarca **Puede entrar en la web**. No se borra, para que sus ventas sigan teniendo nombre.
- **Registro de cambios**: quién ha anulado una venta, borrado una compra, cambiado un precio, retirado un producto o tocado los usuarios, y cuándo.

---

## El asistente

El botón verde de abajo a la derecha abre el asistente. Se le pregunta como a una persona:

- "¿Qué caduca esta semana?"
- "¿Cuántas Coca-Colas quedan?"
- "¿Qué productos llevan un mes sin venderse?"
- "¿Cuánto se cobró ayer con tarjeta?"
- (Administrador) "¿Cuánto he ganado este mes de verdad?", "¿Qué le tengo que pedir a Dulcesol?", "¿Quién ha cambiado precios esta semana?"

El dependiente no puede preguntar por costes ni beneficios. Si el asistente dice que se ha superado el límite, espera un minuto: es un servicio gratuito con un máximo de preguntas por minuto.

## Instalar la web como una aplicación

En el móvil o la tablet, abre la web y en el menú del navegador elige **Añadir a la pantalla de inicio** o **Instalar aplicación**. Aparece el icono de la tienda y se abre a pantalla completa.
