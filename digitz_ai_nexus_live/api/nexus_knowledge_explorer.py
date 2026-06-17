import frappe


@frappe.whitelist()
def get_tenants():
    return frappe.get_all(
        "Nexus Tenant",
        filters={"disabled": 0},
        fields=["name", "tenant_name", "tenant_code"],
        order_by="tenant_name asc",
    )


@frappe.whitelist()
def get_explorer_data(
    tenant=None,
    business_unit=None,
    context=None,
    sub_context=None,
    entity_type=None,
    entity=None,
    topic=None,
    sensitivity=None,
    status=None,
    search=None,
    page=1,
    page_size=20,
):
    page = int(page or 1)
    page_size = int(page_size or 20)
    offset = (page - 1) * page_size

    # Base filters
    base = {}
    if tenant:
        base["tenant"] = tenant
    if business_unit:
        base["business_unit"] = business_unit
    if context:
        base["context"] = context
    if sub_context:
        base["sub_context"] = sub_context
    if entity_type:
        base["entity_type"] = entity_type
    if entity:
        base["entity"] = entity
    if topic:
        base["topic"] = topic
    if sensitivity:
        base["sensitivity"] = sensitivity
    if status:
        base["status"] = status

    fields = [
        "name", "title",
        "tenant", "business_unit", "project",
        "context", "sub_context", "entity_type", "entity", "topic", "context_path",
        "status", "sensitivity", "access_policy",
        "chunk_count", "embedding_status",
        "modified",
    ]

    if search:
        search_val = f"%{search}%"
        where_parts = ["(`tabNexus Knowledge Unit`.`status` != 'Archived')"]
        params = {"search": search_val, "limit": page_size, "offset": offset}

        for k, v in base.items():
            where_parts.append(f"`tabNexus Knowledge Unit`.`{k}` = %({k})s")
            params[k] = v

        where_parts.append(
            "(`tabNexus Knowledge Unit`.`title` LIKE %(search)s "
            "OR `tabNexus Knowledge Unit`.`topic` LIKE %(search)s "
            "OR `tabNexus Knowledge Unit`.`entity` LIKE %(search)s "
            "OR `tabNexus Knowledge Unit`.`sub_context` LIKE %(search)s)"
        )

        where_clause = " AND ".join(where_parts)
        field_list = ", ".join(
            f"`tabNexus Knowledge Unit`.`{f}`" for f in fields
        )

        units = frappe.db.sql(
            f"""
            SELECT {field_list},
                   LEFT(`tabNexus Knowledge Unit`.`content`, 400) AS content_preview
            FROM `tabNexus Knowledge Unit`
            WHERE {where_clause}
            ORDER BY `tabNexus Knowledge Unit`.`modified` DESC
            LIMIT %(limit)s OFFSET %(offset)s
            """,
            params,
            as_dict=True,
        )

        count_row = frappe.db.sql(
            f"""
            SELECT COUNT(*) as cnt
            FROM `tabNexus Knowledge Unit`
            WHERE {where_clause}
            """,
            {k: v for k, v in params.items() if k not in ("limit", "offset")},
        )
        total = count_row[0][0] if count_row else 0

    else:
        base_no_archived = dict(base)
        if not status:
            base_no_archived["status"] = ["!=", "Archived"]

        total = frappe.db.count("Nexus Knowledge Unit", base_no_archived)

        units = frappe.get_all(
            "Nexus Knowledge Unit",
            filters=base_no_archived,
            fields=fields,
            order_by="modified desc",
            limit=page_size,
            start=offset,
        )

        # Fetch content preview separately for the fetched names
        if units:
            names = [u["name"] for u in units]
            placeholders = ", ".join(["%s"] * len(names))
            previews = frappe.db.sql(
                f"SELECT name, LEFT(content, 400) AS content_preview "
                f"FROM `tabNexus Knowledge Unit` WHERE name IN ({placeholders})",
                names,
                as_dict=True,
            )
            preview_map = {p["name"]: p["content_preview"] for p in previews}
            for u in units:
                u["content_preview"] = preview_map.get(u["name"], "")

    # Compute facets from the current tenant (not filtered further — show full picture)
    facets = _get_facets(tenant, base)
    stats = _get_stats(tenant)

    return {
        "units": units,
        "total": total,
        "page": page,
        "page_size": page_size,
        "facets": facets,
        "stats": stats,
    }


