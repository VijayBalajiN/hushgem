#!/usr/bin/env python3
"""Build docs/index.html: one self-contained page for GitHub Pages (or any static host).

It is the same game as index.html, with engine.js, the mqtt.js browser bundle and relay.js inlined, so live tables work
outside claude.ai. Run:  python3 build-site.py
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
def read(*p):
    with open(os.path.join(HERE, *p), encoding='utf-8') as f:
        return f.read()

page, engine, relay = read('index.html'), read('engine.js'), read('relay.js')
mqtt = read('vendor', 'mqtt.min.js')

def inline(js):
    # keep the source from closing its own <script> tag or opening an HTML comment
    return js.replace('</script', '<\\/script').replace('<!--', '<\\!--')

tag = '<script src="engine.js"></script>'
assert page.count(tag) == 1, 'engine script tag not found exactly once'
scripts = ('<script>\n' + inline(engine) + '\n</script>\n'
           '<script>\n' + inline(mqtt) + '\n</script>\n'
           '<script>\n' + inline(relay) + '\n</script>')
body = page.replace(tag, scripts)

head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<meta name="description" content="Hushgem: practise sealed-bid gem auctions against bots or with friends.">\n'
        '<meta name="robots" content="noindex,nofollow">\n'
        '<style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>\n')
out = head + body.rstrip() + '\n</body>\n</html>\n'

# the page uses only ASCII outside the inlined libraries, but make sure the file is valid UTF-8 text throughout
os.makedirs(os.path.join(HERE, 'docs'), exist_ok=True)
with open(os.path.join(HERE, 'docs', 'index.html'), 'w', encoding='utf-8') as f:
    f.write(out)
print('docs/index.html', len(out.encode('utf-8')), 'bytes')
