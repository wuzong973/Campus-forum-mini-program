# -*- coding: utf-8 -*-
import sys, traceback
out = r"D:\校园论坛小程序\.workbuddy\py_check.txt"
with open(out, "w", encoding="utf-8") as f:
    f.write("python=%s\n" % sys.version.split()[0])
    try:
        import paramiko
        f.write("paramiko=%s\n" % paramiko.__version__)
    except Exception:
        f.write("paramiko_missing\n")
        f.write(traceback.format_exc())
