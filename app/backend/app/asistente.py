"""Asistente virtual de la tienda (LangChain + LangGraph).

El asistente es un agente que decide qué herramienta usar para responder.
Las herramientas son consultas SQL fijas (no escribe SQL libre) y se
ejecutan con el usuario de MariaDB del perfil que está chateando: un
dependiente solo tiene herramientas de stock y caducidades, y aunque
intentara otra cosa, MariaDB se lo denegaría.

La memoria de cada conversación la guarda el checkpointer de LangGraph.
"""
import json
from datetime import date
from typing import Literal

from langchain.agents import create_agent
from langchain.agents.middleware import ModelFallbackMiddleware, ModelRetryMiddleware
from langchain.chat_models import init_chat_model
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver

from .config import settings
from .db import consultar

_memoria = InMemorySaver()
_agentes: dict[tuple[str, date], object] = {}


def _json(filas: list[dict]) -> str:
    return json.dumps(filas, ensure_ascii=False) if filas else "Sin resultados."


# ---------------------------------------------------------------------
#  Herramientas
# ---------------------------------------------------------------------
def _herramientas_comunes(rol: str):
    @tool
    def buscar_productos(texto: str) -> str:
        """Busca productos por nombre o categoría y devuelve precio de venta, stock y estado."""
        like = f"%{texto}%"
        return _json(consultar(
            rol,
            "SELECT producto, categoria, unidad_medida, precio_venta, stock_actual, "
            "stock_minimo, estado FROM v_stock WHERE producto LIKE %s OR categoria LIKE %s "
            "ORDER BY producto LIMIT 25",
            (like, like),
        ))

    @tool
    def productos_con_stock_bajo() -> str:
        """Productos agotados o por debajo del stock mínimo, con su proveedor y cantidad sugerida a pedir."""
        return _json(consultar(rol, "SELECT * FROM v_alertas_stock ORDER BY stock_actual"))

    @tool
    def productos_que_caducan() -> str:
        """Lotes caducados o que caducan en los próximos días, con la cantidad que queda."""
        return _json(consultar(
            rol, "SELECT * FROM v_caducidades ORDER BY fecha_caducidad"
        ))

    @tool
    def ventas_de_hoy() -> str:
        """Número de tickets y total facturado hoy."""
        return _json(consultar(
            rol,
            "SELECT COUNT(*) AS tickets, COALESCE(SUM(total), 0) AS facturado "
            "FROM ventas WHERE fecha >= CURDATE()",
        ))

    @tool
    def productos_sin_vender(dias: int = 30) -> str:
        """Productos con stock que llevan al menos esos días sin venderse (género parado)."""
        return _json(consultar(
            rol,
            "SELECT producto, categoria, unidad_medida, stock_actual, ultima_venta, dias_sin_vender "
            "FROM v_productos_parados WHERE dias_sin_vender >= %s ORDER BY dias_sin_vender DESC LIMIT 30",
            (dias,),
        ))

    @tool
    def caja_por_forma_de_pago(dias: int = 7) -> str:
        """Tickets y total cobrado en efectivo, tarjeta y Bizum en cada uno de los últimos días,
        y si la caja de ese día se cerró y con qué diferencia (descuadre) de efectivo."""
        return _json(consultar(
            rol,
            "SELECT d.*, c.efectivo_contado, c.diferencia AS descuadre_efectivo "
            "FROM v_caja_diaria d LEFT JOIN cierres_caja c ON c.fecha = d.dia "
            "WHERE d.dia >= CURDATE() - INTERVAL %s DAY ORDER BY d.dia DESC",
            (dias,),
        ))

    return [buscar_productos, productos_con_stock_bajo, productos_que_caducan, ventas_de_hoy,
            productos_sin_vender, caja_por_forma_de_pago]


