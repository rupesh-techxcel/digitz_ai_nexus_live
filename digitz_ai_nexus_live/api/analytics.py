import json
from datetime import datetime, timedelta

import frappe
from frappe.utils import now_datetime

# Conversations from local dev origins are excluded from all analytics.
_DEV_ORIGIN_PATTERNS = ("127.0.0.1", "localhost")


def _dev_origin_filter(alias="c"):
    """Returns a SQL fragment that excludes local dev traffic.

    Uses %% for LIKE wildcards so the fragment is safe both in plain sql()
    calls (pymysql sends %% to MySQL which treats it as %) and in parameterised
    calls (pymysql collapses %% → % before sending to MySQL).

    Pass the SQL table alias (e.g. 'c') used in the surrounding query,
    or an empty string for no table prefix.
    """
    col = f"{alias}.origin_host" if alias else "origin_host"
    parts = [f"({col} NOT LIKE '%%{p}%%')" for p in _DEV_ORIGIN_PATTERNS]
    return f"({' AND '.join(parts)} OR {col} IS NULL OR {col} = '')"


def _conv_tenant_filter(alias, tenant):
    """
    Returns a SQL fragment (prefixed with AND) that restricts Nexus Live Conversation rows
    to the given tenant via the channel → Nexus Live Channel.tenant join.
    Returns empty string when tenant is None (System Manager — sees all).
    """
    if not tenant:
        return ""
    col = f"{alias}.channel" if alias else "channel"
    return f"AND {col} IN (SELECT name FROM `tabNexus Live Channel` WHERE tenant = {frappe.db.escape(tenant)})"


def _visitor_tenant_filter(alias, tenant):
    """
    Returns a SQL fragment (prefixed with AND) for direct tenant filtering on
    Nexus Web Visitor / Nexus Web Session / Nexus Web Page Visit / Nexus Knowledge Hit rows.
    Returns empty string when tenant is None.
    """
    if not tenant:
        return ""
    col = f"{alias}.tenant" if alias else "tenant"
    return f"AND {col} = {frappe.db.escape(tenant)}"


@frappe.whitelist()
def get_overview_stats():
    """KPI numbers for the top row cards."""
    _check_permission()
    tenant = _get_current_tenant()
    dev_filter = _dev_origin_filter("c")
    tenant_filter = _conv_tenant_filter("c", tenant)

    row = frappe.db.sql(f"""
        SELECT
            COUNT(*) AS total_conversations,
            SUM(CASE WHEN status IN ('Open','Responding','Waiting') THEN 1 ELSE 0 END) AS active_now,
            SUM(CASE WHEN escalation_status != 'None' THEN 1 ELSE 0 END) AS ever_escalated,
            SUM(CASE WHEN DATE(started_on) = CURDATE() THEN 1 ELSE 0 END) AS today_conversations,
            COUNT(DISTINCT NULLIF(visitor_email,'')) AS unique_visitors
        FROM `tabNexus Live Conversation` c
        WHERE {dev_filter} {tenant_filter}
    """, as_dict=True)

    r = row[0] if row else {}
    total = r.get("total_conversations") or 0
    escalated = r.get("ever_escalated") or 0

    # Messages today
    msg_today = frappe.db.sql(f"""
        SELECT COUNT(*) AS cnt
        FROM `tabNexus Live Message` m
        JOIN `tabNexus Live Conversation` c ON c.name = m.conversation
        WHERE DATE(m.message_time) = CURDATE()
          AND {_dev_origin_filter("c")} {_conv_tenant_filter("c", tenant)}
    """, as_dict=True)

    return {
        "total_conversations": total,
        "active_now": r.get("active_now") or 0,
        "today_conversations": r.get("today_conversations") or 0,
        "unique_visitors": r.get("unique_visitors") or 0,
        "escalation_rate": round((escalated / total * 100), 1) if total else 0,
        "messages_today": (msg_today[0].get("cnt") or 0) if msg_today else 0,
    }


