"""Keep local PDF navigation consistent when deleting pages in place."""
from pymupdf import mupdf


def _keep_destination(destination, pages, retained):
    """Local explicit destinations normally reference the page object, which survives renumbering."""
    if destination.pdf_is_dict():
        destination = destination.pdf_dict_gets("D")
    if not destination.pdf_is_array() or not destination.pdf_array_len():
        return False
    target = destination.pdf_array_get(0)
    if target.pdf_is_int():
        # Some producers use a zero-based page index for a local destination.
        index = target.pdf_to_int()
        if not 0 <= index < len(pages):
            return False
        target = pages[index]
        destination.pdf_array_put(0, target)
    return target.pdf_to_num() in retained


def _prune_names(catalog, pages, retained):
    old = catalog.pdf_dict_gets("Dests")
    for i in reversed(range(old.pdf_dict_len())):
        if not _keep_destination(old.pdf_dict_get_val(i), pages, retained):
            old.pdf_dict_del(old.pdf_dict_get_key(i))

    tree = catalog.pdf_dict_getp("Names/Dests")
    if not tree.pdf_is_dict():
        return
    # A single root leaf is a valid name tree. Preserve original key bytes, ordering,
    # destination objects and every other /Names collection (including attachments).
    pending = [tree]
    visited = set()
    pairs = []
    removed = False
    while pending:
        node = pending.pop()
        ref = node.pdf_to_num()
        if ref and ref in visited:
            raise ValueError("Invalid PDF destination name tree")
        visited.add(ref)
        kids = node.pdf_dict_gets("Kids")
        pending.extend(kids.pdf_array_get(i) for i in reversed(range(kids.pdf_array_len())))
        names = node.pdf_dict_gets("Names")
        for i in range(0, names.pdf_array_len(), 2):
            value = names.pdf_array_get(i + 1)
            if _keep_destination(value, pages, retained):
                pairs.append((names.pdf_array_get(i), value))
            else:
                removed = True
    if removed:
        tree.pdf_dict_dels("Kids")
        tree.pdf_dict_dels("Limits")
        names = tree.pdf_dict_put_array(mupdf.pdf_new_name("Names"), len(pairs) * 2)
        for key, value in pairs:
            names.pdf_array_push(key)
            names.pdf_array_push(value)


def delete_pages_with_bookmarks(doc, indices):
    pdf = mupdf.pdf_document_from_fz_document(doc)
    catalog = mupdf.pdf_trailer(pdf).pdf_dict_gets("Root")
    pages = [mupdf.pdf_new_indirect(pdf, doc.page_xref(i), 0) for i in range(len(doc))]
    retained = {page.pdf_to_num() for page in pages}
    retained.difference_update(pages[i].pdf_to_num() for i in indices)

    def keep_target(dest, action):
        if dest.pdf_is_null():
            if action.pdf_dict_gets("S").pdf_to_name() != "GoTo":
                return True  # Organizational headings and nonlocal actions.
            dest = action.pdf_dict_gets("D")
        if dest.pdf_is_string() or dest.pdf_is_name():
            dest = mupdf.pdf_lookup_dest(pdf, dest)
        return _keep_destination(dest, pages, retained)

    # Preserve item identities and all original action, destination view and style fields.
    # A removed parent's children inherit its nearest surviving ancestor in reading order.
    root = catalog.pdf_dict_gets("Outlines")
    nodes = {0: root}
    children = {0: []}
    ancestors = [0]
    removed = False
    for (level, _, _), xref in zip(doc.get_toc(), doc.get_outline_xrefs(), strict=True):
        del ancestors[level:]
        parent = ancestors[-1]
        node = mupdf.pdf_new_indirect(pdf, xref, 0)
        dest = node.pdf_dict_gets("Dest")
        action = node.pdf_dict_gets("A")
        if not keep_target(dest, action):
            ancestors.append(parent)
            removed = True
            continue
        nodes[xref] = node
        children[xref] = []
        children[parent].append(xref)
        ancestors.append(xref)

    # Named destinations can also be shared by page links and the initial view.
    # Resolve them before removing their name-tree entries.
    opening = catalog.pdf_dict_gets("OpenAction")
    null = mupdf.PdfObj()
    if opening.pdf_is_dict():
        keep_opening = keep_target(null, opening)
    else:
        keep_opening = keep_target(opening, null)
    if not keep_opening:
        catalog.pdf_dict_dels("OpenAction")
    for page in pages:
        if page.pdf_to_num() in retained:
            annots = page.pdf_dict_gets("Annots")
            for i in reversed(range(annots.pdf_array_len())):
                annot = annots.pdf_array_get(i)
                if (annot.pdf_dict_gets("Subtype").pdf_to_name() == "Link"
                        and not keep_target(annot.pdf_dict_gets("Dest"), annot.pdf_dict_gets("A"))):
                    annots.pdf_array_delete(i)
    doc.delete_pages(indices)
    _prune_names(catalog, pages, retained)
    if not removed:
        return
    if not children[0]:
        catalog.pdf_dict_dels("Outlines")
        return

    # Rebuild only the structural links. Reverse preorder makes each child's visible
    # descendant count available when computing its parent's signed /Count.
    visible = {}
    for parent in reversed(children):
        node = nodes[parent]
        siblings = children[parent]
        expanded = node.pdf_dict_gets("Count").pdf_to_int() >= 0 or parent == 0
        count = sum(1 + visible[child] for child in siblings)
        visible[parent] = count if expanded else 0
        if not siblings:
            for key in ("First", "Last", "Count"):
                node.pdf_dict_dels(key)
            continue
        node.pdf_dict_puts("First", nodes[siblings[0]])
        node.pdf_dict_puts("Last", nodes[siblings[-1]])
        node.pdf_dict_puts("Count", mupdf.pdf_new_int(count if expanded else -count))
        for i, child in enumerate(siblings):
            item = nodes[child]
            item.pdf_dict_puts("Parent", node)
            for key, neighbor in (("Prev", i - 1), ("Next", i + 1)):
                if 0 <= neighbor < len(siblings):
                    item.pdf_dict_puts(key, nodes[siblings[neighbor]])
                else:
                    item.pdf_dict_dels(key)