def _herramientas_admin():
    rol = "admin"

    @tool
    def resumen_mensual(meses: int = 6) -> str:
        """Facturación, coste, beneficio real, pérdidas por mermas y margen de los últimos meses.
        Incluye la estimación antigua del 15 % para compararla con el beneficio real."""
        return _json(consultar(
            rol, "SELECT * FROM v_beneficio_mensual ORDER BY mes DESC LIMIT %s", (meses,)
        ))

    @tool
    def beneficio_por_categoria() -> str:
        """Facturación, beneficio y margen de cada categoría (histórico completo)."""
        return _json(consultar(
            rol, "SELECT * FROM v_beneficio_categoria ORDER BY beneficio DESC"
        ))

    @tool
    def ranking_productos(
        criterio: Literal["beneficio", "margen", "unidades"] = "beneficio",
        orden: Literal["mejores", "peores"] = "mejores",
        limite: int = 10,
    ) -> str:
        """Ranking de productos por beneficio total, porcentaje de margen o unidades vendidas."""
        columna = {"beneficio": "beneficio", "margen": "margen_pct",
                   "unidades": "unidades_vendidas"}[criterio]
        sentido = "DESC" if orden == "mejores" else "ASC"
        return _json(consultar(
            rol,
            f"SELECT * FROM v_beneficio_producto ORDER BY {columna} {sentido} LIMIT %s",
            (min(limite, 50),),
        ))

    @tool
    def beneficio_de_producto(texto: str) -> str:
        """Ventas, coste, beneficio y margen de los productos cuyo nombre contiene el texto,
        junto con su precio de venta y coste medio actuales."""
        return _json(consultar(
            rol,
            "SELECT p.nombre, p.precio_venta, ROUND(p.coste_medio, 4) AS coste_medio_sin_iva, "
            "b.unidades_vendidas, b.facturacion, b.beneficio, b.margen_pct "
            "FROM productos p LEFT JOIN v_beneficio_producto b ON b.producto_id = p.id "
            "WHERE p.nombre LIKE %s LIMIT 20",
            (f"%{texto}%",),
        ))

    @tool
    def ventas_por_dia(dias: int = 14) -> str:
        """Tickets, facturación y ticket medio de cada uno de los últimos días."""
        return _json(consultar(
            rol,
            "SELECT * FROM v_ventas_diarias WHERE dia >= CURDATE() - INTERVAL %s DAY "
            "ORDER BY dia DESC",
            (dias,),
        ))

    @tool
    def mermas_recientes(dias: int = 30) -> str:
        """Productos tirados (caducados, rotos...) en los últimos días y lo que han costado."""
        return _json(consultar(
            rol,
            "SELECT m.fecha, p.nombre AS producto, m.cantidad, m.motivo, "
            "ROUND(m.cantidad * m.coste_unitario, 2) AS perdida "
            "FROM mermas m JOIN productos p ON p.id = m.producto_id "
            "WHERE m.fecha >= CURDATE() - INTERVAL %s DAY ORDER BY m.fecha DESC",
            (dias,),
        ))

    @tool
    def pedido_sugerido() -> str:
        """Qué pedir a cada proveedor (productos con stock bajo), cuánto y el coste estimado sin IVA."""
        return _json(consultar(
            rol,
            "SELECT COALESCE(a.proveedor, 'Sin proveedor') AS proveedor, a.producto, a.unidad_medida, "
            "a.stock_actual, a.cantidad_sugerida, ROUND(a.cantidad_sugerida * p.coste_medio, 2) AS coste_estimado "
            "FROM v_alertas_stock a JOIN productos p ON p.id = a.id ORDER BY proveedor, a.producto",
        ))

    @tool
    def cambios_recientes(dias: int = 7) -> str:
        """Registro de auditoría: cambios de precio, ventas anuladas, compras borradas, mermas
        y cambios de usuarios en los últimos días, con quién lo hizo."""
        return _json(consultar(
            rol,
            "SELECT fecha, usuario, accion, detalle FROM auditoria "
            "WHERE fecha >= CURDATE() - INTERVAL %s DAY ORDER BY fecha DESC LIMIT 50",
            (dias,),
        ))

    return [resumen_mensual, beneficio_por_categoria, ranking_productos,
            beneficio_de_producto, ventas_por_dia, mermas_recientes, pedido_sugerido,
            cambios_recientes]


