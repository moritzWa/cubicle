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

def fields():
    app = chrome()
    out = []
    doc = False
    for n, _ in walk(app) if app else []:
        r = role(n)
        if r in ('document web', 'document frame'):
            doc = True
        if doc and r in ('entry', 'password text', 'push button', 'link', 'check box', 'heading', 'paragraph'):
            try:
                ext = n.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
                box = [ext.x, ext.y, ext.width, ext.height]
            except Exception:
                box = None
            label = n.name or text(n)[:60]
            if label or r in ('entry', 'password text'):
                out.append({'role': r, 'label': label, 'box': box})
    return out

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'fields'
    print(json.dumps({'url': url, 'focus': focused, 'fields': fields}[cmd]()))
