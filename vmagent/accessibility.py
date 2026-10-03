"""Accessibility helpers inside the VM: read the focused tab's URL, the focused
element's role, and the interactive elements of the page. Used instead of pixels."""
import os, sys, json
os.environ.setdefault('DISPLAY', ':0')
import pyatspi

def chrome():
    for app in pyatspi.Registry.getDesktop(0):
        if app and 'hrome' in (app.name or ''):
            return app

def walk(node, depth=0):
    try:
        yield node, depth
    except Exception:
        return
    if depth > 25:
        return
    for i in range(getattr(node, 'childCount', 0)):
        try:
            child = node.getChildAtIndex(i)
        except Exception:
            continue
        if child is not None:
            yield from walk(child, depth + 1)

def role(n):
    try: return pyatspi.ROLE_NAMES.get(n.getRole(), str(n.getRole()))
    except Exception: return '?'

def text(n):
    try: return n.queryText().getText(0, -1)
    except Exception: return ''

def url():
    app = chrome()
    for n, _ in walk(app) if app else []:
        if role(n) == 'entry' and 'Address' in (n.name or ''):
            return text(n)
    return ''

def focused():
    app = chrome()
    for n, _ in walk(app) if app else []:
        try:
            st = n.getState()
            if st.contains(pyatspi.STATE_FOCUSED):
                return {'role': role(n), 'name': n.name or '',
                        'password': bool(st.contains(pyatspi.STATE_EDITABLE)) and role(n) == 'password text'}
        except Exception:
            pass
    return {}

INTERACTIVE = {
    'entry', 'password text', 'push button', 'toggle button', 'link', 'check box',
    'radio button', 'combo box', 'list item', 'menu item', 'slider', 'spin button',
    'tab', 'text',
}
# Roles that carry visible text. Pages built out of divs surface as section/static,
# so excluding them hides most of the real web (MiniWoB, any div-built UI).
TEXTUAL = {'heading', 'paragraph', 'static', 'label', 'section', 'list item', 'table cell'}


def clickable(n):
    """A node is actionable if it exposes an action other than the generic ones."""
    try:
        a = n.queryAction()
        names = {a.getName(i).lower() for i in range(a.nActions)}
        return bool(names & {'click', 'press', 'jump', 'activate', 'toggle', 'open'})
    except Exception:
        return False


def label_of(n):
    name = (n.name or '').strip()
    if name:
        return name
    txt = text(n).strip()
    # drop the object-replacement chars Chrome uses for embedded children
    txt = ''.join(c for c in txt if c != '\ufffc').strip()
    return txt


def web_document(app):
    """The tab's page, not the browser UI: the web document with the most nodes."""
    best, best_size = None, -1
    for n, _ in walk(app):
        if role(n) in ('document web', 'document frame'):
            size = sum(1 for _ in walk(n))
            if size > best_size:
                best, best_size = n, size
    return best


def fields():
    app = chrome()
    doc_node = web_document(app) if app else None
    out = []
    seen = set()
    for n, _ in (walk(doc_node) if doc_node else []):
        r = role(n)
        if r in ('document web', 'document frame'):
            continue
        interactive = r in INTERACTIVE
        if not interactive and r not in TEXTUAL:
            continue
        label = label_of(n)
        if not label and r not in ('entry', 'password text', 'check box', 'radio button'):
            continue
        if len(label) > 120:
            label = label[:117] + '...'
        try:
            ext = n.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
            box = [ext.x, ext.y, ext.width, ext.height]
        except Exception:
            box = None
        if box and (box[2] <= 0 or box[3] <= 0):
            continue
        key = (label, tuple(box) if box else None)
        if key in seen:
            continue
        # Chrome repeats text down the tree: a paragraph, then its static children,
        # one per run of markup. Keep the parent, drop the fragments.
        if not interactive and out:
            prev = out[-1]['label']
            if label == prev or (len(label) < len(prev) and label in prev):
                continue
        seen.add(key)
        entry = {'role': r, 'label': label, 'box': box}
        if interactive or clickable(n):
            entry['click'] = True
        out.append(entry)
        if len(out) >= 150:
            break
    return out


def present():
    """Whether Chrome is published on the accessibility bus at all."""
    return {'chrome': chrome() is not None}


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'fields'
    print(json.dumps({'url': url, 'focus': focused, 'fields': fields, 'present': present}[cmd]()))
