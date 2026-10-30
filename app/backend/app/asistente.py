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

    return [buscar_productos, productos_con_stock_bajo, productos_que_caducan, ventas_de_hoy]


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

    return [resumen_mensual, beneficio_por_categoria, ranking_productos,
            beneficio_de_producto, ventas_por_dia, mermas_recientes]


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


def asistente_disponible() -> bool:
    return settings.llm_provider != "anthropic" or bool(settings.anthropic_api_key)


def _agente(rol: str):
    hoy = date.today()
    clave = (rol, hoy)
    if clave not in _agentes:
        herramientas = _herramientas_comunes(rol)
        if rol == "admin":
            herramientas += _herramientas_admin()
        modelo = init_chat_model(
            settings.llm_model,
            model_provider=settings.llm_provider,
            max_tokens=8000,
        )
        _agentes[clave] = create_agent(
            modelo,
            tools=herramientas,
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