# ---------------------------------------------------------------------
#  Agente
# ---------------------------------------------------------------------
_PROMPT = """Eres el asistente de una pequeña tienda de alimentación de barrio en España.
Hablas con {quien}. Hoy es {hoy}.

- Responde en español, breve y claro, como hablarías con alguien de la familia que
  lleva la tienda. Usa euros con coma decimal (1,25 €) y kg cuando toque.
- Usa siempre las herramientas para obtener datos; no inventes cifras, productos ni
  fechas. Si una herramienta no devuelve nada, dilo.
- "Beneficio" es siempre el real: base imponible (precio sin IVA) menos coste de compra.
- Cuando des recomendaciones (qué pedir, qué retirar, qué precio revisar), básalas en
  los datos y explica el porqué en una frase.
{extra}"""

_EXTRA_DEPENDIENTE = """- Esta persona tiene perfil de DEPENDIENTE: no tiene acceso a precios de compra,
  costes, márgenes ni beneficios. Si lo pide, explícale que eso solo lo ve el administrador."""


_CLAVES = {"google_genai": "google_api_key", "groq": "groq_api_key", "anthropic": "anthropic_api_key"}


def _modelo(proveedor: str, nombre: str):
    campo_api_key = _CLAVES.get(proveedor)
    return init_chat_model(
        nombre,
        model_provider=proveedor,
        max_tokens=4000,
        max_retries=1,  # los reintentos los gestiona ModelRetryMiddleware
        **({"api_key": getattr(settings, campo_api_key)} if campo_api_key else {}),
    )


def _reserva_disponible() -> bool:
    p = settings.llm_reserva_provider
    if not (p and settings.llm_reserva_model):
        return False
    clave = _CLAVES.get(p)
    return clave is None or bool(getattr(settings, clave))


def asistente_disponible() -> bool:
    clave = _CLAVES.get(settings.llm_provider)
    return clave is None or bool(getattr(settings, clave))


def _agente(rol: str):
    hoy = date.today()
    clave = (rol, hoy)
    if clave not in _agentes:
        herramientas = _herramientas_comunes(rol)
        if rol == "admin":
            herramientas += _herramientas_admin()
        # Si el proveedor está saturado (503) o se pasa la cuota (429), se
        # reintenta una vez y, si hay modelo de reserva configurado, se usa.
        middleware = [ModelRetryMiddleware(max_retries=1, initial_delay=2.0, on_failure="error")]
        if _reserva_disponible():
            middleware.insert(0, ModelFallbackMiddleware(
                _modelo(settings.llm_reserva_provider, settings.llm_reserva_model)))
        _agentes[clave] = create_agent(
            _modelo(settings.llm_provider, settings.llm_model),
            tools=herramientas,
            middleware=middleware,
            system_prompt=_PROMPT.format(
                quien="el administrador (dueño del negocio)" if rol == "admin"
                else "un dependiente de la tienda",
                hoy=hoy.strftime("%d/%m/%Y"),
                extra="" if rol == "admin" else _EXTRA_DEPENDIENTE,
            ),
            checkpointer=_memoria,
        )
    return _agentes[clave]


def _texto(contenido) -> str:
    if isinstance(contenido, str):
        return contenido
    return "".join(b.get("text", "") for b in contenido
                   if isinstance(b, dict) and b.get("type") == "text")


def preguntar(rol: str, usuario: str, conversacion: str, mensaje: str) -> str:
    resultado = _agente(rol).invoke(
        {"messages": [{"role": "user", "content": mensaje}]},
        config={"configurable": {"thread_id": f"{usuario}:{conversacion}"}},
    )
    return _texto(resultado["messages"][-1].content)
