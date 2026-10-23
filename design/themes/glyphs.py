# Solid glyphs for the Snow Leopard theme's toolbar buttons, each in two:
# <name>.svg (dark grey, a white line under it, pressed into a light
# capsule) and <name>-dark.svg (light grey on a black line, for Aperture).
# Writes app/themes/snow/glyphs/. These are the buttons drawn after the
# first set; the first set was drawn the same way.
import os

G = {
    'scan': '<path d="M1 2.5h14v3H1z"/><path fill-rule="evenodd" d="M.5 7h15a.5.5 0 0 1 .5.5V13a.5.5 0 0 1-.5.5H.5A.5.5 0 0 1 0 13V7.5A.5.5 0 0 1 .5 7zM2 9v1.5h12V9z"/>',
    'camera': '<path fill-rule="evenodd" d="M1 4.2h3.4L5.9 2h4.2l1.5 2.2H15a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1V5.2a1 1 0 0 1 1-1zM8 5.6a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6zm0 1.7a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z"/>',
    'adjust': '<path d="M1 3.1h14v1.6H1zM1 7.2h14v1.6H1zM1 11.3h14v1.6H1z"/><circle cx="10.5" cy="3.9" r="2.3"/><circle cx="5" cy="8" r="2.3"/><circle cx="11" cy="12.1" r="2.3"/>',
    'paint': '<path d="M15.3.7a1.5 1.5 0 0 1 0 2.1L9.2 9 7 6.8 13.2.7a1.5 1.5 0 0 1 2.1 0zM6.2 7.6l2.2 2.2c-.3 2.8-2.3 4.7-5.2 4.7H0c1.6-1 1.7-2.3 2-3.5.4-1.9 2-3.3 4.2-3.4z"/>',
    'dupes': '<path fill-rule="evenodd" d="M4.5 1H15v8.5h-2V3H4.5z"/><path fill-rule="evenodd" d="M1 5h10v9.5H1zm1.6 1.6v6.3h6.8V6.6zM3.2 12.3l2.1-3 1.5 2 1-1.3 1.5 2.3z"/>',
    'fullscreen': '<path d="M1 1h5.2v1.9H2.9v3.3H1zM9.8 1H15v5.2h-1.9V2.9H9.8zM1 9.8h1.9v3.3h3.3V15H1zM13.1 9.8H15V15H9.8v-1.9h3.3z"/>',
    'keys': '<path fill-rule="evenodd" d="M1 3.5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM2 5.5v1.6h1.6V5.5zm3 0v1.6h1.6V5.5zm3 0v1.6h1.6V5.5zm3 0v1.6h1.6V5.5zM3.5 8.3v1.6h1.6V8.3zm3 0v1.6h1.6V8.3zm3 0v1.6h1.6V8.3zM4 10.8v1.4h8v-1.4z"/>',
    'whatsnew': '<path d="M8 .6l2.2 4.6 5 .7-3.6 3.5.9 5L8 12 3.5 14.4l.9-5L.8 5.9l5-.7z"/>',
    'settings': '<path fill-rule="evenodd" d="M4.5 4h7a4 4 0 0 1 0 8h-7a4 4 0 0 1 0-8zm6.8 1.7a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z"/>',
    'fit': '<path fill-rule="evenodd" d="M0 2h16v12H0zm1.6 1.6v8.8h12.8V3.6z"/><path d="M4 5.5h8v5H4z"/>',
    'strip': '<path fill-rule="evenodd" d="M0 3h16v10H0zm1.2 1v1.3h1.4V4zm3 0v1.3h1.4V4zm3 0v1.3h1.4V4zm3 0v1.3h1.4V4zm3 0v1.3h1.4V4zM1.2 10.7V12h1.4v-1.3zm3 0V12h1.4v-1.3zm3 0V12h1.4v-1.3zm3 0V12h1.4v-1.3zm3 0V12h1.4v-1.3zM2 6.3v3.4h5.4V6.3zm6.6 0v3.4H14V6.3z"/>',
}

def svg(body, ink, line, line_dy, line_op):
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="17" viewBox="0 0 16 17">'
            f'<g transform="translate(0 {line_dy})" opacity="{line_op}"><g fill="{line}">{body}</g></g>'
            f'<g transform="translate(0 {1 - line_dy})"><g fill="{ink}">{body}</g></g></svg>')

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../app/themes/snow/glyphs')
for name, body in G.items():
    with open(os.path.join(out, name + '.svg'), 'w') as f:
        f.write(svg(body, '#383838', '#ffffff', 1, 0.75))
    with open(os.path.join(out, name + '-dark.svg'), 'w') as f:
        f.write(svg(body, '#e6e6e6', '#000000', 0, 0.8))
print('ok')
