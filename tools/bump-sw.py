"""docs/sw.js の VERSION を現在時刻のスタンプに書き換える（公開前に必ず実行する）。

Service Worker はファイルの中身が1バイトでも変わらないと更新されない。
アプリのJSだけ直して sw.js を変えないと、端末は古いキャッシュを使い続け、「更新」の案内も出ない。
"""
import datetime
import io
import re
import sys

PATH = 'docs/sw.js'
stamp = datetime.datetime.now().strftime('v%Y%m%d-%H%M')
s = io.open(PATH, encoding='utf-8').read()
new, n = re.subn(r"const VERSION = '[^']*';", f"const VERSION = '{stamp}';", s, count=1)
if n != 1:
    sys.exit('VERSION の行が見つかりません: ' + PATH)
io.open(PATH, 'w', encoding='utf-8', newline='\n').write(new)
print('sw.js VERSION ->', stamp)