@frappe.whitelist()
def get_conversation_trend(days=30):
    """Daily conversation counts for the trend chart."""
    _check_permission()
    days = max(7, min(int(days), 90))
    tenant = _get_current_tenant()
    dev_filter = _dev_origin_filter("c")

    rows = frappe.db.sql(f"""
        SELECT
            DATE(started_on) AS day,
            COUNT(*) AS total,
            SUM(CASE WHEN escalation_status != 'None' THEN 1 ELSE 0 END) AS escalated
        FROM `tabNexus Live Conversation` c
        WHERE started_on >= DATE_SUB(CURDATE(), INTERVAL {days} DAY)
          AND {dev_filter} {_conv_tenant_filter("c", tenant)}
        GROUP BY DATE(started_on)
        ORDER BY day ASC
    """, as_dict=True)

    # Fill gaps so chart always has a continuous x-axis
    date_map = {str(r["day"]): r for r in rows}
    result = []
    for i in range(days):
        day = (datetime.now() - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        entry = date_map.get(day, {})
        result.append({
            "day": day,
            "total": entry.get("total") or 0,
            "escalated": entry.get("escalated") or 0,
        })
    return result


@frappe.whitelist()
def get_category_distribution():
    """Breakdown by chat category and by status."""
    _check_permission()
    tenant = _get_current_tenant()
    dev_filter = _dev_origin_filter("c")
    tf = _conv_tenant_filter("c", tenant)

    by_category = frappe.db.sql(f"""
        SELECT
            COALESCE(chat_category, 'Uncategorised') AS label,
            COUNT(*) AS value
        FROM `tabNexus Live Conversation` c
        WHERE {dev_filter} {tf}
        GROUP BY chat_category
        ORDER BY value DESC
        LIMIT 10
    """, as_dict=True)

    by_status = frappe.db.sql(f"""
        SELECT
            status AS label,
            COUNT(*) AS value
        FROM `tabNexus Live Conversation` c
        WHERE {dev_filter} {tf}
        GROUP BY status
        ORDER BY value DESC
    """, as_dict=True)

    by_channel = frappe.db.sql(f"""
        SELECT
            COALESCE(channel, 'Unknown') AS label,
            COUNT(*) AS value
        FROM `tabNexus Live Conversation` c
        WHERE {dev_filter} {tf}
        GROUP BY channel
        ORDER BY value DESC
        LIMIT 8
    """, as_dict=True)

    return {
        "by_category": by_category,
        "by_status": by_status,
        "by_channel": by_channel,
    }


@frappe.whitelist()
def get_knowledge_topic_stats(limit=20, topic_filter=None):
    """Ranked knowledge topic hits aggregated from Nexus Knowledge Hit log."""
    _check_permission()
    tenant = _get_current_tenant()
    limit = max(1, min(int(limit), 100))
    topic_cond = "AND h.topic LIKE %(topic)s" if topic_filter else ""
    tf = _visitor_tenant_filter("h", tenant)

    rows = frappe.db.sql(f"""
        SELECT
            COALESCE(h.topic, h.knowledge_title, h.knowledge_unit, h.chunk) AS topic_label,
            h.knowledge_unit,
            h.knowledge_title,
            COUNT(*) AS hit_count,
            COUNT(DISTINCT h.conversation) AS unique_conversations,
            ROUND(AVG(h.final_score), 4) AS avg_score
        FROM `tabNexus Knowledge Hit` h
        WHERE 1=1 {topic_cond} {tf}
        GROUP BY topic_label, h.knowledge_unit, h.knowledge_title
        ORDER BY hit_count DESC
        LIMIT {limit}
    """, values={"topic": f"%{topic_filter}%"} if topic_filter else {}, as_dict=True)

    return rows


@frappe.whitelist()
def get_visitor_engagement_list(
    page=1, page_size=25, status_filter=None,
    category_filter=None, date_from=None, date_to=None, search=None
):
    """Paginated visitor engagement table with optional filters."""
    _check_permission()
    tenant = _get_current_tenant()
    page = max(1, int(page))
    page_size = max(5, min(int(page_size), 100))
    offset = (page - 1) * page_size

    conditions = [_dev_origin_filter("c")]
    if tenant:
        conditions.append(f"c.channel IN (SELECT name FROM `tabNexus Live Channel` WHERE tenant = {frappe.db.escape(tenant)})")
    values = {}

    if status_filter:
        conditions.append("c.status = %(status_filter)s")
        values["status_filter"] = status_filter

    if category_filter:
        conditions.append("c.chat_category = %(category_filter)s")
        values["category_filter"] = category_filter

    if date_from:
        conditions.append("DATE(c.started_on) >= %(date_from)s")
        values["date_from"] = date_from

    if date_to:
        conditions.append("DATE(c.started_on) <= %(date_to)s")
        values["date_to"] = date_to

    if search:
        conditions.append("""(
            c.visitor_name LIKE %(search)s OR
            c.visitor_email LIKE %(search)s OR
            c.conversation_id LIKE %(search)s OR
            c.chat_category LIKE %(search)s
        )""")
        values["search"] = f"%{search}%"

    where = " AND ".join(conditions)

    rows = frappe.db.sql(f"""
        SELECT
            c.conversation_id,
            c.visitor_name,
            c.visitor_email,
            c.chat_category,
            c.channel,
            c.status,
            c.escalation_status,
            c.user_type,
            c.started_on,
            c.closed_on,
            c.confidence,
            TIMESTAMPDIFF(SECOND, c.started_on, COALESCE(c.closed_on, NOW())) AS duration_seconds,
            (SELECT COUNT(*) FROM `tabNexus Live Message` m WHERE m.conversation = c.name) AS message_count
        FROM `tabNexus Live Conversation` c
        WHERE {where}
        ORDER BY c.started_on DESC
        LIMIT {page_size} OFFSET {offset}
    """, values=values, as_dict=True)

    total_row = frappe.db.sql(f"""
        SELECT COUNT(*) AS cnt
        FROM `tabNexus Live Conversation` c
        WHERE {where}
    """, values=values, as_dict=True)

    total = (total_row[0].get("cnt") or 0) if total_row else 0

    return {
        "rows": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, -(-total // page_size)),
    }


@frappe.whitelist()
def get_conversation_detail(conversation_id):
    """Full conversation + messages for the side panel drill-down."""
    _check_permission()

    conv = frappe.db.get_value(
        "Nexus Live Conversation",
        {"conversation_id": conversation_id},
        [
            "name", "conversation_id", "visitor_name", "visitor_email",
            "chat_category", "channel", "status", "escalation_status",
            "user_type", "started_on", "closed_on", "confidence",
            "human_agent", "origin_host",
        ],
        as_dict=True,
    )
    if not conv:
        frappe.throw("Conversation not found.")

    messages = frappe.db.sql("""
        SELECT sender_type, message, confidence, message_time, sources_json
        FROM `tabNexus Live Message`
        WHERE conversation = %(name)s
        ORDER BY message_time ASC
    """, {"name": conv["name"]}, as_dict=True)

    for m in messages:
        try:
            m["sources"] = json.loads(m.get("sources_json") or "[]")
        except Exception:
            m["sources"] = []
        del m["sources_json"]

    return {"conversation": conv, "messages": messages}


@frappe.whitelist()
def get_filter_options():
    """Returns distinct categories and channels for filter dropdowns."""
    _check_permission()
    tenant = _get_current_tenant()
    dev_filter = _dev_origin_filter("c")
    tf = _conv_tenant_filter("c", tenant)

    categories = frappe.db.sql(f"""
        SELECT DISTINCT chat_category AS value
        FROM `tabNexus Live Conversation` c
        WHERE chat_category IS NOT NULL AND chat_category != ''
          AND {dev_filter} {tf}
        ORDER BY chat_category
    """, as_dict=True)

    return {
        "categories": [r["value"] for r in categories],
        "statuses": ["Open", "Waiting", "Responding", "Escalated", "Handed Over", "Closed"],
    }


@frappe.whitelist()
def get_knowledge_hit_list(
    page=1, page_size=50, topic_filter=None, unit_filter=None,
    date_from=None, date_to=None, search=None
):
    """Paginated Knowledge Hit log with optional filters."""
    _check_permission()
    page = max(1, int(page))
    page_size = max(10, min(int(page_size), 200))
    offset = (page - 1) * page_size

    tenant = _get_current_tenant()
    conditions = ["h.origin_host NOT LIKE '%%127.0.0.1%%'",
                  "h.origin_host NOT LIKE '%%localhost%%'"]
    if tenant:
        conditions.append(f"h.tenant = {frappe.db.escape(tenant)}")
    values = {}

    if topic_filter:
        conditions.append("h.topic LIKE %(topic_filter)s")
        values["topic_filter"] = f"%%{topic_filter}%%"

    if unit_filter:
        conditions.append("h.knowledge_unit = %(unit_filter)s")
        values["unit_filter"] = unit_filter

    if date_from:
        conditions.append("DATE(h.hit_time) >= %(date_from)s")
        values["date_from"] = date_from

    if date_to:
        conditions.append("DATE(h.hit_time) <= %(date_to)s")
        values["date_to"] = date_to

    if search:
        conditions.append("""(
            h.topic LIKE %(search)s OR
            h.knowledge_title LIKE %(search)s OR
            h.knowledge_unit LIKE %(search)s OR
            h.chunk LIKE %(search)s OR
            h.context_path LIKE %(search)s
        )""")
        values["search"] = f"%%{search}%%"

    where = " AND ".join(conditions)

    rows = frappe.db.sql(f"""
        SELECT
            h.name,
            h.hit_time,
            h.topic,
            h.knowledge_title,
            h.knowledge_unit,
            h.context_path,
            h.chunk,
            h.score,
            h.final_score,
            h.conversation,
            h.context,
            h.sub_context
        FROM `tabNexus Knowledge Hit` h
        WHERE {where}
        ORDER BY h.hit_time DESC
        LIMIT {page_size} OFFSET {offset}
    """, values=values, as_dict=True)

    total_row = frappe.db.sql(f"""
        SELECT COUNT(*) AS cnt FROM `tabNexus Knowledge Hit` h WHERE {where}
    """, values=values, as_dict=True)

    total = (total_row[0].get("cnt") or 0) if total_row else 0

    # KPI summary for visible filtered set
    kpi = frappe.db.sql(f"""
        SELECT
            COUNT(*)                              AS total_hits,
            COUNT(DISTINCT h.topic)               AS unique_topics,
            COUNT(DISTINCT h.knowledge_unit)      AS unique_units,
            COUNT(DISTINCT h.conversation)        AS unique_conversations,
            ROUND(AVG(h.score), 4)                AS avg_score,
            ROUND(AVG(h.final_score), 4)          AS avg_final_score
        FROM `tabNexus Knowledge Hit` h
        WHERE {where}
    """, values=values, as_dict=True)

    return {
        "rows": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, -(-total // page_size)),
        "kpi": kpi[0] if kpi else {},
    }


@frappe.whitelist()
def get_knowledge_hit_topic_chart(topic_filter=None, date_from=None, date_to=None, limit=15):
    """Top topics by hit count for the bar chart on the Knowledge Hits page."""
    _check_permission()
    tenant = _get_current_tenant()
    limit = max(1, min(int(limit), 30))

    conditions = ["h.origin_host NOT LIKE '%%127.0.0.1%%'",
                  "h.origin_host NOT LIKE '%%localhost%%'"]
    if tenant:
        conditions.append(f"h.tenant = {frappe.db.escape(tenant)}")
    values = {}

    if topic_filter:
        conditions.append("h.topic LIKE %(topic_filter)s")
        values["topic_filter"] = f"%%{topic_filter}%%"

    if date_from:
        conditions.append("DATE(h.hit_time) >= %(date_from)s")
        values["date_from"] = date_from

    if date_to:
        conditions.append("DATE(h.hit_time) <= %(date_to)s")
        values["date_to"] = date_to

    where = " AND ".join(conditions)

    rows = frappe.db.sql(f"""
        SELECT
            COALESCE(h.topic, h.knowledge_title, h.knowledge_unit, h.chunk) AS label,
            COUNT(*) AS hit_count,
            COUNT(DISTINCT h.conversation) AS conversations,
            ROUND(AVG(h.final_score), 4) AS avg_score
        FROM `tabNexus Knowledge Hit` h
        WHERE {where}
        GROUP BY label
        ORDER BY hit_count DESC
        LIMIT {limit}
    """, values=values, as_dict=True)

    return rows


@frappe.whitelist()
def get_knowledge_hit_filter_options():
    """Distinct knowledge units for the filter dropdown."""
    _check_permission()
    tenant = _get_current_tenant()
    tenant_cond = f"AND tenant = {frappe.db.escape(tenant)}" if tenant else ""
    rows = frappe.db.sql(f"""
        SELECT DISTINCT knowledge_unit AS value
        FROM `tabNexus Knowledge Hit`
        WHERE knowledge_unit IS NOT NULL AND knowledge_unit != ''
          AND origin_host NOT LIKE '%%127.0.0.1%%'
          AND origin_host NOT LIKE '%%localhost%%'
          {tenant_cond}
        ORDER BY knowledge_unit
        LIMIT 100
    """, as_dict=True)
    return [r["value"] for r in rows]


@frappe.whitelist()
def get_country_stats():
    """
    Country-wise breakdown: session count, unique visitors, conversations, avg session duration.
    Primary source is Nexus Web Session; falls back to Nexus Live Conversation visitor_country.
    """
    _check_permission()
    tenant = _get_current_tenant()
    svtf = _visitor_tenant_filter("s", tenant)

    # Sessions with country from the visitor analytics tables
    session_rows = frappe.db.sql(f"""
        SELECT
            COALESCE(s.country, 'Unknown') AS country,
            COUNT(*)                        AS session_count,
            COUNT(DISTINCT s.visitor)       AS visitor_count,
            ROUND(AVG(s.total_duration_seconds), 0) AS avg_duration_seconds
        FROM `tabNexus Web Session` s
        WHERE s.country IS NOT NULL AND s.country != '' {svtf}
        GROUP BY s.country
        ORDER BY session_count DESC
        LIMIT 30
    """, as_dict=True)

    # Conversations per country (using visitor_country stamped at chat start)
    dev_filter = _dev_origin_filter("c")
    conv_rows = frappe.db.sql(f"""
        SELECT
            COALESCE(c.visitor_country, 'Unknown') AS country,
            COUNT(*) AS conversation_count
        FROM `tabNexus Live Conversation` c
        WHERE c.visitor_country IS NOT NULL AND c.visitor_country != ''
          AND {dev_filter} {_conv_tenant_filter("c", tenant)}
        GROUP BY c.visitor_country
    """, as_dict=True)

    conv_map = {r["country"]: r["conversation_count"] for r in conv_rows}

    for row in session_rows:
        row["conversation_count"] = conv_map.get(row["country"], 0)

    # Include countries that appear only in conversations but not in sessions
    session_countries = {r["country"] for r in session_rows}
    for row in conv_rows:
        if row["country"] not in session_countries and row["country"] != "Unknown":
            session_rows.append({
                "country": row["country"],
                "session_count": 0,
                "visitor_count": 0,
                "avg_duration_seconds": 0,
                "conversation_count": row["conversation_count"],
            })

    session_rows.sort(key=lambda r: r["session_count"], reverse=True)
    return session_rows


@frappe.whitelist()
def get_page_visit_stats(limit=20, path_filter=None):
    """
    Top pages by visit count with average duration metrics.
    Grouped by page_path for normalised comparison.
    """
    _check_permission()
    tenant = _get_current_tenant()
    limit = max(1, min(int(limit), 100))
    path_cond = "AND v.page_path LIKE %(path_filter)s" if path_filter else ""
    tf = _visitor_tenant_filter("v", tenant)

    rows = frappe.db.sql(f"""
        SELECT
            v.page_path,
            MAX(v.page_title)                   AS page_title,
            COUNT(*)                             AS visit_count,
            COUNT(DISTINCT v.visitor)            AS unique_visitors,
            ROUND(AVG(v.duration_seconds), 0)    AS avg_duration_seconds,
            ROUND(AVG(v.active_duration_seconds), 0) AS avg_active_seconds,
            SUM(v.duration_seconds)              AS total_duration_seconds
        FROM `tabNexus Web Page Visit` v
        WHERE v.page_path IS NOT NULL AND v.page_path != ''
          AND v.status IN ('Active', 'Completed')
          {path_cond} {tf}
        GROUP BY v.page_path
        ORDER BY visit_count DESC
        LIMIT {limit}
    """, values={"path_filter": f"%{path_filter}%"} if path_filter else {}, as_dict=True)

    return rows


@frappe.whitelist()
def get_visitor_list(page=1, page_size=25, country_filter=None, search=None):
    """
    Visitor-centric list: one row per Nexus Web Visitor with session/page/conversation counts.
    """
    _check_permission()
    tenant = _get_current_tenant()
    page = max(1, int(page))
    page_size = max(5, min(int(page_size), 100))
    offset = (page - 1) * page_size

    conditions = ["1=1"]
    values = {}
    if tenant:
        conditions.append(f"v.tenant = {frappe.db.escape(tenant)}")
    if country_filter:
        conditions.append("v.country = %(country_filter)s")
        values["country_filter"] = country_filter
    if search:
        conditions.append("v.visitor_id LIKE %(search)s")
        values["search"] = f"%{search}%"
    where = " AND ".join(conditions)

    rows = frappe.db.sql(f"""
        SELECT
            v.visitor_id,
            v.visitor_type,
            v.first_seen,
            v.last_seen,
            v.country,
            v.city,
            v.device_type,
            v.browser,
            v.os,
            (SELECT COUNT(*) FROM `tabNexus Web Session` s WHERE s.visitor = v.name)     AS session_count,
            (SELECT COUNT(*) FROM `tabNexus Web Page Visit` p WHERE p.visitor = v.name)  AS page_count,
            (SELECT COUNT(*) FROM `tabNexus Live Conversation` c WHERE c.web_visitor = v.name) AS conversation_count
        FROM `tabNexus Web Visitor` v
        WHERE {where}
        ORDER BY v.last_seen DESC
        LIMIT {page_size} OFFSET {offset}
    """, values=values, as_dict=True)

    total_row = frappe.db.sql(f"""
        SELECT COUNT(*) AS cnt FROM `tabNexus Web Visitor` v WHERE {where}
    """, values=values, as_dict=True)

    total = (total_row[0].get("cnt") or 0) if total_row else 0

    return {
        "rows": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, -(-total // page_size)),
    }


@frappe.whitelist()
def get_visitor_journey(visitor_id):
    """
    Full journey for one Nexus Web Visitor:
      visitor metadata → sessions → page visits per session → linked conversations with messages.
    """
    _check_permission()
    tenant = _get_current_tenant()
    if not visitor_id:
        frappe.throw("visitor_id is required.")

    visitor = frappe.db.get_value(
        "Nexus Web Visitor", visitor_id,
        ["name", "visitor_id", "visitor_type", "first_seen", "last_seen",
         "country", "city", "device_type", "browser", "os", "tenant"],
        as_dict=True,
    )
    if not visitor:
        frappe.throw("Visitor not found.")

    # Enforce tenant isolation: non-System-Manager users can only view their own tenant's visitors
    if tenant and visitor.get("tenant") != tenant:
        frappe.throw("Not permitted.", frappe.PermissionError)

    # Sessions for this visitor
    sessions = frappe.db.sql("""
        SELECT session_id, started_on, ended_on, status,
               landing_page, exit_page, referrer,
               utm_source, utm_campaign,
               page_count, total_duration_seconds, active_duration_seconds,
               country, city, device_type, browser
        FROM `tabNexus Web Session`
        WHERE visitor = %s
        ORDER BY started_on ASC
    """, (visitor["name"],), as_dict=True)

    for sess in sessions:
        sid = sess["session_id"]

        # Page visits for this session
        sess["pages"] = frappe.db.sql("""
            SELECT page_path, page_title, page_url,
                   started_on, duration_seconds, active_duration_seconds, status
            FROM `tabNexus Web Page Visit`
            WHERE session = %s
            ORDER BY started_on ASC
        """, (sid,), as_dict=True)

        # Conversations linked to this session
        convs = frappe.db.sql("""
            SELECT conversation_id, status, started_on, closed_on,
                   visitor_name, visitor_email, chat_category,
                   escalation_status, confidence, source_page_url
            FROM `tabNexus Live Conversation`
            WHERE web_session = %s OR web_session_id = %s
            ORDER BY started_on ASC
        """, (sid, sid), as_dict=True)

        for conv in convs:
            conv["messages"] = frappe.db.sql("""
                SELECT sender_type, message, confidence, message_time
                FROM `tabNexus Live Message`
                WHERE conversation = (
                    SELECT name FROM `tabNexus Live Conversation`
                    WHERE conversation_id = %s LIMIT 1
                )
                ORDER BY message_time ASC
            """, (conv["conversation_id"],), as_dict=True)

        sess["conversations"] = convs

    return {"visitor": visitor, "sessions": sessions}


def _check_permission():
    if frappe.session.user == "Guest":
        frappe.throw("Not permitted.", frappe.PermissionError)


def _get_current_tenant():
    """
    Resolve the active tenant for the logged-in desk user.
    Returns None for System Managers (they see all tenants).

    Priority:
      1. Nexus User Context.active_tenant  (user's last selected tenant)
      2. Nexus Settings.default_tenant     (system-wide fallback)
    """
    if "System Manager" in frappe.get_roles(frappe.session.user):
        return None  # no filter — System Manager sees everything

    try:
        if frappe.db.exists("DocType", "Nexus User Context"):
            tenant = frappe.db.get_value(
                "Nexus User Context",
                {"user": frappe.session.user, "is_default": 1},
                "active_tenant",
            )
            if tenant:
                return tenant

        if frappe.db.exists("DocType", "Nexus Settings"):
            tenant = frappe.db.get_single_value("Nexus Settings", "default_tenant")
            if tenant:
                return tenant
    except Exception:
        pass

    return None