@frappe.whitelist()
def get_unit_detail(unit_name):
    if not unit_name:
        frappe.throw("Unit name is required.")

    unit = frappe.db.get_value(
        "Nexus Knowledge Unit",
        unit_name,
        [
            "name", "title", "content",
            "tenant", "business_unit", "project",
            "context", "sub_context", "entity_type", "entity", "topic", "context_path",
            "status", "sensitivity", "access_policy",
            "chunk_count", "embedding_status",
            "approved_by", "approved_on", "modified", "creation",
        ],
        as_dict=True,
    )
    if not unit:
        frappe.throw("Knowledge Unit not found.")

    # Compute active chunk count from the chunk table
    unit["active_chunk_count"] = frappe.db.count(
        "Nexus Knowledge Chunk",
        {"knowledge_unit": unit_name, "disabled": 0, "archived": 0},
    )

    # Fetch linked source
    source = frappe.db.get_value(
        "Nexus Knowledge Source",
        {"generated_knowledge_unit": unit_name},
        ["name", "title", "source_type", "status", "processing_status"],
        as_dict=True,
    )
    unit["source"] = source

    return unit


def _get_facets(tenant, applied_filters):
    """Return facet counts for all classification dimensions."""
    base = {}
    if tenant:
        base["tenant"] = tenant
    base["status"] = ["!=", "Archived"]

    def _counts(field):
        rows = frappe.db.sql(
            f"""
            SELECT `{field}` AS val, COUNT(*) AS cnt
            FROM `tabNexus Knowledge Unit`
            WHERE tenant = %(tenant)s AND `status` != 'Archived'
            AND `{field}` IS NOT NULL AND `{field}` != ''
            GROUP BY `{field}`
            ORDER BY cnt DESC
            """,
            {"tenant": tenant or ""},
            as_dict=True,
        )
        return [{"value": r["val"], "count": r["cnt"]} for r in rows]

    def _counts_global(field):
        """For when no tenant is selected."""
        rows = frappe.db.sql(
            f"""
            SELECT `{field}` AS val, COUNT(*) AS cnt
            FROM `tabNexus Knowledge Unit`
            WHERE `status` != 'Archived'
            AND `{field}` IS NOT NULL AND `{field}` != ''
            GROUP BY `{field}`
            ORDER BY cnt DESC
            """,
            as_dict=True,
        )
        return [{"value": r["val"], "count": r["cnt"]} for r in rows]

    fn = _counts if tenant else _counts_global

    return {
        "business_unit": fn("business_unit"),
        "context": fn("context"),
        "sub_context": fn("sub_context"),
        "entity_type": fn("entity_type"),
        "topic": fn("topic"),
        "sensitivity": fn("sensitivity"),
        "status": fn("status"),
    }


def _get_stats(tenant):
    """Return high-level statistics for the knowledge base."""
    t_filter = f"AND tenant = %s" if tenant else ""
    t_val = [tenant] if tenant else []

    def _count(table, extra=""):
        row = frappe.db.sql(
            f"SELECT COUNT(*) FROM `tab{table}` WHERE 1=1 {t_filter} {extra}",
            t_val,
        )
        return row[0][0] if row else 0

    total_sources = _count("Nexus Knowledge Source")
    published_sources = _count("Nexus Knowledge Source", "AND status = 'Published'")
    total_units = _count("Nexus Knowledge Unit", "AND status != 'Archived'")
    active_units = _count("Nexus Knowledge Unit", "AND status = 'Active'")
    total_chunks = _count("Nexus Knowledge Chunk", "AND disabled = 0 AND archived = 0")
    embedded_chunks = _count("Nexus Knowledge Chunk", "AND disabled = 0 AND archived = 0 AND embedding_status = 'Completed'")
    pending_approval = _count("Nexus Knowledge Unit", "AND status IN ('Review', 'Draft')")

    # Last modified knowledge unit
    last_row = frappe.db.sql(
        f"SELECT modified FROM `tabNexus Knowledge Unit` WHERE 1=1 {t_filter} ORDER BY modified DESC LIMIT 1",
        t_val,
    )
    last_updated = last_row[0][0] if last_row else None

    return {
        "total_sources": total_sources,
        "published_sources": published_sources,
        "total_units": total_units,
        "active_units": active_units,
        "total_chunks": total_chunks,
        "embedded_chunks": embedded_chunks,
        "pending_approval": pending_approval,
        "last_updated": str(last_updated) if last_updated else None,
        "embedding_coverage": round(embedded_chunks / total_chunks * 100) if total_chunks else 0,
    }
