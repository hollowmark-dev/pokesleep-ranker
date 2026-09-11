#!/usr/bin/env python3
# 管理者モードの合言葉から SHA-256 hex を作る小道具。
# 出力した hex を docs/js/data/defaults.js の ADMIN_PASS_HASH に貼る。
# 合言葉そのものはリポジトリに置かないこと。
#
#   使い方: python tools/hash-pass.py <合言葉>

import hashlib
import sys


def main() -> int:
    if len(sys.argv) != 2 or not sys.argv[1]:
        sys.stderr.write(
            "usage: python tools/hash-pass.py <passphrase>\n"
            "  合言葉の SHA-256 (UTF-8) を16進で表示します。\n"
        )
        return 1
    print(hashlib.sha256(sys.argv[1].encode("utf-8")).hexdigest())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
